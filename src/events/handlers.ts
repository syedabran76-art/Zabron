/**
 * Zabron — Event handler orchestration.
 *
 * Every Discord gateway event that the bot reacts to is wired up here.
 * Logging is centralised through `services/logging.ts` so branding and
 * error isolation stay consistent across the whole codebase.
 *
 * Coverage:
 *   - messageCreate / messageUpdate / messageDelete / messageBulkDelete
 *   - guildMemberAdd / guildMemberRemove / guildMemberUpdate (nickname,
 *     roles, timeout, server boost)
 *   - guildBanAdd / guildBanRemove
 *   - guildCreate / guildUpdate
 *   - voiceStateUpdate
 *   - channelCreate / channelDelete / channelUpdate
 *   - roleCreate / roleDelete / roleUpdate (via GuildRoleUpdate)
 *   - webhooksUpdate (resolved via audit log)
 *   - interactionCreate
 *
 * Each handler is fault-tolerant: Discord API failures, missing
 * permissions, missing channels, and partial objects are caught so a
 * logging failure can never crash the underlying event handler.
 */

import {
  Events,
  Message,
  GuildMember,
  PartialGuildMember,
  AuditLogEvent,
  PermissionFlagsBits,
  ChannelType,
  Collection,
  GuildAuditLogsEntry,
  Role,
  GuildChannel,
  Guild,
  EmbedField,
} from 'discord.js';

import { editSnipeCacheRef, snipeCacheRef } from '../commands/utility/util.js';
import {
  getAfk,
  clearAfk,
  getCustomCommand,
  incrementCustomCommandUsage,
  listAutoresponders,
  addXp,
  getLevelingUser,
  ensureInviteCache,
  getInviteCache,
  recordInviteUse,
  adjustInviteCount,
  setTempvoiceGenerator,
  getTempvoiceConfig,
  registerTempvoice,
  deleteTempvoice,
  getTempvoice,
} from '../db/repositories.js';
import { getDatabase } from '../db/database.js';
import {
  getAutomodConfig,
  getAntiraidConfig,
  getAntinukeConfig,
  isAutomodExempt,
  trackAntinukeEvent,
  isWhitelisted,
  isWhitelistedWithRoles,
} from '../services/security.js';
import { evaluateMessage } from '../services/automodScanner.js';
import { xpForLevel, levelFromXp } from '../commands/leveling/leveling.js';
import { resolveVariables } from '../utils/variables.js';
import {
  logEvent,
  buildActorInfo,
  resolveAuditExecutor,
  logMessageDelete,
  logMessageBulkDelete,
  logMessageEdit,
  logMemberJoin,
  logMemberLeave,
  logMemberNicknameChange,
  logMemberRoleChange,
  logMemberTimeoutChange,
  logMemberBoostChange,
  logBanAdd,
  logBanRemove,
  logChannelEvent,
  logRoleEvent,
  logWebhookEvent,
  ActorInfo,
} from '../services/logging.js';
import { addWarning } from '../db/repositories.js';
import { setAfk } from '../db/repositories.js';
import { handleGiveawayJoin, handleGiveawayLeave } from '../commands/giveaways/giveaway.js';
import { runWorkflowsForTrigger } from '../services/automation.js';
import { truncate } from '../embeds/builders.js';

const recentMessagesByGuild = new Map<string, { content: string; ts: number; author: string }[]>();

