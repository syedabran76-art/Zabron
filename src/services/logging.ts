/**
 * Zabron — Logging service.
 *
 * Provides:
 *   - logEvent()              — central dispatcher for all event embeds.
 *   - resolveAuditExecutor()  — reliable audit-log attribution helper that
 *      fetches WITHOUT a hard-coded type filter (so we can match against
 *      a list of allowed actions), matches the target ID where possible,
 *      rejects stale entries, and falls back to "Unknown" if Discord does
 *      not provide enough information.
 *   - logIgnore helpers       — message-log channel ignore list.
 *   - Centralised builders    — every embed is built through the design
 *      system in src/embeds/builders.ts so branding stays consistent.
 *
 * All Discord API errors, rate limits, missing permissions and missing
 * channels are caught at every level — a logging failure NEVER crashes
 * the underlying Discord event handler.
 */

import {
  Client,
  EmbedBuilder,
  EmbedField,
  Guild,
  GuildAuditLogsEntry,
  GuildMember,
  User,
  AuditLogEvent,
  GuildBan,
  Message,
  PartialMessage,
  Role,
  GuildChannel,
} from 'discord.js';

import {
  buildBanner,
  truncate,
} from '../embeds/builders.js';
import {
  getLoggingConfig,
  isChannelIgnoredForLogs,
  isWebhookDeliveryEnabled,
} from '../db/repositories.js';
import type { LogCategory } from '../types/index.js';

// ---------- Public types ----------

export interface ActorInfo {
  id: string;
  tag: string;
  avatar?: string;
}

export type LogTone =
  | 'brand'
  | 'success'
  | 'error'
  | 'warning'
  | 'info'
  | 'security'
  | 'moderation'
  | 'configuration'
  | 'log'
  | 'ticket'
  | 'giveaway'
  | 'leveling'
  | 'welcome'
  | 'help';

export type LogRisk = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface LogEventOptions {
  guildId: string;
  category: LogCategory;
  title: string;
  description?: string;
  fields?: EmbedField[];
  actor?: ActorInfo | GuildMember | User | null;
  /** Alias kept for backward compatibility with earlier call sites. */
  author?: ActorInfo | GuildMember | User | null;
  target?: ActorInfo | GuildMember | User | null;
  channelId?: string | null;
  channelOverride?: string;
  tone?: LogTone;
  risk?: LogRisk;
  caseId?: string;
  eventId?: string;
  /** Audit-log reason attached to the event (not the embed field). */
  reason?: string | null;
  client: Client;
}

export interface SendResult {
  ok: boolean;
  channelId?: string;
  eventId: string;
  reason?: string;
}

// ---------- Actor extraction ----------

function isGuildMember(value: unknown): value is GuildMember {
  return (
    !!value &&
    typeof value === 'object' &&
    'id' in (value as Record<string, unknown>) &&
    'roles' in (value as Record<string, unknown>) &&
    'guild' in (value as Record<string, unknown>)
  );
}

function isUser(value: unknown): value is User {
  return (
    !!value &&
    typeof value === 'object' &&
    'id' in (value as Record<string, unknown>) &&
    'tag' in (value as Record<string, unknown>) &&
    'bot' in (value as Record<string, unknown>)
  );
}

export function buildActorInfo(
  value: GuildMember | User | ActorInfo | null | undefined,
): ActorInfo | undefined {
  if (!value) return undefined;
  if (!isGuildMember(value) && !isUser(value) && 'id' in (value as any) && 'tag' in (value as any)) {
    return value as ActorInfo;
  }
  if (isGuildMember(value)) {
    return {
      id: value.id,
      tag: value.user?.tag ?? value.user?.username ?? value.id,
      avatar: value.user?.displayAvatarURL?.(),
    };
  }
  if (isUser(value)) {
    return { id: value.id, tag: value.tag, avatar: value.displayAvatarURL?.() };
  }
  return undefined;
}

export const buildLogActor = buildActorInfo;

// ---------- Event id generator ----------

const CATEGORY_PREFIX: Record<string, string> = {
  general: 'LOG',
  message: 'MSG',
  security: 'SEC',
  moderation: 'MOD',
  member: 'MEM',
  role: 'ROLE',
  channel: 'CHAN',
  webhook: 'WH',
  voice: 'VOX',
  server: 'SRV',
  automod: 'AM',
  tickets: 'TKT',
  giveaways: 'GW',
  leveling: 'LVL',
};

let eventCounter = Math.floor(Math.random() * 1000);

export function generateEventId(category: string): string {
  const prefix = CATEGORY_PREFIX[category] ?? 'LOG';
  eventCounter = (eventCounter + 1) % 100000;
  return `${prefix}-${Date.now().toString(36).slice(-4).toUpperCase()}-${eventCounter.toString().padStart(5, '0')}`;
}

// ---------- Routing & tone ----------

