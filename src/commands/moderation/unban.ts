/**
 * /unban + .unban — Unbans a user.
 */

import { ChatInputCommandInteraction, Message, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import type { CommandContext, CommandDefinition } from '../../types/index.js';
import { registerCommand } from '../../handlers/registry.js';
import { resolveUser } from '../../utils/permissions.js';
import { runModeration } from '../../services/moderation.js';

const def: CommandDefinition = {
  name: 'unban',
  description: 'Unban a previously banned user.',
  usage: '/unban <user> [reason]',
  category: 'moderation',
  userPermissions: ['BanMembers'],
  botPermissions: ['BanMembers'],
  cooldownSeconds: 5,

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('unban')
      .setDescription('Unban a user by ID or tag.')
      .addStringOption((o) => o.setName('user').setDescription('User ID or tag').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers);
  },

  async parseSlash(i: ChatInputCommandInteraction) {
    const userInput = i.options.getString('user', true);
    const userId = userInput.replace(/[<@!>]/g, '');
    if (!/^\d{17,20}$/.test(userId)) throw new Error('Provide a valid user ID.');
    return { userId, reason: i.options.getString('reason') };
  },

  async parsePrefix(_m: Message, raw: string[]) {
    return { userId: raw[0]?.replace(/[<@!>]/g, ''), reason: raw.slice(1).join(' ') || null };
  },

  async run(ctx: CommandContext) {
    if (!ctx.guild || !ctx.member) return;
    const { userId, reason } = ctx.args as { userId: string; reason: string | null };
    if (!userId) throw new Error('User ID required');

    const user = await ctx.guild.client.users.fetch(userId).catch(() => null);
    if (!user) throw new Error('Could not fetch that user.');

    await runModeration(
      ctx,
      {
        guild: ctx.guild,
        executor: ctx.member,
        user,
        reason,
        durationMs: null,
        action: 'unban',
        successTitle: 'Member unbanned',
      },
      async () => {
        await ctx.guild!.members.unban(user.id, reason ?? undefined);
      },
    );
  },
};

registerCommand(def);
export default def;