export function attachEventHandlers(client: any): void {
  client.on(Events.MessageCreate, (message: Message) => safeRun(() => onMessage(message, client), 'onMessage'));
  client.on(Events.MessageUpdate, (_o: Message, n: Message) => safeRun(() => onMessageUpdate(_o, n, client), 'onMessageUpdate'));
  client.on(Events.MessageDelete, (m: Message) => safeRun(() => onMessageDelete(m), 'onMessageDelete'));
  client.on(Events.MessageBulkDelete, (msgs: Collection<string, Message>, ch: any) => safeRun(() => onMessageBulkDelete(msgs, ch, client), 'onMessageBulkDelete'));
  client.on(Events.GuildMemberAdd, (m: GuildMember) => safeRun(() => onMemberAdd(m, client), 'onMemberAdd'));
  client.on(Events.GuildMemberRemove, (m: GuildMember | PartialGuildMember) => safeRun(() => onMemberRemove(m, client), 'onMemberRemove'));
  client.on(Events.GuildMemberUpdate, (o: GuildMember, n: GuildMember) => safeRun(() => onMemberUpdate(o, n, client), 'onMemberUpdate'));
  client.on(Events.GuildBanAdd, (ban: any) => safeRun(() => onGuildBanAdd(ban, client), 'onGuildBanAdd'));
  client.on(Events.GuildBanRemove, (ban: any) => safeRun(() => onGuildBanRemove(ban, client), 'onGuildBanRemove'));
  client.on(Events.GuildCreate, (g: any) => safeRun(() => onGuildCreate(g), 'onGuildCreate'));
  client.on(Events.GuildUpdate, (o: any, n: any) => safeRun(() => onGuildUpdate(o, n, client), 'onGuildUpdate'));
  client.on(Events.GuildAuditLogEntryCreate, (entry: GuildAuditLogsEntry, guild: Guild) =>
    safeRun(() => onAuditLogEntry(entry, guild, client), 'onAuditLogEntry'),
  );
  client.on(Events.VoiceStateUpdate, (_o: any, n: any) => safeRun(() => onVoiceStateUpdate(_o, n, client), 'onVoiceStateUpdate'));
  client.on(Events.ChannelCreate, (c: any) => safeRun(() => onChannelChange(c, 'create', null, client), 'onChannelCreate'));
  client.on(Events.ChannelDelete, (c: any) => safeRun(() => onChannelChange(c, 'delete', null, client), 'onChannelDelete'));
  client.on(Events.ChannelUpdate, (o: any, n: any) => safeRun(() => onChannelUpdate(o, n, client), 'onChannelUpdate'));
  client.on(Events.GuildRoleCreate, (r: Role) => safeRun(() => onRoleChange(r, 'create', null, client), 'onGuildRoleCreate'));
  client.on(Events.GuildRoleDelete, (r: Role) => safeRun(() => onRoleChange(r, 'delete', null, client), 'onGuildRoleDelete'));
  client.on(Events.GuildRoleUpdate, (o: Role, n: Role) => safeRun(() => onRoleUpdate(o, n, client), 'onGuildRoleUpdate'));
  client.on(Events.WebhooksUpdate as any, (c: any) => safeRun(() => onWebhookUpdate(c, client), 'onWebhooksUpdate'));
  client.on(Events.InteractionCreate, (i: any) => safeRun(() => onInteraction(i, client), 'onInteraction'));
}

/**
 * Run a handler but swallow ANY error so a logging failure can never
 * crash the underlying Discord event loop. We surface a short warning
 * to stderr so devs can still see what blew up.
 */
async function safeRun(fn: () => Promise<void>, name: string): Promise<void> {
  try {
    await fn();
  } catch (err) {
    try {
      // eslint-disable-next-line no-console
      console.warn(`[zabron] handler ${name} failed:`, (err as Error).message);
    } catch {}
  }
}

// ============================================================================
// Message events
// ============================================================================

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
  try {
    const { handleSticky } = await import('../services/sticky.js');
    await handleSticky(message as any);
  } catch {}

  // Automation engine
  await runWorkflowsForTrigger(guildId, 'message_create', { guild: message.guild, user: message.author, channel: message.channel as any, message: { id: message.id, content: message.content ?? '', author: { id: message.author.id, tag: message.author.tag } } });
}