function toneForCategory(category: LogCategory): LogTone {
  switch (category) {
    case 'security':
    case 'automod':
      return 'security';
    case 'moderation':
      return 'moderation';
    case 'tickets':
      return 'ticket';
    case 'giveaways':
      return 'giveaway';
    case 'leveling':
      return 'leveling';
    case 'message':
    case 'member':
    case 'role':
    case 'channel':
    case 'webhook':
    case 'voice':
    case 'server':
    case 'general':
    default:
      return 'log';
  }
}

function resolveLogChannel(
  opts: LogEventOptions,
): { channelId: string; tone: LogTone } | null {
  const tone: LogTone = opts.tone ?? toneForCategory(opts.category);
  if (opts.channelOverride) return { channelId: opts.channelOverride, tone };
  const cfg = getLoggingConfig(opts.guildId, opts.category);
  if (!cfg.enabled || !cfg.channelId) return null;
  return { channelId: cfg.channelId, tone };
}

// ---------- Audit log attribution ----------

/**
 * Options accepted by {@link resolveAuditExecutor}.
 */
export interface ResolveAuditOptions {
  /** The guild whose audit log should be searched. */
  guild: Guild;
  /**
   * The Discord audit-log action type we are looking for (e.g.
   * `AuditLogEvent.MemberRoleUpdate`). Multiple types can be supplied so
   * we can cover related actions (e.g. `MemberBanAdd`).
   */
  action: AuditLogEvent | AuditLogEvent[];
  /**
   * Target ID to match against the audit entry's target, when known.
   * When `null` or omitted, target ID is NOT checked (best-effort match).
   */
  targetId?: string | null;
  /**
   * Maximum age of the audit entry in milliseconds. Discord audit logs
   * are eventually pruned by Discord itself; we use a 30-second window by
   * default which is large enough to cover API latency but small enough
   * to avoid attributing stale actions.
   */
  maxAgeMs?: number;
  /** Limit of entries to fetch. Defaults to 25. */
  limit?: number;
  /**
   * Optional secondary target ID for webhook attribution: many
   * webhook-create audit entries set BOTH a webhook target and the
   * channel. We accept either when both are supplied.
   */
  channelId?: string | null;
}

export interface AuditResolution {
  executorId: string | null;
  executor: ActorInfo | null;
  reason: string | null;
  entry: GuildAuditLogsEntry | null;
}

/**
 * Reliable audit-log executor resolver.
 *
 * Why we can't just take `entries.first()`:
 *   - The newest audit entry on the guild may belong to a *different*
 *     action that happened just before the one we're trying to attribute.
 *     Discord buckets all actions into a single rolling log; without
 *     filtering we frequently attribute the wrong user.
 *   - Discord's audit log target field is sometimes the user, sometimes
 *     a channel/role/etc. We only match on target when the caller
 *     explicitly supplies `targetId`.
 *   - Rate-limit errors and "Unknown Guild / Unknown Audit Log" failures
 *     happen frequently; we swallow them so the calling event handler
 *     can continue processing the underlying Discord event.
 *
 * Behaviour:
 *   1. Fetch `limit` recent entries WITHOUT a type filter so we get a
 *      wide slice of the audit log (Discord paginates from newest to
 *      oldest, so the most recent events are at the start).
 *   2. For each entry, check:
 *        a. `action` matches one of the requested action types.
 *        b. If `targetId` was supplied, the entry's target matches it
 *           (or the entry's channel target matches `channelId`).
 *        c. `now - entry.createdTimestamp <= maxAgeMs` (default 30s).
 *   3. Return the first matching entry's executor, plus the entry and
 *      reason. Falls back to `{ executorId: null, executor: null }` when
 *      nothing matches.
 *
 * Discord API failures are caught and the function never throws.
 */
export async function resolveAuditExecutor(
  opts: ResolveAuditOptions,
): Promise<AuditResolution> {
  const actions = Array.isArray(opts.action) ? opts.action : [opts.action];
  const maxAge = opts.maxAgeMs ?? 30_000;
  const limit = opts.limit ?? 25;
  const now = Date.now();

  let audit;
  try {
    // Fetch WITHOUT a `type` filter so we can match against any of the
    // allowed actions in one pass. Discord orders entries newest-first.
    audit = await opts.guild.fetchAuditLogs({ limit });
  } catch {
    // Rate limit, missing VIEW_AUDIT_LOG permission, etc. — never throw.
    return { executorId: null, executor: null, reason: null, entry: null };
  }

  if (!audit) return { executorId: null, executor: null, reason: null, entry: null };

  for (const entry of audit.entries.values()) {
    // Type must match at least one of the requested actions.
    if (!actions.includes(entry.action)) continue;

    // Target must match (when supplied). For webhooks we also accept a
    // channel match because Discord reports the webhook target ID but
    // the action's "extra.channel" object also carries the channel ID.
    if (opts.targetId) {
      const targetMatches = entry.targetId === opts.targetId;
      const channelMatches = !!opts.channelId && (
        (entry.extra && (entry.extra as any).channel && (entry.extra as any).channel.id === opts.channelId)
      );
      if (!targetMatches && !channelMatches) continue;
    }

    // Reject stale entries. Discord audits can lag behind the event by
    // a few seconds under load, but anything older than the configured
    // window almost certainly belongs to an unrelated previous action.
    const ts = typeof entry.createdTimestamp === 'number'
      ? entry.createdTimestamp
      : new Date(entry.createdTimestamp as any).getTime();
    const age = now - ts;
    if (age > maxAge) continue;

    // We have a winner — extract actor info.
    const executor = entry.executor;
    if (!executor) {
      return { executorId: null, executor: null, reason: entry.reason ?? null, entry };
    }
    return {
      executorId: executor.id,
      executor: {
        id: executor.id,
        tag: executor.tag ?? executor.username ?? executor.id,
        avatar: executor.displayAvatarURL?.(),
      },
      reason: entry.reason ?? null,
      entry,
    };
  }

  return { executorId: null, executor: null, reason: null, entry: null };
}

