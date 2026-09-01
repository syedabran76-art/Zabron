/**
 * /afk, /remind, /sticky, /customcommand, /autoresponder, /poll, /suggestion, /starboard
 */

import { ChatInputCommandInteraction, Message, SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

import type { CommandContext, CommandDefinition } from '../../types/index.js';
import { registerCommand } from '../../handlers/registry.js';
import { respond, replyError, replySuccess } from '../../handlers/respond.js';
import { buildEmbed, afkStatus as afkStatusEmbed, listResult, emptyState, actionDone, truncate } from '../../embeds/builders.js';
import { resolveUser } from '../../utils/permissions.js';
import { parseDuration, discordTime } from '../../utils/duration.js';
import { randomToken, eventId } from '../../utils/ids.js';
import {
  setAfk,
  clearAfk,
  getAfk,
  insertReminder,
  listReminders,
  deleteReminder,
  upsertStickyMessage,
  deleteStickyMessage,
  listStickyMessages,
  upsertCustomCommand,
  deleteCustomCommand,
  listCustomCommands,
  getCustomCommand,
  upsertAutoresponder,
  deleteAutoresponder,
  listAutoresponders,
} from '../../db/repositories.js';
import { getDatabase } from '../../db/database.js';
import { getSticky, setSticky } from '../../services/sticky.js';
import { logEvent, buildActorInfo } from '../../services/logging.js';

const afk: CommandDefinition = {
  name: 'afk',
  description: 'Mark yourself as AFK.',
  category: 'community',
  cooldownSeconds: 5,
  buildSlash() {
    return new SlashCommandBuilder().setName('afk').setDescription('Go AFK.').addStringOption((o) => o.setName('reason').setDescription('Optional reason shown while AFK').setRequired(false));
  },
  async parseSlash(i: ChatInputCommandInteraction) { return { reason: i.options.getString('reason') }; },
  async parsePrefix(_m: Message, raw: string[]) { return { reason: raw.join(' ') || null }; },
  async run(ctx: CommandContext) {
    if (!ctx.guild) return;
    const { reason } = ctx.args as any;
    const since = Date.now();
    setAfk(ctx.guild.id, ctx.user.id, reason);
    await respond(ctx, {
      embeds: [
        afkStatusEmbed({
          enabled: true,
          user: { id: ctx.user.id, tag: ctx.user.tag },
          reason,
          since,
          view: false,
        }),
      ],
    });
  },
};

const afkStatus: CommandDefinition = {
  name: 'afk-status',
  description: 'View another user\'s AFK status.',
  category: 'community',
  buildSlash() {
    return new SlashCommandBuilder().setName('afk-status').setDescription('Check AFK status.').addUserOption((o) => o.setName('user').setDescription('User to check').setRequired(true));
  },
  async parseSlash(i: ChatInputCommandInteraction) { return { user: i.options.getUser('user', true) }; },
  async parsePrefix(m: Message, raw: string[]) {
    const user = raw[0] ? await resolveUser(m.guild!, raw[0]) : null;
    if (!user) throw new Error('User required');
    return { user };
  },
  async run(ctx: CommandContext) {
    if (!ctx.guild) return;
    const { user } = ctx.args as any;
    const a = getAfk(ctx.guild.id, user.id);
    if (!a) {
      await respond(ctx, {
        embeds: [
          afkStatusEmbed({
            enabled: false,
            user: { id: user.id, tag: user.tag },
            view: true,
          }),
        ],
      });
      return;
    }
    await respond(ctx, {
      embeds: [
        afkStatusEmbed({
          enabled: true,
          user: { id: user.id, tag: user.tag },
          reason: a.reason,
          since: a.since,
          view: true,
        }),
      ],
    });
  },
};

const remind: CommandDefinition = {
  name: 'remind',
  description: 'Set a reminder.',
  category: 'community',
  cooldownSeconds: 5,
  buildSlash() {
    return new SlashCommandBuilder().setName('remind').setDescription('Set a reminder.').addStringOption((o) => o.setName('duration').setDescription('e.g. 30m, 2h, 1d').setRequired(true)).addStringOption((o) => o.setName('message').setDescription('Reminder text').setRequired(true));
  },
  async parseSlash(i: ChatInputCommandInteraction) {
    return { duration: i.options.getString('duration', true), message: i.options.getString('message', true) };
  },
  async parsePrefix(_m: Message, raw: string[]) {
    return { duration: raw[0], message: raw.slice(1).join(' ') };
  },
  async run(ctx: CommandContext) {
    const { duration, message } = ctx.args as any;
    const parsed = parseDuration(duration);
    if (!parsed) { await replyError(ctx, 'Invalid duration. Try `30m`, `2h`, `1d`.'); return; }
    const id = `REM-${randomToken(6)}`;
    insertReminder({ id, guildId: ctx.guild?.id ?? null, userId: ctx.user.id, message, remindAt: Date.now() + parsed.ms, createdAt: Date.now() });
    await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Reminder set', description: `I'll remind you in **${parsed.formatted}** (ID ${id}).` })] });
  },
};

const reminders: CommandDefinition = {
  name: 'reminders',
  description: 'List your pending reminders.',
  category: 'community',
  buildSlash() { return new SlashCommandBuilder().setName('reminders').setDescription('Show pending reminders.'); },
  parseSlash() { return {}; },
  parsePrefix() { return {}; },
  async run(ctx: CommandContext) {
    const list = listReminders(ctx.user.id);
    const items = list.map((r) => `\`${r.id}\` — ${r.message} *(fires ${discordTime(r.remindAt, 'R')})*`);
    await respond(ctx, {
      embeds: [
        listResult({
          title: '⏰ Your reminders',
          items,
          summary: 'Pending reminders set in this guild.',
          tone: 'info',
        }),
      ],
    });
  },
};

