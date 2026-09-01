/**
 * /antiraid — Configure raid protection.
 */

import { ChatInputCommandInteraction, Message, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import type { CommandContext, CommandDefinition } from '../../types/index.js';
import { registerCommand } from '../../handlers/registry.js';
import { respond } from '../../handlers/respond.js';
import { buildEmbed } from '../../embeds/builders.js';
import { getAntiraidConfig, setAntiraidConfig } from '../../services/security.js';

const def: CommandDefinition = {
  name: 'antiraid',
  description: 'Configure raid protection.',
  category: 'security',
  userPermissions: ['Administrator'],
  cooldownSeconds: 5,

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('antiraid')
      .setDescription('Configure raid protection.')
      .addSubcommand((s) => s.setName('status').setDescription('Show config'))
      .addSubcommand((s) => s.setName('enable').setDescription('Enable'))
      .addSubcommand((s) => s.setName('disable').setDescription('Disable'))
      .addSubcommand((s) => s.setName('threshold').setDescription('Set thresholds').addIntegerOption((o) => o.setName('joins').setDescription('Joins').setRequired(false)).addIntegerOption((o) => o.setName('window').setDescription('Window seconds').setRequired(false)).addIntegerOption((o) => o.setName('account_age').setDescription('Min account age (days)').setRequired(false)))
      .addSubcommand((s) => s.setName('action').setDescription('Action on raid').addStringOption((o) => o.setName('value').setDescription('Action to take').addChoices({ name: 'kick', value: 'kick' }, { name: 'ban', value: 'ban' }, { name: 'lockdown', value: 'lockdown' }).setRequired(true)))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
  },

  async parseSlash(i: ChatInputCommandInteraction) {
    const sub = i.options.getSubcommand();
    return {
      sub,
      joins: i.options.getInteger('joins'),
      window: i.options.getInteger('window'),
      accountAge: i.options.getInteger('account_age'),
      action: i.options.getString('value'),
    };
  },

  async parsePrefix(_m: Message, raw: string[]) {
    return { sub: raw[0] ?? 'status', joins: null, window: null, accountAge: null, action: raw[1] };
  },

  async run(ctx: CommandContext) {
    if (!ctx.guild) return;
    const args = ctx.args as any;
    const config = getAntiraidConfig(ctx.guild.id);
    if (args.sub === 'status') {
      await respond(ctx, { embeds: [buildEmbed({ tone: 'security', title: 'Antiraid status', description: `Enabled: **${config.enabled}**`, fields: [
        { name: 'Threshold', value: `${config.joinThreshold} joins / ${config.joinWindowSeconds}s`, inline: true },
        { name: 'Account age', value: `${config.accountAgeDays} days`, inline: true },
        { name: 'Action', value: config.action, inline: true },
      ] })] });
      return;
    }
    if (args.sub === 'enable') { setAntiraidConfig(ctx.guild.id, { enabled: true }); await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Antiraid enabled' })] }); return; }
    if (args.sub === 'disable') { setAntiraidConfig(ctx.guild.id, { enabled: false }); await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Antiraid disabled' })] }); return; }
    if (args.sub === 'threshold') {
      const patch: any = {};
      if (args.joins) patch.joinThreshold = args.joins;
      if (args.window) patch.joinWindowSeconds = args.window;
      if (args.accountAge !== null && args.accountAge !== undefined) patch.accountAgeDays = args.accountAge;
      setAntiraidConfig(ctx.guild.id, patch);
      await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Thresholds updated' })] });
      return;
    }
    if (args.sub === 'action') {
      setAntiraidConfig(ctx.guild.id, { action: args.action });
      await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Action updated', description: `Action: ${args.action}` })] });
    }
  },
};

registerCommand(def);
export default def;