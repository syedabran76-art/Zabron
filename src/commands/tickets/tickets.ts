/**
 * /tickets — Manage tickets.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ChatInputCommandInteraction,
  EmbedBuilder,
  Message,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextChannel,
} from 'discord.js';

import type { CommandContext, CommandDefinition } from '../../types/index.js';
import { registerCommand } from '../../handlers/registry.js';
import { respond, replyError } from '../../handlers/respond.js';
import { buildEmbed, ticket } from '../../embeds/builders.js';
import { ticketId } from '../../utils/ids.js';
import {
  insertTicket,
  updateTicketStatus,
  getTicket,
  getTicketByChannel,
  listOpenTickets,
} from '../../db/repositories.js';
import { getDatabase } from '../../db/database.js';
import { logEvent, buildActorInfo } from '../../services/logging.js';

const def: CommandDefinition = {
  name: 'tickets',
  description: 'Manage tickets.',
  category: 'tickets',
  userPermissions: ['ManageChannels'],
  cooldownSeconds: 5,

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('tickets')
      .setDescription('Manage the ticket system.')
      .addSubcommand((s) => s.setName('setup').setDescription('Set up the ticket system (categories, support role)').addStringOption((o) => o.setName('category').setDescription('Category name').setRequired(true)).addStringOption((o) => o.setName('description').setDescription('Category description').setRequired(false)).addRoleOption((o) => o.setName('support_role').setDescription('Role that can see and reply to tickets').setRequired(false)))
      .addSubcommand((s) => s.setName('panel').setDescription('Post a ticket panel').addChannelOption((o) => o.setName('channel').setDescription('Channel to post the panel in').setRequired(true)).addStringOption((o) => o.setName('title').setDescription('Panel embed title').setRequired(true)).addStringOption((o) => o.setName('description').setDescription('Panel embed description').setRequired(false)))
      .addSubcommand((s) => s.setName('open').setDescription('Open a ticket').addStringOption((o) => o.setName('topic').setDescription('Optional ticket topic').setRequired(false)))
      .addSubcommand((s) => s.setName('close').setDescription('Close the current ticket'))
      .addSubcommand((s) => s.setName('claim').setDescription('Claim the current ticket'))
      .addSubcommand((s) => s.setName('add').setDescription('Add a user to the ticket').addUserOption((o) => o.setName('user').setDescription('User to add').setRequired(true)))
      .addSubcommand((s) => s.setName('remove').setDescription('Remove a user from the ticket').addUserOption((o) => o.setName('user').setDescription('User to remove').setRequired(true)))
      .addSubcommand((s) => s.setName('list').setDescription('List open tickets'))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);
  },

  async parseSlash(i: ChatInputCommandInteraction) {
    return {
      sub: i.options.getSubcommand(),
      category: i.options.getString('category'),
      description: i.options.getString('description'),
      supportRole: i.options.getRole('support_role'),
      channel: i.options.getChannel('channel'),
      title: i.options.getString('title'),
      topic: i.options.getString('topic'),
      user: i.options.getUser('user'),
    };
  },

  async parsePrefix(_m: Message, raw: string[]) {
    return { sub: raw[0] ?? 'list', category: raw[1], description: raw.slice(2).join(' '), supportRole: null, channel: null, title: null, topic: null, user: null };
  },

  async run(ctx: CommandContext) {
    if (!ctx.guild || !ctx.member) return;
    const args = ctx.args as any;

    if (args.sub === 'setup') {
      if (!args.category) { await replyError(ctx, 'Category name required.'); return; }
      getDatabase().prepare(`INSERT INTO ticket_categories (guild_id, name, description, support_role_id) VALUES (?, ?, ?, ?) ON CONFLICT(guild_id, name) DO UPDATE SET description = excluded.description, support_role_id = excluded.support_role_id`).run(ctx.guild.id, args.category, args.description, args.supportRole?.id ?? null);
      await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Ticket category set', description: `**${args.category}** ready.` })] });
      return;
    }

    if (args.sub === 'panel') {
      if (!args.channel || !args.title) { await replyError(ctx, 'channel and title required.'); return; }
      const categories = (getDatabase().prepare('SELECT name FROM ticket_categories WHERE guild_id = ?').all(ctx.guild.id) as any[]).map((r) => r.name);
      const buttons = categories.length ? categories.slice(0, 5).map((cat) => new ButtonBuilder().setCustomId(`ticket:open:${cat}`).setLabel(cat).setStyle(ButtonStyle.Primary)) : [new ButtonBuilder().setCustomId('ticket:open:general').setLabel('Open ticket').setStyle(ButtonStyle.Primary)];
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
      const message = await (args.channel as TextChannel).send({ embeds: [new EmbedBuilder().setTitle(args.title).setDescription(args.description ?? 'Click a button to open a ticket.').setColor(0x16a085)], components: [row] });
      getDatabase().prepare('INSERT INTO ticket_panels (guild_id, channel_id, message_id, title, description, categories, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(ctx.guild.id, args.channel.id, message.id, args.title, args.description, JSON.stringify(categories), Date.now());
      await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Ticket panel posted' })] });
      return;
    }

    if (args.sub === 'open') {
      const channel = await createTicketChannel(ctx, { topic: args.topic ?? null });
      await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Ticket opened', description: `<#${channel.id}>` })] });
      return;
    }

    if (args.sub === 'close' && ctx.channel) {
      const t = getTicketByChannel(ctx.channel.id);
      if (!t) { await replyError(ctx, 'This channel is not a ticket.'); return; }
      await closeTicket(ctx, t.ticketId);
      return;
    }

    if (args.sub === 'claim' && ctx.channel) {
      const t = getTicketByChannel(ctx.channel.id);
      if (!t) { await replyError(ctx, 'This channel is not a ticket.'); return; }
      updateTicketStatus(t.ticketId, 'claimed', ctx.user.id);
      await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Ticket claimed', description: `Claimed by <@${ctx.user.id}>.` })] });
      return;
    }

    if (args.sub === 'add' || args.sub === 'remove') {
      const t = ctx.channel ? getTicketByChannel(ctx.channel.id) : null;
      if (!t) { await replyError(ctx, 'Not a ticket channel.'); return; }
      const target = await ctx.guild.members.fetch(args.user.id).catch(() => null);
      if (!target) { await replyError(ctx, 'User not in server.'); return; }
      const channel = ctx.channel as any;
      if (args.sub === 'add') await channel.permissionOverwrites.edit(target, { ViewChannel: true, SendMessages: true });
      else await channel.permissionOverwrites.delete(target.id);
      await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: args.sub === 'add' ? 'Added' : 'Removed', description: `<@${target.id}>` })] });
      return;
    }

    if (args.sub === 'list') {
      const list = listOpenTickets(ctx.guild.id);
      await respond(ctx, { embeds: [ticket('Open tickets', list.length ? list.map((t) => `• ${t.ticketId} — <#${t.channelId}> — <@${t.userId}> — ${t.status}`).join('\n') : 'No open tickets.')] });
      return;
    }
  },
};

export interface TicketOptions {
  category?: string;
  topic?: string | null;
}

export async function createTicketChannel(ctx: CommandContext, topicOrOpts: string | TicketOptions | null): Promise<any> {
  // Back-compat: old callers passed `topic`, new callers may pass options.
  const opts: TicketOptions =
    typeof topicOrOpts === 'string' || topicOrOpts === null
      ? { topic: topicOrOpts }
      : topicOrOpts;
  const category = (opts.category ?? 'general').toLowerCase();
  const topic = opts.topic ?? null;
  const id = ticketId();
  const everyone = ctx.guild!.roles.everyone;
  const supportRow = (getDatabase().prepare('SELECT support_role_id FROM ticket_categories WHERE guild_id = ? AND name = ?').get(ctx.guild!.id, category) as any) ?? null;
  const permissionOverwrites: any[] = [
    { id: everyone.id, deny: ['ViewChannel'] },
    { id: ctx.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
  ];
  if (supportRow?.support_role_id) {
    permissionOverwrites.push({ id: supportRow.support_role_id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] });
  }
  const channel = await ctx.guild!.channels.create({
    name: `ticket-${id}`,
    type: ChannelType.GuildText,
    topic: topic ?? undefined,
    parent: ctx.channel && 'parent' in ctx.channel ? (ctx.channel as any).parent ?? undefined : undefined,
    permissionOverwrites,
    reason: `Ticket opened by ${ctx.user.tag}`,
  });
  insertTicket({
    ticketId: id,
    guildId: ctx.guild!.id,
    channelId: channel.id,
    userId: ctx.user.id,
    claimedBy: null,
    category,
    status: 'open',
    topic,
    createdAt: Date.now(),
    closedAt: null,
  });
  if ('send' in channel) await (channel as any).send({ embeds: [buildEmbed({ tone: 'ticket', title: `Ticket ${id}`, description: `${ctx.user.tag}, please describe your issue. Support will respond shortly.` })] });
  return channel;
}

export async function closeTicket(ctx: CommandContext, ticketId: string): Promise<void> {
  const t = getTicket(ticketId);
  if (!t) return;
  updateTicketStatus(ticketId, 'closed');
  if (ctx.channel) {
    await ctx.channel.send({ embeds: [buildEmbed({ tone: 'ticket', title: 'Ticket closed', description: 'This ticket will be archived in 10 seconds.' })] });
    setTimeout(async () => {
      try { await ctx.channel!.delete('Ticket closed'); } catch { /* ignore */ }
    }, 10_000);
  }
  await logEvent({
    guildId: t.guildId,
    category: 'tickets',
    title: `Ticket ${t.ticketId} closed`,
    author: ctx.member ? buildActorInfo(ctx.member) : undefined,
    client: ctx.guild!.client,
  });
}

registerCommand(def);
export default def;