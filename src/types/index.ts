/**
 * Zabron — Core type definitions.
 *
 * Every module imports its types from here so the codebase has a single
 * source of truth. Keep this file dependency-free.
 */

import type {
  ChatInputCommandInteraction,
  GuildMember,
  Message,
  PermissionResolvable,
  SlashCommandBuilder,
  SlashCommandSubcommandsOnlyBuilder,
  TextChannel,
  NewsChannel,
  VoiceChannel,
  StageChannel,
  ForumChannel,
  ThreadChannel,
  Guild,
  Role,
  User,
} from 'discord.js';

// ---------- Commands ----------

// Channels we may receive on a context. Excludes Forum (no .send) and
// PartialGroupDMChannel (read-only). Use `writableChannel()` in
// handlers/respond.ts for runtime narrowing.
export type AnyTextChannel =
  | TextChannel
  | NewsChannel
  | VoiceChannel
  | StageChannel
  | ThreadChannel;

export type WritableChannel = TextChannel | NewsChannel | VoiceChannel | StageChannel | ThreadChannel;

export type CommandCategory =
  | 'security'
  | 'moderation'
  | 'automod'
  | 'management'
  | 'logging'
  | 'automation'
  | 'tickets'
  | 'giveaways'
  | 'leveling'
  | 'roles'
  | 'voice'
  | 'community'
  | 'utility'
  | 'fun'
  | 'configuration';

export interface CommandContext {
  /** Slash or prefix invocation source. */
  source: 'slash' | 'prefix';

  /** The Discord guild, when applicable. */
  guild: Guild | null;

  /** The invoking user. */
  user: User;

  /** Guild member if available, otherwise the raw user. */
  member: GuildMember | null;

  /** For slash commands, the original interaction. */
  interaction?: ChatInputCommandInteraction;

  /** For prefix commands, the original message. */
  message?: Message;

  /** Target text channel where the reply should be sent when possible. */
  channel: AnyTextChannel | null;

  /** Map of named arguments already parsed. */
  args: Record<string, unknown>;

  /** The raw positional argument list (prefix commands). */
  raw: string[];
}

export interface CommandDefinition {
  /** Slash / prefix name. */
  name: string;

  /** Short human description. */
  description: string;

  /** Long-form usage example. */
  usage?: string;

  /** Required bot permissions for the command to function. */
  botPermissions?: PermissionResolvable[];

  /** Required user permissions. */
  userPermissions?: PermissionResolvable[];

  /** Optional cooldown in seconds for users. */
  cooldownSeconds?: number;

  /** Whether this command can be used in DMs. */
  allowDm?: boolean;

  /** Whether this command requires a guild context. */
  guildOnly?: boolean;

  /** Category used for help and organisation. */
  category: CommandCategory;

  /** Build the slash command definition. */
  buildSlash(): any;

  /** Parse arguments for prefix invocations. */
  parsePrefix?(message: Message, raw: string[]): Promise<Record<string, unknown>> | Record<string, unknown>;

  /** Parse arguments for slash invocations. */
  parseSlash?(interaction: ChatInputCommandInteraction): Promise<Record<string, unknown>> | Record<string, unknown>;

  /** Shared business logic — runs regardless of source. */
  run(ctx: CommandContext): Promise<void> | void;
}

export interface RegisteredCommand {
  definition: CommandDefinition;
  source: 'slash' | 'prefix';
}

// ---------- Guild settings ----------

export interface GuildSettings {
  guildId: string;
  prefix: string;
  modLogChannel: string | null;
  panicMode: boolean;
  createdAt: number;
  updatedAt: number;
}

// ---------- Logging categories ----------

export type LogCategory =
  | 'general'
  | 'message'
  | 'security'
  | 'moderation'
  | 'member'
  | 'role'
  | 'channel'
  | 'webhook'
  | 'voice'
  | 'server'
  | 'automod'
  | 'tickets'
  | 'giveaways'
  | 'leveling';

export const LOG_CATEGORIES: LogCategory[] = [
  'general',
  'message',
  'security',
  'moderation',
  'member',
  'role',
  'channel',
  'webhook',
  'voice',
  'server',
  'automod',
  'tickets',
  'giveaways',
  'leveling',
];

// ---------- Moderation ----------

export type ModerationAction =
  | 'ban'
  | 'unban'
  | 'kick'
  | 'timeout'
  | 'untimeout'
  | 'warn'
  | 'purge'
  | 'softban'
  | 'lock'
  | 'unlock';

export interface ModerationCase {
  id: string;
  guildId: string;
  targetId: string;
  moderatorId: string;
  action: ModerationAction;
  reason: string | null;
  duration: number | null;
  createdAt: number;
  metadata: string | null;
}

// ---------- Tickets ----------

export type TicketStatus = 'open' | 'claimed' | 'closed';

export interface Ticket {
  ticketId: string;
  guildId: string;
  channelId: string;
  userId: string;
  claimedBy: string | null;
  category: string;
  status: TicketStatus;
  createdAt: number;
  closedAt: number | null;
  topic: string | null;
}

// ---------- Giveaways ----------

export interface Giveaway {
  id: string;
  guildId: string;
  channelId: string;
  messageId: string | null;
  hostId: string;
  prize: string;
  winnerCount: number;
  requiredRoleId: string | null;
  startsAt: number;
  endsAt: number;
  ended: boolean;
  cancelled: boolean;
  winners: string | null;
}

// ---------- Leveling ----------

export interface LevelingUser {
  guildId: string;
  userId: string;
  xp: number;
  level: number;
  totalMessages: number;
  lastXpAt: number;
}

// ---------- Automation ----------

export type AutomationEvent =
  | 'member_join'
  | 'member_leave'
  | 'message_create'
  | 'message_delete'
  | 'member_update'
  | 'channel_create'
  | 'channel_delete'
  | 'role_create'
  | 'role_delete'
  | 'warn_added'
  | 'security_event'
  | 'schedule'
  | 'automod'
  | 'level_up';

export type AutomationConditionType =
  | 'equals'
  | 'contains'
  | 'regex'
  | 'role'
  | 'channel'
  | 'time_after'
  | 'time_before'
  | 'warn_count_gte';

export type AutomationActionType =
  | 'send_message'
  | 'send_embed'
  | 'add_role'
  | 'remove_role'
  | 'kick'
  | 'ban'
  | 'timeout'
  | 'warn'
  | 'log';

export interface AutomationWorkflow {
  id: string;
  guildId: string;
  name: string;
  enabled: boolean;
  trigger: AutomationEvent;
  conditions: string; // JSON
  actions: string; // JSON
  createdAt: number;
}

// ---------- Permissions ----------

export type PermissionCheckResult =
  | { ok: true }
  | { ok: false; reason: string; ephemeral?: boolean };

// ---------- Misc helpers ----------

export function now(): number {
  return Date.now();
}

export function isGuildMember(value: unknown): value is GuildMember {
  return (
    !!value &&
    typeof value === 'object' &&
    'id' in (value as Record<string, unknown>) &&
    'roles' in (value as Record<string, unknown>)
  );
}

export function isRole(value: unknown): value is Role {
  return !!value && typeof value === 'object' && 'permissions' in (value as Record<string, unknown>);
}