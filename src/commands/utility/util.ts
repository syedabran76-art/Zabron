/**
 * /help, /ping, /uptime, /botinfo, /avatar, /banner, /user, /permissions, /calculator, /timestamp, /announce, /embed, /snipe, /editsnipe
 */

import {
  ActionRowBuilder,
  ChatInputCommandInteraction,
  Message,
  SelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  SlashCommandBuilder,
  EmbedBuilder,
  ComponentType,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} from 'discord.js';

import type { CommandContext, CommandDefinition } from '../../types/index.js';
import { registerCommand } from '../../handlers/registry.js';
import { respond, replyError, deferReply, editReply } from '../../handlers/respond.js';
import { listByCategory } from '../../handlers/registry.js';
import { buildEmbed, help as helpEmbed } from '../../embeds/builders.js';
import { resolveUser } from '../../utils/permissions.js';
import { discordTime } from '../../utils/duration.js';

const startedAt = Date.now();

const help: CommandDefinition = {
  name: 'help',
  description: 'Show all commands by category.',
  category: 'utility',
  cooldownSeconds: 3,
  allowDm: true,
  guildOnly: false,

  buildSlash() {
    return new SlashCommandBuilder().setName('help').setDescription('Show commands.').addStringOption((o) => o.setName('command').setDescription('Command to look up').setRequired(false).setAutocomplete(true));
  },

  async parseSlash(i: ChatInputCommandInteraction) {
    return { command: i.options.getString('command') };
  },

  async parsePrefix(_m: Message, raw: string[]) {
    return { command: raw[0] };
  },

  async run(ctx: CommandContext) {
    const grouped = listByCategory();
    const target = (ctx.args as any).command;
    if (target) {
      const { listCommands } = await import('../../handlers/registry.js');
      const def = listCommands().find((c) => c.name === target || c.name === target.toLowerCase());
      if (!def) {
        await respond(ctx, { embeds: [helpEmbed('Command not found', `No command named "${target}".`)] });
        return;
      }
      const embed = helpEmbed(`/${def.name}`, def.description).addFields(
        { name: 'Usage', value: def.usage ?? `/${def.name}`, inline: false },
        { name: 'Category', value: def.category, inline: true },
        { name: 'Cooldown', value: def.cooldownSeconds ? `${def.cooldownSeconds}s` : 'none', inline: true },
        { name: 'Bot perms', value: def.botPermissions?.length ? def.botPermissions.join(', ') : '—', inline: true },
      );
      await respond(ctx, { embeds: [embed] });
      return;
    }

    const entries = Object.entries(grouped);
    const embed = helpEmbed('Zabron Help', 'Pick a category below or browse all commands here.').addFields(
      entries.map(([cat, list]) => ({ name: `${cat} (${list.length})`, value: list.map((c) => `\`${c.name}\``).slice(0, 10).join(', ') + (list.length > 10 ? '…' : ''), inline: false })),
    );

    const select = new StringSelectMenuBuilder()
      .setCustomId('help:select')
      .setPlaceholder('Choose a category')
      .addOptions(entries.map(([cat]) => ({ label: cat, value: cat, description: `${grouped[cat].length} commands` })));

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
    await respond(ctx, { embeds: [embed], components: [row as any] });

    if (ctx.interaction) {
      try {
        const reply = await ctx.interaction.fetchReply();
        const collector = reply.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 60_000 });
        collector.on('collect', async (i) => {
          const cat = i.values[0];
          const cmds = grouped[cat] ?? [];
          const e2 = helpEmbed(`${cat} commands`, cmds.map((c) => `**/${c.name}** — ${c.description}`).join('\n'));
          await i.update({ embeds: [e2], components: [row as any] });
        });
        collector.on('end', async () => {
          try { await reply.edit({ components: [] }); } catch {}
        });
      } catch {}
    }
  },
};

const ping: CommandDefinition = {
  name: 'ping',
  description: 'Check Zabron latency.',
  category: 'utility',
  buildSlash() { return new SlashCommandBuilder().setName('ping').setDescription('Ping the bot.'); },
  parseSlash() { return {}; },
  parsePrefix() { return {}; },
  async run(ctx: CommandContext) {
    const ws = ctx.guild?.client.ws.ping ?? 0;
    await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Pong!', description: `WebSocket latency: **${ws}ms**` })] });
  },
};

