/**
 * /warn + .warn — Issue a formal warning.
 */

import { ChatInputCommandInteraction, EmbedBuilder, Message, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import type { CommandContext, CommandDefinition } from '../../types/index.js';
import { registerCommand } from '../../handlers/registry.js';
import { resolveUser } from '../../utils/permissions.js';
import { addWarning, warningCount } from '../../db/repositories.js';
import { runModeration } from '../../services/moderation.js';
import { replyError, replyInfo, respond } from '../../handlers/respond.js';
import { buildEmbed } from '../../embeds/builders.js';

const def: CommandDefinition = {
  name: 'warn',
  description: 'Warn a member.',
  usage: '/warn <user> [reason]',
  category: 'moderation',
  userPermissions: ['ModerateMembers'],
  botPermissions: [],
  cooldownSeconds: 3,

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('warn')
      .setDescription('Warn a member.')
      .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(false));
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
    addWarning(ctx.guild.id, user.id, ctx.user.id, reason ?? null);
    const total = warningCount(ctx.guild.id, user.id);
    const embed = buildEmbed({
      tone: 'moderation',
      title: 'Member warned',
      description: `${user.tag} now has ${total} warning${total === 1 ? '' : 's'}.`,
      fields: [{ name: 'Reason', value: reason ?? 'No reason provided', inline: false }],
    });
    await respond(ctx, { embeds: [embed] });
    await runModeration(
      ctx,
      {
        guild: ctx.guild,
        executor: ctx.member,
        user,
        reason,
        durationMs: null,
        action: 'warn',
        successTitle: 'Member warned',
      },
      async () => {},
    );
  },
};

registerCommand(def);
export default def;