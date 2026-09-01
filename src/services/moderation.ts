/**
 * Zabron — Shared moderation helpers.
 *
 * Provides reusable functions so every moderation command does not
 * duplicate permission checks, hierarchy validation, case recording and
 * the polished user-facing embed.
 */

import { Guild, GuildMember, User, PermissionResolvable } from 'discord.js';

import { canActOn, hasBotPermissions, hasUserPermissions, resolveUser } from '../utils/permissions.js';
import { insertModerationCase } from '../db/repositories.js';
import { caseId } from '../utils/ids.js';
import { replyError, respond } from '../handlers/respond.js';
import { buildActorInfo, logEvent } from './logging.js';
import { moderationAction } from '../embeds/builders.js';
import type { CommandContext, ModerationAction } from '../types/index.js';

export interface ModerationInput {
  guild: Guild;
  executor: GuildMember;
  user: User;
  reason: string | null;
  durationMs: number | null;
  action: ModerationAction;
  /** Human-readable duration string (e.g. "1 hour 30 minutes"). Optional. */
  durationLabel?: string | null;
  extraFields?: { name: string; value: string; inline?: boolean }[];
  successTitle?: string;
  successDescription?: string;
  /**
   * Suppress the user-facing moderation embed — useful when the calling
   * command has already composed its own reply (e.g. /warn with custom
   * extra fields). Defaults to false (send embed).
   */
  silent?: boolean;
}

export interface ModerationResult {
  caseId: string;
}

export async function runModeration(
  ctx: CommandContext,
  input: ModerationInput,
  perform: () => Promise<void>,
): Promise<ModerationResult | null> {
  const botMember = await input.guild.members.fetchMe();
  const targetMember = await input.guild.members.fetch(input.user.id).catch(() => null);

  const userCheck = hasUserPermissions(input.executor, ['ModerateMembers', 'KickMembers', 'BanMembers'] as PermissionResolvable[]);
  if (!userCheck.ok && input.action !== 'warn' && input.action !== 'purge' && input.action !== 'lock' && input.action !== 'unlock') {
    await replyError(ctx, userCheck.reason ?? 'Insufficient permissions.');
    return null;
  }

  if (targetMember) {
    const hierarchy = canActOn({ guild: input.guild, executor: input.executor, bot: botMember, target: targetMember });
    if (!hierarchy.ok) {
      await replyError(ctx, hierarchy.reason!);
      return null;
    }
  }

  try {
    await perform();
  } catch (err) {
    await replyError(ctx, `Failed: ${(err as Error).message}`);
    return null;
  }

  const id = caseId();
  insertModerationCase({
    id,
    guildId: input.guild.id,
    targetId: input.user.id,
    moderatorId: input.executor.id,
    action: input.action,
    reason: input.reason,
    duration: input.durationMs,
    metadata: null,
  });

  if (!input.silent) {
    await respond(ctx, {
      embeds: [
        moderationAction({
          action: input.successTitle ?? `${capitalize(input.action)} applied`,
          target: { id: input.user.id, tag: input.user.tag },
          moderator: { id: input.executor.id, tag: input.executor.user.tag },
          reason: input.reason,
          duration: input.durationLabel,
          caseId: id,
          extraFields: input.extraFields?.map((f) => ({ ...f, inline: f.inline ?? false })),
        }),
      ],
    });
  }

  await logEvent({
    guildId: input.guild.id,
    category: 'moderation',
    title: input.successTitle ?? `${capitalize(input.action)} applied`,
    description: input.reason ?? undefined,
    fields: input.extraFields?.map((f) => ({ ...f, inline: f.inline ?? false })),
    author: buildActorInfo(input.executor),
    target: buildActorInfo(input.user),
    client: input.guild.client,
  });

  return { caseId: id };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}