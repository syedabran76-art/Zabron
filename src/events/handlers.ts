/**
 * Zabron — Event handler orchestration.
 *
 * Wires up messageCreate (snipe, AFK, automod, leveling, autoresponder,
 * custom commands), guildMemberAdd (welcome, autorole, antiraid),
 * guildMemberRemove (goodbye, invite), and audit-log-based antinuke
 * detection.
 */

import {
  Events,
  Message,
  GuildMember,
  AuditLogEvent,
  PermissionFlagsBits,
  ChannelType,
  Collection,
} from 'discord.js';

import { editSnipeCacheRef, snipeCacheRef } from '../commands/utility/util.js';
import { getAfk, clearAfk, getCustomCommand, incrementCustomCommandUsage, listAutoresponders, addXp, getLevelingUser, ensureInviteCache, getInviteCache, recordInviteUse, adjustInviteCount, setTempvoiceGenerator, getTempvoiceConfig, registerTempvoice, deleteTempvoice, getTempvoice } from '../db/repositories.js';
import { getDatabase } from '../db/database.js';
import { getAutomodConfig, getAntiraidConfig, getAntinukeConfig, isAutomodExempt, trackAntinukeEvent, isWhitelisted, isWhitelistedWithRoles } from '../services/security.js';
import { evaluateMessage } from '../services/automodScanner.js';
import { xpForLevel, levelFromXp } from '../commands/leveling/leveling.js';
import { resolveVariables } from '../utils/variables.js';
import { logEvent, buildActorInfo } from '../services/logging.js';
import { addWarning } from '../db/repositories.js';
import { setAfk } from '../db/repositories.js';
import { handleGiveawayJoin, handleGiveawayLeave } from '../commands/giveaways/giveaway.js';
import { runWorkflowsForTrigger } from '../services/automation.js';

const recentMessagesByGuild = new Map<string, { content: string; ts: number; author: string }[]>();

export function attachEventHandlers(client: any): void {
  client.on(Events.MessageCreate, (message: Message) => onMessage(message, client));
  client.on(Events.MessageUpdate, (_o: Message, n: Message) => onMessageUpdate(_o, n, client));
  client.on(Events.MessageDelete, (m: Message) => onMessageDelete(m));
  client.on(Events.GuildMemberAdd, (m: GuildMember) => onMemberAdd(m, client));
  client.on(Events.GuildMemberRemove, (m: GuildMember | { guild: any; user: any }) => onMemberRemove(m, client));
  client.on(Events.GuildMemberUpdate, (o: GuildMember, n: GuildMember) => onMemberUpdate(o, n, client));
  client.on(Events.GuildCreate, (g: any) => onGuildCreate(g, client));
  client.on(Events.VoiceStateUpdate, (o: any, n: any) => onVoiceStateUpdate(o, n, client));
  client.on(Events.ChannelCreate, (c: any) => onChannelChange(c, 'channel_create', client));
  client.on(Events.ChannelDelete, (c: any) => onChannelChange(c, 'channel_delete', client));
  // discord.js v14 renamed RoleCreate/RoleDelete to GuildRoleCreate/GuildRoleDelete.
  client.on(Events.GuildRoleCreate, (r: any) => onRoleChange(r, 'role_create', client));
  client.on(Events.GuildRoleDelete, (r: any) => onRoleChange(r, 'role_delete', client));
  client.on(Events.WebhooksUpdate as any, (c: any) => onWebhookUpdate(c, client));
  client.on(Events.InteractionCreate, (i: any) => onInteraction(i, client));
}

