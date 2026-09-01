/**
 * /tempvoice — Set up join-to-create voice channels.
 */

import { ChatInputCommandInteraction, Message, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import type { CommandContext, CommandDefinition } from '../../types/index.js';
import { registerCommand } from '../../handlers/registry.js';
import { respond } from '../../handlers/respond.js';
import { buildEmbed } from '../../embeds/builders.js';
import { setTempvoiceGenerator } from '../../db/repositories.js';

const def: CommandDefinition = {
  name: 'tempvoice',
  description: 'Set up temporary voice channels.',
  category: 'voice',
  userPermissions: ['ManageChannels'],

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('tempvoice')
      .setDescription('Configure temp voice.')
      .addSubcommand((s) => s.setName('set').setDescription('Set generator').addChannelOption((o) => o.setName('generator').setDescription('Voice channel users join to spawn a temp room').setRequired(true)))
      .addSubcommand((s) => s.setName('disable').setDescription('Disable temp voice'))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);
  },

  async parseSlash(i: ChatInputCommandInteraction) {
    return { sub: i.options.getSubcommand(), generator: i.options.getChannel('generator') };
  },

  async parsePrefix(_m: Message, raw: string[]) { return { sub: raw[0] ?? 'disable', generator: null }; },

  async run(ctx: CommandContext) {
    if (!ctx.guild) return;
    const args = ctx.args as any;
    if (args.sub === 'set' && args.generator) {
      setTempvoiceGenerator(ctx.guild.id, args.generator.id, null);
      await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Temp voice set', description: `Joining <#${args.generator.id}> will create a new voice channel.` })] });
    }
  },
};

registerCommand(def);
export default def;