const uptime: CommandDefinition = {
  name: 'uptime',
  description: 'Show how long Zabron has been running.',
  category: 'utility',
  buildSlash() { return new SlashCommandBuilder().setName('uptime').setDescription('Show uptime.'); },
  parseSlash() { return {}; },
  parsePrefix() { return {}; },
  async run(ctx: CommandContext) {
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    await respond(ctx, { embeds: [buildEmbed({ tone: 'info', title: 'Uptime', description: `${days}d ${hours}h ${minutes}m ${secs}s` })] });
  },
};

const botinfo: CommandDefinition = {
  name: 'botinfo',
  description: 'Show information about Zabron.',
  category: 'utility',
  buildSlash() { return new SlashCommandBuilder().setName('botinfo').setDescription('Show Zabron info.'); },
  parseSlash() { return {}; },
  parsePrefix() { return {}; },
  async run(ctx: CommandContext) {
    const client = ctx.guild?.client ?? (ctx.interaction?.client);
    const guilds = client?.guilds?.cache?.size ?? 0;
    await respond(ctx, { embeds: [buildEmbed({ tone: 'brand', title: 'Zabron', description: 'All-in-one Discord server operating system.', fields: [
      { name: 'Guilds', value: String(guilds), inline: true },
      { name: 'Library', value: 'discord.js', inline: true },
      { name: 'Version', value: '1.0.0', inline: true },
      { name: 'Started', value: discordTime(startedAt, 'R'), inline: true },
    ] })] });
  },
};

const avatar: CommandDefinition = {
  name: 'avatar',
  description: 'Show a user\'s avatar.',
  category: 'utility',
  buildSlash() {
    return new SlashCommandBuilder().setName('avatar').setDescription('Show an avatar.').addUserOption((o) => o.setName('user').setDescription('User (defaults to you)').setRequired(false));
  },
  async parseSlash(i: ChatInputCommandInteraction) { return { user: i.options.getUser('user') }; },
  async parsePrefix(m: Message, raw: string[]) {
    const user = raw[0] ? await resolveUser(m.guild!, raw[0]) : null;
    return { user };
  },
  async run(ctx: CommandContext) {
    const user = (ctx.args as any).user ?? ctx.user;
    const url = user.displayAvatarURL({ size: 4096 });
    await respond(ctx, { embeds: [buildEmbed({ tone: 'info', title: `${user.tag}`, imageURL: url, description: `[Direct link](${url})` })] });
  },
};

const banner: CommandDefinition = {
  name: 'banner',
  description: 'Show a user\'s banner.',
  category: 'utility',
  buildSlash() {
    return new SlashCommandBuilder().setName('banner').setDescription('Show a banner.').addUserOption((o) => o.setName('user').setDescription('User (defaults to you)').setRequired(false));
  },
  async parseSlash(i: ChatInputCommandInteraction) { return { user: i.options.getUser('user') }; },
  async parsePrefix(m: Message, raw: string[]) {
    const user = raw[0] ? await resolveUser(m.guild!, raw[0]) : null;
    return { user };
  },
  async run(ctx: CommandContext) {
    const user = (ctx.args as any).user ?? ctx.user;
    const fetched = await user.fetch(true).catch(() => null);
    const url = (fetched as any)?.bannerURL?.({ size: 1024 });
    if (!url) {
      await respond(ctx, { embeds: [buildEmbed({ tone: 'warning', title: 'No banner', description: 'This user has no banner set.' })] });
      return;
    }
    await respond(ctx, { embeds: [buildEmbed({ tone: 'info', title: `${user.tag} banner`, imageURL: url })] });
  },
};

const calculator: CommandDefinition = {
  name: 'calculator',
  description: 'Evaluate a math expression.',
  category: 'utility',
  cooldownSeconds: 3,
  buildSlash() {
    return new SlashCommandBuilder().setName('calculator').setDescription('Evaluate math.').addStringOption((o) => o.setName('expression').setDescription('Math expression (numbers + - * / ( ))').setRequired(true));
  },
  async parseSlash(i: ChatInputCommandInteraction) { return { expression: i.options.getString('expression', true) }; },
  async parsePrefix(_m: Message, raw: string[]) { return { expression: raw.join(' ') }; },
  async run(ctx: CommandContext) {
    const expression = String((ctx.args as any).expression ?? '');
    if (!/^[\d+\-*/().\s]+$/.test(expression)) { await replyError(ctx, 'Only numbers and basic operators are allowed.'); return; }
    try {
      // eslint-disable-next-line no-new-func
      const result = Function(`"use strict"; return (${expression})`)();
      await respond(ctx, { embeds: [buildEmbed({ tone: 'info', title: 'Calculator', description: `\`${expression}\` = **${result}**` })] });
    } catch (err) {
      await replyError(ctx, `Could not evaluate: ${(err as Error).message}`);
    }
  },
};

