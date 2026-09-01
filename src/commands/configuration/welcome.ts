/**
 * /welcome + /goodbye — Configure welcome/goodbye and autorole.
 */

import { ChatInputCommandInteraction, ChannelType, Message, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import type { CommandContext, CommandDefinition } from '../../types/index.js';
import { registerCommand } from '../../handlers/registry.js';
import { respond } from '../../handlers/respond.js';
import { getDatabase } from '../../db/database.js';
import { buildEmbed } from '../../embeds/builders.js';

interface WelcomeRow {
  welcome_channel: string | null;
  welcome_message: string | null;
  welcome_dm: string | null;
  welcome_role: string | null;
  goodbye_channel: string | null;
  goodbye_message: string | null;
  autorole: string | null;
}

function getWelcomeConfig(guildId: string): WelcomeRow {
  const row = getDatabase().prepare('SELECT welcome_channel, welcome_message, welcome_dm, welcome_role, goodbye_channel, goodbye_message, autorole FROM guild_settings WHERE guild_id = ?').get(guildId) as WelcomeRow | undefined;
  return row ?? { welcome_channel: null, welcome_message: null, welcome_dm: null, welcome_role: null, goodbye_channel: null, goodbye_message: null, autorole: null };
}

function setWelcomeConfig(guildId: string, patch: Partial<WelcomeRow>): void {
  const current = getWelcomeConfig(guildId);
  const merged = { ...current, ...patch };
  getDatabase()
    .prepare(
      `UPDATE guild_settings SET welcome_channel = ?, welcome_message = ?, welcome_dm = ?, welcome_role = ?, goodbye_channel = ?, goodbye_message = ?, autorole = ? WHERE guild_id = ?`,
    )
    .run(merged.welcome_channel, merged.welcome_message, merged.welcome_dm, merged.welcome_role, merged.goodbye_channel, merged.goodbye_message, merged.autorole, guildId);
}

const welcome: CommandDefinition = {
  name: 'welcome',
  description: 'Configure welcome messages and autorole.',
  category: 'configuration',
  userPermissions: ['ManageGuild'],
  cooldownSeconds: 5,

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('welcome')
      .setDescription('Manage welcome messages.')
      .addSubcommand((s) => s.setName('status').setDescription('Show current config'))
      .addSubcommand((s) => s.setName('enable').setDescription('Enable welcome messages').addChannelOption((o) => o.setName('channel').setDescription('Welcome channel').setRequired(true)))
      .addSubcommand((s) => s.setName('disable').setDescription('Disable welcome messages'))
      .addSubcommand((s) => s.setName('message').setDescription('Set welcome message').addStringOption((o) => o.setName('text').setDescription('Welcome message body').setRequired(true)))
      .addSubcommand((s) => s.setName('dm').setDescription('DM message').addStringOption((o) => o.setName('text').setDescription('DM message body').setRequired(false)))
      .addSubcommand((s) => s.setName('autorole').setDescription('Set autorole').addRoleOption((o) => o.setName('role').setDescription('Role to grant on join').setRequired(true)))
      .addSubcommand((s) => s.setName('test').setDescription('Test welcome'))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
  },

  async parseSlash(i: ChatInputCommandInteraction) {
    const sub = i.options.getSubcommand();
    return {
      sub,
      channel: i.options.getChannel('channel'),
      text: i.options.getString('text'),
      role: i.options.getRole('role'),
    };
  },

  async parsePrefix(_m: Message, raw: string[]) {
    return { sub: raw[0] ?? 'status', channel: null, text: null, role: null };
  },

  async run(ctx: CommandContext) {
    if (!ctx.guild) return;
    const args = ctx.args as any;
    const config = getWelcomeConfig(ctx.guild.id);
    if (args.sub === 'status') {
      await respond(ctx, { embeds: [buildEmbed({ tone: 'configuration', title: 'Welcome config', fields: [
        { name: 'Channel', value: config.welcome_channel ? `<#${config.welcome_channel}>` : '—', inline: true },
        { name: 'Message', value: config.welcome_message ?? '—', inline: false },
        { name: 'DM', value: config.welcome_dm ?? '—', inline: false },
        { name: 'Autorole', value: config.welcome_role ? `<@&${config.welcome_role}>` : '—', inline: true },
      ] })] });
      return;
    }
    if (args.sub === 'enable') {
      if (!args.channel) return;
      setWelcomeConfig(ctx.guild.id, { welcome_channel: args.channel.id });
      await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Welcome enabled', description: `Channel: <#${args.channel.id}>` })] });
      return;
    }
    if (args.sub === 'disable') {
      setWelcomeConfig(ctx.guild.id, { welcome_channel: null });
      await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Welcome disabled' })] });
      return;
    }
    if (args.sub === 'message') {
      setWelcomeConfig(ctx.guild.id, { welcome_message: args.text });
      await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Welcome message updated' })] });
      return;
    }
    if (args.sub === 'dm') {
      setWelcomeConfig(ctx.guild.id, { welcome_dm: args.text });
      await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'DM message updated' })] });
      return;
    }
    if (args.sub === 'autorole') {
      if (!args.role) return;
      setWelcomeConfig(ctx.guild.id, { welcome_role: args.role.id });
      await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Autorole set', description: `<@&${args.role.id}>` })] });
      return;
    }
    if (args.sub === 'test') {
      await respond(ctx, { embeds: [buildEmbed({ tone: 'welcome', title: 'Welcome test', description: config.welcome_message ?? 'Welcome {mention} to {server}!' })] });
    }
  },
};

