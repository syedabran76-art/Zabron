/**
 * /purge + .purge — Bulk delete messages.
 */

import { ChatInputCommandInteraction, Message, PermissionFlagsBits, SlashCommandBuilder, TextChannel } from 'discord.js';

import type { CommandContext, CommandDefinition } from '../../types/index.js';
import { registerCommand } from '../../handlers/registry.js';
import { respond, replyError } from '../../handlers/respond.js';
import { parseDuration } from '../../utils/duration.js';
import { insertModerationCase } from '../../db/repositories.js';
import { actionDone } from '../../embeds/builders.js';
import { logEvent, buildActorInfo } from '../../services/logging.js';

const def: CommandDefinition = {
  name: 'purge',
  description: 'Bulk delete messages in a channel.',
  usage: '/purge <amount> [user] [filter]',
  category: 'moderation',
  userPermissions: ['ManageMessages'],
  botPermissions: ['ManageMessages', 'ReadMessageHistory'],
  cooldownSeconds: 5,

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('purge')
      .setDescription('Bulk delete messages.')
      .addIntegerOption((o) => o.setName('amount').setDescription('Number of messages (1-100)').setMinValue(1).setMaxValue(100).setRequired(true))
      .addUserOption((o) => o.setName('user').setDescription('Only delete messages from this user').setRequired(false))
      .addStringOption((o) => o.setName('filter').setDescription('Filter type').setRequired(false).addChoices({ name: 'bots', value: 'bots' }, { name: 'humans', value: 'humans' }))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);
  },

  async parseSlash(i: ChatInputCommandInteraction) {
    return {
      amount: i.options.getInteger('amount', true),
      user: i.options.getUser('user'),
      filter: i.options.getString('filter'),
    };
  },

  async parsePrefix(_m: Message, raw: string[]) {
    return {
      amount: Number(raw[0]),
      user: undefined,
      filter: raw[1] ?? null,
    };
  },

  async run(ctx: CommandContext) {
    if (!ctx.guild || !ctx.channel || !ctx.member) return;
    const { amount, user, filter } = ctx.args as any;
    if (!amount || amount < 1 || amount > 100) {
      await replyError(ctx, 'Amount must be between 1 and 100.');
      return;
    }
    if (!('bulkDelete' in ctx.channel)) {
      await replyError(ctx, 'This channel does not support bulk deletion.');
      return;
    }
    let deleted = 0;
    try {
      const fetched = await ctx.channel.messages.fetch({ limit: 100 });
      let filtered = fetched;
      if (user) filtered = filtered.filter((m) => m.author.id === user.id);
      if (filter === 'bots') filtered = filtered.filter((m) => m.author.bot);
      if (filter === 'humans') filtered = filtered.filter((m) => !m.author.bot);
      const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
      filtered = filtered.filter((m) => m.createdTimestamp > twoWeeksAgo);
      const sliced = [...filtered.values()].slice(0, amount);
      const result = await ctx.channel.bulkDelete(sliced, true);
      deleted = result.size;
    } catch (err) {
      await replyError(ctx, `Failed to purge: ${(err as Error).message}`);
      return;
    }

    insertModerationCase({
      id: `PURGE-${Date.now().toString(36).toUpperCase()}`,
      guildId: ctx.guild.id,
      targetId: user?.id ?? '0',
      moderatorId: ctx.user.id,
      action: 'purge',
      reason: null,
      duration: null,
      metadata: JSON.stringify({ amount: deleted, filter }),
    });

    const filterSummary = [
  user ? `Target: <@${user.id}>` : null,
  filter ? `Filter: \`${filter}\`` : null,
].filter(Boolean).join(' · ');
    await respond(ctx, {
      embeds: [
        actionDone({
          action: 'Channel purged',
          target: `<#${ctx.channel.id}>`,
          detail: `Removed **${deleted}** message${deleted === 1 ? '' : 's'} from <#${ctx.channel.id}>${filterSummary ? `\n${filterSummary}` : ''}.`,
        }),
      ],
      ephemeral: ctx.source === 'slash',
    });

    await logEvent({
      guildId: ctx.guild.id,
      category: 'moderation',
      title: 'Messages purged',
      description: `${deleted} messages removed in <#${ctx.channel.id}>`,
      fields: [
        { name: 'Amount', value: String(deleted), inline: true },
        { name: 'Filter', value: filter ?? 'none', inline: true },
        { name: 'Target', value: user ? `<@${user.id}>` : 'All authors', inline: true },
      ],
      author: buildActorInfo(ctx.member),
      client: ctx.guild.client,
    });
  },
};

registerCommand(def);
export default def;