async function onMessageUpdate(_o: Message, n: Message, client: any): Promise<void> {
  if (!n.guild) return;
  editSnipeCacheRef.set(n.channel.id, { before: _o?.content ?? '', after: n.content ?? '', author: n.author?.id ?? '', ts: Date.now() });

  // Only log edits where the content actually changed.
  if (_o?.content === n.content) return;

  let author: ActorInfo | null = null;
  if (n.author) {
    author = {
      id: n.author.id,
      tag: n.author.tag ?? n.author.username ?? n.author.id,
      avatar: n.author.displayAvatarURL?.(),
    };
  }

  await logMessageEdit(client, n.guild.id, {
    before: _o?.content ?? '',
    after: n.content ?? '',
    message: n,
    author,
  });
}

async function onMessageDelete(m: Message): Promise<void> {
  if (!m.guild) return;
  // Resolve audit log executor. The newest matching audit entry for
  // either MessageBulkDelete or MessageDelete targeting this message
  // (or its channel) within the last 30s is our actor.
  let executor: ActorInfo | null = null;
  let reason: string | null = null;
  try {
    const audit = await resolveAuditExecutor({
      guild: m.guild,
      // For bulk deletes the entry's target is the channel, not the
      // message, so we still pass targetId so single-message deletes
      // match first.
      action: [AuditLogEvent.MessageDelete, AuditLogEvent.MessageBulkDelete],
      targetId: m.id,
      channelId: m.channel?.id,
      maxAgeMs: 30_000,
      limit: 15,
    });
    executor = audit.executor;
    reason = audit.reason;
  } catch {}

  // Pass the partial message straight to logMessageDelete — it now
  // handles fetch() failures internally and renders a "content
  // unavailable" placeholder when the message can't be hydrated.
  await logMessageDelete(m.guild.client, m.guild.id, {
    message: m,
    executor,
    reason,
  });
}

async function onMessageBulkDelete(messages: Collection<string, Message>, channel: any, client: any): Promise<void> {
  if (!channel?.guild) return;
  let executor: ActorInfo | null = null;
  let reason: string | null = null;
  try {
    const audit = await resolveAuditExecutor({
      guild: channel.guild,
      // For MessageBulkDelete the audit entry's target is the channel,
      // not any of the deleted messages — pass channelId so we match.
      action: AuditLogEvent.MessageBulkDelete,
      targetId: channel.id,
      channelId: channel.id,
      maxAgeMs: 30_000,
      limit: 15,
    });
    executor = audit.executor;
    reason = audit.reason;
  } catch {}

  const msgArray = Array.from(messages.values());
  await logMessageBulkDelete(client, channel.guild.id, {
    channelId: channel.id,
    channelName: channel.name,
    count: msgArray.length,
    messages: msgArray,
    executor,
  });
}

// ============================================================================
// Member events
// ============================================================================

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
    if (channel && channel.type !== ChannelType.GuildForum && 'send' in channel) {
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

  await logMemberJoin(client, member.guild.id, {
    id: member.user.id,
    tag: member.user.tag,
    avatar: member.user.displayAvatarURL(),
    createdTimestamp: member.user.createdTimestamp,
  });
  await runWorkflowsForTrigger(member.guild.id, 'member_join', { guild: member.guild, user: member, channel: member.guild.channels.cache.first() as any, raw: { account_age: Date.now() - member.user.createdTimestamp } });
}

async function onMemberRemove(member: GuildMember | PartialGuildMember, client: any): Promise<void> {
  const guild = (member as any).guild;
  const user = (member as any).user;
  if (!guild || !user) return;
  const settings = getDatabase().prepare('SELECT goodbye_channel, goodbye_message FROM guild_settings WHERE guild_id = ?').get(guild.id) as any;
  if (settings?.goodbye_channel) {
    const channel = await guild.channels.fetch(settings.goodbye_channel).catch(() => null);
    if (channel && channel.type !== ChannelType.GuildForum && 'send' in channel) {
      const message = resolveVariables(settings.goodbye_message ?? '{username} has left the server.', { user: member as any, guild });
      try { await (channel as any).send({ content: message, allowedMentions: { parse: [] } }); } catch {}
    }
  }
  await logMemberLeave(client, guild.id, {
    id: user.id,
    tag: user.tag ?? user.username ?? user.id,
    avatar: user.displayAvatarURL?.(),
  });
  await runWorkflowsForTrigger(guild.id, 'member_leave', { guild, user, channel: guild.channels.cache.first() as any });
}

