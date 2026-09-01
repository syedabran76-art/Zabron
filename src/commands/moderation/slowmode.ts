/**
 * /slowmode + .slowmode — Adjusts slowmode on the current channel.
 */

import { ChatInputCommandInteraction, Message, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import type { CommandContext, CommandDefinition } from '../../types/index.js';
import { registerCommand } from '../../handlers/registry.js';
import { respond, replyError } from '../../handlers/respond.js';
import { parseDuration } from '../../utils/duration.js';
import { actionDone } from '../../embeds/builders.js';

const def: CommandDefinition = {
  name: 'slowmode',
  description: 'Adjust slowmode on the current channel.',
  usage: '/slowmode <duration>',
  category: 'moderation',
  userPermissions: ['ManageChannels'],
  botPermissions: ['ManageChannels'],

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('slowmode')
      .setDescription('Set slowmode.')
      .addStringOption((o) => o.setName('duration').setDescription('Off / 5s / 10s / 30s / 1m / 5m / 15m / 1h / 6h').setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);
  },

  async parseSlash(i: ChatInputCommandInteraction) {
    return { duration: i.options.getString('duration', true) };
  },

  async parsePrefix(_m: Message, raw: string[]) {
    return { duration: raw.join(' ') };
  },

  async run(ctx: CommandContext) {
    if (!ctx.guild || !ctx.channel) return;
    const { duration } = ctx.args as any;
    if (!duration) {
      await replyError(ctx, 'Provide a duration like `5s`, `1m`, or `off`.');
      return;
    }
    let seconds = 0;
    if (duration.toLowerCase() === 'off' || duration === '0s') {
      seconds = 0;
    } else {
      const parsed = parseDuration(duration);
      if (!parsed) { await replyError(ctx, 'Invalid duration.'); return; }
      seconds = Math.floor(parsed.ms / 1000);
      if (seconds > 21600) { await replyError(ctx, 'Maximum slowmode is 6 hours.'); return; }
    }
    const target = ctx.channel as any;
    if (!('setRateLimitPerUser' in target)) {
      await replyError(ctx, 'Slowmode is not supported on this channel type.');
      return;
    }
    await target.setRateLimitPerUser(seconds, `slowmode set by ${ctx.user.tag}`);
    await respond(ctx, {
      embeds: [actionDone({
        action: 'Slowmode updated',
        target: `<#${ctx.channel.id}>`,
        detail: seconds === 0 ? 'Slowmode disabled.' : `Now **${seconds} second${seconds === 1 ? '' : 's'}** between messages.`,
      })],
    });
  },
};

registerCommand(def);
export default def;