/**
 * /giveaway — Create, end, reroll, cancel, list.
 */

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction, Message, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import type { CommandContext, CommandDefinition } from '../../types/index.js';
import { registerCommand } from '../../handlers/registry.js';
import { respond, replyError, deferReply, editReply } from '../../handlers/respond.js';
import { buildEmbed, giveaway } from '../../embeds/builders.js';
import { parseDuration, discordTime } from '../../utils/duration.js';
import { giveawayId } from '../../utils/ids.js';
import {
  insertGiveaway,
  listGiveaways,
  getGiveaway,
  setGiveawayMessageId,
  endGiveaway,
  cancelGiveaway,
  addGiveawayEntry,
  removeGiveawayEntry,
  getGiveawayEntries,
} from '../../db/repositories.js';

const def: CommandDefinition = {
  name: 'giveaway',
  description: 'Run giveaways.',
  category: 'giveaways',
  cooldownSeconds: 10,

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('giveaway')
      .setDescription('Manage giveaways.')
      .addSubcommand((s) => s.setName('create').setDescription('Create a giveaway').addStringOption((o) => o.setName('duration').setDescription('e.g. 1h, 30m, 1d').setRequired(true)).addStringOption((o) => o.setName('prize').setDescription('Prize description').setRequired(true)).addIntegerOption((o) => o.setName('winners').setDescription('Number of winners').setRequired(false)).addRoleOption((o) => o.setName('role').setDescription('Role required to enter').setRequired(false)))
      .addSubcommand((s) => s.setName('end').setDescription('End a giveaway early').addStringOption((o) => o.setName('id').setDescription('Giveaway ID').setRequired(true)))
      .addSubcommand((s) => s.setName('reroll').setDescription('Reroll winners').addStringOption((o) => o.setName('id').setDescription('Giveaway ID').setRequired(true)))
      .addSubcommand((s) => s.setName('cancel').setDescription('Cancel a giveaway').addStringOption((o) => o.setName('id').setDescription('Giveaway ID').setRequired(true)))
      .addSubcommand((s) => s.setName('list').setDescription('List giveaways'));
  },

  async parseSlash(i: ChatInputCommandInteraction) {
    const sub = i.options.getSubcommand();
    return {
      sub,
      duration: i.options.getString('duration'),
      prize: i.options.getString('prize'),
      winners: i.options.getInteger('winners') ?? 1,
      role: i.options.getRole('role'),
      id: i.options.getString('id'),
    };
  },

  async parsePrefix(_m: Message, raw: string[]) {
    return { sub: raw[0] ?? 'list', duration: raw[1], prize: raw.slice(2).join(' '), winners: 1, role: null, id: raw[1] };
  },

  async run(ctx: CommandContext) {
    if (!ctx.guild || !ctx.channel) return;
    const args = ctx.args as any;

    if (args.sub === 'create') {
      if (!args.duration || !args.prize) { await replyError(ctx, 'duration and prize required.'); return; }
      const parsed = parseDuration(args.duration);
      if (!parsed) { await replyError(ctx, 'Invalid duration.'); return; }
      const id = giveawayId();
      const endsAt = Date.now() + parsed.ms;
      insertGiveaway({
        id,
        guildId: ctx.guild.id,
        channelId: ctx.channel.id,
        messageId: null,
        hostId: ctx.user.id,
        prize: args.prize,
        winnerCount: args.winners,
        requiredRoleId: args.role?.id ?? null,
        startsAt: Date.now(),
        endsAt,
        ended: false,
        cancelled: false,
        winners: null,
      });
      const embed = giveaway(`🎉 Giveaway!`, `**${args.prize}**\nWinners: **${args.winners}**\nEnds: ${discordTime(endsAt, 'R')}${args.role ? `\nRequired role: <@&${args.role.id}>` : ''}`).setFooter({ text: `ID: ${id}` });
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`giveaway:join:${id}`).setLabel('Enter 🎉').setStyle(ButtonStyle.Primary));
      const msg = await ctx.channel.send({ content: '🎉 **A new giveaway has started!**', embeds: [embed], components: [row] });
      setGiveawayMessageId(id, msg.id);
      await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Giveaway created', description: `ID: ${id}` })] });
      return;
    }
    if (args.sub === 'end' || args.sub === 'reroll' || args.sub === 'cancel') {
      const g = getGiveaway(args.id);
      if (!g || g.guildId !== ctx.guild.id) { await replyError(ctx, 'Giveaway not found.'); return; }
      if (args.sub === 'cancel') {
        cancelGiveaway(g.id);
        await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Giveaway cancelled' })] });
        return;
      }
      const entries = getGiveawayEntries(g.id);
      if (!entries.length) { await replyError(ctx, 'No entries.'); return; }
      const winners: string[] = [];
      const pool = [...entries];
      while (winners.length < g.winnerCount && pool.length) {
        const idx = Math.floor(Math.random() * pool.length);
        winners.push(pool.splice(idx, 1)[0]);
      }
      endGiveaway(g.id, winners);
      if (g.channelId && g.messageId) {
        const channel = await ctx.guild.channels.fetch(g.channelId).catch(() => null);
        if (channel && 'send' in channel) {
          await (channel as any).send({ embeds: [giveaway('🎉 Giveaway ended!', `Prize: **${g.prize}**\nWinner${winners.length > 1 ? 's' : ''}: ${winners.map((w) => `<@${w}>`).join(', ')}`)] });
        }
      }
      await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Done', description: `Winners: ${winners.map((w) => `<@${w}>`).join(', ')}` })] });
      return;
    }
    if (args.sub === 'list') {
      const list = listGiveaways(ctx.guild.id);
      await respond(ctx, { embeds: [buildEmbed({ tone: 'giveaway', title: 'Giveaways', description: list.slice(0, 10).map((g) => `${g.ended ? '⌛' : '🟢'} ${g.id} — ${g.prize} (${discordTime(g.endsAt, 'R')})`).join('\n') || 'No giveaways.' }) ] });
    }
  },
};

export function handleGiveawayJoin(giveawayId: string, userId: string): boolean {
  const g = getGiveaway(giveawayId);
  if (!g || g.ended || g.cancelled) return false;
  if (g.requiredRoleId) {
    // We can't check member roles without fetching guild — caller handles that
  }
  return addGiveawayEntry(giveawayId, userId);
}

export function handleGiveawayLeave(giveawayId: string, userId: string): void {
  removeGiveawayEntry(giveawayId, userId);
}

registerCommand(def);
export default def;