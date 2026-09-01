/**
 * /lock + /unlock — Locks a channel by removing @everyone send permissions.
 */

import { ChatInputCommandInteraction, Message, OverwriteType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import type { CommandContext, CommandDefinition } from '../../types/index.js';
import { registerCommand } from '../../handlers/registry.js';
import { respond, replyError } from '../../handlers/respond.js';
import { actionDone, buildEmbed, moderationAction } from '../../embeds/builders.js';
import { parseDuration, formatDuration } from '../../utils/duration.js';
import { logEvent, buildActorInfo } from '../../services/logging.js';
import {
  insertModerationCase,
  recordChannelLock,
  clearChannelLock,
} from '../../db/repositories.js';

interface LockArgs {
  unlock: boolean;
  duration: string | null;
  reason: string | null;
}

async function runLock(ctx: CommandContext, args: LockArgs): Promise<void> {
  if (!ctx.guild || !ctx.channel || !ctx.member) return;
  const everyone = ctx.guild.roles.everyone;
  const target = ctx.channel as any;
  const current = target.permissionOverwrites?.cache?.get(everyone.id);
  const sendAllowed = current?.allow?.has(PermissionFlagsBits.SendMessages);
  const sendDenied = current?.deny?.has(PermissionFlagsBits.SendMessages);
  const currentlyLocked = sendAllowed === false || sendDenied === true;

  if (args.unlock) {
    await target.permissionOverwrites.edit(everyone, { SendMessages: null }).catch(() => {});
    clearChannelLock(ctx.guild.id, target.id);
    await respond(ctx, {
      embeds: [
        actionDone({
          action: 'Channel unlocked',
          target: `<#${target.id}>`,
          detail: '🟢 Open for everyone again.',
        }),
      ],
    });
    await logEvent({
      guildId: ctx.guild.id,
      category: 'moderation',
      title: 'Channel unlocked',
      description: `<#${target.id}>`,
      author: buildActorInfo(ctx.member),
      client: ctx.guild.client,
    });
    return;
  }

  await target.permissionOverwrites.edit(everyone, { SendMessages: false }).catch(() => {});

  // Compute expiry (null = indefinite).
  const expiresAt = args.duration ? parseDuration(args.duration)?.ms != null ? Date.now() + parseDuration(args.duration)!.ms! : null : null;
  recordChannelLock(ctx.guild.id, target.id, ctx.user.id, expiresAt);

  // Schedule auto-unlock if a duration was given.
  let timer: NodeJS.Timeout | null = null;
  if (expiresAt) {
    const delay = Math.max(0, expiresAt - Date.now());
    const guild = ctx.guild;
    const client = guild.client;
    timer = setTimeout(async () => {
      try {
        await target.permissionOverwrites.edit(everyone, { SendMessages: null });
        clearChannelLock(guild.id, target.id);
        await logEvent({
          guildId: guild.id,
          category: 'moderation',
          title: 'Channel auto-unlocked',
          description: `<#${target.id}> lock expired after ${args.duration}`,
          client,
        });
      } catch {
        /* ignore */
      }
    }, delay);
    timer.unref?.();
  }

  const caseIdStr = `LOCK-${Date.now().toString(36).toUpperCase()}`;
  const lockDurationMs = args.duration ? parseDuration(args.duration)?.ms ?? null : null;
  await respond(ctx, {
    embeds: [
      moderationAction({
        action: 'Channel locked',
        target: { id: target.id, tag: target.name ?? target.id },
        moderator: { id: ctx.user.id, tag: ctx.user.tag },
        reason: args.reason,
        duration: lockDurationMs ? formatDuration(lockDurationMs) : null,
        caseId: caseIdStr,
        description: `<#${target.id}> is now read-only${args.duration ? ` — auto-unlock in **${args.duration}**` : ' indefinitely'}.`,
      }),
    ],
  });
  insertModerationCase({
    id: caseIdStr,
    guildId: ctx.guild.id,
    targetId: target.id,
    moderatorId: ctx.user.id,
    action: 'lock',
    reason: args.reason,
    duration: lockDurationMs,
    metadata: null,
  });
  await logEvent({
    guildId: ctx.guild.id,
    category: 'moderation',
    title: 'Channel locked',
    description: `<#${target.id}>`,
    fields: args.duration ? [{ name: 'Duration', value: args.duration, inline: true }] : [],
    author: buildActorInfo(ctx.member),
    client: ctx.guild.client,
  });
  // Suppress unused-var lint by referencing the timer reference.
  void timer;
}

const lockDef: CommandDefinition = {
  name: 'lock',
  description: 'Lock a channel.',
  usage: '/lock [duration]',
  category: 'moderation',
  userPermissions: ['ManageChannels'],
  botPermissions: ['ManageChannels'],
  cooldownSeconds: 3,

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('lock')
      .setDescription('Lock the current channel.')
      .addStringOption((o) => o.setName('duration').setDescription('Auto-unlock after this duration').setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);
  },

  async parseSlash(i: ChatInputCommandInteraction) {
    return { unlock: false, duration: i.options.getString('duration'), reason: null };
  },

  async parsePrefix(_m: Message, raw: string[]) {
    return { unlock: false, duration: raw[0] ?? null, reason: raw.slice(1).join(' ') || null };
  },

  run(ctx: CommandContext) {
    return runLock(ctx, ctx.args as unknown as LockArgs);
  },
};

const unlockDef: CommandDefinition = {
  name: 'unlock',
  description: 'Unlock a channel.',
  category: 'moderation',
  userPermissions: ['ManageChannels'],
  botPermissions: ['ManageChannels'],

  buildSlash() {
    return new SlashCommandBuilder().setName('unlock').setDescription('Unlock a channel.').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);
  },

  parseSlash() {
    return { unlock: true, duration: null, reason: null };
  },

  parsePrefix() {
    return { unlock: true, duration: null, reason: null };
  },

  run(ctx: CommandContext) {
    return runLock(ctx, { unlock: true, duration: null, reason: null });
  },
};

registerCommand(lockDef);
registerCommand(unlockDef);
export default lockDef;