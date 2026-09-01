/**
 * /role + .role — Add or remove a role from a member.
 */

import { ChatInputCommandInteraction, Message, PermissionFlagsBits, Role, SlashCommandBuilder } from 'discord.js';

import type { CommandContext, CommandDefinition } from '../../types/index.js';
import { registerCommand } from '../../handlers/registry.js';
import { respond, replyError } from '../../handlers/respond.js';
import { resolveUser } from '../../utils/permissions.js';
import { canActOn } from '../../utils/permissions.js';
import { buildEmbed } from '../../embeds/builders.js';

const def: CommandDefinition = {
  name: 'role',
  description: 'Add or remove a role on a member.',
  usage: '/role <user> <role> [add|remove]',
  category: 'moderation',
  userPermissions: ['ManageRoles'],
  botPermissions: ['ManageRoles'],
  cooldownSeconds: 3,

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('role')
      .setDescription('Toggle a role on a member.')
      .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
      .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true))
      .addStringOption((o) => o.setName('mode').setDescription('add or remove').setRequired(false).addChoices({ name: 'add', value: 'add' }, { name: 'remove', value: 'remove' }))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles);
  },

  async parseSlash(i: ChatInputCommandInteraction) {
    return {
      user: i.options.getUser('user', true),
      role: i.options.getRole('role', true),
      mode: (i.options.getString('mode') ?? 'toggle') as 'add' | 'remove' | 'toggle',
    };
  },

  async parsePrefix(m: Message, raw: string[]) {
    const user = await resolveUser(m.guild!, raw[0]);
    if (!user) throw new Error(`Could not resolve user "${raw[0]}"`);
    const roleId = raw[1]?.replace(/[<@&>]/g, '');
    const role = await m.guild!.roles.fetch(roleId!).catch(() => null);
    if (!role) throw new Error('Role not found.');
    const mode = (raw[2] as any) ?? 'toggle';
    return { user, role, mode };
  },

  async run(ctx: CommandContext) {
    if (!ctx.guild || !ctx.member) return;
    const { user, role, mode } = ctx.args as { user: any; role: Role; mode: 'add' | 'remove' | 'toggle' };
    const target = await ctx.guild.members.fetch(user.id).catch(() => null);
    if (!target) { await replyError(ctx, 'User is not a member of this server.'); return; }
    const bot = await ctx.guild.members.fetchMe();
    const hierarchy = canActOn({ guild: ctx.guild, executor: ctx.member, bot, target });
    if (!hierarchy.ok) { await replyError(ctx, hierarchy.reason!); return; }
    if (role.position >= bot.roles.highest.position) {
      await replyError(ctx, 'Zabron cannot manage a role equal to or higher than its highest role.');
      return;
    }

    const hasRole = target.roles.cache.has(role.id);
    let final: 'add' | 'remove';
    if (mode === 'add') final = 'add';
    else if (mode === 'remove') final = 'remove';
    else final = hasRole ? 'remove' : 'add';

    if (final === 'add') await target.roles.add(role, `by ${ctx.user.tag}`);
    else await target.roles.remove(role, `by ${ctx.user.tag}`);

    await respond(ctx, {
      embeds: [buildEmbed({
        tone: 'success',
        title: final === 'add' ? 'Role added' : 'Role removed',
        description: `${user.tag} — ${role.name} ${final === 'add' ? 'added' : 'removed'}`,
      })],
    });
  },
};

registerCommand(def);
export default def;