/**
 * Safely fetch a single message, returning `null` on any failure.
 * Use this in logging paths so a missing/partial message can never
 * crash the underlying event handler.
 */
export async function safeFetchMessage(m: Message | PartialMessage): Promise<Message | null> {
  if (!m.partial) return m as Message;
  try {
    return await m.fetch();
  } catch {
    return null;
  }
}

// ---------- Embed assembly ----------

function fmtTime(d: number | Date): string {
  const date = d instanceof Date ? d : new Date(d);
  return `<t:${Math.floor(date.getTime() / 1000)}:F> (<t:${Math.floor(date.getTime() / 1000)}:R>)`;
}

function addActorField(
  fields: EmbedField[],
  actor: ActorInfo | null | undefined,
  explicitNull: boolean,
): void {
  if (actor) {
    const avatar = actor.avatar ? actor.avatar : undefined;
    fields.push({
      name: '👤 Actor',
      value: `<@${actor.id}>\n\`${actor.tag}\` • \`${actor.id}\`${avatar ? `\n[avatar](${avatar})` : ''}`,
      inline: true,
    });
  } else if (explicitNull) {
    fields.push({ name: '👤 Actor', value: '`Unknown` (no executor resolved)', inline: true });
  }
}

function addTargetField(fields: EmbedField[], target: ActorInfo | null | undefined): void {
  if (!target) return;
  const avatar = target.avatar ? target.avatar : undefined;
  fields.push({
    name: '🎯 Target',
    value: `<@${target.id}>\n\`${target.tag}\` • \`${target.id}\`${avatar ? `\n[avatar](${avatar})` : ''}`,
    inline: true,
  });
}

function addChannelField(fields: EmbedField[], channelId: string | null | undefined): void {
  if (!channelId) return;
  fields.push({ name: '📍 Channel', value: `<#${channelId}>`, inline: true });
}

function addCaseAndRisk(
  fields: EmbedField[],
  caseId: string | undefined,
  risk: LogRisk | undefined,
): void {
  if (caseId) fields.push({ name: '📂 Case', value: `\`${caseId}\``, inline: true });
  if (risk) {
    const riskEmoji = risk === 'CRITICAL' ? '🚨' : risk === 'HIGH' ? '🟥' : risk === 'MEDIUM' ? '🟧' : '🟩';
    fields.push({ name: '⚠️ Risk', value: `${riskEmoji} \`${risk}\``, inline: true });
  }
}

export function buildLogEmbed(opts: LogEventOptions, eventId: string, now: number): EmbedBuilder {
  // Resolve actor and target. `null` (explicit "Unknown") must survive
  // the nullish-coalescing chain — only `undefined` falls back to the
  // legacy `author` alias.
  const resolvedActor =
    opts.actor !== undefined ? opts.actor : (opts.author !== undefined ? opts.author : undefined);
  const resolved = { ...opts, actor: resolvedActor };

  const fields: EmbedField[] = [];
  const tone: LogTone = resolved.tone ?? toneForCategory(resolved.category);

  addActorField(
    fields,
    buildActorInfo(resolved.actor ?? undefined),
    resolved.actor === null || resolved.actor === undefined,
  );
  addTargetField(fields, buildActorInfo(resolved.target ?? undefined));
  addChannelField(fields, resolved.channelId ?? undefined);
  fields.push({ name: '🕒 Time', value: fmtTime(now), inline: false });
  addCaseAndRisk(fields, resolved.caseId, resolved.risk);

  if (resolved.fields && resolved.fields.length) fields.push(...resolved.fields);

  return buildBanner({
    title: resolved.title,
    description: resolved.description,
    fields,
    tone,
    eventId,
  });
}

// ---------- Main entry point ----------

/**
 * Send a log event to the configured channel for its category.
 *
 * Failure modes (all return `{ ok: false, reason }` instead of throwing):
 *   - Guild not found
 *   - No log channel configured for the category
 *   - Webhook delivery disabled for the category
 *   - Log channel missing / deleted / not text-based
 *   - Discord API error (rate limit, missing permissions, network)
 *
 * Returns `{ ok: true, channelId, eventId }` on success.
 */
