/**
 * /clear + .clear — Delete the last N messages (alias of /purge with no filters).
 */

import { ChatInputCommandInteraction, Message, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import type { CommandContext, CommandDefinition } from '../../types/index.js';
import { registerCommand } from '../../handlers/registry.js';
import { respond, replyError } from '../../handlers/respond.js';
import { actionDone } from '../../embeds/builders.js';

const def: CommandDefinition = {
  name: 'clear',
  description: 'Quickly clear the last N messages.',
  usage: '/clear <amount>',
  category: 'moderation',
  userPermissions: ['ManageMessages'],
  botPermissions: ['ManageMessages', 'ReadMessageHistory'],
  cooldownSeconds: 3,

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('clear')
      .setDescription('Delete the last N messages.')
      .addIntegerOption((o) => o.setName('amount').setDescription('Amount').setMinValue(1).setMaxValue(100).setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);
  },

  async parseSlash(i: ChatInputCommandInteraction) {
    return { amount: i.options.getInteger('amount', true) };
  },

  async parsePrefix(_m: Message, raw: string[]) {
    return { amount: Number(raw[0]) };
  },

  async run(ctx: CommandContext) {
    if (!ctx.channel || !ctx.guild || !ctx.member) return;
    const { amount } = ctx.args as any;
    if (!amount || amount < 1 || amount > 100) { await replyError(ctx, 'Amount must be 1-100.'); return; }
    if (!('bulkDelete' in ctx.channel)) { await replyError(ctx, 'Channel cannot be bulk-cleared.'); return; }
    const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const fetched = await ctx.channel.messages.fetch({ limit: 100 });
    const slice = [...fetched.values()].filter((m) => m.createdTimestamp > twoWeeksAgo).slice(0, amount);
    const res = await ctx.channel.bulkDelete(slice, true);
    await respond(ctx, {
      embeds: [
        actionDone({
          action: 'Channel cleared',
          target: `<#${ctx.channel.id}>`,
          detail: `Removed **${res.size}** message${res.size === 1 ? '' : 's'}.`,
        }),
      ],
      ephemeral: ctx.source === 'slash',
    });
  },
};

registerCommand(def);
export default def;