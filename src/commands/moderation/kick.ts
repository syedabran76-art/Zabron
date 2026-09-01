/**
 * /kick + .kick — Kicks a member.
 */

import { ChatInputCommandInteraction, Message, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import type { CommandContext, CommandDefinition } from '../../types/index.js';
import { registerCommand } from '../../handlers/registry.js';
import { resolveUser } from '../../utils/permissions.js';
import { runModeration } from '../../services/moderation.js';

const def: CommandDefinition = {
  name: 'kick',
  description: 'Kick a member from the server.',
  usage: '/kick <user> [reason]',
  category: 'moderation',
  userPermissions: ['KickMembers'],
  botPermissions: ['KickMembers'],
  cooldownSeconds: 5,

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('kick')
      .setDescription('Kick a member.')
      .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers);
  },

  async parseSlash(i: ChatInputCommandInteraction) {
    return { user: i.options.getUser('user', true), reason: i.options.getString('reason') };
  },

  async parsePrefix(m: Message, raw: string[]) {
    const user = await resolveUser(m.guild!, raw[0]);
    if (!user) throw new Error(`Could not resolve user "${raw[0]}"`);
    return { user, reason: raw.slice(1).join(' ') || null };
  },

  async run(ctx: CommandContext) {
    if (!ctx.guild || !ctx.member) return;
    const { user, reason } = ctx.args as any;
    if (!user) throw new Error('User required');
    await runModeration(
      ctx,
      {
        guild: ctx.guild,
        executor: ctx.member,
        user,
        reason,
        durationMs: null,
        action: 'kick',
        successTitle: 'Member kicked',
      },
      async () => {
        const member = await ctx.guild!.members.fetch(user.id);
        await member.kick(reason ?? undefined);
      },
    );
  },
};

registerCommand(def);
export default def;