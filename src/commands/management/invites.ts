/**
 * /invites — Show invite stats and leaderboard.
 */

import { ChatInputCommandInteraction, Message, SlashCommandBuilder } from 'discord.js';

import type { CommandContext, CommandDefinition } from '../../types/index.js';
import { registerCommand } from '../../handlers/registry.js';
import { respond } from '../../handlers/respond.js';
import { buildEmbed } from '../../embeds/builders.js';
import { resolveUser } from '../../utils/permissions.js';
import { getInviteCounts, getInviteLeaderboard } from '../../db/repositories.js';

const def: CommandDefinition = {
  name: 'invites',
  description: 'View invite stats.',
  category: 'management',
  cooldownSeconds: 3,
  buildSlash() {
    return new SlashCommandBuilder().setName('invites').setDescription('View invite stats.').addUserOption((o) => o.setName('user').setDescription('User to inspect (defaults to you)').setRequired(false));
  },
  async parseSlash(i: ChatInputCommandInteraction) { return { user: i.options.getUser('user') }; },
  async parsePrefix(m: Message, raw: string[]) {
    const user = raw[0] ? await resolveUser(m.guild!, raw[0]) : null;
    return { user };
  },
  async run(ctx: CommandContext) {
    if (!ctx.guild) return;
    const args = ctx.args as any;
    if (args.user) {
      const c = getInviteCounts(ctx.guild.id, args.user.id);
      await respond(ctx, { embeds: [buildEmbed({ tone: 'info', title: `Invites for ${args.user.tag}`, fields: [
        { name: 'Invites', value: String(c.invites), inline: true },
        { name: 'Leaves', value: String(c.leaves), inline: true },
        { name: 'Fakes', value: String(c.fakes), inline: true },
        { name: 'Net', value: String(c.invites - c.leaves - c.fakes), inline: true },
      ] })] });
      return;
    }
    const list = getInviteLeaderboard(ctx.guild.id, 10);
    await respond(ctx, { embeds: [buildEmbed({ tone: 'info', title: 'Invite leaderboard', description: list.length ? list.map((u, idx) => `${idx + 1}. <@${u.userId}> — ${u.invites - u.leaves - u.fakes} net`).join('\n') : 'No data yet.' }) ] });
  },
};

registerCommand(def);
export default def;