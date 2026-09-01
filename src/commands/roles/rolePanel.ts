/**
 * /rolepanel — Create a button/select role panel.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ChatInputCommandInteraction,
  Message,
  PermissionFlagsBits,
  Role,
  SelectMenuBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';

import type { CommandContext, CommandDefinition } from '../../types/index.js';
import { registerCommand } from '../../handlers/registry.js';
import { respond, replyError } from '../../handlers/respond.js';
import { buildEmbed } from '../../embeds/builders.js';
import { getDatabase } from '../../db/database.js';

const def: CommandDefinition = {
  name: 'rolepanel',
  description: 'Create a role panel.',
  category: 'roles',
  userPermissions: ['ManageRoles'],
  botPermissions: ['ManageRoles'],
  cooldownSeconds: 5,

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('rolepanel')
      .setDescription('Build a role panel.')
      .addStringOption((o) => o.setName('title').setDescription('Panel title').setRequired(true))
      .addChannelOption((o) => o.setName('channel').setDescription('Channel to post the panel in').setRequired(true))
      .addStringOption((o) => o.setName('description').setDescription('Panel description').setRequired(false))
      .addStringOption((o) => o.setName('mode').setDescription('Role toggle mode').setRequired(false).addChoices({ name: 'toggle', value: 'toggle' }, { name: 'add-only', value: 'add' }, { name: 'remove-only', value: 'remove' }))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles);
  },

  async parseSlash(i: ChatInputCommandInteraction) {
    return {
      title: i.options.getString('title', true),
      description: i.options.getString('description'),
      channel: i.options.getChannel('channel', true),
      mode: (i.options.getString('mode') ?? 'toggle') as 'toggle' | 'add' | 'remove',
    };
  },

  async parsePrefix(_m: Message, raw: string[]) { return { title: raw.slice(0, 1).join(' '), description: null, channel: null, mode: 'toggle' }; },

  async run(ctx: CommandContext) {
    if (!ctx.guild || !ctx.member) return;
    const args = ctx.args as any;
    if (!args.channel || !args.title) { await replyError(ctx, 'Provide title and channel.'); return; }
    const rows = (getDatabase().prepare('SELECT id, name FROM roles WHERE guild_id = ? ORDER BY position DESC LIMIT 25').all(ctx.guild.id) as any[]);
    const roles = rows.map((r) => ({ id: r.id, name: r.name }));
    if (!roles.length) { await replyError(ctx, 'This server has no roles to assign.'); return; }

    const select = new StringSelectMenuBuilder().setCustomId('rolepanel:select').setPlaceholder('Pick your roles').setMinValues(0).setMaxValues(roles.length).addOptions(roles.map((r) => new StringSelectMenuOptionBuilder().setLabel(r.name).setValue(r.id)));
    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
    const embed = buildEmbed({ tone: 'info', title: args.title, description: args.description ?? 'Select your roles below.' });
    const message = await (args.channel as any).send({ embeds: [embed], components: [row as any] });
    getDatabase().prepare('INSERT INTO role_panels (guild_id, message_id, channel_id, kind, title, description, roles, mode, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(ctx.guild.id, message.id, args.channel.id, 'select', args.title, args.description, JSON.stringify(roles), args.mode, Date.now());
    await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Role panel posted' })] });
  },
};

registerCommand(def);
export default def;