const timestamp: CommandDefinition = {
  name: 'timestamp',
  description: 'Generate a Discord timestamp.',
  category: 'utility',
  buildSlash() {
    return new SlashCommandBuilder().setName('timestamp').setDescription('Generate a timestamp.').addStringOption((o) => o.setName('datetime').setDescription('e.g. 2026-12-31 23:59').setRequired(true)).addStringOption((o) => o.setName('style').setDescription('Timestamp display style').setRequired(false).addChoices({ name: 'Short Time', value: 't' }, { name: 'Long Time', value: 'T' }, { name: 'Short Date', value: 'd' }, { name: 'Long Date', value: 'D' }, { name: 'Short Date/Time', value: 'f' }, { name: 'Long Date/Time', value: 'F' }, { name: 'Relative', value: 'R' }));
  },
  async parseSlash(i: ChatInputCommandInteraction) {
    return { datetime: i.options.getString('datetime', true), style: i.options.getString('style') ?? 'F' };
  },
  async parsePrefix(_m: Message, raw: string[]) {
    return { datetime: raw.join(' '), style: 'F' };
  },
  async run(ctx: CommandContext) {
    const { datetime, style } = ctx.args as any;
    const ts = Date.parse(datetime);
    if (Number.isNaN(ts)) { await replyError(ctx, 'Invalid datetime.'); return; }
    await respond(ctx, { embeds: [buildEmbed({ tone: 'info', title: 'Timestamp', description: `\`${datetime}\` → <t:${Math.floor(ts / 1000)}:${style}>\nRaw: \`${Math.floor(ts / 1000)}\`` })] });
  },
};

const permissions: CommandDefinition = {
  name: 'permissions',
  description: 'Inspect a member\'s permissions.',
  category: 'utility',
  buildSlash() {
    return new SlashCommandBuilder().setName('permissions').setDescription('Inspect permissions.').addUserOption((o) => o.setName('user').setDescription('User to inspect (defaults to you)').setRequired(false));
  },
  async parseSlash(i: ChatInputCommandInteraction) { return { user: i.options.getUser('user') }; },
  async parsePrefix(m: Message, raw: string[]) {
    const user = raw[0] ? await resolveUser(m.guild!, raw[0]) : null;
    return { user };
  },
  async run(ctx: CommandContext) {
    if (!ctx.guild) return;
    const user = (ctx.args as any).user ?? ctx.user;
    const member = await ctx.guild.members.fetch(user.id).catch(() => null);
    if (!member) { await replyError(ctx, 'User not in server.'); return; }
    const list = member.permissions.toArray();
    await respond(ctx, { embeds: [buildEmbed({ tone: 'info', title: `Permissions for ${user.tag}`, description: list.length ? list.join(', ') : 'No special permissions.' })] });
  },
};

const user: CommandDefinition = {
  name: 'user',
  description: 'Quick user info.',
  category: 'utility',
  buildSlash() {
    return new SlashCommandBuilder().setName('user').setDescription('Quick user info.').addUserOption((o) => o.setName('user').setDescription('User to inspect (defaults to you)').setRequired(false));
  },
  async parseSlash(i: ChatInputCommandInteraction) { return { user: i.options.getUser('user') }; },
  async parsePrefix(m: Message, raw: string[]) {
    const user = raw[0] ? await resolveUser(m.guild!, raw[0]) : null;
    return { user };
  },
  async run(ctx: CommandContext) {
    const target = (ctx.args as any).user ?? ctx.user;
    const embed = buildEmbed({ tone: 'info', title: target.tag, thumbnailURL: target.displayAvatarURL(), fields: [
      { name: 'ID', value: target.id, inline: true },
      { name: 'Created', value: discordTime(target.createdTimestamp, 'F'), inline: true },
    ] });
    await respond(ctx, { embeds: [embed] });
  },
};