const goodbye: CommandDefinition = {
  name: 'goodbye',
  description: 'Configure goodbye messages.',
  category: 'configuration',
  userPermissions: ['ManageGuild'],

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('goodbye')
      .setDescription('Manage goodbye messages.')
      .addSubcommand((s) => s.setName('enable').setDescription('Enable').addChannelOption((o) => o.setName('channel').setDescription('Goodbye channel').setRequired(true)))
      .addSubcommand((s) => s.setName('disable').setDescription('Disable'))
      .addSubcommand((s) => s.setName('message').setDescription('Set message').addStringOption((o) => o.setName('text').setDescription('Goodbye message body').setRequired(true)))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
  },

  async parseSlash(i: ChatInputCommandInteraction) {
    return { sub: i.options.getSubcommand(), channel: i.options.getChannel('channel'), text: i.options.getString('text') };
  },

  async parsePrefix(_m: Message, raw: string[]) { return { sub: raw[0] ?? 'disable', channel: null, text: null }; },

  async run(ctx: CommandContext) {
    if (!ctx.guild) return;
    const args = ctx.args as any;
    const config = getWelcomeConfig(ctx.guild.id);
    if (args.sub === 'enable') {
      if (!args.channel) return;
      setWelcomeConfig(ctx.guild.id, { goodbye_channel: args.channel.id });
      await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Goodbye enabled' })] });
      return;
    }
    if (args.sub === 'disable') {
      setWelcomeConfig(ctx.guild.id, { goodbye_channel: null });
      await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Goodbye disabled' })] });
      return;
    }
    if (args.sub === 'message') {
      setWelcomeConfig(ctx.guild.id, { goodbye_message: args.text });
      await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Goodbye message updated' })] });
      return;
    }
    await respond(ctx, { embeds: [buildEmbed({ tone: 'configuration', title: 'Goodbye config', description: `Channel: ${config.goodbye_channel ? `<#${config.goodbye_channel}>` : '—'}\nMessage: ${config.goodbye_message ?? '—'}` })] });
  },
};

const autorole: CommandDefinition = {
  name: 'autorole',
  description: 'Set the autorole given to every new member.',
  category: 'configuration',
  userPermissions: ['ManageRoles'],
  botPermissions: ['ManageRoles'],

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('autorole')
      .setDescription('Configure autorole.')
      .addSubcommand((s) => s.setName('set').setDescription('Set autorole').addRoleOption((o) => o.setName('role').setDescription('Autorole to grant').setRequired(true)))
      .addSubcommand((s) => s.setName('clear').setDescription('Remove autorole'))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles);
  },

  async parseSlash(i: ChatInputCommandInteraction) {
    return { sub: i.options.getSubcommand(), role: i.options.getRole('role') };
  },

  async parsePrefix(_m: Message, raw: string[]) { return { sub: raw[0] ?? 'clear', role: null }; },

  async run(ctx: CommandContext) {
    if (!ctx.guild) return;
    const args = ctx.args as any;
    if (args.sub === 'set') {
      if (!args.role) return;
      setWelcomeConfig(ctx.guild.id, { autorole: args.role.id });
      await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Autorole set', description: `<@&${args.role.id}>` })] });
    } else {
      setWelcomeConfig(ctx.guild.id, { autorole: null });
      await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Autorole cleared' })] });
    }
  },
};

registerCommand(welcome);
registerCommand(goodbye);
registerCommand(autorole);
export default welcome;