async function onMemberUpdate(o: GuildMember, n: GuildMember, client: any): Promise<void> {
  // Nickname change.
  if (o.nickname !== n.nickname) {
    await logMemberNicknameChange(client, n.guild.id, {
      id: n.user.id,
      tag: n.user.tag ?? n.user.username ?? n.user.id,
      avatar: n.user.displayAvatarURL?.(),
    }, o.nickname ?? null, n.nickname ?? null);
  }

  // Role add/remove detection — compare cached role sets.
  const before = new Set(o.roles.cache.map((r) => r.id));
  const after = new Set(n.roles.cache.map((r) => r.id));
  const added: Role[] = [];
  const removed: Role[] = [];
  for (const id of after) if (!before.has(id)) added.push(n.roles.cache.get(id) as Role);
  for (const id of before) if (!after.has(id)) removed.push(o.roles.cache.get(id) as Role);
  if (added.length || removed.length) {
    // Attribute to audit log where possible so we surface the moderator.
    let executor: ActorInfo | null = null;
    try {
      const audit = await resolveAuditExecutor({
        guild: n.guild,
        action: AuditLogEvent.MemberRoleUpdate,
        targetId: n.user.id,
        maxAgeMs: 30_000,
        limit: 5,
      });
      executor = audit.executor;
    } catch {}
    if (added.length || removed.length) {
      await logMemberRoleChange(client, n.guild.id, {
        id: n.user.id,
        tag: n.user.tag ?? n.user.username ?? n.user.id,
        avatar: n.user.displayAvatarURL?.(),
      }, added, removed);
    }
    // If we got an executor, log it under moderator category so admins
    // can audit role changes performed by staff.
    if (executor) {
      await logEvent({
        client,
        guildId: n.guild.id,
        category: 'moderation',
        title: 'Roles changed by moderator',
        description: `${executor.tag} changed <@${n.user.id}>'s roles.`,
        actor: executor,
        target: { id: n.user.id, tag: n.user.tag ?? n.user.id, avatar: n.user.displayAvatarURL?.() },
        risk: 'MEDIUM',
      });
    }
  }

  // Timeout change detection.
  const beforeTo = o.communicationDisabledUntilTimestamp ?? null;
  const afterTo = n.communicationDisabledUntilTimestamp ?? null;
  const beforeDate = beforeTo ? new Date(beforeTo) : null;
  const afterDate = afterTo ? new Date(afterTo) : null;
  if ((beforeDate?.getTime() ?? 0) !== (afterDate?.getTime() ?? 0)) {
    await logMemberTimeoutChange(client, n.guild.id, {
      id: n.user.id,
      tag: n.user.tag ?? n.user.username ?? n.user.id,
      avatar: n.user.displayAvatarURL?.(),
    }, beforeDate, afterDate);
  }

  // Server boost change detection. The `premiumSince` timestamp is the
  // only signal Discord exposes for boosts.
  const beforeBoost = o.premiumSinceTimestamp ?? null;
  const afterBoost = n.premiumSinceTimestamp ?? null;
  if (!beforeBoost && afterBoost) {
    await logMemberBoostChange(client, n.guild.id, {
      id: n.user.id,
      tag: n.user.tag ?? n.user.username ?? n.user.id,
      avatar: n.user.displayAvatarURL?.(),
    }, 'start');
  } else if (beforeBoost && !afterBoost) {
    await logMemberBoostChange(client, n.guild.id, {
      id: n.user.id,
      tag: n.user.tag ?? n.user.username ?? n.user.id,
      avatar: n.user.displayAvatarURL?.(),
    }, 'end');
  }

  // Detect avatar / banner / flag changes that aren't covered by the
  // Discord gateway `GuildMemberUpdate` event for individual properties.
  // We compare the `pending` flag at minimum so onboarding completion
  // shows up in logs (these are the only consistently-available signals).
  if ((o.pending ?? false) !== (n.pending ?? false)) {
    const fields: EmbedField[] = [
      { name: 'Before', value: `\`${o.pending ? 'pending' : 'verified'}\``, inline: true },
      { name: 'After',  value: `\`${n.pending ? 'pending' : 'verified'}\``, inline: true },
    ];
    await logEvent({
      client,
      guildId: n.guild.id,
      category: 'member',
      title: 'Member onboarding state changed',
      description: `<@${n.user.id}> is now ${n.pending ? 'pending' : 'verified'}.`,
      actor: { id: n.user.id, tag: n.user.tag ?? n.user.id },
      target: { id: n.user.id, tag: n.user.tag ?? n.user.id },
      fields,
    });
  }
}

