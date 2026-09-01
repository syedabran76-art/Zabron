/**
 * /untimeout + .untimeout — Removes a timeout.
 */

import { ChatInputCommandInteraction, Message, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import type { CommandContext, CommandDefinition } from '../../types/index.js';
import { registerCommand } from '../../handlers/registry.js';
import { resolveUser } from '../../utils/permissions.js';
import { runModeration } from '../../services/moderation.js';

const def: CommandDefinition = {
  name: 'untimeout',
  description: 'Remove a member\'s timeout.',
  usage: '/untimeout <user> [reason]',
  category: 'moderation',
  userPermissions: ['ModerateMembers'],
  botPermissions: ['ModerateMembers'],
  cooldownSeconds: 3,

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('untimeout')
      .setDescription('Remove a member\'s timeout.')
      .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);
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
        action: 'untimeout',
        successTitle: 'Timeout removed',
      },
      async () => {
        const member = await ctx.guild!.members.fetch(user.id);
        await member.timeout(null, reason ?? undefined);
      },
    );
  },
};

registerCommand(def);
export default def;