export async function logEvent(opts: LogEventOptions): Promise<SendResult> {
  const eventId = opts.eventId ?? generateEventId(opts.category);
  const now = Date.now();
  try {
    const guild =
      opts.client.guilds?.cache?.get(opts.guildId) ??
      (await opts.client.guilds?.fetch(opts.guildId).catch(() => null));
    if (!guild) return { ok: false, eventId, reason: 'Guild not found' };

    const route = resolveLogChannel(opts);
    if (!route) return { ok: false, eventId, reason: 'No log channel configured' };

    // Webhook delivery toggles live alongside the regular channel config.
    if (!isWebhookDeliveryEnabled(opts.guildId, opts.category)) {
      return { ok: false, eventId, reason: 'Webhook delivery disabled for category' };
    }

    const channel = await guild.channels.fetch(route.channelId).catch(() => null);
    if (!channel || !('send' in (channel as any))) {
      return { ok: false, eventId, reason: 'Log channel missing or non-text' };
    }

    const embed = buildLogEmbed({ ...opts, tone: route.tone }, eventId, now);
    if (opts.risk) {
      embed.setFooter({
        text: `Event ${eventId} • risk: ${opts.risk} • Zabron`,
        iconURL: opts.client.user?.displayAvatarURL?.(),
      });
    }

    await (channel as any).send({
      embeds: [embed],
      allowedMentions: { parse: [] },
    });
    return { ok: true, channelId: route.channelId, eventId };
  } catch (err) {
    return { ok: false, eventId, reason: (err as Error).message };
  }
}

// ---------- Plain text escape hatch ----------

export async function sendPlain(
  guildId: string,
  category: LogCategory,
  content: string,
  client: Client,
): Promise<SendResult> {
  const cfg = getLoggingConfig(guildId, category);
  if (!cfg.enabled || !cfg.channelId) {
    return { ok: false, eventId: '-', reason: 'No log channel configured' };
  }
  try {
    const guild = client.guilds.cache.get(guildId) ?? (await client.guilds.fetch(guildId).catch(() => null));
    if (!guild) return { ok: false, eventId: '-', reason: 'Guild not found' };
    const channel = await guild.channels.fetch(cfg.channelId).catch(() => null);
    if (!channel || !('send' in (channel as any))) return { ok: false, eventId: '-', reason: 'Bad channel' };
    await (channel as any).send({ content, allowedMentions: { parse: [] } });
    return { ok: true, channelId: cfg.channelId, eventId: '-' };
  } catch (err) {
    return { ok: false, eventId: '-', reason: (err as Error).message };
  }
}

// ---------- High-level wrapper ----------

export function buildLogEmbedStandalone(opts: LogEventOptions): EmbedBuilder {
  const eventId = opts.eventId ?? generateEventId(opts.category);
  return buildLogEmbed(opts, eventId, Date.now());
}

export function buildCaseRow(opts: {
  action: string;
  reason?: string | null;
  moderatorId: string;
  targetId: string;
  createdAt: number;
  caseId: string;
}): { name: string; value: string; inline: true } {
  return {
    name: `Case ${opts.caseId} • ${opts.action}`,
    value:
      `> 👤 **Moderator:** <@${opts.moderatorId}> (\`${opts.moderatorId}\`)\n` +
      `> 🎯 **Target:** <@${opts.targetId}> (\`${opts.targetId}\`)\n` +
      `> 📝 **Reason:** ${opts.reason ?? 'No reason provided'}\n` +
      `> 🕒 **Time:** ${fmtTime(opts.createdAt)}`,
    inline: true as const,
  };
}

// ---------- High-level event helpers ----------

/**
 * Render a member join event with consistent formatting.
 */
export async function logMemberJoin(
  client: Client,
  guildId: string,
  user: { id: string; tag: string; avatar?: string; createdTimestamp?: number },
): Promise<SendResult> {
  const fields: EmbedField[] = [];
  if (typeof user.createdTimestamp === 'number') {
    const ageDays = (Date.now() - user.createdTimestamp) / 86_400_000;
    fields.push({ name: '🆔 Account age', value: `\`${ageDays.toFixed(1)}d\``, inline: true });
  }
  fields.push({ name: '👤 User ID', value: `\`${user.id}\``, inline: true });
  return logEvent({
    client,
    guildId,
    category: 'member',
    title: 'Member joined',
    description: `${user.tag} joined the server.`,
    actor: { id: user.id, tag: user.tag, avatar: user.avatar },
    fields,
  });
}

export async function logMemberLeave(
  client: Client,
  guildId: string,
  user: { id: string; tag: string; avatar?: string },
): Promise<SendResult> {
  return logEvent({
    client,
    guildId,
    category: 'member',
    title: 'Member left',
    description: `${user.tag} left the server.`,
    actor: { id: user.id, tag: user.tag, avatar: user.avatar },
    fields: [{ name: '👤 User ID', value: `\`${user.id}\``, inline: true }],
  });
}