async function onMessage(message: Message, client: any): Promise<void> {
  if (!message.guild) return;
  if (message.author.bot) return;
  if (message.system) return;

  const guildId = message.guild.id;

  // AFK notify (mention reply)
  const mentioned = message.mentions.users;
  for (const user of mentioned.values()) {
    if (user.id === message.author.id) continue;
    const afk = getAfk(guildId, user.id);
    if (afk) {
      const elapsed = Math.floor((Date.now() - afk.since) / 1000);
      try {
        await message.reply({ content: `<@${user.id}> is AFK (${elapsed}s ago)${afk.reason ? `: ${afk.reason}` : ''}.`, allowedMentions: { repliedUser: false } });
      } catch {}
    }
  }

  // Self-AFK clear
  const selfAfk = getAfk(guildId, message.author.id);
  if (selfAfk) {
    clearAfk(guildId, message.author.id);
    try {
      await message.reply({ content: `Welcome back, <@${message.author.id}> — your AFK status was cleared.`, allowedMentions: { repliedUser: false } });
    } catch {}
  }

  // Snipe cache
  snipeCacheRef.set(message.channel.id, { content: message.content ?? '', author: message.author.id, ts: Date.now() });

  // Custom commands + autoresponder
  const guildSettings = getDatabase().prepare('SELECT prefix FROM guild_settings WHERE guild_id = ?').get(guildId) as any;
  const prefix: string = guildSettings?.prefix ?? '.';
  if (message.content.startsWith(prefix)) {
    const raw = message.content.slice(prefix.length).trim();
    const name = raw.split(/\s+/)[0]?.toLowerCase();
    if (name) {
      const cc = getCustomCommand(guildId, name);
      if (cc) {
        incrementCustomCommandUsage(guildId, name);
        const text = resolveVariables(cc.response, { user: message.member ?? undefined, guild: message.guild ?? undefined });
        if (cc.embed) {
          const { buildEmbed } = await import('../embeds/builders.js');
          await (message.channel as any).send({ embeds: [buildEmbed({ tone: 'info', description: text })] });
        } else {
          await (message.channel as any).send({ content: text, allowedMentions: { parse: [] } });
        }
        return;
      }
    }
  }

  // Autoresponder
  for (const ar of listAutoresponders(guildId)) {
    if (!ar.enabled) continue;
    const content = message.content;
    let matched = false;
    try {
      if (ar.match === 'exact') matched = content === ar.trigger;
      else if (ar.match === 'contains') matched = content.toLowerCase().includes(ar.trigger.toLowerCase());
      else if (ar.match === 'starts') matched = content.toLowerCase().startsWith(ar.trigger.toLowerCase());
      else if (ar.match === 'regex') matched = new RegExp(ar.trigger, 'i').test(content);
    } catch { continue; }
    if (matched) {
      const response = resolveVariables(ar.response, { user: message.member ?? undefined, guild: message.guild ?? undefined });
      try {
        await (message.channel as any).send({ content: response, allowedMentions: { parse: [] } });
      } catch {}
      break;
    }
  }

  // Track recent messages for automod
  const recent = recentMessagesByGuild.get(guildId) ?? [];
  recent.push({ content: message.content ?? '', ts: Date.now(), author: message.author.id });
  if (recent.length > 200) recent.splice(0, recent.length - 200);
  recentMessagesByGuild.set(guildId, recent);

  // Automod
  const am = getAutomodConfig(guildId);
  if (am.enabled && !isAutomodExempt(guildId, message.author.id)) {
    const verdict = evaluateMessage(message.content ?? '', am, recent.filter((m) => m.author === message.author.id));
    if (verdict.triggered) {
      try { await message.delete(); } catch {}
      const messagePreview = (message.content ?? '').slice(0, 256);
      const fields: any[] = [
        { name: 'Action', value: `\`${verdict.action}\``, inline: true },
        { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
        { name: 'Message ID', value: `\`${message.id}\``, inline: true },
        { name: 'Content preview', value: messagePreview ? `\`\`\`${messagePreview}\`\`\`` : '_(empty)_', inline: false },
      ];
      if (verdict.matches) {
        fields.push({ name: 'Rule', value: `\`${verdict.matches}\``, inline: true });
      }
      if (typeof verdict.count === 'number') {
        fields.push({ name: 'Count', value: String(verdict.count), inline: true });
      }
      await logEvent({
        guildId,
        category: 'automod',
        title: `Automod triggered — ${verdict.reason ?? 'rule violation'}`,
        description: `User <@${message.author.id}> violated an automod rule and was punished with **${verdict.action}**.`,
        fields,
        author: { id: message.author.id, tag: message.author.tag, avatar: message.author.displayAvatarURL() },
        channelId: message.channel.id,
        client,
        risk: verdict.action === 'kick' ? 'HIGH' : verdict.action === 'timeout' ? 'MEDIUM' : 'LOW',
      });
      if (verdict.action === 'warn') addWarning(guildId, message.author.id, client.user!.id, verdict.reason ?? null);
      if (verdict.action === 'timeout') {
        const m = await message.guild.members.fetch(message.author.id).catch(() => null);
        await m?.timeout(10 * 60_000, `Automod: ${verdict.reason}`).catch(() => {});
      }
      if (verdict.action === 'kick') {
        const m = await message.guild.members.fetch(message.author.id).catch(() => null);
        await m?.kick(`Automod: ${verdict.reason}`).catch(() => {});
      }
      await runWorkflowsForTrigger(guildId, 'automod', { guild: message.guild, user: message.author, channel: message.channel as any, raw: { reason: verdict.reason } });
    }
  }

  // Leveling
  const leveling = getDatabase().prepare('SELECT enabled, cooldown_seconds as cooldownSeconds FROM leveling_config WHERE guild_id = ?').get(guildId) as any;
  if (leveling?.enabled) {
    const data = getLevelingUser(guildId, message.author.id);
    if (Date.now() - data.lastXpAt >= (leveling.cooldownSeconds ?? 60) * 1000) {
      const xpGain = Math.floor(Math.random() * 11) + 15;
      const next = addXp(guildId, message.author.id, xpGain, Date.now());
      const newLevel = levelFromXp(next.xp);
      if (newLevel > levelFromXp(data.xp)) {
        await logEvent({ guildId, category: 'leveling', title: 'Level up', description: `<@${message.author.id}> reached level ${newLevel}`, client });
        await runWorkflowsForTrigger(guildId, 'level_up', { guild: message.guild, user: message.author, channel: message.channel as any, raw: { level: newLevel } });
      }
    }
  }

  // Sticky
  const { handleSticky } = await import('../services/sticky.js');
  await handleSticky(message as any);

  // Automation engine
  await runWorkflowsForTrigger(guildId, 'message_create', { guild: message.guild, user: message.author, channel: message.channel as any, message: { id: message.id, content: message.content ?? '', author: { id: message.author.id, tag: message.author.tag } } });
}

async function onMessageUpdate(_o: Message, n: Message, client: any): Promise<void> {
  if (!n.guild) return;
  editSnipeCacheRef.set(n.channel.id, { before: _o?.content ?? '', after: n.content ?? '', author: n.author?.id ?? '', ts: Date.now() });

  // Only log edits where the content actually changed.
  if (_o?.content === n.content) return;

  const before = (_o?.content ?? '').slice(0, 500);
  const after = (n.content ?? '').slice(0, 500);
  await logEvent({
    guildId: n.guild.id,
    category: 'message',
    title: 'Message edited',
    description: `Edited in <#${n.channel.id}>`,
    fields: [
      { name: 'Before', value: before ? `\`\`\`\n${before}\n\`\`\`` : '_empty_', inline: false },
      { name: 'After', value: after ? `\`\`\`\n${after}\n\`\`\`` : '_empty_', inline: false },
      { name: 'Jump', value: `[Go to message](${n.url})`, inline: false },
    ],
    author: n.author ? { id: n.author.id, tag: n.author.tag, avatar: n.author.displayAvatarURL() } : undefined,
    channelId: n.channel.id,
    client,
  });
}

async function onMessageDelete(m: Message): Promise<void> {
  if (!m.guild) return;
  const preview = (m.content ?? '').slice(0, 512);
  await logEvent({
    guildId: m.guild.id,
    category: 'message',
    title: 'Message deleted',
    description: preview || '_no content_',
    fields: [
      { name: 'Channel', value: `<#${m.channel.id}>`, inline: true },
      { name: 'Author ID', value: m.author ? `\`${m.author.id}\`` : '`unknown`', inline: true },
      { name: 'Message ID', value: `\`${m.id}\``, inline: true },
    ],
    author: m.author ? { id: m.author.id, tag: m.author.tag, avatar: m.author.displayAvatarURL() } : null,
    channelId: m.channel.id,
    client: m.guild.client,
  });
}

async function onMemberAdd(member: GuildMember, client: any): Promise<void> {
  if (member.user.bot) {
    if (getAntinukeConfig(member.guild.id).enabled && !isWhitelisted(member.guild.id, member.id)) {
      const recentBots = (getDatabase().prepare('SELECT COUNT(*) as c FROM antinuke_trackers WHERE guild_id = ? AND action = ? AND ts > ?').get(member.guild.id, 'bot_add', Date.now() - 60_000) as any)?.c ?? 0;
      if (recentBots >= 3) {
        try { await member.ban({ reason: 'Antinuke: bot spam' }); } catch {}
        await logEvent({
          guildId: member.guild.id,
          category: 'security',
          title: 'Antinuke triggered — Bot spam',
          description: `${member.user.tag} banned because ${recentBots} bots joined in 60s.`,
          fields: [
            { name: 'Bot', value: `<@${member.id}>`, inline: true },
            { name: 'Recent bots / 60s', value: String(recentBots), inline: true },
            { name: 'Punishment', value: '`ban`', inline: true },
          ],
          author: { id: member.id, tag: member.user.tag, avatar: member.user.displayAvatarURL() },
          client,
          risk: 'HIGH',
        });
      }
    }
  }

  const settings = getDatabase().prepare('SELECT welcome_channel, welcome_message, welcome_dm, welcome_role FROM guild_settings WHERE guild_id = ?').get(member.guild.id) as any;

  // Antiraid
  const ar = getAntiraidConfig(member.guild.id);
  if (ar.enabled && !member.user.bot) {
    const recent = (getDatabase().prepare(`SELECT COUNT(*) as c FROM antinuke_trackers WHERE guild_id = ? AND action = 'member_join' AND ts > ?`).get(member.guild.id, Date.now() - ar.joinWindowSeconds * 1000) as any)?.c ?? 0;
    getDatabase().prepare('INSERT OR REPLACE INTO antinuke_trackers (guild_id, user_id, action, ts) VALUES (?, ?, ?, ?)').run(member.guild.id, member.id, 'member_join', Date.now());
    const ageDays = (Date.now() - member.user.createdTimestamp) / 86_400_000;
    if (recent >= ar.joinThreshold || ageDays < ar.accountAgeDays) {
      const triggerReason = recent >= ar.joinThreshold
        ? `Join spike: ${recent} joins in ${ar.joinWindowSeconds}s (threshold: ${ar.joinThreshold})`
        : `Account age ${ageDays.toFixed(1)}d < ${ar.accountAgeDays}d`;
      try {
        if (ar.action === 'kick') await member.kick('Antiraid');
        else if (ar.action === 'ban') await member.ban({ reason: 'Antiraid' });
        await logEvent({
          guildId: member.guild.id,
          category: 'security',
          title: `Antiraid triggered — ${ar.action === 'ban' ? 'Auto-ban' : 'Auto-kick'}`,
          description: `Held against <@${member.id}>. Reason: ${triggerReason}.`,
          fields: [
            { name: 'Account age', value: `${ageDays.toFixed(1)}d`, inline: true },
            { name: 'Recent joins', value: `${recent} / ${ar.joinWindowSeconds}s`, inline: true },
            { name: 'Action', value: `\`${ar.action}\``, inline: true },
          ],
          author: { id: member.id, tag: member.user.tag, avatar: member.user.displayAvatarURL() },
          client,
          risk: 'MEDIUM',
        });
      } catch {}
      return;
    }
  }

  // Welcome
  if (settings?.welcome_channel) {
    const channel = await member.guild.channels.fetch(settings.welcome_channel).catch(() => null);
    if (channel && channel.type !== 15 /* not a Forum */ && 'send' in channel) {
      const message = resolveVariables(settings.welcome_message ?? 'Welcome {mention} to {server}!', { user: member, guild: member.guild });
      try { await (channel as any).send({ content: message, allowedMentions: { parse: ['users'] } }); } catch {}
    }
  }
  if (settings?.welcome_dm) {
    try { await member.send(settings.welcome_dm); } catch {}
  }
  if (settings?.welcome_role) {
    try { await member.roles.add(settings.welcome_role); } catch {}
  }
  const autoroleRow = (getDatabase().prepare('SELECT autorole FROM guild_settings WHERE guild_id = ?').get(member.guild.id) as any);
  if (autoroleRow?.autorole) {
    try { await member.roles.add(autoroleRow.autorole); } catch {}
  }

  // Invite attribution
  try {
    const invites = await member.guild.invites.fetch();
    const cached = new Map(getInviteCache(member.guild.id).map((c) => [c.code, c]));
    for (const [code, invite] of invites) {
      const prev = cached.get(code);
      const prevUses = prev?.uses ?? 0;
      const currentUses = invite.uses ?? 0;
      if (prev && currentUses > prevUses) {
        recordInviteUse(member.guild.id, code, member.id, invite.inviterId ?? null, Date.now());
        if (invite.inviterId) adjustInviteCount(member.guild.id, invite.inviterId, 1, 'invites');
        break;
      }
    }
    for (const [code, invite] of invites) {
      ensureInviteCache(member.guild.id, code, invite.inviterId ?? null, invite.uses ?? 0);
    }
  } catch {}

  await logEvent({ guildId: member.guild.id, category: 'member', title: 'Member joined', description: `${member.user.tag} (${member.id})`, author: { id: member.user.id, tag: member.user.tag, avatar: member.user.displayAvatarURL() }, client });
  await runWorkflowsForTrigger(member.guild.id, 'member_join', { guild: member.guild, user: member, channel: member.guild.channels.cache.first() as any, raw: { account_age: Date.now() - member.user.createdTimestamp } });
}

async function onMemberRemove(member: GuildMember | { guild: any; user: any }, client: any): Promise<void> {
  const guild = (member as any).guild;
  const user = (member as any).user;
  if (!guild || !user) return;
  const settings = getDatabase().prepare('SELECT goodbye_channel, goodbye_message FROM guild_settings WHERE guild_id = ?').get(guild.id) as any;
  if (settings?.goodbye_channel) {
    const channel = await guild.channels.fetch(settings.goodbye_channel).catch(() => null);
    if (channel && channel.type !== 15 /* not a Forum */ && 'send' in channel) {
      const message = resolveVariables(settings.goodbye_message ?? '{username} has left the server.', { user: member as any, guild });
      try { await (channel as any).send({ content: message, allowedMentions: { parse: [] } }); } catch {}
    }
  }
  await logEvent({ guildId: guild.id, category: 'member', title: 'Member left', description: `${user.tag} (${user.id})`, client });
  await runWorkflowsForTrigger(guild.id, 'member_leave', { guild, user, channel: guild.channels.cache.first() as any });
}

async function onMemberUpdate(o: GuildMember, n: GuildMember, client: any): Promise<void> {
  if (o.nickname !== n.nickname) {
    await logEvent({ guildId: n.guild.id, category: 'member', title: 'Nickname changed', fields: [{ name: 'Old', value: o.nickname ?? '(none)', inline: false }, { name: 'New', value: n.nickname ?? '(none)', inline: false }], author: { id: n.user.id, tag: n.user.tag, avatar: n.user.displayAvatarURL() }, client });
  }
}

async function onGuildCreate(g: any, client: any): Promise<void> {
  getDatabase().prepare('INSERT OR IGNORE INTO guild_settings (guild_id, prefix, panic_mode, created_at, updated_at) VALUES (?, ?, 0, ?, ?)').run(g.id, '.', Date.now(), Date.now());
}

async function onVoiceStateUpdate(_o: any, n: any, client: any): Promise<void> {
  const member = n.member;
  if (!member) return;
  const config = getTempvoiceConfig(member.guild.id);
  if (config && n.channelId === config.generatorChannelId && n.channelId !== _o.channelId) {
    const channel = await member.guild.channels.create({
      name: `${member.user.username}'s room`,
      type: ChannelType.GuildVoice,
      parent: config.categoryId ?? undefined,
    });
    try { await n.setChannel(channel.id); } catch {}
    registerTempvoice(member.guild.id, channel.id, member.id);
  }
  if (_o.channel && !n.channel) {
    const existing = getTempvoice(_o.channel.id);
    if (existing) {
      try { await _o.channel.delete('Temp voice empty'); } catch {}
      deleteTempvoice(_o.channel.id);
    }
  }
  await logEvent({ guildId: member.guild.id, category: 'voice', title: n.channelId ? 'Voice joined' : 'Voice left', description: n.channel ? `<#${n.channel.id}>` : 'Disconnected', author: { id: member.id, tag: member.user.tag, avatar: member.user.displayAvatarURL() }, client });
}

async function onChannelChange(channel: any, action: string, client: any): Promise<void> {
  if (!channel.guild) return;

  // Audit log fetch for antinuke attribution.
  const audit = await channel.guild.fetchAuditLogs({ type: action === 'channel_create' ? AuditLogEvent.ChannelCreate : AuditLogEvent.ChannelDelete, limit: 1 }).catch(() => null);
  const entry = audit?.entries.first();
  const executorId = entry?.executorId ?? null;
  const executorMember = executorId ? await channel.guild.members.fetch(executorId).catch(() => null) : null;

  if (getAntinukeConfig(channel.guild.id).enabled) {
    if (executorId) {
      const isOwner = channel.guild.ownerId === executorId;
      const isBot = client.user?.id === executorId;
      const roleIds: string[] = executorMember ? executorMember.roles.cache.map((r: { id: string }) => r.id) : [];
      const whitelisted = isWhitelistedWithRoles(channel.guild.id, executorId, roleIds);
      if (!isOwner && !isBot && !whitelisted) {
        const triggered = trackAntinukeEvent(channel.guild.id, executorId, action);
        if (triggered) {
          try { await channel.guild.members.ban(executorId, { reason: `Antinuke: ${action} threshold` }); } catch {}
          await logEvent({
            guildId: channel.guild.id,
            category: 'security',
            title: `Antinuke triggered — ${action === 'channel_create' ? 'Channel creation' : 'Channel deletion'} spam`,
            description: `${entry.executorId} exceeded the ${action} threshold within the window. Punishment: **ban**`,
            fields: [
              { name: 'Channel', value: (channel as any).name ?? 'unknown', inline: true },
              { name: 'Action type', value: action, inline: true },
              { name: 'Punishment', value: '`ban`', inline: true },
            ],
            author: executorMember ? { id: executorMember.id, tag: executorMember.user?.tag ?? executorMember.id, avatar: executorMember.user?.displayAvatarURL?.() } : { id: executorId, tag: 'Unknown' },
            client,
            risk: 'HIGH',
          });
        }
      }
    }
  }

  // General channel event log (always fires, even if antinuke didn't trigger).
  await logEvent({
    guildId: channel.guild.id,
    category: 'channel',
    title: action === 'channel_create' ? 'Channel created' : 'Channel deleted',
    description: (channel as any).name ?? '',
    fields: [{ name: 'Channel type', value: String(channel.type), inline: true }],
    author: executorMember
      ? { id: executorMember.id, tag: executorMember.user?.tag ?? executorMember.id, avatar: executorMember.user?.displayAvatarURL?.() }
      : executorId
      ? { id: executorId, tag: 'Unknown' }
      : null,
    client,
  });
}

async function onRoleChange(role: any, action: string, client: any): Promise<void> {
  if (!role.guild) return;

  const audit = await role.guild.fetchAuditLogs({ type: action === 'role_create' ? AuditLogEvent.RoleCreate : AuditLogEvent.RoleDelete, limit: 1 }).catch(() => null);
  const entry = audit?.entries.first();
  const executorId = entry?.executorId ?? null;
  const executorMember = executorId ? await role.guild.members.fetch(executorId).catch(() => null) : null;

  if (getAntinukeConfig(role.guild.id).enabled && executorId) {
    const isOwner = role.guild.ownerId === executorId;
    const isBot = client.user?.id === executorId;
    const roleIds: string[] = executorMember ? executorMember.roles.cache.map((r: { id: string }) => r.id) : [];
    const whitelisted = isWhitelistedWithRoles(role.guild.id, executorId, roleIds);
    if (!isOwner && !isBot && !whitelisted) {
      const triggered = trackAntinukeEvent(role.guild.id, executorId, action);
      if (triggered) {
        try { await role.guild.members.ban(executorId, { reason: `Antinuke: ${action} threshold` }); } catch {}
        await logEvent({
          guildId: role.guild.id,
          category: 'security',
          title: `Antinuke triggered — ${action === 'role_create' ? 'Role creation' : 'Role deletion'} spam`,
          description: `${executorId} exceeded the ${action} threshold. Punishment: **ban**`,
          fields: [
            { name: 'Role', value: role.name, inline: true },
            { name: 'Action type', value: action, inline: true },
            { name: 'Punishment', value: '`ban`', inline: true },
          ],
          author: executorMember ? { id: executorMember.id, tag: executorMember.user?.tag ?? executorMember.id, avatar: executorMember.user?.displayAvatarURL?.() } : { id: executorId, tag: 'Unknown' },
          client,
          risk: 'HIGH',
        });
      }
    }
  }
  await logEvent({
    guildId: role.guild.id,
    category: 'role',
    title: action === 'role_create' ? 'Role created' : 'Role deleted',
    description: role.name,
    fields: [
      { name: 'Color', value: String(role.hexColor ?? 'default'), inline: true },
      { name: 'Mentionable', value: role.mentionable ? 'Yes' : 'No', inline: true },
    ],
    author: executorMember
      ? { id: executorMember.id, tag: executorMember.user?.tag ?? executorMember.id, avatar: executorMember.user?.displayAvatarURL?.() }
      : executorId
      ? { id: executorId, tag: 'Unknown' }
      : null,
    client,
  });
}

async function onWebhookUpdate(channel: any, client: any): Promise<void> {
  if (!channel.guild) return;
  if (!getAntinukeConfig(channel.guild.id).enabled) return;
  const audit = await channel.guild.fetchAuditLogs({ type: AuditLogEvent.WebhookCreate, limit: 5 }).catch(() => null);
  for (const entry of audit?.entries.values() ?? []) {
    if (!entry.executorId) continue;
    const executorMember = await channel.guild.members.fetch(entry.executorId).catch(() => null);
    const isOwner = channel.guild.ownerId === entry.executorId;
    const isBot = client.user?.id === entry.executorId;
    const roleIds: string[] = executorMember ? executorMember.roles.cache.map((r: { id: string }) => r.id) : [];
    const whitelisted = isWhitelistedWithRoles(channel.guild.id, entry.executorId, roleIds);
    if (isOwner || isBot || whitelisted) continue;
    const triggered = trackAntinukeEvent(channel.guild.id, entry.executorId, 'webhook_create');
    if (triggered) {
      try { await channel.guild.members.ban(entry.executorId, { reason: 'Antinuke: webhook spam' }); } catch {}
      await logEvent({
        guildId: channel.guild.id,
        category: 'security',
        title: 'Antinuke triggered — Webhook spam',
        description: `${entry.executorId} created too many webhooks. Punishment: **ban**`,
        fields: [
          { name: 'Action type', value: '`webhook_create`', inline: true },
          { name: 'Channel', value: `<#${channel.id}>`, inline: true },
          { name: 'Punishment', value: '`ban`', inline: true },
        ],
        author: executorMember
          ? { id: executorMember.id, tag: executorMember.user?.tag ?? executorMember.id, avatar: executorMember.user?.displayAvatarURL?.() }
          : { id: entry.executorId, tag: 'Unknown' },
        client,
        risk: 'HIGH',
      });
      break;
    }
  }
}

async function onInteraction(i: any, client: any): Promise<void> {
  if (!i.isButton() && !i.isStringSelectMenu()) return;
  if (!i.guild) return;
  if (i.customId?.startsWith('ticket:open:')) {
    const category = i.customId.split(':')[2];
    const { createTicketChannel } = await import('../commands/tickets/tickets.js');
    await createTicketChannel({ source: 'slash', guild: i.guild, user: i.user, member: i.member, channel: i.channel, args: {}, raw: [], interaction: i } as any, { category });
    await i.reply({ content: 'Ticket created.', ephemeral: true });
    return;
  }
  if (i.customId?.startsWith('giveaway:join:')) {
    const id = i.customId.split(':')[2];
    const ok = handleGiveawayJoin(id, i.user.id);
    await i.reply({ content: ok ? 'You entered the giveaway.' : 'Could not enter.', ephemeral: true });
    return;
  }
  if (i.customId?.startsWith('giveaway:leave:')) {
    const id = i.customId.split(':')[2];
    handleGiveawayLeave(id, i.user.id);
    await i.reply({ content: 'You left the giveaway.', ephemeral: true });
    return;
  }
  if (i.customId?.startsWith('poll:')) {
    const [, , pollId, idxStr] = i.customId.split(':');
    const idx = Number(idxStr);
    const row = getDatabase().prepare('SELECT user_id FROM poll_votes WHERE poll_id = ?').all(pollId) as any[];
    const userVotes = row.filter((r) => r.user_id === i.user.id).map((r) => r.user_id);
    try {
      getDatabase().prepare('INSERT INTO poll_votes (poll_id, user_id, option_index) VALUES (?, ?, ?)').run(pollId, i.user.id, idx);
    } catch {}
    await i.reply({ content: `Vote recorded for option ${idx + 1}.`, ephemeral: true });
    return;
  }
  if (i.customId?.startsWith('suggestion:')) {
    const [, , id, status] = i.customId.split(':');
    if (!i.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) { await i.reply({ content: 'No permission.', ephemeral: true }); return; }
    getDatabase().prepare('UPDATE suggestions SET status = ? WHERE id = ?').run(status, id);
    await i.reply({ content: `Marked as ${status}.`, ephemeral: true });
    return;
  }
  if (i.customId?.startsWith('rolepanel:select')) {
    const roleIds = (i.values as string[]) ?? [];
    const member = await i.guild.members.fetch(i.user.id).catch(() => null);
    if (!member) return;
    for (const id of roleIds) {
      if (!member.roles.cache.has(id)) await member.roles.add(id).catch(() => {});
    }
    await i.reply({ content: 'Roles updated.', ephemeral: true });
    return;
  }
}