/**
 * /warnings + .warnings — View warnings for a member.
 */

import { ChatInputCommandInteraction, Message, SlashCommandBuilder } from 'discord.js';

import type { CommandContext, CommandDefinition } from '../../types/index.js';
import { registerCommand } from '../../handlers/registry.js';
import { resolveUser } from '../../utils/permissions.js';
import { listWarnings, clearWarnings } from '../../db/repositories.js';
import { replyError, respond } from '../../handlers/respond.js';
import { buildEmbed, listResult, emptyState } from '../../embeds/builders.js';
import { discordTime } from '../../utils/duration.js';

const def: CommandDefinition = {
  name: 'warnings',
  description: 'View or clear a member\'s warnings.',
  usage: '/warnings <user> [clear]',
  category: 'moderation',
  userPermissions: ['ModerateMembers'],
  cooldownSeconds: 3,

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('warnings')
      .setDescription('Show warnings for a user.')
      .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true))
      .addBooleanOption((o) => o.setName('clear').setDescription('Clear all warnings'));
  },

  async parseSlash(i: ChatInputCommandInteraction) {
    return { user: i.options.getUser('user', true), clear: i.options.getBoolean('clear') ?? false };
  },

  async parsePrefix(m: Message, raw: string[]) {
    const user = await resolveUser(m.guild!, raw[0]);
    if (!user) throw new Error(`Could not resolve user "${raw[0]}"`);
    return { user, clear: raw.includes('clear') };
  },

  async run(ctx: CommandContext) {
    if (!ctx.guild) return;
    const { user, clear } = ctx.args as any;
    if (clear) {
      clearWarnings(ctx.guild.id, user.id);
      await respond(ctx, { embeds: [buildEmbed({
        tone: 'success',
        title: '✓ Warnings cleared',
        description: `All warnings for ${user.tag} have been wiped.`,
      })] });
      return;
    }
    const list = listWarnings(ctx.guild.id, user.id);
    if (!list.length) {
      await respond(ctx, { embeds: [emptyState({
        title: `🟢 ${user.tag} — clean record`,
        message: `${user.tag} has no warnings on this server.`,
        tone: 'success',
      })] });
      return;
    }
    const items = list.slice(0, 10).map((w, idx) =>
      `**${idx + 1}.** ${w.reason ?? '_No reason given_'} · ${discordTime(w.createdAt, 'R')} · by <@${w.moderatorId}>`
    );
    await respond(ctx, { embeds: [listResult({
      title: `⚠ Warnings — ${user.tag}`,
      items,
      summary: `Total on record: **${list.length}**.`,
      perPage: 10,
      tone: 'moderation',
    })] });
  },
};

registerCommand(def);
export default def;