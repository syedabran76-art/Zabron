/**
 * /stats — Server statistic channels.
 */

import { ChatInputCommandInteraction, Message, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import type { CommandContext, CommandDefinition } from '../../types/index.js';
import { registerCommand } from '../../handlers/registry.js';
import { respond, replyError } from '../../handlers/respond.js';
import { buildEmbed } from '../../embeds/builders.js';
import { setStatChannel, removeStatChannel, listStatChannels } from '../../db/repositories.js';

const def: CommandDefinition = {
  name: 'stats',
  description: 'Configure statistic channels.',
  category: 'community',
  userPermissions: ['ManageChannels'],

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('stats')
      .setDescription('Set up stat channels.')
      .addSubcommand((s) => s.setName('set').setDescription('Set').addStringOption((o) => o.setName('kind').setDescription('What to count').setRequired(true).addChoices({ name: 'members', value: 'members' }, { name: 'bots', value: 'bots' }, { name: 'channels', value: 'channels' }, { name: 'roles', value: 'roles' })).addChannelOption((o) => o.setName('channel').setDescription('Target voice/text channel').setRequired(true)).addStringOption((o) => o.setName('template').setDescription('Template e.g. "Members: {count}"').setRequired(false)))
      .addSubcommand((s) => s.setName('remove').setDescription('Remove').addStringOption((o) => o.setName('kind').setDescription('What to stop counting').setRequired(true).addChoices({ name: 'members', value: 'members' }, { name: 'bots', value: 'bots' }, { name: 'channels', value: 'channels' }, { name: 'roles', value: 'roles' })))
      .addSubcommand((s) => s.setName('list').setDescription('List'))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);
  },

  async parseSlash(i: ChatInputCommandInteraction) {
    return { sub: i.options.getSubcommand(), kind: i.options.getString('kind'), channel: i.options.getChannel('channel'), template: i.options.getString('template') };
  },

  async parsePrefix(_m: Message, raw: string[]) { return { sub: raw[0] ?? 'list', kind: raw[1], channel: null, template: null }; },

  async run(ctx: CommandContext) {
    if (!ctx.guild) return;
    const args = ctx.args as any;
    if (args.sub === 'set' && args.channel) {
      setStatChannel(ctx.guild.id, args.kind, args.channel.id, args.template ?? `{count}`);
      await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Stat channel set' })] });
      return;
    }
    if (args.sub === 'remove') {
      removeStatChannel(ctx.guild.id, args.kind);
      await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Stat channel removed' })] });
      return;
    }
    const list = listStatChannels(ctx.guild.id);
    await respond(ctx, { embeds: [buildEmbed({ tone: 'info', title: 'Statistic channels', description: list.length ? list.map((s) => `${s.kind} → <#${s.channelId}> (\`${s.template}\`)`).join('\n') : 'None configured.' }) ] });
  },
};

registerCommand(def);
export default def;