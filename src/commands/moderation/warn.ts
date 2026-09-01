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
import { moderationAction } from '../../embeds/builders.js';

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
    // Generate a stable case-id locally so the moderation-action embed can
    // show it without depending on the runModeration flow (warn is purely
    // a record-keeping action, not a Discord API call).
    const id = `WARN-${Date.now().toString(36).toUpperCase()}`;
    await respond(ctx, {
      embeds: [
        moderationAction({
          action: 'Member warned',
          target: { id: user.id, tag: user.tag },
          moderator: { id: ctx.user.id, tag: ctx.user.tag },
          reason,
          caseId: id,
          extraFields: [
            { name: 'Total warnings', value: `\`${total}\``, inline: true },
          ],
        }),
      ],
    });
    // Mirror the event into the moderation case log. We pass `silent: true`
    // because the moderationAction embed above is the single source of
    // truth for the user reply — runModeration should only record the
    // case + send the log channel entry.
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
        silent: true,
      },
      async () => {},
    );
  },
};

registerCommand(def);
export default def;