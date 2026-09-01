/**
 * Zabron — Logging service (Zeon-style SOC embeds).
 *
 * One central `logEvent()` produces a consistent, branded, structured
 * embed for every audit event the bot emits. The embed mirrors the
 * layout used by Zeon / popular Discord security bots:
 *
 *   ┌─[ 🛡 ANTINUKE — Mass ban detected ]─────────────┐
 *   │ <description>                                   │
 *   │                                                │
 *   │ 👤 Actor: @user (123456789)                    │
 *   │ 🎯 Target: @victim (987654321)                 │
 *   │ 📍 Channel: #general                           │
 *   │ 🕒 Time: <discord timestamp>                   │
 *   │                                                │
 *   │ ── Additional context fields ──                │
 *   │ Case #1042  •  Threshold: 3/10s                │
 *   │ Punishment: ban                                │
 *   └────────────────────────────────────────────────┘
 *   Zabron • Event SEC-1042 • risk: HIGH
 *
 * Public API:
 *   - logEvent(opts)               — send a single log embed
 *   - buildActorInfo(member/user)  — extract {id, tag, avatar} safely
 *   - buildLogActor(member/user)   — same as buildActorInfo, kept as alias
 *   - generateEventId(category)    — produce a readable event id
 *   - sendPlain(guildId, message)  — escape hatch for plain text logs
 */

import { Client, Guild, GuildMember, User, EmbedField } from 'discord.js';
import { EmbedBuilder } from 'discord.js';

import { buildBanner, EmbedTone } from '../embeds/builders.js';
import { getLoggingConfig } from '../db/repositories.js';
import { LogCategory } from '../types/index.js';

// ---------- Public types ----------

export interface ActorInfo {
  id: string;
  tag: string;
  avatar?: string;
}

export type LogTone = 'brand' | 'success' | 'error' | 'warning' | 'info' | 'security' | 'moderation' | 'configuration' | 'log' | 'ticket' | 'giveaway' | 'leveling' | 'welcome' | 'help';

export type LogRisk = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface LogEventOptions {
  /** Guild this event belongs to. */
  guildId: string;

  /** Routing category — picks the configured log channel. */
  category: LogCategory;

  /** Short title (e.g. "Member banned", "Antinuke triggered"). */
  title: string;

  /** Optional long description, shown above the structured fields. */
  description?: string;

  /** Additional context fields shown in the embed. */
  fields?: EmbedField[];

  /** Person who caused / performed the action. */
  actor?: ActorInfo | GuildMember | User | null;

  /**
   * Alias for `actor` — accepted for backward compatibility with existing
   * call sites that already use `author`.
   */
  author?: ActorInfo | GuildMember | User | null;

  /** Person / thing the action was applied to. */
  target?: ActorInfo | GuildMember | User | null;

  /** Where the event took place (e.g. #general, voice channel). */
  channelId?: string | null;

  /** Override the channel the embed is sent to. */
  channelOverride?: string;

  /** Override the embed tone / color. */
  tone?: LogTone;

  /** Risk indicator shown in the footer (e.g. "risk: HIGH"). */
  risk?: LogRisk;

  /** Optional case / case id associated with the event. */
  caseId?: string;

  /** Optional custom event id, otherwise one is generated. */
  eventId?: string;

  /** Source client (used to resolve guild + send messages). */
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

/**
 * Best-effort conversion of a member / user into ActorInfo so we can
 * embed it consistently regardless of the call site.
 */
export function buildActorInfo(value: GuildMember | User | ActorInfo | null | undefined): ActorInfo | undefined {
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
    return {
      id: value.id,
      tag: value.tag,
      avatar: value.displayAvatarURL?.(),
    };
  }
  return undefined;
}

/** Alias kept for backward compatibility with earlier call sites. */
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

// ---------- Routing ----------

function resolveLogChannel(opts: LogEventOptions, guild: Guild): { channelId: string; tone: LogTone } | null {
  const tone: LogTone = opts.tone ?? toneForCategory(opts.category);
  if (opts.channelOverride) return { channelId: opts.channelOverride, tone };

  const cfg = getLoggingConfig(opts.guildId, opts.category);
  if (!cfg.enabled || !cfg.channelId) return null;
  return { channelId: cfg.channelId, tone };
}

function toneForCategory(category: LogCategory): LogTone {
  switch (category) {
    case 'security':
    case 'automod':
      return 'security';
    case 'moderation':
      return 'moderation';
    case 'member':
    case 'message':
    case 'role':
    case 'channel':
    case 'voice':
    case 'server':
      return 'log';
    case 'tickets':
      return 'ticket';
    case 'giveaways':
      return 'giveaway';
    case 'leveling':
      return 'leveling';
    default:
      return 'log';
  }
}

// ---------- Embed assembly ----------

function timestamp(d?: number | Date): number {
  if (d instanceof Date) return d.getTime();
  if (typeof d === 'number') return d;
  return Date.now();
}