const announce: CommandDefinition = {
  name: 'announce',
  description: 'Send an announcement embed.',
  category: 'utility',
  userPermissions: ['ManageMessages'],
  buildSlash() {
    return new SlashCommandBuilder()
      .setName('announce')
      .setDescription('Send an announcement.')
      .addChannelOption((o) => o.setName('channel').setDescription('Target channel').setRequired(true))
      .addStringOption((o) => o.setName('title').setDescription('Announcement title').setRequired(true))
      .addStringOption((o) => o.setName('message').setDescription('Announcement body').setRequired(true))
      .addStringOption((o) => o.setName('color').setDescription('Hex color (e.g. #6c5ce7)').setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);
  },
  async parseSlash(i: ChatInputCommandInteraction) {
    return { channel: i.options.getChannel('channel', true), title: i.options.getString('title', true), message: i.options.getString('message', true), color: i.options.getString('color') };
  },
  async parsePrefix(_m: Message, raw: string[]) { return { channel: null, title: raw[0], message: raw.slice(1).join(' '), color: null }; },
  async run(ctx: CommandContext) {
    const { channel, title, message, color } = ctx.args as any;
    if (!channel || !title || !message) { await replyError(ctx, 'channel, title and message are required.'); return; }
    const embed = new EmbedBuilder().setTitle(title).setDescription(message).setColor((color as any) ?? 0x6c5ce7).setFooter({ text: `Announcement by ${ctx.user.tag}` }).setTimestamp();
    await channel.send({ embeds: [embed] });
    await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Announcement sent', description: `<#${channel.id}>` })] });
  },
};

const embed: CommandDefinition = {
  name: 'embed',
  description: 'Send a custom embed.',
  category: 'utility',
  userPermissions: ['ManageMessages'],
  buildSlash() {
    return new SlashCommandBuilder()
      .setName('embed')
      .setDescription('Build an embed.')
      .addChannelOption((o) => o.setName('channel').setDescription('Target channel').setRequired(true))
      .addStringOption((o) => o.setName('title').setDescription('Embed title').setRequired(false))
      .addStringOption((o) => o.setName('description').setDescription('Embed body').setRequired(false))
      .addStringOption((o) => o.setName('color').setDescription('Hex color').setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);
  },
  async parseSlash(i: ChatInputCommandInteraction) {
    return { channel: i.options.getChannel('channel', true), title: i.options.getString('title'), description: i.options.getString('description'), color: i.options.getString('color') };
  },
  async parsePrefix(_m: Message, raw: string[]) { return { channel: null, title: raw[0], description: raw.slice(1).join(' '), color: null }; },
  async run(ctx: CommandContext) {
    const { channel, title, description, color } = ctx.args as any;
    if (!channel || (!title && !description)) { await replyError(ctx, 'Provide channel and title/description.'); return; }
    const e = new EmbedBuilder().setTitle(title ?? '').setDescription(description ?? '').setColor((color as any) ?? 0x6c5ce7).setFooter({ text: `Sent by ${ctx.user.tag}` }).setTimestamp();
    await channel.send({ embeds: [e] });
    await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Embed sent' })] });
  },
};

// In-memory snipe/editsnipe stores
const snipeCache = new Map<string, { content: string; author: string; ts: number }>();
const editSnipeCache = new Map<string, { before: string; after: string; author: string; ts: number }>();

const snipe: CommandDefinition = {
  name: 'snipe',
  description: 'Show the last deleted message in this channel.',
  category: 'utility',
  cooldownSeconds: 2,
  buildSlash() { return new SlashCommandBuilder().setName('snipe').setDescription('Snipe a deleted message.'); },
  parseSlash() { return {}; },
  parsePrefix() { return {}; },
  async run(ctx: CommandContext) {
    if (!ctx.channel) return;
    const sniped = snipeCache.get(ctx.channel.id);
    if (!sniped) { await replyError(ctx, 'No recently deleted message here.'); return; }
    await respond(ctx, { embeds: [buildEmbed({ tone: 'info', title: 'Deleted message', description: sniped.content, fields: [{ name: 'Author', value: `<@${sniped.author}>`, inline: true }, { name: 'When', value: discordTime(sniped.ts, 'R'), inline: true }] })] });
  },
};

const editsnipe: CommandDefinition = {
  name: 'editsnipe',
  description: 'Show the last edited message.',
  category: 'utility',
  buildSlash() { return new SlashCommandBuilder().setName('editsnipe').setDescription('Snipe the last edit.'); },
  parseSlash() { return {}; },
  parsePrefix() { return {}; },
  async run(ctx: CommandContext) {
    if (!ctx.channel) return;
    const e = editSnipeCache.get(ctx.channel.id);
    if (!e) { await replyError(ctx, 'No recently edited message here.'); return; }
    await respond(ctx, { embeds: [buildEmbed({ tone: 'info', title: 'Edited message', fields: [
      { name: 'Before', value: e.before || '(empty)', inline: false },
      { name: 'After', value: e.after || '(empty)', inline: false },
      { name: 'Author', value: `<@${e.author}>`, inline: true },
    ] })] });
  },
};

export const snipeCacheRef = snipeCache;
export const editSnipeCacheRef = editSnipeCache;

[help, ping, uptime, botinfo, avatar, banner, calculator, timestamp, permissions, user, announce, embed, snipe, editsnipe].forEach(registerCommand);
export default help;