const remindCancel: CommandDefinition = {
  name: 'remind-cancel',
  description: 'Cancel a reminder by ID.',
  category: 'community',
  buildSlash() {
    return new SlashCommandBuilder().setName('remind-cancel').setDescription('Cancel a reminder.').addStringOption((o) => o.setName('id').setDescription('Reminder ID to cancel').setRequired(true));
  },
  async parseSlash(i: ChatInputCommandInteraction) { return { id: i.options.getString('id', true) }; },
  async parsePrefix(_m: Message, raw: string[]) { return { id: raw[0] }; },
  async run(ctx: CommandContext) {
    const { id } = ctx.args as any;
    if (deleteReminder(ctx.user.id, id)) await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Reminder cancelled' })] });
    else await replyError(ctx, 'No reminder with that ID.');
  },
};

const sticky: CommandDefinition = {
  name: 'sticky',
  description: 'Manage sticky messages.',
  category: 'community',
  userPermissions: ['ManageMessages'],
  cooldownSeconds: 5,

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('sticky')
      .setDescription('Sticky messages.')
      .addSubcommand((s) => s.setName('create').setDescription('Create a sticky message').addStringOption((o) => o.setName('content').setDescription('Sticky message body').setRequired(true)))
      .addSubcommand((s) => s.setName('remove').setDescription('Remove sticky from this channel'))
      .addSubcommand((s) => s.setName('list').setDescription('List stickies'))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);
  },

  async parseSlash(i: ChatInputCommandInteraction) {
    return { sub: i.options.getSubcommand(), content: i.options.getString('content') };
  },

  async parsePrefix(_m: Message, raw: string[]) {
    return { sub: raw[0] ?? 'list', content: raw.slice(1).join(' ') };
  },

  async run(ctx: CommandContext) {
    if (!ctx.guild || !ctx.channel) return;
    const { sub, content } = ctx.args as any;
    if (sub === 'create') {
      if (!content) { await replyError(ctx, 'Provide sticky content.'); return; }
      upsertStickyMessage(ctx.guild.id, ctx.channel.id, content, null);
      await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Sticky created', description: 'The sticky message will appear after the next message in this channel.' })] });
      return;
    }
    if (sub === 'remove') {
      deleteStickyMessage(ctx.guild.id, ctx.channel.id);
      await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Sticky removed' })] });
      return;
    }
    const list = listStickyMessages(ctx.guild.id);
    const items = list.map((s) => `<#${s.channelId}> — ${s.content.slice(0, 80)}`);
    await respond(ctx, {
      embeds: [
        listResult({
          title: '📌 Sticky messages',
          items,
          summary: 'Channels with an active sticky message.',
          tone: 'info',
        }),
      ],
    });
  },
};

