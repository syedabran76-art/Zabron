/**
 * /automod — Configure automod.
 */

import { ChatInputCommandInteraction, Message, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import type { CommandContext, CommandDefinition } from '../../types/index.js';
import { registerCommand } from '../../handlers/registry.js';
import { respond } from '../../handlers/respond.js';
import { buildEmbed, configChange, actionDone } from '../../embeds/builders.js';
import { getAutomodConfig, setAutomodConfig, addAutomodExemption, removeAutomodExemption, listAutomodExemptions } from '../../services/security.js';

const def: CommandDefinition = {
  name: 'automod',
  description: 'Configure automod.',
  category: 'automod',
  userPermissions: ['ManageGuild'],
  cooldownSeconds: 5,

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('automod')
      .setDescription('Configure automod.')
      .addSubcommand((s) => s.setName('status').setDescription('Show status'))
      .addSubcommand((s) => s.setName('enable').setDescription('Enable'))
      .addSubcommand((s) => s.setName('disable').setDescription('Disable'))
      .addSubcommand((s) => s.setName('spam').setDescription('Spam threshold').addIntegerOption((o) => o.setName('messages').setDescription('Messages').setRequired(false)).addIntegerOption((o) => o.setName('interval').setDescription('Window seconds').setRequired(false)))
      .addSubcommand((s) => s.setName('mentions').setDescription('Mention limit').addIntegerOption((o) => o.setName('limit').setDescription('Max mentions per message').setRequired(false)))
      .addSubcommand((s) => s.setName('links').setDescription('Block links').addBooleanOption((o) => o.setName('block').setDescription('Whether to block links').setRequired(false)))
      .addSubcommand((s) => s.setName('invites').setDescription('Block invites').addBooleanOption((o) => o.setName('block').setDescription('Whether to block invite links').setRequired(false)))
      .addSubcommand((s) => s.setName('caps').setDescription('Caps rule').addIntegerOption((o) => o.setName('percent').setDescription('Percent of capitals to flag').setRequired(false)).addIntegerOption((o) => o.setName('min_length').setDescription('Minimum message length to apply rule').setRequired(false)))
      .addSubcommand((s) => s.setName('punishment').setDescription('Punishment').addStringOption((o) => o.setName('action').setDescription('Action to apply on violation').addChoices({ name: 'delete', value: 'delete' }, { name: 'warn', value: 'warn' }, { name: 'timeout', value: 'timeout' }, { name: 'kick', value: 'kick' }).setRequired(true)))
      .addSubcommand((s) => s.setName('word').setDescription('Add/remove blocked words').addStringOption((o) => o.setName('mode').setDescription('Add or remove').addChoices({ name: 'add', value: 'add' }, { name: 'remove', value: 'remove' }).setRequired(true)).addStringOption((o) => o.setName('word').setDescription('Word to block or unblock').setRequired(true)))
      .addSubcommand((s) => s.setName('exempt').setDescription('Add/remove exemption').addStringOption((o) => o.setName('target').setDescription('User/role/channel ID to exempt').setRequired(true)).addStringOption((o) => o.setName('mode').setDescription('Add or remove').addChoices({ name: 'add', value: 'add' }, { name: 'remove', value: 'remove' }).setRequired(true)))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
  },

  async parseSlash(i: ChatInputCommandInteraction) {
    const sub = i.options.getSubcommand();
    return {
      sub,
      messages: i.options.getInteger('messages'),
      interval: i.options.getInteger('interval'),
      limit: i.options.getInteger('limit'),
      block: i.options.getBoolean('block'),
      percent: i.options.getInteger('percent'),
      minLength: i.options.getInteger('min_length'),
      action: i.options.getString('action'),
      mode: i.options.getString('mode'),
      word: i.options.getString('word'),
      target: i.options.getString('target'),
    };
  },

  async parsePrefix(_m: Message, raw: string[]) {
    return { sub: raw[0] ?? 'status', messages: null, interval: null, limit: null, block: null, percent: null, minLength: null, action: raw[1], mode: raw[1], word: raw.slice(1).join(' '), target: raw[1] };
  },

  async run(ctx: CommandContext) {
    if (!ctx.guild) return;
    const args = ctx.args as any;
    const config = getAutomodConfig(ctx.guild.id);

    if (args.sub === 'status') {
      const exemptions = listAutomodExemptions(ctx.guild.id);
      await respond(ctx, {
        embeds: [buildEmbed({
          tone: 'security',
          title: `🛡 Automod — ${config.enabled ? '🟢 Enabled' : '🔴 Disabled'}`,
          description: 'Rules the bot enforces automatically across this server.',
          fields: [
            { name: 'Spam',          value: `\`${config.spamMessages}\` msgs / \`${config.spamIntervalSeconds}s\``, inline: true },
            { name: 'Mentions',      value: `\`${config.mentionLimit}\`/msg`, inline: true },
            { name: 'Links',         value: config.linkBlock ? '🔴 Blocked' : '🟢 Allowed', inline: true },
            { name: 'Invites',       value: config.inviteBlock ? '🔴 Blocked' : '🟢 Allowed', inline: true },
            { name: 'Caps',          value: `\`${config.capsPercent}%\` / \`${config.capsMinLength}+\` chars`, inline: true },
            { name: 'Punishment',    value: `\`${config.punishment}\``, inline: true },
            { name: 'Blocked words', value: `\`${config.blockedWords.length}\``, inline: true },
            { name: 'Exemptions',    value: `\`${exemptions.length}\``, inline: true },
          ],
        })],
      });
      return;
    }
    if (args.sub === 'enable') {
      const previous = config.enabled;
      setAutomodConfig(ctx.guild.id, { enabled: true });
      await respond(ctx, { embeds: [configChange({
        setting: 'Automod',
        previous: previous ? '🟢 Enabled' : '🔴 Disabled',
        current: '🟢 Enabled',
        actor: { id: ctx.user.id, tag: ctx.user.tag },
      })] });
      return;
    }
    if (args.sub === 'disable') {
      const previous = config.enabled;
      setAutomodConfig(ctx.guild.id, { enabled: false });
      await respond(ctx, { embeds: [configChange({
        setting: 'Automod',
        previous: previous ? '🟢 Enabled' : '🔴 Disabled',
        current: '🔴 Disabled',
        actor: { id: ctx.user.id, tag: ctx.user.tag },
      })] });
      return;
    }
    if (args.sub === 'spam') {
      const before = { msgs: config.spamMessages, interval: config.spamIntervalSeconds };
      const patch: any = {};
      if (args.messages) patch.spamMessages = args.messages;
      if (args.interval) patch.spamIntervalSeconds = args.interval;
      setAutomodConfig(ctx.guild.id, patch);
      const after = { ...before, ...patch };
      await respond(ctx, { embeds: [actionDone({
        action: 'Automod spam threshold updated',
        target: ctx.guild.name,
        detail: `Messages: \`${before.msgs}\` → \`${after.spamMessages}\` · Window: \`${before.interval}s\` → \`${after.spamIntervalSeconds}s\``,
      })] });
      return;
    }
    if (args.sub === 'mentions') {
      const before = config.mentionLimit;
      const limit = args.limit ?? 5;
      setAutomodConfig(ctx.guild.id, { mentionLimit: limit });
      await respond(ctx, { embeds: [configChange({
        setting: 'Automod mention limit',
        previous: `\`${before}\` per message`,
        current: `\`${limit}\` per message`,
        actor: { id: ctx.user.id, tag: ctx.user.tag },
      })] });
      return;
    }
    if (args.sub === 'links') {
      const before = config.linkBlock;
      const block = !!args.block;
      setAutomodConfig(ctx.guild.id, { linkBlock: block });
      await respond(ctx, { embeds: [configChange({
        setting: 'Automod link blocking',
        previous: before ? '🔴 Blocked' : '🟢 Allowed',
        current: block ? '🔴 Blocked' : '🟢 Allowed',
        actor: { id: ctx.user.id, tag: ctx.user.tag },
      })] });
      return;
    }
    if (args.sub === 'invites') {
      const before = config.inviteBlock;
      const block = !!args.block;
      setAutomodConfig(ctx.guild.id, { inviteBlock: block });
      await respond(ctx, { embeds: [configChange({
        setting: 'Automod invite blocking',
        previous: before ? '🔴 Blocked' : '🟢 Allowed',
        current: block ? '🔴 Blocked' : '🟢 Allowed',
        actor: { id: ctx.user.id, tag: ctx.user.tag },
      })] });
      return;
    }
    if (args.sub === 'caps') {
      const before = { percent: config.capsPercent, minLength: config.capsMinLength };
      const percent = args.percent ?? 80;
      const minLength = args.minLength ?? 10;
      setAutomodConfig(ctx.guild.id, { capsPercent: percent, capsMinLength: minLength });
      await respond(ctx, { embeds: [configChange({
        setting: 'Automod caps rule',
        previous: `\`${before.percent}%\` / \`${before.minLength}+\` chars`,
        current: `\`${percent}%\` / \`${minLength}+\` chars`,
        actor: { id: ctx.user.id, tag: ctx.user.tag },
      })] });
      return;
    }
    if (args.sub === 'punishment') {
      const before = config.punishment;
      setAutomodConfig(ctx.guild.id, { punishment: args.action });
      await respond(ctx, { embeds: [configChange({
        setting: 'Automod punishment',
        previous: `\`${before}\``,
        current: `\`${args.action}\``,
        actor: { id: ctx.user.id, tag: ctx.user.tag },
      })] });
      return;
    }
    if (args.sub === 'word') {
      const clean = String(args.word ?? '').toLowerCase().trim();
      if (!clean) { await respond(ctx, { embeds: [buildEmbed({ tone: 'warning', title: '⚠ Provide a word' })] }); return; }
      if (args.mode === 'add') {
        if (config.blockedWords.includes(clean)) { await respond(ctx, { embeds: [buildEmbed({ tone: 'info', title: 'ℹ Already blocked', description: `\`${clean}\` is already on the blocked list.` })] }); return; }
        setAutomodConfig(ctx.guild.id, { blockedWords: [...config.blockedWords, clean] });
        await respond(ctx, { embeds: [actionDone({
          action: 'Word blocked',
          target: `\`${clean}\``,
          detail: 'Now counted as a violation when used in a message.',
        })] });
      } else {
        setAutomodConfig(ctx.guild.id, { blockedWords: config.blockedWords.filter((w) => w !== clean) });
        await respond(ctx, { embeds: [actionDone({
          action: 'Word unblocked',
          target: `\`${clean}\``,
          detail: 'This word is no longer auto-flagged.',
        })] });
      }
      return;
    }
    if (args.sub === 'exempt') {
      const target = String(args.target ?? '').replace(/[<@&>#]/g, '');
      if (!target) { await respond(ctx, { embeds: [buildEmbed({ tone: 'warning', title: '⚠ Provide a target ID' })] }); return; }
      if (args.mode === 'add') {
        addAutomodExemption(ctx.guild.id, target, 'user');
        await respond(ctx, { embeds: [actionDone({
          action: 'Automod exemption added',
          target: `<@${target}>`,
          detail: '🛡 Will be skipped by automod.',
        })] });
      } else {
        removeAutomodExemption(ctx.guild.id, target);
        await respond(ctx, { embeds: [actionDone({
          action: 'Automod exemption removed',
          target: `<@${target}>`,
          detail: '🛡 Automod will now apply to this target.',
        })] });
      }
    }
  },
};

registerCommand(def);
export default def;