/**
 * /timeout + .timeout — Times out a member.
 */

import { ChatInputCommandInteraction, Message, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import type { CommandContext, CommandDefinition } from '../../types/index.js';
import { registerCommand } from '../../handlers/registry.js';
import { resolveUser } from '../../utils/permissions.js';
import { runModeration } from '../../services/moderation.js';
import { parseDuration } from '../../utils/duration.js';

const def: CommandDefinition = {
  name: 'timeout',
  description: 'Time-out a member for a given duration.',
  usage: '/timeout <user> <duration> [reason]',
  category: 'moderation',
  userPermissions: ['ModerateMembers'],
  botPermissions: ['ModerateMembers'],
  cooldownSeconds: 3,

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('timeout')
      .setDescription('Timeout a member.')
      .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
      .addStringOption((o) => o.setName('duration').setDescription('Duration (e.g. 1h, 30m)').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);
  },

  async parseSlash(i: ChatInputCommandInteraction) {
    return {
      user: i.options.getUser('user', true),
      duration: i.options.getString('duration', true),
      reason: i.options.getString('reason'),
    };
  },

  async parsePrefix(m: Message, raw: string[]) {
    const user = await resolveUser(m.guild!, raw[0]);
    if (!user) throw new Error(`Could not resolve user "${raw[0]}"`);
    return { user, duration: raw[1], reason: raw.slice(2).join(' ') || null };
  },

  async run(ctx: CommandContext) {
    if (!ctx.guild || !ctx.member) return;
    const { user, duration, reason } = ctx.args as any;
    const parsed = parseDuration(duration);
    if (!parsed) throw new Error('Invalid duration. Try `30m`, `2h`, `1d`.');
    await runModeration(
      ctx,
      {
        guild: ctx.guild,
        executor: ctx.member,
        user,
        reason,
        durationMs: parsed.ms,
        durationLabel: parsed.formatted,
        action: 'timeout',
        successTitle: 'Member timed out',
      },
      async () => {
        const member = await ctx.guild!.members.fetch(user.id);
        await member.timeout(parsed.ms, reason ?? undefined);
      },
    );
  },
};

registerCommand(def);
export default def;