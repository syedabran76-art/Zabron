/**
 * /prefix + .prefix — Configure the guild prefix.
 */

import { ChatInputCommandInteraction, Message, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import type { CommandContext, CommandDefinition } from '../../types/index.js';
import { registerCommand } from '../../handlers/registry.js';
import { respond } from '../../handlers/respond.js';
import { getGuildSettings, updateGuildSettings } from '../../db/repositories.js';
import { buildEmbed } from '../../embeds/builders.js';

const def: CommandDefinition = {
  name: 'prefix',
  description: 'View or change the guild prefix.',
  usage: '/prefix [set|reset|view]',
  category: 'configuration',
  userPermissions: ['ManageGuild'],
  cooldownSeconds: 5,

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('prefix')
      .setDescription('Manage the guild prefix.')
      .addSubcommand((s) => s.setName('view').setDescription('Show the current prefix.'))
      .addSubcommand((s) => s.setName('set').setDescription('Set a new prefix.').addStringOption((o) => o.setName('value').setDescription('New prefix (max 5 chars)').setRequired(true)))
      .addSubcommand((s) => s.setName('reset').setDescription('Reset to default (.)'))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
  },

  async parseSlash(i: ChatInputCommandInteraction) {
    const sub = i.options.getSubcommand();
    return { sub, value: i.options.getString('value') };
  },

  async parsePrefix(_m: Message, raw: string[]) {
    if (raw.length === 0) return { sub: 'view', value: null };
    if (raw[0] === 'set') return { sub: 'set', value: raw.slice(1).join(' ') };
    if (raw[0] === 'reset') return { sub: 'reset', value: null };
    return { sub: 'view', value: null };
  },

  async run(ctx: CommandContext) {
    if (!ctx.guild) return;
    const settings = getGuildSettings(ctx.guild.id);
    const { sub, value } = ctx.args as any;

    if (sub === 'view') {
      await respond(ctx, { embeds: [buildEmbed({ tone: 'configuration', title: 'Current prefix', description: `Prefix is \`${settings.prefix}\`\nUse it like \`${settings.prefix}help\`` })] });
      return;
    }
    if (sub === 'reset') {
      const next = updateGuildSettings(ctx.guild.id, { prefix: '.' });
      await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Prefix reset', description: `New prefix: \`${next.prefix}\`` })] });
      return;
    }
    if (sub === 'set') {
      if (!value) { await respond(ctx, { embeds: [buildEmbed({ tone: 'warning', title: 'Provide a prefix' })] }); return; }
      if (value.length > 5) { await respond(ctx, { embeds: [buildEmbed({ tone: 'error', title: 'Prefix too long', description: 'Use up to 5 characters.' })] }); return; }
      const next = updateGuildSettings(ctx.guild.id, { prefix: value });
      await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Prefix updated', description: `New prefix: \`${next.prefix}\`` })] });
    }
  },
};

registerCommand(def);
export default def;