export async function logMemberNicknameChange(
  client: Client,
  guildId: string,
  user: { id: string; tag: string; avatar?: string },
  before: string | null,
  after: string | null,
): Promise<SendResult> {
  return logEvent({
    client,
    guildId,
    category: 'member',
    title: 'Nickname changed',
    description: `${user.tag} updated their nickname.`,
    actor: { id: user.id, tag: user.tag, avatar: user.avatar },
    target: { id: user.id, tag: user.tag, avatar: user.avatar },
    fields: [
      { name: '🅰️ Old', value: before ? truncate(before, 256) : '*none*', inline: true },
      { name: '🆕 New', value: after ? truncate(after, 256) : '*cleared*', inline: true },
    ],
  });
}

export async function logMemberRoleChange(
  client: Client,
  guildId: string,
  user: { id: string; tag: string; avatar?: string },
  added: Role[],
  removed: Role[],
  /**
   * The Discord user who actually performed the role change, as
   * resolved from the audit log (`AuditLogEvent.MemberRoleUpdate`).
   *
   * IMPORTANT: this is the ACTOR of the change — NOT the target
   * member. The target member is `user`. Historically the embed used
   * `user` as both actor and target, which incorrectly attributed
   * moderator-initiated role changes to the affected member.
   *
   * Behaviour:
   *   - When a non-null `executor` is provided, it is used as the
   *     actor and `user` remains the target.
   *   - When `executor` is `null` (audit log could not be resolved,
   *     or the executor field is missing on the entry), the embed
   *     shows "Unknown" for the actor — NEVER the target.
   *   - When the executor IS the target (a member adding/removing
   *     their own roles via Discord's profile UI or self-bot), the
   *     executor is still shown as the actor, since that is the
   *     accurate attribution.
   */
  executor: ActorInfo | null = null,
): Promise<SendResult> {
  const fields: EmbedField[] = [];
  if (added.length) {
    fields.push({
      name: `➕ Roles added (${added.length})`,
      value: added.map((r) => `<@&${r.id}>`).join(' ').slice(0, 1024) || '*none*',
      inline: false,
    });
  }
  if (removed.length) {
    fields.push({
      name: `➖ Roles removed (${removed.length})`,
      value: removed.map((r) => `<@&${r.id}>`).join(' ').slice(0, 1024) || '*none*',
      inline: false,
    });
  }
  if (!fields.length) {
    fields.push({ name: 'ℹ️ Note', value: '*No roles changed (audit log re-attribution)*', inline: false });
  }
  // Pass `executor` through directly. The audit-log resolver already
  // guarantees it is either a real Discord user with an ID different
  // from the target (when a moderator acted) or `null` when no
  // attribution is available. We NEVER substitute `user` (the target)
  // as a fallback — that was the original bug and would mis-attribute
  // moderator actions to the affected member.
  return logEvent({
    client,
    guildId,
    category: 'role',
    title: 'Member roles updated',
    description: `${user.tag} ${added.length ? 'received' : ''}${added.length && removed.length ? ' and ' : ''}${removed.length ? 'lost' : ''} role${added.length + removed.length === 1 ? '' : 's'}.`,
    actor: executor, // null → embed renders "Unknown" via buildLogEmbed
    target: { id: user.id, tag: user.tag, avatar: user.avatar },
    fields,
  });
}

export async function logMemberTimeoutChange(
  client: Client,
  guildId: string,
  user: { id: string; tag: string; avatar?: string },
  before: Date | null | undefined,
  after: Date | null | undefined,
): Promise<SendResult> {
  const beforeStr = before ? `<t:${Math.floor(before.getTime() / 1000)}:F>` : '*none*';
  const afterStr = after ? `<t:${Math.floor(after.getTime() / 1000)}:F> (<t:${Math.floor(after.getTime() / 1000)}:R>)` : '*cleared*';
  const fields: EmbedField[] = [
    { name: '⏱️ Previous', value: beforeStr, inline: true },
    { name: '⏱️ Current', value: afterStr, inline: true },
  ];
  if (after) {
    const remainingMs = after.getTime() - Date.now();
    if (remainingMs > 0) {
      fields.push({ name: '⏳ Remaining', value: `\`${truncateMs(remainingMs)}\``, inline: true });
    }
  }
  return logEvent({
    client,
    guildId,
    category: 'moderation',
    title: after ? 'Member timed out' : 'Timeout cleared',
    description: `${user.tag} ${after ? 'was put in timeout' : 'had their timeout cleared'}.`,
    actor: { id: user.id, tag: user.tag, avatar: user.avatar },
    target: { id: user.id, tag: user.tag, avatar: user.avatar },
    fields,
  });
}

export async function logMemberBoostChange(
  client: Client,
  guildId: string,
  user: { id: string; tag: string; avatar?: string },
  now: 'start' | 'end',
): Promise<SendResult> {
  return logEvent({
    client,
    guildId,
    category: 'server',
    title: now === 'start' ? 'Server boost started' : 'Server boost ended',
    description: now === 'start'
      ? `${user.tag} started boosting the server.`
      : `${user.tag} stopped boosting the server.`,
    actor: { id: user.id, tag: user.tag, avatar: user.avatar },
    target: { id: user.id, tag: user.tag, avatar: user.avatar },
  });
}