// ============================================================================
// Ban events
// ============================================================================

async function onGuildBanAdd(ban: any, client: any): Promise<void> {
  if (!ban.guild) return;
  let executor: ActorInfo | null = null;
  let reason: string | null = null;
  try {
    const audit = await resolveAuditExecutor({
      guild: ban.guild,
      action: [AuditLogEvent.MemberBanAdd],
      targetId: ban.user?.id,
      maxAgeMs: 30_000,
      limit: 5,
    });
    executor = audit.executor;
    reason = audit.reason;
  } catch {}
  await logBanAdd(client, ban.guild.id, ban, executor, reason);
}

async function onGuildBanRemove(ban: any, client: any): Promise<void> {
  if (!ban.guild) return;
  let executor: ActorInfo | null = null;
  let reason: string | null = null;
  try {
    const audit = await resolveAuditExecutor({
      guild: ban.guild,
      action: [AuditLogEvent.MemberBanRemove],
      targetId: ban.user?.id,
      maxAgeMs: 30_000,
      limit: 5,
    });
    executor = audit.executor;
    reason = audit.reason;
  } catch {}
  await logBanRemove(client, ban.guild.id, ban, executor, reason);
}

// ============================================================================
// Guild lifecycle
// ============================================================================

async function onGuildCreate(g: any): Promise<void> {
  getDatabase().prepare('INSERT OR IGNORE INTO guild_settings (guild_id, prefix, panic_mode, created_at, updated_at) VALUES (?, ?, 0, ?, ?)').run(g.id, '.', Date.now(), Date.now());
}

/**
 * Log guild-level changes that aren't covered by other event handlers
 * (name, icon, banner, verification, default notifications, MFA, etc.).
 */
async function onGuildUpdate(o: Guild, n: Guild, client: any): Promise<void> {
  const changes: string[] = [];
  if (o.name !== n.name) {
    changes.push(`Name: \`${o.name}\` → \`${n.name}\``);
  }
  if (o.icon !== n.icon) {
    changes.push(`Icon: \`${o.icon ?? 'none'}\` → \`${n.icon ?? 'none'}\``);
  }
  if (o.banner !== n.banner) {
    changes.push(`Banner changed`);
  }
  if (o.verificationLevel !== n.verificationLevel) {
    changes.push(`Verification: \`${o.verificationLevel}\` → \`${n.verificationLevel}\``);
  }
  if (o.defaultMessageNotifications !== n.defaultMessageNotifications) {
    changes.push(`Default notifications: \`${o.defaultMessageNotifications}\` → \`${n.defaultMessageNotifications}\``);
  }
  if (o.mfaLevel !== n.mfaLevel) {
    changes.push(`MFA: \`${o.mfaLevel}\` → \`${n.mfaLevel}\``);
  }
  if (o.premiumTier !== n.premiumTier) {
    changes.push(`Boost tier: \`${o.premiumTier}\` → \`${n.premiumTier}\``);
  }
  if (o.afkTimeout !== n.afkTimeout) {
    changes.push(`AFK timeout: \`${o.afkTimeout}s\` → \`${n.afkTimeout}s\``);
  }

  if (!changes.length) return; // Nothing material to report.

  // Attribute to the audit log so we surface the responsible moderator.
  let executor: ActorInfo | null = null;
  let reason: string | null = null;
  try {
    const audit = await resolveAuditExecutor({
      guild: n,
      action: AuditLogEvent.GuildUpdate,
      targetId: n.id,
      maxAgeMs: 30_000,
      limit: 10,
    });
    executor = audit.executor;
    reason = audit.reason;
  } catch {}

  const fields: EmbedField[] = [
    { name: '🔄 Changes', value: changes.map((c) => `• ${c}`).join('\n').slice(0, 1024), inline: false },
  ];
  if (reason) fields.push({ name: '📝 Reason', value: truncate(reason, 512), inline: false });

  await logEvent({
    client,
    guildId: n.id,
    category: 'server',
    title: 'Server settings updated',
    description: executor ? `${executor.tag} updated server settings.` : `Server settings were updated.`,
    actor: executor,
    target: { id: n.id, tag: n.name },
    fields,
  });
}