const customCommand: CommandDefinition = {
  name: 'customcommand',
  description: 'Create custom commands.',
  category: 'community',
  userPermissions: ['ManageGuild'],

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('customcommand')
      .setDescription('Manage custom commands.')
      .addSubcommand((s) => s.setName('create').setDescription('Create a custom command').addStringOption((o) => o.setName('name').setDescription('Command name to invoke').setRequired(true)).addStringOption((o) => o.setName('response').setDescription('Reply text or embed content').setRequired(true)).addBooleanOption((o) => o.setName('embed').setDescription('Send response as an embed').setRequired(false)))
      .addSubcommand((s) => s.setName('delete').setDescription('Delete a custom command').addStringOption((o) => o.setName('name').setDescription('Command name to delete').setRequired(true)))
      .addSubcommand((s) => s.setName('list').setDescription('List custom commands'))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
  },

  async parseSlash(i: ChatInputCommandInteraction) {
    return {
      sub: i.options.getSubcommand(),
      name: i.options.getString('name'),
      response: i.options.getString('response'),
      embed: i.options.getBoolean('embed') ?? false,
    };
  },

  async parsePrefix(_m: Message, raw: string[]) {
    return { sub: raw[0] ?? 'list', name: raw[1], response: raw.slice(2).join(' '), embed: false };
  },

  async run(ctx: CommandContext) {
    if (!ctx.guild) return;
    const args = ctx.args as any;
    if (args.sub === 'create') {
      if (!args.name || !args.response) { await replyError(ctx, 'Provide a name and response.'); return; }
      upsertCustomCommand(ctx.guild.id, args.name.toLowerCase(), args.response, !!args.embed);
      await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Custom command saved' })] });
      return;
    }
    if (args.sub === 'delete') {
      if (deleteCustomCommand(ctx.guild.id, args.name)) {
        await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Custom command deleted' })] });
      } else await replyError(ctx, 'No such custom command.');
      return;
    }
    const list = listCustomCommands(ctx.guild.id);
    const items = list.map((c) => `\`${c.name}\` — ${c.response.slice(0, 80)}${c.embed ? ' *\(embed\)*' : ''}`);
    await respond(ctx, {
      embeds: [
        listResult({
          title: '⌨️ Custom commands',
          items,
          summary: 'Custom slash/prefix commands defined in this guild.',
          tone: 'info',
        }),
      ],
    });
  },
};