function fmtTime(d: number | Date): string {
  const date = d instanceof Date ? d : new Date(d);
  return `<t:${Math.floor(date.getTime() / 1000)}:F> (<t:${Math.floor(date.getTime() / 1000)}:R>)`;
}

/**
 * Assemble the final embed. Layout (Zeon-style):
 *  - title with severity emoji
 *  - description
 *  - "Actor" / "Target" / "Channel" / "Time" struct fields
 *  - any caller-supplied fields
 *  - footer with case id, event id, and risk indicator
 */
export function buildLogEmbed(opts: LogEventOptions, eventId: string, now: number): EmbedBuilder {
  // Resolve `author` alias for backward compat.
  const resolved = { ...opts, actor: opts.actor ?? opts.author };
  const fields: EmbedField[] = [];
  const tone = resolved.tone ?? toneForCategory(resolved.category);

  // Actor — only if known. Plain systems (e.g. RAID) are still attributed
  // to "Unknown" so the row is auditable rather than dropped.
  const actor = buildActorInfo(resolved.actor ?? undefined);
  if (actor) {
    const avatar = actor.avatar ? actor.avatar : undefined;
    fields.push({
      name: '👤 Actor',
      value: `<@${actor.id}>\n\`${actor.tag}\` • \`${actor.id}\`${avatar ? `\n[avatar](${avatar})` : ''}`,
      inline: true,
    });
  } else if (resolved.actor === null) {
    fields.push({ name: '👤 Actor', value: '`Unknown` (no executor resolved)', inline: true });
  }

  // Target — independent of actor.
  const target = buildActorInfo(resolved.target ?? undefined);
  if (target) {
    const avatar = target.avatar ? target.avatar : undefined;
    fields.push({
      name: '🎯 Target',
      value: `<@${target.id}>\n\`${target.tag}\` • \`${target.id}\`${avatar ? `\n[avatar](${avatar})` : ''}`,
      inline: true,
    });
  }

  // Channel + Time
  if (resolved.channelId) {
    fields.push({ name: '📍 Channel', value: `<#${resolved.channelId}>`, inline: true });
  }
  fields.push({ name: '🕒 Time', value: fmtTime(now), inline: false });

  if (resolved.caseId) {
    fields.push({ name: '📂 Case', value: `\`${resolved.caseId}\``, inline: true });
  }
  if (resolved.risk) {
    const riskEmoji = resolved.risk === 'CRITICAL' ? '🚨' : resolved.risk === 'HIGH' ? '🟥' : resolved.risk === 'MEDIUM' ? '🟧' : '🟩';
    fields.push({ name: '⚠️ Risk', value: `${riskEmoji} \`${resolved.risk}\``, inline: true });
  }

  if (resolved.fields && resolved.fields.length) {
    fields.push(...resolved.fields);
  }

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
 * Build and dispatch a Zeon-style log embed.
 *
 * Failure modes are swallowed and returned as `{ ok: false, reason }` so
 * logging itself never crashes the calling command/event.
 */
export async function logEvent(opts: LogEventOptions): Promise<SendResult> {
  const eventId = opts.eventId ?? generateEventId(opts.category);
  const now = timestamp();
  try {
    const guild = opts.client.guilds?.cache?.get(opts.guildId) ?? (await opts.client.guilds?.fetch(opts.guildId).catch(() => null));
    if (!guild) return { ok: false, eventId, reason: 'Guild not found' };

    const route = resolveLogChannel(opts, guild);
    if (!route) return { ok: false, eventId, reason: 'No log channel configured' };

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

    await (channel as any).send({ embeds: [embed], allowedMentions: { parse: [] } });
    return { ok: true, channelId: route.channelId, eventId };
  } catch (err) {
    return { ok: false, eventId, reason: (err as Error).message };
  }
}

/**
 * Plain text log for low-noise housekeeping events (e.g. cache warmup,
 * unknown actor notices). Routes via the same channel config as logEvent.
 */
export async function sendPlain(guildId: string, category: LogCategory, content: string, client: Client): Promise<SendResult> {
  const cfg = getLoggingConfig(guildId, category);
  if (!cfg.enabled || !cfg.channelId) return { ok: false, eventId: '-', reason: 'No log channel configured' };
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

/**
 * Convenience wrapper for events without a guild context but where the
 * caller still wants the structured embed (e.g. moderation cases).
 */
export function buildLogEmbedStandalone(opts: LogEventOptions): EmbedBuilder {
  const eventId = opts.eventId ?? generateEventId(opts.category);
  return buildLogEmbed(opts, eventId, timestamp());
}

/**
 * Used by the moderation case listing to render rows in a "who did
 * what to whom" format. Kept here so every log surface shares the same
 * vocabulary.
 */
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

/** Re-export for tests / embed builders. */
export const __internal = { buildLogEmbed, generateEventId, toneForCategory };
