/**
 * /automod — Configure automod.
 */

import { ChatInputCommandInteraction, Message, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import type { CommandContext, CommandDefinition } from '../../types/index.js';
import { registerCommand } from '../../handlers/registry.js';
import { respond } from '../../handlers/respond.js';
import { buildEmbed } from '../../embeds/builders.js';
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
      await respond(ctx, { embeds: [buildEmbed({ tone: 'log', title: 'Automod status', description: `Enabled: **${config.enabled}**`, fields: [
        { name: 'Spam', value: `${config.spamMessages} msgs / ${config.spamIntervalSeconds}s`, inline: true },
        { name: 'Mentions', value: String(config.mentionLimit), inline: true },
        { name: 'Links', value: config.linkBlock ? 'Blocked' : 'Allowed', inline: true },
        { name: 'Invites', value: config.inviteBlock ? 'Blocked' : 'Allowed', inline: true },
        { name: 'Caps', value: `${config.capsPercent}% / ${config.capsMinLength}+ chars`, inline: true },
        { name: 'Punishment', value: config.punishment, inline: true },
        { name: 'Blocked words', value: String(config.blockedWords.length), inline: true },
        { name: 'Exemptions', value: String(listAutomodExemptions(ctx.guild.id).length), inline: true },
      ] })] });
      return;
    }
    if (args.sub === 'enable') { setAutomodConfig(ctx.guild.id, { enabled: true }); await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Automod enabled' })] }); return; }
    if (args.sub === 'disable') { setAutomodConfig(ctx.guild.id, { enabled: false }); await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Automod disabled' })] }); return; }
    if (args.sub === 'spam') {
      const patch: any = {};
      if (args.messages) patch.spamMessages = args.messages;
      if (args.interval) patch.spamIntervalSeconds = args.interval;
      setAutomodConfig(ctx.guild.id, patch);
      await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Spam threshold updated' })] });
      return;
    }
    if (args.sub === 'mentions') { setAutomodConfig(ctx.guild.id, { mentionLimit: args.limit ?? 5 }); await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Mention limit updated' })] }); return; }
    if (args.sub === 'links') { setAutomodConfig(ctx.guild.id, { linkBlock: !!args.block }); await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Links updated' })] }); return; }
    if (args.sub === 'invites') { setAutomodConfig(ctx.guild.id, { inviteBlock: !!args.block }); await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Invites updated' })] }); return; }
    if (args.sub === 'caps') { setAutomodConfig(ctx.guild.id, { capsPercent: args.percent ?? 80, capsMinLength: args.minLength ?? 10 }); await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Caps rule updated' })] }); return; }
    if (args.sub === 'punishment') { setAutomodConfig(ctx.guild.id, { punishment: args.action }); await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Punishment updated' })] }); return; }
    if (args.sub === 'word') {
      const clean = String(args.word ?? '').toLowerCase().trim();
      if (!clean) { await respond(ctx, { embeds: [buildEmbed({ tone: 'warning', title: 'Provide a word' })] }); return; }
      if (args.mode === 'add') {
        if (config.blockedWords.includes(clean)) { await respond(ctx, { embeds: [buildEmbed({ tone: 'info', title: 'Already blocked' })] }); return; }
        setAutomodConfig(ctx.guild.id, { blockedWords: [...config.blockedWords, clean] });
        await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Word added' })] });
      } else {
        setAutomodConfig(ctx.guild.id, { blockedWords: config.blockedWords.filter((w) => w !== clean) });
        await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Word removed' })] });
      }
      return;
    }
    if (args.sub === 'exempt') {
      const target = String(args.target ?? '').replace(/[<@&>#]/g, '');
      if (!target) { await respond(ctx, { embeds: [buildEmbed({ tone: 'warning', title: 'Provide a target ID' })] }); return; }
      if (args.mode === 'add') { addAutomodExemption(ctx.guild.id, target, 'user'); await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Exemption added' })] }); }
      else { removeAutomodExemption(ctx.guild.id, target); await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Exemption removed' })] }); }
    }
  },
};

registerCommand(def);
export default def;