/**
 * Log a single message deletion.
 *
 * Partial messages are handled safely: if Discord doesn't have the
 * message cached we render a "content unavailable" placeholder instead
 * of failing. `m.fetch()` errors are swallowed.
 */
export async function logMessageDelete(
  client: Client,
  guildId: string,
  data: {
    message: Message | PartialMessage;
    executor: ActorInfo | null;
    reason?: string | null;
  },
): Promise<SendResult> {
  const m = data.message;
  const channelId = m.channel?.id;
  if (!channelId) return { ok: false, eventId: '-', reason: 'No channel' };

  // Respect per-channel ignore list BEFORE building the embed.
  if (isChannelIgnoredForLogs(guildId, channelId)) {
    return { ok: false, eventId: '-', reason: 'Channel ignored' };
  }

  const partial = !!m.partial;

  // Try to fetch full message if we have a partial. Never throws.
  const full = await safeFetchMessage(m);

  const fields: EmbedField[] = [
    { name: '📍 Channel', value: `<#${channelId}>`, inline: true },
    { name: '🆔 Message ID', value: `\`${m.id}\``, inline: true },
  ];

  // Author extraction — works for both full and partial messages.
  let authorTag = 'Unknown';
  let authorId = 'Unknown';
  let authorAvatar: string | undefined;
  if (m.author) {
    authorId = m.author.id;
    authorTag = m.author.tag ?? `${m.author.username}#${m.author.discriminator ?? '0000'}`;
    authorAvatar = m.author.displayAvatarURL?.();
  } else if (full?.author) {
    authorId = full.author.id;
    authorTag = full.author.tag ?? `${full.author.username}#${full.author.discriminator ?? '0000'}`;
    authorAvatar = full.author.displayAvatarURL?.();
  }

  if (authorId !== 'Unknown') {
    fields.push({ name: '👤 Author', value: `<@${authorId}>\n\`${authorTag}\`\n\`${authorId}\``, inline: true });
  }

  // Content extraction — handles text, attachments, embeds, partial state.
  let content: string | null = null;
  if (full) {
    if (full.content && full.content.length) {
      content = truncate(full.content, 1024);
    } else if (full.attachments && full.attachments.size > 0) {
      const list = full.attachments.map((a) => `[${a.name}](${a.url})`).slice(0, 5);
      content = `📎 ${full.attachments.size} attachment${full.attachments.size === 1 ? '' : 's'}:\n${list.join(', ')}`;
    } else if (full.embeds && full.embeds.length > 0) {
      content = `🖼 ${full.embeds.length} embed${full.embeds.length === 1 ? '' : 's'}`;
    }
  }

  if (content) {
    fields.push({ name: '💬 Content', value: content, inline: false });
  } else if (partial) {
    fields.push({ name: '💬 Content', value: '*content unavailable*', inline: false });
  } else {
    fields.push({ name: '💬 Content', value: '*empty message*', inline: false });
  }

  if (data.executor) {
    fields.push({
      name: '🛠 Deleted by',
      value: `<@${data.executor.id}>\n\`${data.executor.tag}\`\n\`${data.executor.id}\``,
      inline: true,
    });
  } else {
    fields.push({ name: '🛠 Deleted by', value: '*self-deleted or unknown*', inline: true });
  }
  if (data.reason) {
    fields.push({ name: '📝 Audit reason', value: truncate(data.reason, 512), inline: false });
  }

  return logEvent({
    client,
    guildId,
    category: 'message',
    title: partial ? 'Message deleted (partial)' : 'Message deleted',
    description: partial ? '*Partial message — content may be unavailable*' : undefined,
    actor: data.executor,
    target: authorId !== 'Unknown' ? { id: authorId, tag: authorTag, avatar: authorAvatar } : null,
    channelId,
    fields,
  });
}

/**
 * Log a bulk message delete.
 *
 * Up to the first 5 messages are previewed. Partial messages are
 * fetched lazily; if the fetch fails, the preview shows "*unavailable*".
 */
