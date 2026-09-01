/**
 * /ban + .ban — Bans a member from the guild.
 */

import {
  ChatInputCommandInteraction,
  GuildMember,
  Message,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';

import type { CommandContext, CommandDefinition } from '../../types/index.js';
import { registerCommand } from '../../handlers/registry.js';
import { respond, replyError } from '../../handlers/respond.js';
import { canActOn, hasBotPermissions, hasUserPermissions, resolveUser } from '../../utils/permissions.js';
import { parseDuration } from '../../utils/duration.js';
import { caseId } from '../../utils/ids.js';
import { insertModerationCase, insertTempBan, deleteTempBan } from '../../db/repositories.js';
import { buildActorInfo, logEvent } from '../../services/logging.js';
import { success } from '../../embeds/builders.js';

const def: CommandDefinition = {
  name: 'ban',
  description: 'Ban a member from the server.',
  usage: '/ban <user> [duration] [reason]    |    .ban <user> [duration] [reason]',
  category: 'moderation',
  botPermissions: ['BanMembers'],
  userPermissions: ['BanMembers'],
  cooldownSeconds: 5,

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('ban')
      .setDescription('Ban a member from the server.')
      .addUserOption((o) => o.setName('user').setDescription('Member to ban').setRequired(true))
      .addStringOption((o) => o.setName('duration').setDescription('Optional temp-ban duration (e.g. 7d)').setRequired(false))
      .addStringOption((o) => o.setName('reason').setDescription('Reason for the ban').setRequired(false))
      .addBooleanOption((o) => o.setName('delete_messages').setDescription('Delete the last 7 days of messages').setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers);
  },

  async parseSlash(interaction: ChatInputCommandInteraction) {
    return {
      user: interaction.options.getUser('user', true),
      duration: interaction.options.getString('duration'),
      reason: interaction.options.getString('reason') ?? null,
      deleteMessages: interaction.options.getBoolean('delete_messages') ?? false,
    };
  },

  async parsePrefix(message: Message, raw: string[]) {
    const [userInput, ...rest] = raw;
    const user = await resolveUser(message.guild!, userInput);
    if (!user) throw new Error(`Could not resolve user "${userInput}"`);
    const tokens = rest.join(' ').trim();
    let durationStr: string | null = null;
    let reasonStr: string | null = null;
    if (tokens) {
      const tokens2 = tokens.split(/\s+/);
      const parsed = parseDuration(tokens2[0]);
      if (parsed) {
        durationStr = tokens2[0];
        reasonStr = tokens2.slice(1).join(' ') || null;
      } else {
        reasonStr = tokens;
      }
    }
    return { user, duration: durationStr, reason: reasonStr, deleteMessages: false };
  },

  async run(ctx: CommandContext) {
    if (!ctx.guild || !ctx.member) {
      await replyError(ctx, 'This command can only be used in a server.');
      return;
    }
    const { user, duration: durationStr, reason } = ctx.args as {
      user: any;
      duration: string | null;
      reason: string | null;
      deleteMessages: boolean;
    };
    if (!user) {
      await replyError(ctx, 'A target user is required.');
      return;
    }

    const targetMember = await ctx.guild.members.fetch(user.id).catch(() => null);
    const botMember = await ctx.guild.members.fetchMe();

    if (targetMember) {
      const hierarchy = canActOn({ guild: ctx.guild, executor: ctx.member, bot: botMember, target: targetMember });
      if (!hierarchy.ok) {
        await replyError(ctx, hierarchy.reason!);
        return;
      }
    }

    const upc = hasUserPermissions(ctx.member, ['BanMembers']);
    if (!upc.ok) { await replyError(ctx, upc.reason!); return; }
    const bpc = hasBotPermissions(botMember, ['BanMembers']);
    if (!bpc.ok) { await replyError(ctx, bpc.reason!); return; }

    let durationMs: number | null = null;
    if (durationStr) {
      const parsed = parseDuration(durationStr);
      if (!parsed) { await replyError(ctx, 'Invalid duration format.'); return; }
      durationMs = parsed.ms;
    }

    try {
      await ctx.guild.members.ban(user.id, {
        reason: reason ?? undefined,
        deleteMessageSeconds: 7 * 24 * 60 * 60,
      });
    } catch (err) {
      await replyError(ctx, `Failed to ban: ${(err as Error).message}`);
      return;
    }

    const id = caseId();
    insertModerationCase({
      id,
      guildId: ctx.guild.id,
      targetId: user.id,
      moderatorId: ctx.user.id,
      action: 'ban',
      reason: reason ?? null,
      duration: durationMs,
      metadata: null,
    });

    if (durationMs) {
      const guild = ctx.guild;
      // Persist the expiry so a restart doesn't silently keep the user banned.
      insertTempBan(guild.id, user.id, Date.now() + durationMs, reason ?? null);
      setTimeout(async () => {
        try {
          await guild.members.unban(user.id, 'Temporary ban expired');
          deleteTempBan(guild.id, user.id);
        } catch {
          /* ignore */
        }
      }, durationMs).unref?.();
    }

    await respond(ctx, {
      embeds: [
        success(
          'Member banned',
          `${user.tag} was banned.\n${reason ? `Reason: ${reason}` : 'No reason provided'}${durationMs ? `\nDuration: ${durationStr}` : ''}\nCase ID: ${id}`,
        ),
      ],
    });

    await logEvent({
      guildId: ctx.guild.id,
      category: 'moderation',
      title: 'Member banned',
      description: reason ?? undefined,
      fields: [
        ...(durationMs ? [{ name: 'Duration', value: durationStr ?? '', inline: true }] : []),
      ],
      author: buildActorInfo(ctx.member),
      target: buildActorInfo(user),
      client: ctx.guild.client,
    });
  },
};

registerCommand(def);
export default def;