/**
 * Lightweight audit-log listener. Discord already fires other events
 * for the common changes, but this hook provides a fallback for action
 * types that don't have a dedicated gateway event (e.g. invite updates).
 */
async function onAuditLogEntry(entry: GuildAuditLogsEntry, guild: Guild, client: any): Promise<void> {
  if (!entry.executor) return;
  const executor: ActorInfo = {
    id: entry.executor.id,
    tag: entry.executor.tag ?? entry.executor.username ?? entry.executor.id,
    avatar: entry.executor.displayAvatarURL?.(),
  };

  // Invite updates don't have a dedicated gateway event, so we
  // surface them via the audit-log stream.
  if (entry.action === AuditLogEvent.InviteUpdate) {
    await logEvent({
      client,
      guildId: guild.id,
      category: 'moderation',
      title: 'Invite updated',
      description: `${executor.tag} updated an invite.`,
      actor: executor,
      target: entry.targetId ? { id: entry.targetId, tag: entry.targetId } : null,
      reason: entry.reason,
      fields: entry.changes?.length
        ? [{ name: '🔄 Changes', value: entry.changes.map((c) => `\`${c.key}\``).join(', ').slice(0, 1024), inline: false }]
        : undefined,
    });
  }
}

// ============================================================================
// Voice
// ============================================================================

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

// ============================================================================
// Channel events
// ============================================================================

async function onChannelChange(channel: GuildChannel, action: 'create' | 'delete', _unused: any, client: any): Promise<void> {
  if (!channel.guild) return;

  const auditAction =
    action === 'create' ? AuditLogEvent.ChannelCreate :
    AuditLogEvent.ChannelDelete;

  let executor: ActorInfo | null = null;
  let reason: string | null = null;
  try {
    const audit = await resolveAuditExecutor({
      guild: channel.guild,
      action: auditAction,
      targetId: channel.id,
      maxAgeMs: 30_000,
      limit: 5,
    });
    executor = audit.executor;
    reason = audit.reason;
  } catch {}

  // Antinuke attribution.
  if (getAntinukeConfig(channel.guild.id).enabled && executor?.id) {
    const executorMember = await channel.guild.members.fetch(executor.id).catch(() => null);
    const isOwner = channel.guild.ownerId === executor.id;
    const isBot = client.user?.id === executor.id;
    const roleIds: string[] = executorMember ? executorMember.roles.cache.map((r: Role) => r.id) : [];
    const whitelisted = isWhitelistedWithRoles(channel.guild.id, executor.id, roleIds);
    if (!isOwner && !isBot && !whitelisted) {
      const triggered = trackAntinukeEvent(channel.guild.id, executor.id, action === 'create' ? 'channel_create' : 'channel_delete');
      if (triggered) {
        try { await channel.guild.members.ban(executor.id, { reason: `Antinuke: ${action} threshold` }); } catch {}
        await logEvent({
          guildId: channel.guild.id,
          category: 'security',
          title: `Antinuke triggered — Channel ${action} spam`,
          description: `${executor.tag} exceeded the ${action} threshold within the window. Punishment: **ban**`,
          fields: [
            { name: 'Channel', value: (channel as any).name ?? 'unknown', inline: true },
            { name: 'Action type', value: action, inline: true },
            { name: 'Punishment', value: '`ban`', inline: true },
          ],
          author: executor,
          client,
          risk: 'HIGH',
        });
      }
    }
  }

  await logChannelEvent(client, channel.guild.id, {
    action,
    channel,
    executor,
    reason,
  });
}