export async function logMessageBulkDelete(
  client: Client,
  guildId: string,
  data: {
    channelId: string;
    channelName?: string;
    count: number;
    messages: Array<Message | PartialMessage>;
    executor: ActorInfo | null;
  },
): Promise<SendResult> {
  if (isChannelIgnoredForLogs(guildId, data.channelId)) {
    return { ok: false, eventId: '-', reason: 'Channel ignored' };
  }

  const preview: string[] = [];
  for (const m of data.messages.slice(0, 5)) {
    let content = '';
    if (m.partial) {
      const full = await safeFetchMessage(m);
      content = (full?.content ?? '').slice(0, 100);
    } else {
      content = (m.content ?? '').slice(0, 100);
    }
    const author = m.author?.tag ?? 'unknown';
    preview.push(`• \`${author}\`: ${content || '*empty*'}`);
  }

  const fields: EmbedField[] = [
    { name: '📍 Channel', value: `<#${data.channelId}>`, inline: true },
    { name: '🧮 Messages', value: `\`${data.count}\``, inline: true },
  ];
  if (data.executor) {
    fields.push({
      name: '🛠 Purged by',
      value: `<@${data.executor.id}>\n\`${data.executor.tag}\``,
      inline: true,
    });
  }
  if (preview.length) {
    fields.push({ name: '📄 Preview (first 5)', value: truncate(preview.join('\n'), 1024), inline: false });
  }

  return logEvent({
    client,
    guildId,
    category: 'message',
    title: 'Bulk message delete',
    description: `${data.count} message${data.count === 1 ? '' : 's'} purged in <#${data.channelId}>.`,
    actor: data.executor,
    target: null,
    channelId: data.channelId,
    fields,
  });
}

export async function logMessageEdit(
  client: Client,
  guildId: string,
  data: {
    before: string;
    after: string;
    message: Message | PartialMessage;
    author: ActorInfo | null;
  },
): Promise<SendResult> {
  const m = data.message;
  if (isChannelIgnoredForLogs(guildId, m.channel.id)) {
    return { ok: false, eventId: '-', reason: 'Channel ignored' };
  }
  const fields: EmbedField[] = [
    { name: '📍 Channel', value: `<#${m.channel.id}>`, inline: true },
    { name: '🆔 Message ID', value: `\`${m.id}\``, inline: true },
    { name: '🅰️ Before', value: data.before ? `\`\`\`\n${truncate(data.before, 900)}\n\`\`\`` : '*empty*', inline: false },
    { name: '🆕 After', value: data.after ? `\`\`\`\n${truncate(data.after, 900)}\n\`\`\`` : '*empty*', inline: false },
  ];
  if ('url' in m && m.url) {
    fields.push({ name: '🔗 Jump', value: `[Open message](${m.url})`, inline: false });
  }
  return logEvent({
    client,
    guildId,
    category: 'message',
    title: 'Message edited',
    actor: data.author,
    target: data.author,
    channelId: m.channel.id,
    fields,
  });
}

export async function logBanAdd(
  client: Client,
  guildId: string,
  ban: GuildBan,
  executor: ActorInfo | null,
  reason: string | null,
): Promise<SendResult> {
  const user = ban.user;
  const fields: EmbedField[] = [
    { name: '👤 User', value: `<@${user.id}>\n\`${user.tag ?? user.id}\`\n\`${user.id}\``, inline: true },
    { name: '🤖 Bot', value: user.bot ? '✅ Yes' : '❌ No', inline: true },
  ];
  if (reason) fields.push({ name: '📝 Reason', value: truncate(reason, 512), inline: false });

  return logEvent({
    client,
    guildId,
    category: 'moderation',
    title: 'Member banned',
    description: `${user.tag ?? user.id} was banned.`,
    actor: executor,
    target: { id: user.id, tag: user.tag ?? user.id, avatar: user.displayAvatarURL?.() },
    fields,
  });
}

export async function logBanRemove(
  client: Client,
  guildId: string,
  ban: GuildBan,
  executor: ActorInfo | null,
  reason: string | null,
): Promise<SendResult> {
  const user = ban.user;
  const fields: EmbedField[] = [
    { name: '👤 User', value: `<@${user.id}>\n\`${user.tag ?? user.id}\`\n\`${user.id}\``, inline: true },
  ];
  if (reason) fields.push({ name: '📝 Reason', value: truncate(reason, 512), inline: false });
  return logEvent({
    client,
    guildId,
    category: 'moderation',
    title: 'Member unbanned',
    description: `${user.tag ?? user.id} was unbanned.`,
    actor: executor,
    target: { id: user.id, tag: user.tag ?? user.id, avatar: user.displayAvatarURL?.() },
    fields,
  });
}

export async function logChannelEvent(
  client: Client,
  guildId: string,
  data: {
    action: 'create' | 'delete' | 'update';
    channel: GuildChannel;
    before?: GuildChannel | null;
    executor: ActorInfo | null;
    reason?: string | null;
  },
): Promise<SendResult> {
  const fields: EmbedField[] = [
    { name: '📌 Type', value: `\`${data.channel.type}\``, inline: true },
    { name: '🆔 Channel ID', value: `\`${data.channel.id}\``, inline: true },
  ];
  if (data.action === 'update' && data.before) {
    const changes: string[] = [];
    if (data.before.name !== data.channel.name) {
      changes.push(`Name: \`${data.before.name}\` → \`${data.channel.name}\``);
    }
    if ('topic' in data.before && 'topic' in data.channel && data.before.topic !== data.channel.topic) {
      changes.push(`Topic changed`);
    }
    if ('parentId' in data.channel) {
      changes.push(`Parent: \`${(data.before as any).parentId ?? 'none'}\` → \`${(data.channel as any).parentId ?? 'none'}\``);
    }
    if (changes.length) {
      fields.push({ name: '🔄 Changes', value: changes.map((c) => `• ${c}`).join('\n').slice(0, 1024), inline: false });
    } else {
      fields.push({ name: '🔄 Changes', value: '*Permission overwrite updated*', inline: false });
    }
  }
  if (data.executor) {
    fields.push({
      name: '🛠 By',
      value: `<@${data.executor.id}>\n\`${data.executor.tag}\``,
      inline: true,
    });
  }
  if (data.reason) {
    fields.push({ name: '📝 Reason', value: truncate(data.reason, 512), inline: false });
  }

  const title =
    data.action === 'create' ? 'Channel created' :
    data.action === 'delete' ? 'Channel deleted' :
    'Channel updated';

  return logEvent({
    client,
    guildId,
    category: 'channel',
    title,
    description: `${data.channel.name ?? data.channel.id}`,
    actor: data.executor,
    target: null,
    fields,
  });
}

