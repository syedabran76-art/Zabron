/**
 * /softban + .softban — Ban then immediately unban to purge messages.
 */

import { ChatInputCommandInteraction, Message, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import type { CommandContext, CommandDefinition } from '../../types/index.js';
import { registerCommand } from '../../handlers/registry.js';
import { resolveUser } from '../../utils/permissions.js';
import { runModeration } from '../../services/moderation.js';

const def: CommandDefinition = {
  name: 'softban',
  description: 'Ban and immediately unban a user to clear their messages.',
  usage: '/softban <user> [reason]',
  category: 'moderation',
  userPermissions: ['BanMembers'],
  botPermissions: ['BanMembers'],
  cooldownSeconds: 5,

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('softban')
      .setDescription('Softban a user.')
      .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers);
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
    await runModeration(
      ctx,
      {
        guild: ctx.guild,
        executor: ctx.member,
        user,
        reason,
        durationMs: null,
        action: 'softban',
        successTitle: 'Member softbanned',
      },
      async () => {
        await ctx.guild!.members.ban(user.id, { reason: reason ?? undefined, deleteMessageSeconds: 7 * 24 * 60 * 60 });
        await ctx.guild!.members.unban(user.id, 'softban: immediate unban');
      },
    );
  },
};

registerCommand(def);
export default def;