async function onChannelUpdate(o: GuildChannel, n: GuildChannel, client: any): Promise<void> {
  if (!n.guild) return;
  let executor: ActorInfo | null = null;
  let reason: string | null = null;
  try {
    const audit = await resolveAuditExecutor({
      guild: n.guild,
      action: [AuditLogEvent.ChannelUpdate, AuditLogEvent.ChannelOverwriteCreate, AuditLogEvent.ChannelOverwriteUpdate, AuditLogEvent.ChannelOverwriteDelete],
      targetId: n.id,
      maxAgeMs: 30_000,
      limit: 10,
    });
    executor = audit.executor;
    reason = audit.reason;
  } catch {}
  await logChannelEvent(client, n.guild.id, {
    action: 'update',
    channel: n,
    before: o,
    executor,
    reason,
  });
}

// ============================================================================
// Role events
// ============================================================================

async function onRoleChange(role: Role, action: 'create' | 'delete', _unused: any, client: any): Promise<void> {
  if (!role.guild) return;

  const auditAction =
    action === 'create' ? AuditLogEvent.RoleCreate :
    AuditLogEvent.RoleDelete;

  let executor: ActorInfo | null = null;
  let reason: string | null = null;
  try {
    const audit = await resolveAuditExecutor({
      guild: role.guild,
      action: auditAction,
      targetId: role.id,
      maxAgeMs: 30_000,
      limit: 5,
    });
    executor = audit.executor;
    reason = audit.reason;
  } catch {}

  if (getAntinukeConfig(role.guild.id).enabled && executor?.id) {
    const executorMember = await role.guild.members.fetch(executor.id).catch(() => null);
    const isOwner = role.guild.ownerId === executor.id;
    const isBot = client.user?.id === executor.id;
    const roleIds: string[] = executorMember ? executorMember.roles.cache.map((r) => r.id) : [];
    const whitelisted = isWhitelistedWithRoles(role.guild.id, executor.id, roleIds);
    if (!isOwner && !isBot && !whitelisted) {
      const triggered = trackAntinukeEvent(role.guild.id, executor.id, action === 'create' ? 'role_create' : 'role_delete');
      if (triggered) {
        try { await role.guild.members.ban(executor.id, { reason: `Antinuke: ${action} threshold` }); } catch {}
        await logEvent({
          guildId: role.guild.id,
          category: 'security',
          title: `Antinuke triggered — Role ${action} spam`,
          description: `${executor.tag} exceeded the ${action} threshold. Punishment: **ban**`,
          fields: [
            { name: 'Role', value: role.name, inline: true },
            { name: 'Action type', value: action, inline: true },
            { name: 'Punishment', value: '`ban`', inline: true },
          ],
          author: executor,
          client,
          risk: 'HIGH',
        });
      }
    }
  }
  await logRoleEvent(client, role.guild.id, {
    action,
    role,
    executor,
    reason,
  });
}

async function onRoleUpdate(o: Role, n: Role, client: any): Promise<void> {
  if (!n.guild) return;
  let executor: ActorInfo | null = null;
  let reason: string | null = null;
  try {
    const audit = await resolveAuditExecutor({
      guild: n.guild,
      action: AuditLogEvent.RoleUpdate,
      targetId: n.id,
      maxAgeMs: 30_000,
      limit: 5,
    });
    executor = audit.executor;
    reason = audit.reason;
  } catch {}
  await logRoleEvent(client, n.guild.id, {
    action: 'update',
    role: n,
    before: o,
    executor,
    reason,
  });
}

// ============================================================================
// Webhooks
// ============================================================================