const autoresponder: CommandDefinition = {
  name: 'autoresponder',
  description: 'Manage autoresponders.',
  category: 'community',
  userPermissions: ['ManageGuild'],

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('autoresponder')
      .setDescription('Manage autoresponders.')
      .addSubcommand((s) => s.setName('add').setDescription('Add').addStringOption((o) => o.setName('name').setDescription('Autoresponder name').setRequired(true)).addStringOption((o) => o.setName('trigger').setDescription('Trigger phrase or pattern').setRequired(true)).addStringOption((o) => o.setName('response').setDescription('Reply text').setRequired(true)).addStringOption((o) => o.setName('match').setDescription('Match mode').addChoices({ name: 'contains', value: 'contains' }, { name: 'exact', value: 'exact' }, { name: 'starts', value: 'starts' }, { name: 'regex', value: 'regex' }).setRequired(false)))
      .addSubcommand((s) => s.setName('remove').setDescription('Remove').addStringOption((o) => o.setName('name').setDescription('Autoresponder name to remove').setRequired(true)))
      .addSubcommand((s) => s.setName('list').setDescription('List'))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
  },

  async parseSlash(i: ChatInputCommandInteraction) {
    return {
      sub: i.options.getSubcommand(),
      name: i.options.getString('name'),
      trigger: i.options.getString('trigger'),
      match: i.options.getString('match') ?? 'contains',
      response: i.options.getString('response'),
    };
  },

  async parsePrefix(_m: Message, raw: string[]) {
    return { sub: raw[0] ?? 'list', name: raw[1], trigger: raw[2], match: 'contains', response: raw.slice(3).join(' ') };
  },

  async run(ctx: CommandContext) {
    if (!ctx.guild) return;
    const args = ctx.args as any;
    if (args.sub === 'add') {
      if (!args.name || !args.trigger || !args.response) { await replyError(ctx, 'Name, trigger and response are required.'); return; }
      if (args.match === 'regex') {
        try { new RegExp(args.trigger); } catch { await replyError(ctx, 'Invalid regex.'); return; }
      }
      upsertAutoresponder({
        guildId: ctx.guild.id,
        name: args.name.toLowerCase(),
        trigger: args.trigger,
        match: args.match as any,
        response: args.response,
        channels: [],
        roles: [],
        cooldownSeconds: 0,
        enabled: true,
        createdAt: Date.now(),
      });
      await respond(ctx, {
        embeds: [
          actionDone({
            action: 'Autoresponder added',
            target: `\`${args.name.toLowerCase()}\``,
            detail: `Triggers when a message \`${args.match}\` matches **${args.trigger}**.`,
          }),
        ],
      });
      return;
    }
    if (args.sub === 'remove') {
      if (deleteAutoresponder(ctx.guild.id, args.name)) {
        await respond(ctx, {
          embeds: [actionDone({ action: 'Autoresponder removed', target: `\`${args.name}\`` })],
        });
      } else await replyError(ctx, 'No autoresponder with that name.');
      return;
    }
    // List — listResult gives us a polished dashboard with summary + count.
    const list = listAutoresponders(ctx.guild.id);
    const summary = 'Auto-reply rules that trigger when a message matches a configured pattern.';
    const items = list.map((a, idx) =>
      `**${idx + 1}.** \`${a.name}\` — match: \`${a.match}\` · trigger: **${a.trigger}** · reply: ${truncate(a.response, 90)}`
    );
    await respond(ctx, {
      embeds: [
        listResult({
          title: '🤖 Autoresponders',
          items,
          summary,
          perPage: 10,
          tone: 'community',
        }),
      ],
    });
  },
};

const poll: CommandDefinition = {
  name: 'poll',
  description: 'Create a poll.',
  category: 'community',
  cooldownSeconds: 5,
  buildSlash() {
    return new SlashCommandBuilder()
      .setName('poll')
      .setDescription('Create a poll.')
      .addStringOption((o) => o.setName('question').setDescription('Poll question').setRequired(true))
      .addStringOption((o) => o.setName('options').setDescription('Pipe-separated options (2-5)').setRequired(true))
      .addIntegerOption((o) => o.setName('duration').setDescription('Duration in minutes').setRequired(false));
  },

  async parseSlash(i: ChatInputCommandInteraction) {
    return { question: i.options.getString('question', true), options: i.options.getString('options', true).split('|').map((s) => s.trim()).filter(Boolean), duration: i.options.getInteger('duration') ?? null };
  },

  async parsePrefix(_m: Message, raw: string[]) {
    return { question: raw[0], options: raw.slice(1).join(' ').split('|').map((s) => s.trim()).filter(Boolean), duration: null };
  },

  async run(ctx: CommandContext) {
    if (!ctx.channel || !ctx.guild) return;
    const { question, options, duration } = ctx.args as any;
    if (!options || options.length < 2 || options.length > 5) { await replyError(ctx, 'Provide 2-5 options separated by `|`. '); return; }
    const id = `POLL-${randomToken(5)}`;
    const endsAt = duration ? Date.now() + duration * 60_000 : null;
    const buttons = options.map((label: string, idx: number) =>
      new ButtonBuilder().setCustomId(`poll:${id}:${idx}`).setLabel(label.slice(0, 30)).setStyle(ButtonStyle.Primary),
    );
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
    const embed = buildEmbed({ tone: 'info', title: `📊 ${question}`, description: options.map((o: string, idx: number) => `${idx + 1}. ${o}`).join('\n') + (endsAt ? `\n\nEnds ${discordTime(endsAt, 'R')}` : '') });
    const message = await ctx.channel.send({ embeds: [embed], components: [row] });
    getDatabase().prepare('INSERT INTO polls (id, guild_id, channel_id, message_id, question, options, multi, ends_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)').run(id, ctx.guild.id, ctx.channel.id, message.id, question, JSON.stringify(options), endsAt, ctx.user.id, Date.now());
    await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Poll created', description: `ID: ${id}` })], ephemeral: true });
  },
};

