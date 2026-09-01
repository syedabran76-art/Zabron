/**
 * /create-role, /delete-role, /edit-role, /addrole, /removerole, /massrole
 */

import { ChatInputCommandInteraction, Message, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import type { CommandContext, CommandDefinition } from '../../types/index.js';
import { registerCommand } from '../../handlers/registry.js';
import { respond, replyError } from '../../handlers/respond.js';
import { resolveUser } from '../../utils/permissions.js';
import { buildEmbed } from '../../embeds/builders.js';

async function parseRole(m: Message, raw: string[]) {
  const id = raw[0]?.replace(/[<@&>]/g, '');
  const role = await m.guild!.roles.fetch(id!).catch(() => null);
  if (!role) throw new Error('Role not found.');
  return { role };
}

const createRole: CommandDefinition = {
  name: 'create-role',
  description: 'Create a new role.',
  category: 'management',
  userPermissions: ['ManageRoles'],
  botPermissions: ['ManageRoles'],

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('create-role')
      .setDescription('Create a role.')
      .addStringOption((o) => o.setName('name').setDescription('Name').setRequired(true))
      .addStringOption((o) => o.setName('color').setDescription('Hex color (e.g. #ffaa00)').setRequired(false))
      .addBooleanOption((o) => o.setName('hoist').setDescription('Display separately').setRequired(false))
      .addBooleanOption((o) => o.setName('mentionable').setDescription('Mentionable').setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles);
  },

  async parseSlash(i: ChatInputCommandInteraction) {
    return {
      name: i.options.getString('name', true),
      color: i.options.getString('color'),
      hoist: i.options.getBoolean('hoist') ?? false,
      mentionable: i.options.getBoolean('mentionable') ?? false,
    };
  },

  async parsePrefix(_m: Message, raw: string[]) {
    return { name: raw.join(' '), color: null, hoist: false, mentionable: false };
  },

  async run(ctx: CommandContext) {
    if (!ctx.guild || !ctx.member) return;
    const { name, color, hoist, mentionable } = ctx.args as any;
    const role = await ctx.guild.roles.create({
      name,
      color: (color as any) ?? null,
      hoist,
      mentionable,
      reason: `by ${ctx.user.tag}`,
    }).catch(async (err: Error) => { await replyError(ctx, err.message); return null; });
    if (!role) return;
    await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Role created', description: `<@&${role.id}> (${role.id})` })] });
  },
};

const deleteRole: CommandDefinition = {
  name: 'delete-role',
  description: 'Delete a role.',
  category: 'management',
  userPermissions: ['ManageRoles'],
  botPermissions: ['ManageRoles'],

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('delete-role')
      .setDescription('Delete a role.')
      .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles);
  },

  async parseSlash(i: ChatInputCommandInteraction) { return { role: i.options.getRole('role', true) }; },
  async parsePrefix(m: Message, raw: string[]) { return parseRole(m, raw); },

  async run(ctx: CommandContext) {
    if (!ctx.guild) return;
    const { role } = ctx.args as any;
    await role.delete(`by ${ctx.user.tag}`).catch(async (err: Error) => { await replyError(ctx, err.message); return; });
    await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Role deleted', description: `Role was removed.` })] });
  },
};

const editRole: CommandDefinition = {
  name: 'edit-role',
  description: 'Edit a role.',
  category: 'management',
  userPermissions: ['ManageRoles'],
  botPermissions: ['ManageRoles'],

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('edit-role')
      .setDescription('Edit a role.')
      .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true))
      .addStringOption((o) => o.setName('name').setDescription('New name').setRequired(false))
      .addStringOption((o) => o.setName('color').setDescription('New hex color').setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles);
  },

  async parseSlash(i: ChatInputCommandInteraction) {
    return {
      role: i.options.getRole('role', true),
      name: i.options.getString('name'),
      color: i.options.getString('color'),
    };
  },

  async parsePrefix(m: Message, raw: string[]) {
    const r = await parseRole(m, raw);
    return { ...r, name: null, color: null };
  },

  async run(ctx: CommandContext) {
    if (!ctx.guild) return;
    const { role, name, color } = ctx.args as any;
    await role.edit({ name: name ?? undefined, color: (color as any) ?? undefined }).catch(async (err: Error) => { await replyError(ctx, err.message); return; });
    await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Role updated' })] });
  },
};