async function onWebhookUpdate(channel: any, client: any): Promise<void> {
  if (!channel.guild) return;
  // WebhooksUpdate does NOT tell us which webhook action happened or
  // even WHICH webhook — Discord just pings the channel. We have to
  // cross-reference the audit log and emit one log row per recent
  // matching entry that targets this channel.
  //
  // We make a single audit-log fetch and bucket the entries by action
  // type, so we don't spam the log when no webhook event has actually
  // happened (e.g. when WebhooksUpdate fires for an unrelated reason).
  let audit;
  try {
    audit = await channel.guild.fetchAuditLogs({
      limit: 25,
    });
  } catch {
    return; // No audit access — silently skip.
  }
  if (!audit) return;

  // Filter to recent entries (30s) that target this channel.
  const now = Date.now();
  const recent = audit.entries.filter((entry: GuildAuditLogsEntry) => {
    const ts = typeof entry.createdTimestamp === 'number'
      ? entry.createdTimestamp
      : new Date(entry.createdTimestamp as any).getTime();
    if (now - ts > 30_000) return false;

    if (entry.action === AuditLogEvent.WebhookCreate
      || entry.action === AuditLogEvent.WebhookUpdate
      || entry.action === AuditLogEvent.WebhookDelete) {
      // The audit entry's `extra.channel.id` carries the channel ID
      // for webhook actions.
      const extraChannel = (entry.extra as any)?.channel?.id;
      if (extraChannel === channel.id) return true;
      // Fallback: if the webhook itself targets this channel via
      // webhook.channelId we'd need a fetch — keep the extra-channel
      // match as the primary signal.
    }
    return false;
  });

  if (!recent.size) return; // Nothing to log.

  for (const entry of recent.values()) {
    const action: 'create' | 'update' | 'delete' =
      entry.action === AuditLogEvent.WebhookCreate ? 'create'
      : entry.action === AuditLogEvent.WebhookDelete ? 'delete'
      : 'update';

    let executor: ActorInfo | null = null;
    if (entry.executor) {
      executor = {
        id: entry.executor.id,
        tag: entry.executor.tag ?? entry.executor.username ?? entry.executor.id,
        avatar: entry.executor.displayAvatarURL?.(),
      };
    }

    // Antinuke: webhook-create spam.
    if (action === 'create' && executor?.id && getAntinukeConfig(channel.guild.id).enabled) {
      const executorMember = await channel.guild.members.fetch(executor.id).catch(() => null);
      const isOwner = channel.guild.ownerId === executor.id;
      const isBot = client.user?.id === executor.id;
      const roleIds: string[] = executorMember ? executorMember.roles.cache.map((r: Role) => r.id) : [];
      const whitelisted = isWhitelistedWithRoles(channel.guild.id, executor.id, roleIds);
      if (!isOwner && !isBot && !whitelisted) {
        const triggered = trackAntinukeEvent(channel.guild.id, executor.id, 'webhook_create');
        if (triggered) {
          try { await channel.guild.members.ban(executor.id, { reason: 'Antinuke: webhook spam' }); } catch {}
          await logEvent({
            guildId: channel.guild.id,
            category: 'security',
            title: 'Antinuke triggered — Webhook spam',
            description: `${executor.tag} created too many webhooks. Punishment: **ban**`,
            fields: [
              { name: 'Action type', value: '`webhook_create`', inline: true },
              { name: 'Channel', value: `<#${channel.id}>`, inline: true },
              { name: 'Punishment', value: '`ban`', inline: true },
            ],
            author: executor,
            client,
            risk: 'HIGH',
          });
        }
      }
    }

    await logWebhookEvent(client, channel.guild.id, {
      action,
      channelId: channel.id,
      webhookId: entry.targetId ?? null,
      executor,
      reason: entry.reason ?? null,
    });
  }
}

// ============================================================================
// Interactions
// ============================================================================

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

// Avoid unused-warning linting on items that are imported for side effects.
export const __unused = { GuildAuditLogsEntry };