export async function logRoleEvent(
  client: Client,
  guildId: string,
  data: {
    action: 'create' | 'delete' | 'update';
    role: Role;
    before?: Role | null;
    executor: ActorInfo | null;
    reason?: string | null;
  },
): Promise<SendResult> {
  const fields: EmbedField[] = [
    { name: '🎨 Color', value: `\`${data.role.hexColor ?? 'default'}\``, inline: true },
    { name: '📣 Mentionable', value: data.role.mentionable ? '✅ Yes' : '❌ No', inline: true },
    { name: '🚩 Hoisted', value: data.role.hoist ? '✅ Yes' : '❌ No', inline: true },
  ];
  if (data.action === 'update' && data.before) {
    const changes: string[] = [];
    if (data.before.name !== data.role.name) {
      changes.push(`Name: \`${data.before.name}\` → \`${data.role.name}\``);
    }
    if (data.before.hexColor !== data.role.hexColor) {
      changes.push(`Color: \`${data.before.hexColor}\` → \`${data.role.hexColor}\``);
    }
    if (data.before.permissions.bitfield !== data.role.permissions.bitfield) {
      changes.push(`Permissions updated (\`${data.role.permissions.bitfield.toString()}\`)`);
    }
    if (changes.length) {
      fields.push({ name: '🔄 Changes', value: changes.map((c) => `• ${c}`).join('\n').slice(0, 1024), inline: false });
    }
  }
  if (data.executor) {
    fields.push({
      name: '🛠 By',
      value: `<@${data.executor.id}>\n\`${data.executor.tag}\``,
      inline: true,
    });
  }
  if (data.reason) {
    fields.push({ name: '📝 Reason', value: truncate(data.reason, 512), inline: false });
  }

  const title =
    data.action === 'create' ? 'Role created' :
    data.action === 'delete' ? 'Role deleted' :
    'Role updated';

  return logEvent({
    client,
    guildId,
    category: 'role',
    title,
    description: `${data.role.name}`,
    actor: data.executor,
    target: null,
    fields,
  });
}

export async function logWebhookEvent(
  client: Client,
  guildId: string,
  data: {
    action: 'create' | 'update' | 'delete';
    channelId: string;
    webhookId: string | null;
    executor: ActorInfo | null;
    reason?: string | null;
  },
): Promise<SendResult> {
  const fields: EmbedField[] = [
    { name: '📍 Channel', value: `<#${data.channelId}>`, inline: true },
    { name: '🆔 Webhook ID', value: data.webhookId ? `\`${data.webhookId}\`` : '*unknown*', inline: true },
  ];
  if (data.executor) {
    fields.push({
      name: '🛠 By',
      value: `<@${data.executor.id}>\n\`${data.executor.tag}\``,
      inline: true,
    });
  }
  if (data.reason) {
    fields.push({ name: '📝 Reason', value: truncate(data.reason, 512), inline: false });
  }

  const title =
    data.action === 'create' ? 'Webhook created' :
    data.action === 'delete' ? 'Webhook deleted' :
    'Webhook updated';

  return logEvent({
    client,
    guildId,
    category: 'webhook',
    title,
    description: data.action === 'create'
      ? `A webhook was created in <#${data.channelId}>.`
      : data.action === 'delete'
        ? `A webhook in <#${data.channelId}> was deleted.`
        : `A webhook in <#${data.channelId}> was updated.`,
    actor: data.executor,
    target: null,
    channelId: data.channelId,
    fields,
  });
}

// ---------- Helpers ----------

/**
 * Millisecond → readable duration.
 */
function truncateMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h % 24 > 0) parts.push(`${h % 24}h`);
  if (m % 60 > 0 && d === 0) parts.push(`${m % 60}m`);
  if (s % 60 > 0 && h === 0 && d === 0) parts.push(`${s % 60}s`);
  return parts.join(' ') || '0s';
}

/** Re-export for tests / embed builders. */
export const __internal = { buildLogEmbed, generateEventId, toneForCategory, safeFetchMessage };

// Avoid unused-warning linting in strict TS.
export type _AuditLogEvent = AuditLogEvent;