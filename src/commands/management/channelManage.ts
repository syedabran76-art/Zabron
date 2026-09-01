/**
 * /create-channel, /delete-channel, /clone-channel, /hide, /unhide, /nickname
 */

import { ChatInputCommandInteraction, ChannelType, Message, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import type { CommandContext, CommandDefinition } from '../../types/index.js';
import { registerCommand } from '../../handlers/registry.js';
import { respond, replyError } from '../../handlers/respond.js';
import { buildEmbed } from '../../embeds/builders.js';

const createChannel: CommandDefinition = {
  name: 'create-channel',
  description: 'Create a new channel.',
  category: 'management',
  userPermissions: ['ManageChannels'],
  botPermissions: ['ManageChannels'],

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('create-channel')
      .setDescription('Create a channel.')
      .addStringOption((o) => o.setName('name').setDescription('Name').setRequired(true))
      .addStringOption((o) => o.setName('type').setDescription('Type').setRequired(false).addChoices({ name: 'text', value: 'text' }, { name: 'voice', value: 'voice' }, { name: 'stage', value: 'stage' }, { name: 'announcement', value: 'news' }))
      .addStringOption((o) => o.setName('topic').setDescription('Topic').setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);
  },

  async parseSlash(i: ChatInputCommandInteraction) {
    return { name: i.options.getString('name', true), type: i.options.getString('type') ?? 'text', topic: i.options.getString('topic') };
  },

  async parsePrefix(_m: Message, raw: string[]) {
    return { name: raw.join(' '), type: 'text', topic: null };
  },

  async run(ctx: CommandContext) {
    if (!ctx.guild) return;
    const { name, type, topic } = ctx.args as any;
    const channelTypes: Record<string, ChannelType.GuildText | ChannelType.GuildVoice | ChannelType.GuildStageVoice | ChannelType.GuildAnnouncement> = {
      text: ChannelType.GuildText,
      voice: ChannelType.GuildVoice,
      stage: ChannelType.GuildStageVoice,
      news: ChannelType.GuildAnnouncement,
    };
    const channelType = channelTypes[type] ?? ChannelType.GuildText;
    const channel = await ctx.guild.channels.create({ name, type: channelType, topic: topic ?? undefined, reason: `by ${ctx.user.tag}` }).catch(async (err: Error) => { await replyError(ctx, err.message); return null; });
    if (!channel) return;
    await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Channel created', description: `<#${channel.id}>` })] });
  },
};

const deleteChannel: CommandDefinition = {
  name: 'delete-channel',
  description: 'Delete the current channel.',
  category: 'management',
  userPermissions: ['ManageChannels'],
  botPermissions: ['ManageChannels'],

  buildSlash() {
    return new SlashCommandBuilder().setName('delete-channel').setDescription('Delete this channel.').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);
  },

  parseSlash() { return {}; },
  parsePrefix() { return {}; },

  async run(ctx: CommandContext) {
    if (!ctx.channel || !ctx.guild) return;
    const name = (ctx.channel as any).name;
    await ctx.channel.delete(`by ${ctx.user.tag}`).catch(async (err: Error) => { await replyError(ctx, err.message); return; });
    // Best-effort reply
    const target = ctx.guild.channels.cache.find((c) => c.name === 'general');
    if (target && 'send' in target) await (target as any).send({ embeds: [buildEmbed({ tone: 'moderation', title: 'Channel deleted', description: `${name} was removed.` })] }).catch(() => {});
  },
};

const cloneChannel: CommandDefinition = {
  name: 'clone-channel',
  description: 'Clone the current channel.',
  category: 'management',
  userPermissions: ['ManageChannels'],
  botPermissions: ['ManageChannels'],

  buildSlash() {
    return new SlashCommandBuilder().setName('clone-channel').setDescription('Clone this channel.').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);
  },

  parseSlash() { return {}; },
  parsePrefix() { return {}; },

  async run(ctx: CommandContext) {
    if (!ctx.channel || !ctx.guild) return;
    const c = ctx.channel as any;
    const clone = await ctx.guild.channels.create({
      name: `${c.name}-clone`,
      type: c.type,
      topic: c.topic ?? undefined,
      parent: c.parent ?? undefined,
      reason: `by ${ctx.user.tag}`,
    }).catch(async (err: Error) => { await replyError(ctx, err.message); return null; });
    if (!clone) return;
    await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Channel cloned', description: `<#${clone.id}>` })] });
  },
};

const hide: CommandDefinition = {
  name: 'hide',
  description: 'Hide the current channel from @everyone.',
  category: 'management',
  userPermissions: ['ManageChannels'],
  botPermissions: ['ManageChannels'],

  buildSlash() { return new SlashCommandBuilder().setName('hide').setDescription('Hide this channel.').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels); },
  parseSlash() { return {}; },
  parsePrefix() { return {}; },

  async run(ctx: CommandContext) {
    if (!ctx.channel || !ctx.guild) return;
    const everyone = ctx.guild.roles.everyone;
    await (ctx.channel as any).permissionOverwrites.edit(everyone, { ViewChannel: false }).catch(async (err: Error) => { await replyError(ctx, err.message); return; });
    await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Channel hidden' })] });
  },
};

const unhide: CommandDefinition = {
  name: 'unhide',
  description: 'Unhide the current channel for @everyone.',
  category: 'management',
  userPermissions: ['ManageChannels'],
  botPermissions: ['ManageChannels'],

  buildSlash() { return new SlashCommandBuilder().setName('unhide').setDescription('Unhide this channel.').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels); },
  parseSlash() { return {}; },
  parsePrefix() { return {}; },

  async run(ctx: CommandContext) {
    if (!ctx.channel || !ctx.guild) return;
    const everyone = ctx.guild.roles.everyone;
    await (ctx.channel as any).permissionOverwrites.edit(everyone, { ViewChannel: null }).catch(async (err: Error) => { await replyError(ctx, err.message); return; });
    await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Channel visible' })] });
  },
};

const nickname: CommandDefinition = {
  name: 'nickname',
  description: 'Change your own nickname.',
  category: 'management',
  cooldownSeconds: 30,

  buildSlash() {
    return new SlashCommandBuilder().setName('nickname').setDescription('Set your own nickname.').addStringOption((o) => o.setName('value').setDescription('New nickname').setRequired(true));
  },

  async parseSlash(i: ChatInputCommandInteraction) { return { value: i.options.getString('value', true) }; },
  async parsePrefix(_m: Message, raw: string[]) { return { value: raw.join(' ') }; },

  async run(ctx: CommandContext) {
    if (!ctx.guild || !ctx.member) return;
    const { value } = ctx.args as any;
    await ctx.member.setNickname(value || null).catch(async (err: Error) => { await replyError(ctx, err.message); return; });
    await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Nickname updated' })] });
  },
};

registerCommand(createChannel);
registerCommand(deleteChannel);
registerCommand(cloneChannel);
registerCommand(hide);
registerCommand(unhide);
registerCommand(nickname);
export default createChannel;