const suggestion: CommandDefinition = {
  name: 'suggestion',
  description: 'Submit a suggestion.',
  category: 'community',
  buildSlash() {
    return new SlashCommandBuilder().setName('suggestion').setDescription('Submit a suggestion.').addStringOption((o) => o.setName('text').setDescription('Suggestion text').setRequired(true));
  },
  async parseSlash(i: ChatInputCommandInteraction) { return { text: i.options.getString('text', true) }; },
  async parsePrefix(_m: Message, raw: string[]) { return { text: raw.join(' ') }; },
  async run(ctx: CommandContext) {
    if (!ctx.channel || !ctx.guild) return;
    const { text } = ctx.args as any;
    const id = `SUG-${randomToken(5)}`;
    const embed = buildEmbed({ tone: 'info', title: `Suggestion ${id}`, description: text, fields: [{ name: 'Author', value: `<@${ctx.user.id}>`, inline: true }] });
    const message = await ctx.channel.send({ embeds: [embed] });
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`suggestion:${id}:approve`).setLabel('Approve').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`suggestion:${id}:deny`).setLabel('Deny').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`suggestion:${id}:consider`).setLabel('Consider').setStyle(ButtonStyle.Secondary),
    );
    await message.edit({ components: [row] });
    getDatabase().prepare('INSERT INTO suggestions (id, guild_id, channel_id, message_id, author_id, content, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, ctx.guild.id, ctx.channel.id, message.id, ctx.user.id, text, 'pending', Date.now());
    await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Suggestion posted' })], ephemeral: true });
  },
};

const starboard: CommandDefinition = {
  name: 'starboard',
  description: 'Configure starboard.',
  category: 'community',
  userPermissions: ['ManageGuild'],

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('starboard')
      .setDescription('Configure starboard.')
      .addSubcommand((s) => s.setName('set').setDescription('Set starboard channel + threshold').addChannelOption((o) => o.setName('channel').setDescription('Starboard channel').setRequired(true)).addIntegerOption((o) => o.setName('threshold').setDescription('Minimum star reactions').setRequired(false)))
      .addSubcommand((s) => s.setName('disable').setDescription('Disable starboard'))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
  },

  async parseSlash(i: ChatInputCommandInteraction) {
    return { sub: i.options.getSubcommand(), channel: i.options.getChannel('channel'), threshold: i.options.getInteger('threshold') ?? 3 };
  },

  async parsePrefix(_m: Message, raw: string[]) { return { sub: raw[0] ?? 'disable', channel: null, threshold: 3 }; },

  async run(ctx: CommandContext) {
    if (!ctx.guild) return;
    const args = ctx.args as any;
    if (args.sub === 'set') {
      if (!args.channel) return;
      getDatabase().prepare('INSERT INTO starboard (guild_id, channel_id, threshold) VALUES (?, ?, ?) ON CONFLICT(guild_id) DO UPDATE SET channel_id = excluded.channel_id, threshold = excluded.threshold').run(ctx.guild.id, args.channel.id, args.threshold);
      await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Starboard set', description: `<#${args.channel.id}> (${args.threshold} ⭐)` })] });
    } else {
      getDatabase().prepare('DELETE FROM starboard WHERE guild_id = ?').run(ctx.guild.id);
      await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Starboard disabled' })] });
    }
  },
};

[afk, afkStatus, remind, reminders, remindCancel, sticky, customCommand, autoresponder, poll, suggestion, starboard].forEach(registerCommand);
export default afk;