const addRole: CommandDefinition = {
  name: 'addrole',
  description: 'Add a role to a user.',
  category: 'management',
  userPermissions: ['ManageRoles'],
  botPermissions: ['ManageRoles'],

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('addrole')
      .setDescription('Add a role to a user.')
      .addUserOption((o) => o.setName('user').setDescription('Member receiving the role').setRequired(true))
      .addRoleOption((o) => o.setName('role').setDescription('Role to grant').setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles);
  },

  async parseSlash(i: ChatInputCommandInteraction) {
    return { user: i.options.getUser('user', true), role: i.options.getRole('role', true) };
  },

  async parsePrefix(m: Message, raw: string[]) {
    const user = await resolveUser(m.guild!, raw[0]);
    if (!user) throw new Error(`Could not resolve "${raw[0]}"`);
    const r = await parseRole(m, [raw[1]]);
    return { user, ...r };
  },

  async run(ctx: CommandContext) {
    if (!ctx.guild || !ctx.member) return;
    const { user, role } = ctx.args as any;
    const member = await ctx.guild.members.fetch(user.id).catch(() => null);
    if (!member) { await replyError(ctx, 'User not found.'); return; }
    await member.roles.add(role, `by ${ctx.user.tag}`).catch(async (err: Error) => { await replyError(ctx, err.message); return; });
    await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Role added', description: `<@&${role.id}> → <@${user.id}>` })] });
  },
};

const removeRole: CommandDefinition = {
  name: 'removerole',
  description: 'Remove a role from a user.',
  category: 'management',
  userPermissions: ['ManageRoles'],
  botPermissions: ['ManageRoles'],

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('removerole')
      .setDescription('Remove a role from a user.')
      .addUserOption((o) => o.setName('user').setDescription('Member losing the role').setRequired(true))
      .addRoleOption((o) => o.setName('role').setDescription('Role to revoke').setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles);
  },

  async parseSlash(i: ChatInputCommandInteraction) {
    return { user: i.options.getUser('user', true), role: i.options.getRole('role', true) };
  },

  async parsePrefix(m: Message, raw: string[]) {
    const user = await resolveUser(m.guild!, raw[0]);
    if (!user) throw new Error(`Could not resolve "${raw[0]}"`);
    const r = await parseRole(m, [raw[1]]);
    return { user, ...r };
  },

  async run(ctx: CommandContext) {
    if (!ctx.guild || !ctx.member) return;
    const { user, role } = ctx.args as any;
    const member = await ctx.guild.members.fetch(user.id).catch(() => null);
    if (!member) { await replyError(ctx, 'User not found.'); return; }
    await member.roles.remove(role, `by ${ctx.user.tag}`).catch(async (err: Error) => { await replyError(ctx, err.message); return; });
    await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Role removed', description: `<@&${role.id}> ← <@${user.id}>` })] });
  },
};

const massrole: CommandDefinition = {
  name: 'massrole',
  description: 'Add a role to every member.',
  category: 'management',
  userPermissions: ['Administrator'],
  botPermissions: ['ManageRoles'],
  cooldownSeconds: 30,

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('massrole')
      .setDescription('Apply a role to every member.')
      .addRoleOption((o) => o.setName('role').setDescription('Role to apply to everyone').setRequired(true))
      .addBooleanOption((o) => o.setName('remove').setDescription('Remove instead of add').setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
  },

  async parseSlash(i: ChatInputCommandInteraction) {
    return { role: i.options.getRole('role', true), remove: i.options.getBoolean('remove') ?? false };
  },

  async parsePrefix(m: Message, raw: string[]) {
    const r = await parseRole(m, [raw[0]]);
    return { ...r, remove: raw.includes('remove') };
  },

  async run(ctx: CommandContext) {
    if (!ctx.guild) return;
    const { role, remove } = ctx.args as any;
    await ctx.guild.members.fetch();
    let count = 0;
    for (const member of ctx.guild.members.cache.values()) {
      try {
        if (remove) await member.roles.remove(role);
        else await member.roles.add(role);
        count++;
      } catch {
        /* ignore */
      }
    }
    await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Massrole complete', description: `${count} members updated.` })] });
  },
};

registerCommand(createRole);
registerCommand(deleteRole);
registerCommand(editRole);
registerCommand(addRole);
registerCommand(removeRole);
registerCommand(massrole);
export default createRole;