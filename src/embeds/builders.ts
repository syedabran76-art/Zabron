/**
 * Zabron — Centralized Embed Design System.
 *
 * All user-facing embeds should be built using these helpers so that
 * branding, colors, footers and timestamps stay consistent across
 * moderation, security, logging, configuration and feature responses.
 *
 * Direct calls to `new EmbedBuilder()` from command files are discouraged
 * unless you need a fully custom embed. Prefer these helpers.
 *
 * The design system provides:
 *   - Semantic tone-based colors
 *   - Consistent status indicators (🟢 🟡 🔴 🔵 🛡 ⚙ etc.)
 *   - Formatting helpers (user, channel, role, duration, truncation)
 *   - Specialized builders (permissionError, moderationAction, etc.)
 *   - Reusable button rows (confirm/cancel)
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Channel,
  ColorResolvable,
  EmbedBuilder,
  EmbedField,
  Guild,
  Role,
  User,
} from 'discord.js';

// ============================================================================
// BRAND & COLORS
// ============================================================================

export const BRAND_NAME = 'Zabron';
/**
 * Bot tagline / one-line elevator pitch. Used in footers, embeds and
 * the bot's short description. Keep it short and capability-true.
 */
export const BOT_TAGLINE = 'Protect • Automate • Manage';
/**
 * Sub-tagline used in footer text — slightly more descriptive than
 * BOT_TAGLINE. Always paired with the brand name in `buildEmbed`.
 */
export const BRAND_TAGLINE = 'Protect • Automate • Manage';
export const BRAND_COLOR = 0x6c5ce7; // Primary brand purple

// Semantic palette
export const SUCCESS_COLOR = 0x2ecc71;
export const ERROR_COLOR   = 0xe74c3c;
export const WARNING_COLOR = 0xf39c12;
export const INFO_COLOR    = 0x3498db;
export const SECURITY_COLOR = 0xff3860;
export const MOD_COLOR     = 0x9b59b6;
export const CONFIG_COLOR  = 0x1abc9c;
export const LOG_COLOR     = 0x34495e;
export const TICKET_COLOR  = 0x16a085;
export const GIVEAWAY_COLOR = 0xe67e22;
export const LEVELING_COLOR = 0xf1c40f;
export const WELCOME_COLOR = 0x00cec9;
export const VOICE_COLOR   = 0x8e44ad;
export const AUTOMATION_COLOR = 0x2c3e50;
export const COMMUNITY_COLOR = 0x2980b9;
export const SYSTEM_COLOR  = 0x7f8c8d;
export const HELP_COLOR    = 0x6c5ce7;

// ============================================================================
// TONE SYSTEM
// ============================================================================

export type EmbedTone =
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
  | 'help'
  | 'voice'
  | 'automation'
  | 'community'
  | 'system';

const TONE_TO_COLOR: Record<EmbedTone, ColorResolvable> = {
  brand:       BRAND_COLOR,
  success:     SUCCESS_COLOR,
  error:       ERROR_COLOR,
  warning:     WARNING_COLOR,
  info:        INFO_COLOR,
  security:    SECURITY_COLOR,
  moderation:  MOD_COLOR,
  configuration: CONFIG_COLOR,
  log:         LOG_COLOR,
  ticket:      TICKET_COLOR,
  giveaway:    GIVEAWAY_COLOR,
  leveling:    LEVELING_COLOR,
  welcome:     WELCOME_COLOR,
  help:        HELP_COLOR,
  voice:       VOICE_COLOR,
  automation:  AUTOMATION_COLOR,
  community:   COMMUNITY_COLOR,
  system:      SYSTEM_COLOR,
};

const TONE_TO_INDICATOR: Record<EmbedTone, string> = {
  brand:       '◆',
  success:     '✓',
  error:       '✗',
  warning:     '⚠',
  info:        'ℹ',
  security:    '🛡',
  moderation:  '⚒',
  configuration: '⚙',
  log:         '📋',
  ticket:      '🎫',
  giveaway:    '🎉',
  leveling:    '📈',
  welcome:     '👋',
  help:        '📖',
  voice:       '🔊',
  automation:  '⚡',
  community:   '🌐',
  system:      '⚙',
};

// ============================================================================
// STATUS INDICATORS
// ============================================================================

/** Human-readable status values with emoji. */
export type StatusLevel = 'healthy' | 'degraded' | 'blocked' | 'unknown';

/** Colour-coded emoji for fast status scanning. */
export const STATUS_INDICATOR: Record<StatusLevel, string> = {
  healthy:  '🟢',
  degraded: '🟡',
  blocked:  '🔴',
  unknown:  '⚪',
};

/** Return the appropriate status level for a numeric latency in ms. */
export function wsStatus(wsLatency: number): StatusLevel {
  if (wsLatency < 0)   return 'unknown';
  if (wsLatency < 100)  return 'healthy';
  if (wsLatency < 250)  return 'degraded';
  return 'blocked';
}

/** Return the appropriate status level for a duration in ms. */
export function memoryStatus(usedMB: number): StatusLevel {
  if (usedMB < 200)  return 'healthy';
  if (usedMB < 500)  return 'degraded';
  return 'blocked';
}

// ============================================================================
// INTERFACE
// ============================================================================

export interface EmbedOptions {
  title?:       string;
  description?: string;
  fields?:     EmbedField[];
  author?:     { name: string; iconURL?: string };
  footer?:     string;
  imageURL?:   string;
  thumbnailURL?: string;
  url?:        string;
  timestamp?:  Date | number;
  tone?:       EmbedTone;
}

export interface BannerOptions extends EmbedOptions {
  /** Optional event ID shown in footer (e.g. SEC-1042). */
  eventId?: string;
}

// ============================================================================
// CORE BUILDERS
// ============================================================================

/**
 * Build an embed using the Zabron design system.
 *
 * The returned embed is plain — callers may extend it further with
 * Discord-native components if required.
 */
export function buildEmbed(options: EmbedOptions = {}): EmbedBuilder {
  const tone = options.tone ?? 'brand';
  const embed = new EmbedBuilder().setColor(TONE_TO_COLOR[tone]);

  if (options.title) {
    embed.setTitle(`${TONE_TO_INDICATOR[tone]} ${options.title}`);
  }

  if (options.description) {
    embed.setDescription(options.description);
  }

  if (options.fields && options.fields.length) {
    embed.setFields(options.fields);
  }

  if (options.author) {
    embed.setAuthor({ name: options.author.name, iconURL: options.author.iconURL });
  }

  if (options.imageURL) {
    embed.setImage(options.imageURL);
  }

  if (options.thumbnailURL) {
    embed.setThumbnail(options.thumbnailURL);
  }

  if (options.url) {
    embed.setURL(options.url);
  }

  const footer = options.footer
    ? `${options.footer} • ${BRAND_NAME}`
    : `${BRAND_NAME} • ${BRAND_TAGLINE}`;
  embed.setFooter({ text: footer });
  embed.setTimestamp(options.timestamp ? new Date(options.timestamp) : new Date());

  return embed;
}

/**
 * Standardised banner-style embed for log, security and event embeds.
 *
 * Includes an "Action / Actor / Target / Time / Event ID" header so
 * each log line reads like a real SOC dashboard row.
 */
export function buildBanner(opts: BannerOptions = {}): EmbedBuilder {
  const tone = opts.tone ?? 'log';
  const embed = buildEmbed({
    title: opts.title,
    description: opts.description,
    fields: opts.fields,
    author: opts.author,
    imageURL: opts.imageURL,
    thumbnailURL: opts.thumbnailURL,
    url: opts.url,
    tone,
  });

  const footerText = opts.eventId
    ? `Event ${opts.eventId} • ${BRAND_NAME}`
    : `${BRAND_NAME} • ${BRAND_TAGLINE}`;
  embed.setFooter({ text: footerText });

  return embed;
}

// ============================================================================
// HIGH-LEVEL TONE BUILDERS
// ============================================================================

export function success(      title: string, description?: string): EmbedBuilder {
  return buildEmbed({ title, description, tone: 'success' });
}
export function error(        title: string, description?: string): EmbedBuilder {
  return buildEmbed({ title, description, tone: 'error' });
}
export function warning(      title: string, description?: string): EmbedBuilder {
  return buildEmbed({ title, description, tone: 'warning' });
}
export function info(         title: string, description?: string): EmbedBuilder {
  return buildEmbed({ title, description, tone: 'info' });
}
export function security(     title: string, description?: string, eventId?: string): EmbedBuilder {
  return buildBanner({ title, description, tone: 'security', eventId });
}
export function moderation(   title: string, description?: string): EmbedBuilder {
  return buildEmbed({ title, description, tone: 'moderation' });
}
export function modAction(    title: string, description?: string): EmbedBuilder {
  return buildEmbed({ title, description, tone: 'moderation' });
}
export function log(         title: string, description?: string): EmbedBuilder {
  return buildEmbed({ title, description, tone: 'log' });
}
export function configuration(title: string, description?: string): EmbedBuilder {
  return buildEmbed({ title, description, tone: 'configuration' });
}
export function config(       title: string, description?: string): EmbedBuilder {
  return buildEmbed({ title, description, tone: 'configuration' });
}
export function ticket(       title: string, description?: string): EmbedBuilder {
  return buildEmbed({ title, description, tone: 'ticket' });
}
export function giveaway(     title: string, description?: string): EmbedBuilder {
  return buildEmbed({ title, description, tone: 'giveaway' });
}
export function leveling(     title: string, description?: string): EmbedBuilder {
  return buildEmbed({ title, description, tone: 'leveling' });
}
export function welcome(      title: string, description?: string): EmbedBuilder {
  return buildEmbed({ title, description, tone: 'welcome' });
}
export function help(         title: string, description?: string): EmbedBuilder {
  return buildEmbed({ title, description, tone: 'help' });
}
export function voice(        title: string, description?: string): EmbedBuilder {
  return buildEmbed({ title, description, tone: 'voice' });
}
export function automation(   title: string, description?: string): EmbedBuilder {
  return buildEmbed({ title, description, tone: 'automation' });
}
export function community(   title: string, description?: string): EmbedBuilder {
  return buildEmbed({ title, description, tone: 'community' });
}
export function system(       title: string, description?: string): EmbedBuilder {
  return buildEmbed({ title, description, tone: 'system' });
}

// ============================================================================
// FORMATTERS — safe, reusable text formatting
// ============================================================================

/**
 * Safely truncate a string to `maxLen` characters, appending `suffix` if cut.
 * Discord embed fields cap at 1024 chars per value; descriptions at 4096.
 */
export function truncate(str: string, maxLen: number, suffix = '…'): string {
  if (!str || str.length <= maxLen) return str;
  return str.slice(0, Math.max(0, maxLen - suffix.length)) + suffix;
}

/** Discord mention string for a user. */
export function mentionUser(user: User | { id: string }): string {
  return `<@${user.id}>`;
}

/** Plain tag string for a user (username#discriminator). */
export function tagUser(user: User | { tag?: string; username?: string; id: string }): string {
  if ('tag' in user && user.tag) return user.tag;
  if ('username' in user && user.username) return `${user.username}#0000`;
  return user.id;
}

/** Channel mention or fallback to channel name. */
export function mentionChannel(channel: { id: string; name?: string }): string {
  return `<#${channel.id}>`;
}

/** Human-readable channel name with hash prefix. */
export function nameChannel(channel: { name?: string; id: string }): string {
  return `#${channel.name ?? channel.id}`;
}

/** Role mention or fallback to role name. */
export function mentionRole(role: { id: string; name?: string }): string {
  return `<@&${role.id}>`;
}

/** Human-readable role name. */
export function nameRole(role: { name?: string; id: string }): string {
  return role.name ?? `@${role.id}`;
}

/** Format a millisecond duration into a readable string. */
export function fmtDuration(ms: number): string {
  if (ms <= 0) return '0 seconds';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  const parts: string[] = [];
  if (d > 0)   parts.push(`${d}d`);
  if (h % 24 > 0) parts.push(`${h % 24}h`);
  if (m % 60 > 0 && d === 0) parts.push(`${m % 60}m`);
  if (s % 60 > 0 && h === 0) parts.push(`${s % 60}s`);
  if (!parts.length) parts.push('0s');
  return parts.join(' ');
}

/**
 * Format a millisecond uptime into a compact "Nd Nh Nm" string suitable
 * for status dashboard displays.
 */
export function fmtUptime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  return fmtDuration(ms);
}

/**
 * Compose a status dashboard row for `WebSocket / Uptime / Memory / Guilds`.
 * Returns the array of fields used by `pingResult()`.
 *
 * Every metric is rendered with a semantic status indicator. Negative or
 * non-finite latency values are NEVER shown as raw numbers — they become
 * `—` so the user never sees `-1ms`.
 */
export interface PingMetrics {
  wsLatency: number;
  uptimeMs:  number;
  memoryMB:  number;
  guildCount: number;
}

export function pingFields(metrics: PingMetrics): EmbedField[] {
  const ws = fmtLatency(metrics.wsLatency);
  const mem = fmtMemory(metrics.memoryMB);
  const guildKnown = Number.isFinite(metrics.guildCount) && metrics.guildCount >= 0;
  return [
    { name: '💓 WebSocket', value: `${STATUS_INDICATOR[ws.status]} \`${ws.display}\``, inline: true },
    { name: '⏱ Uptime',    value: `\`${fmtUptime(metrics.uptimeMs)}\``, inline: true },
    { name: '💾 Memory',    value: `${STATUS_INDICATOR[mem.status]} \`${mem.display}\``, inline: true },
    { name: '🌐 Servers',   value: guildKnown ? `\`${metrics.guildCount}\`` : '`—`', inline: true },
  ];
}

// ============================================================================
// SPECIALIZED BUILDERS
// ============================================================================

/**
 * Consistent permission error embed.
 *
 * Shows the action, who tried it, and the required permission(s).
 * Never exposes stack traces or internal details.
 */
export function permissionError(
  required: string | string[],
  action?: string,
): EmbedBuilder {
  const perms = Array.isArray(required) ? required : [required];
  const permLines = perms.map((p) => `\`${p}\``).join(', ');
  const title = '🛡 Permission required';
  const description = action
    ? `You need ${permLines} to ${action}.`
    : `You need ${permLines} to perform this action.`;
  return buildEmbed({ title, description, tone: 'error' });
}

/**
 * Consistent moderation action confirmation embed.
 *
 * Shows: action, target, moderator, reason (when given), duration (when applicable),
 * and the case ID — all in a structured, readable layout.
 */
export function moderationAction(opts: {
  action:      string;
  target:      { id: string; tag: string };
  moderator:   { id: string; tag: string };
  reason?:     string | null;
  duration?:   string | null;
  caseId:      string;
  /** Extra fields appended to the embed (e.g. "Total warnings: 3"). */
  extraFields?: EmbedField[];
  /** Optional description override. Defaults to "<@target> <action>." */
  description?: string;
}): EmbedBuilder {
  const fields: EmbedField[] = [
    { name: 'Action',    value: opts.action,                              inline: true },
    { name: 'Target',    value: `${mentionUser(opts.target)} (${truncate(opts.target.tag, 32)})\n\`${opts.target.id}\``, inline: true },
    { name: 'Moderator', value: `${mentionUser(opts.moderator)}\n\`${opts.moderator.id}\``, inline: true },
  ];
  if (opts.reason) {
    fields.push({ name: 'Reason', value: truncate(opts.reason, 1024), inline: false });
  }
  if (opts.duration) {
    fields.push({ name: 'Duration', value: opts.duration, inline: true });
  }
  fields.push({ name: 'Case', value: `\`${opts.caseId}\``, inline: true });
  if (opts.extraFields?.length) {
    fields.push(...opts.extraFields);
  }

  return buildEmbed({
    title: opts.action,
    description: opts.description ?? `${mentionUser(opts.target)} ${opts.action.toLowerCase()}d.`,
    fields,
    tone: 'moderation',
    timestamp: Date.now(),
  });
}

/**
 * Security alert embed — for antinuke, antiraid, automod events.
 *
 * Shows: event title, actor, target (when applicable), action taken,
 * risk level, and the security event ID.
 */
export function securityAlert(opts: {
  title:     string;
  description?: string;
  eventId:   string;
  risk:      'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  actor?:    { id: string; tag: string } | null;
  target?:   { id: string; tag: string } | null;
  action?:   string;
  fields?:   EmbedField[];
}): EmbedBuilder {
  const fields: EmbedField[] = [];

  if (opts.actor) {
    fields.push({
      name: '👤 Actor',
      value: `${mentionUser(opts.actor)}\n\`${opts.actor.tag}\`\n\`${opts.actor.id}\``,
      inline: true,
    });
  }

  if (opts.target) {
    fields.push({
      name: '🎯 Target',
      value: `${mentionUser(opts.target)}\n\`${opts.target.tag}\`\n\`${opts.target.id}\``,
      inline: true,
    });
  }

  if (opts.action) {
    fields.push({ name: '⚠️ Action', value: opts.action, inline: true });
  }

  const riskEmoji = opts.risk === 'CRITICAL' ? '🚨' : opts.risk === 'HIGH' ? '🔴' : opts.risk === 'MEDIUM' ? '🟡' : '🟢';
  fields.push({ name: '⚠️ Risk', value: `${riskEmoji} \`${opts.risk}\``, inline: true });
  fields.push({ name: '🕒 Time', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true });

  if (opts.fields?.length) {
    fields.push(...opts.fields);
  }

  const embed = buildBanner({
    title: opts.title,
    description: opts.description,
    fields,
    tone: 'security',
    eventId: opts.eventId,
  });

  embed.setFooter({
    text: `Event ${opts.eventId} • risk: ${opts.risk} • ${BRAND_NAME}`,
  });

  return embed;
}

/**
 * Configuration change embed — shows setting, previous value, new value, and actor.
 */
export function configChange(opts: {
  setting:   string;
  previous?: string | null;
  current:   string;
  actor:     { id: string; tag: string };
}): EmbedBuilder {
  const fields: EmbedField[] = [
    { name: 'Setting', value: opts.setting, inline: true },
    { name: 'New value', value: truncate(opts.current, 1024), inline: true },
  ];
  if (opts.previous !== undefined && opts.previous !== null) {
    fields.push({ name: 'Previous', value: truncate(opts.previous, 1024), inline: true });
  }
  fields.push({ name: 'Changed by', value: `${mentionUser(opts.actor)}\n\`${opts.actor.id}\``, inline: false });

  return buildEmbed({
    title: `⚙ ${opts.setting}`,
    description: `Updated to **${truncate(opts.current, 100)}**`,
    fields,
    tone: 'configuration',
    timestamp: Date.now(),
  });
}

/**
 * Success confirmation for a completed action.
 */
export function actionDone(opts: {
  action:   string;
  target?:  string;
  detail?:  string;
}): EmbedBuilder {
  const description = [opts.target ? `${opts.target} — ${opts.action}d.` : `${opts.action}d.`, opts.detail].filter(Boolean).join('\n');
  return buildEmbed({ title: `✓ ${opts.action}`, description, tone: 'success' });
}

/**
 * Format a WebSocket latency (ms) into a safe display value.
 *
 * Discord.js returns -1 when the heartbeat is unavailable, and may also
 * return `NaN` or extremely large numbers. We never surface those values
 * directly — we represent them as `—` and mark the status unknown.
 */
export function fmtLatency(ms: number): { display: string; known: boolean; status: StatusLevel } {
  if (!Number.isFinite(ms) || ms < 0) {
    return { display: '—', known: false, status: 'unknown' };
  }
  const rounded = Math.round(ms);
  return { display: `${rounded}ms`, known: true, status: wsStatus(rounded) };
}

/**
 * Format a memory usage in MB into a safe display value.
 */
export function fmtMemory(mb: number): { display: string; status: StatusLevel } {
  if (!Number.isFinite(mb) || mb < 0) {
    return { display: '—', status: 'unknown' as StatusLevel };
  }
  const rounded = Math.round(mb);
  return { display: `${rounded}MB`, status: memoryStatus(rounded) };
}

/**
 * Compute the overall system health from the individual subsystem
 * statuses. A single `blocked` subsystem degrades the whole system.
 */
function aggregateStatus(...statuses: StatusLevel[]): StatusLevel {
  if (statuses.includes('blocked'))  return 'blocked';
  if (statuses.includes('degraded')) return 'degraded';
  if (statuses.includes('unknown') && statuses.length > 1) return 'degraded';
  if (statuses.every((s) => s === 'unknown')) return 'unknown';
  return 'healthy';
}

/**
 * Ping / diagnostic embed with semantic status indicators.
 *
 * Acts as a polished status dashboard: it never displays a negative or
 * unavailable latency as `-1ms`. Any unavailable metric is rendered as
 * `—` and the overall status badge is computed from the individual
 * subsystems.
 *
 * Layout:
 *   - Title:   "🏓 Pong {indicator} {HealthLabel}"
 *   - Desc:    one-line health snapshot + per-subsystem status list
 *   - Fields:  WebSocket / Uptime / Memory / Servers
 *   - Footer:  eventId / brand (centralized)
 *
 * Two call signatures are supported:
 *   - Legacy: `uptime` as a pre-formatted string.
 *   - Preferred: `uptimeMs` so formatting stays centralized.
 */
export function pingResult(opts: {
  wsLatency:  number;
  uptime:     string;
  memoryMB:   number;
  guildCount: number;
}): EmbedBuilder;
export function pingResult(opts: {
  wsLatency:  number;
  uptimeMs:   number;
  memoryMB:   number;
  guildCount: number;
}): EmbedBuilder;
export function pingResult(opts: any): EmbedBuilder {
  const uptimeMs: number = typeof opts.uptimeMs === 'number'
    ? opts.uptimeMs
    : Number.isFinite(opts.uptime)
      ? Number(opts.uptime)
      : 0;
  const metrics: PingMetrics = {
    wsLatency: opts.wsLatency,
    uptimeMs,
    memoryMB: opts.memoryMB,
    guildCount: opts.guildCount,
  };
  const ws = fmtLatency(metrics.wsLatency);
  const mem = fmtMemory(metrics.memoryMB);
  const overall = aggregateStatus(ws.status, mem.status);
  const overallEmoji = STATUS_INDICATOR[overall];
  const overallLabel = overall.charAt(0).toUpperCase() + overall.slice(1);

  const fields = pingFields(metrics);

  // Inline subsystem summary — keeps users informed at a glance without
  // duplicating the indicator on every row.
  const subParts: string[] = [];
  subParts.push(`${STATUS_INDICATOR[ws.status]} **WebSocket** — ${ws.status === 'unknown' ? 'awaiting heartbeat' : ws.display}`);
  subParts.push(`${STATUS_INDICATOR[mem.status]} **Memory** — ${mem.display}`);
  subParts.push(`${overallEmoji} **System** — ${overallLabel}`);

  const description =
    overall === 'healthy'  ? 'All systems operational.' :
    overall === 'degraded' ? 'Some subsystems are degraded.' :
    overall === 'blocked'  ? 'At least one subsystem is blocked.' :
                             'Status unavailable.';

  const tone: EmbedTone =
    overall === 'healthy' ? 'success' :
    overall === 'degraded' ? 'warning' :
    overall === 'blocked'  ? 'error'   :
                             'system';

  return buildEmbed({
    title: `🏓 Pong — ${overallEmoji} ${overallLabel}`,
    description: `${description}\n${subParts.join('  ·  ')}`,
    fields,
    tone,
    timestamp: Date.now(),
  });
}

// ============================================================================
// ACTION / AFK SPECIALIZED BUILDERS
// ============================================================================

/**
 * Build an AFK-state change embed.
 *
 * Tells the user (or other server members) that AFK mode was enabled
 * with a specific reason, and displays when it was activated.
 */
export function afkStatus(opts: {
  enabled:    boolean;
  user:       { id: string; tag: string };
  reason?:    string | null;
  since?:     number;
  /** When true the embed is rendered as a "viewing someone else's AFK" panel. */
  view?: boolean;
}): EmbedBuilder {
  if (!opts.enabled) {
    const isView = !!opts.view;
    return buildEmbed({
      title: isView ? '🟢 User is active' : '🟢 AFK cleared',
      description: isView
        ? `${mentionUser(opts.user)} is currently active.`
        : `${mentionUser(opts.user)} is back.`,
      fields: [
        { name: 'State', value: '🟢 Active', inline: true },
      ],
      tone: 'success',
    });
  }
  const sinceUnix = Math.floor((opts.since ?? Date.now()) / 1000);
  const fields: EmbedField[] = [
    { name: 'State',  value: opts.view ? '🌙 AFK' : '🌙 AFK enabled', inline: true },
    { name: 'Since',  value: `<t:${sinceUnix}:R>`, inline: true },
    { name: 'Reason', value: opts.reason?.trim() ? truncate(opts.reason, 1024) : '*No reason given*', inline: false },
  ];
  return buildEmbed({
    title: opts.view ? `${opts.user.tag} is AFK` : '🌙 AFK enabled',
    description: opts.view
      ? `${mentionUser(opts.user)} has been away since <t:${sinceUnix}:R>.`
      : `${mentionUser(opts.user)} is now away. You'll be pinged when they return.`,
    fields,
    tone: 'info',
    timestamp: opts.since ?? Date.now(),
  });
}

/**
 * Build a "no results / empty state" embed that can be used by any list
 * command. The embed clearly explains *why* it's empty and what the
 * user can do to populate it.
 */
export function emptyState(opts: {
  title:   string;
  message: string;
  tone?:   EmbedTone;
}): EmbedBuilder {
  return buildEmbed({
    title: opts.title,
    description: opts.message,
    fields: [
      { name: 'Status', value: '⚪ Empty', inline: true },
      { name: 'Count',  value: '`0`',     inline: true },
    ],
    tone: opts.tone ?? 'info',
  });
}

/**
 * Build a "list with header summary" embed. Suitable for any command
 * that returns N items + a count + a short empty-state fall-back.
 *
 * `items` is rendered through `paginateList()` and shown alongside a
 * summary block (total count + filter description). When `items.length
 * === 0` the embed becomes an empty-state.
 */
export function listResult(opts: {
  title:     string;
  items:     string[];
  summary?:  string;
  perPage?:  number;
  tone?:     EmbedTone;
}): EmbedBuilder {
  const tone = opts.tone ?? 'info';
  const count = opts.items.length;
  if (count === 0) {
    return emptyState({
      title: opts.title,
      message: opts.summary ? `${opts.summary}\n\nThere are no entries to display.` : 'There are no entries to display.',
      tone,
    });
  }
  const fields: EmbedField[] = paginateList(opts.items, { title: opts.title, perPage: opts.perPage ?? 10 });
  // Replace the first field's name with "Count" → "Items (N)" pattern.
  const header: EmbedField = { name: '📋 Summary', value: opts.summary ? `${opts.summary}\n**Count:** \`${count}\`` : `**Count:** \`${count}\``, inline: false };
  return buildEmbed({
    title: opts.title,
    fields: [header, ...fields],
    tone,
  });
}

// ============================================================================
// REUSABLE BUTTON ROWS
// ============================================================================

export function confirmRow(customIdPrefix: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${customIdPrefix}:confirm`)
      .setLabel('Confirm')
      .setStyle(ButtonStyle.Success)
      .setEmoji('✓'),
    new ButtonBuilder()
      .setCustomId(`${customIdPrefix}:cancel`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('✗'),
  );
}

export function linkButton(url: string, label: string): ButtonBuilder {
  return new ButtonBuilder()
    .setURL(url)
    .setLabel(label)
    .setStyle(ButtonStyle.Link);
}

// ============================================================================
// LIST HELPERS
// ============================================================================

/**
 * Paginate a list of strings into embed fields (max 10 items per field block).
 * Returns an array of fields suitable for buildEmbed().
 */
export function paginateList(
  items: string[],
  { title = 'Results', perPage = 10 }: { title?: string; perPage?: number } = {},
): EmbedField[] {
  if (!items.length) {
    return [{ name: title, value: 'No results.', inline: false }];
  }
  const fields: EmbedField[] = [];
  for (let i = 0; i < items.length; i += perPage) {
    const slice = items.slice(i, i + perPage);
    const num = Math.floor(i / perPage) + 1;
    const pageCount = Math.ceil(items.length / perPage);
    const label = pageCount > 1 ? `${title} (page ${num}/${pageCount})` : title;
    fields.push({ name: label, value: slice.join('\n'), inline: false });
  }
  return fields;
}

/**
 * Build a numbered list field with consistent formatting.
 */
export function numberedList(
  items: Array<{ label: string; value: string }>,
  { maxLen = 1024 }: { maxLen?: number } = {},
): EmbedField[] {
  if (!items.length) {
    return [{ name: 'Results', value: 'No results.', inline: false }];
  }
  let content = items
    .map((item, i) => `**${i + 1}.** ${item.label}${item.value ? ` — ${item.value}` : ''}`)
    .join('\n');
  if (content.length > maxLen) {
    content = truncate(content, maxLen);
  }
  return [{ name: 'Results', value: content, inline: false }];
}

// ============================================================================
// ONBOARDING & MENTION BUILDERS
// ============================================================================

/**
 * Build the polished welcome embed sent to a guild right after the bot
 * joins (`GuildCreate`).
 *
 * Layout contract:
 *   - Title:    "Welcome to Zabron!"
 *   - Desc:     "Protect • Automate • Manage" + value proposition
 *   - Fields:   Getting Started / Setup / Prefix / Support
 *   - Footer:   brand + tagline (centralized)
 *   - Tone:     'welcome' (uses WELCOME_COLOR)
 *
 * The actual guild prefix is passed in by the caller — it is read from
 * the repository at call time so the embed always shows the prefix
 * users can actually use. We never assume a hardcoded prefix.
 *
 * `supportUrl` is optional: when omitted the Support field simply
 * renders "Not configured" so the rest of the embed stays usable.
 *
 * Returned embed uses the existing tone/indicator system; no custom
 * styles are introduced here.
 */
export function welcomeEmbed(opts: {
  guildName: string;
  /** The actual guild prefix from the repository (never hardcoded). */
  prefix: string;
  /**
   * Optional pre-validated support server URL. When omitted or empty,
   * the Support field renders "Not configured" and the caller skips
   * adding a Support button row.
   */
  supportUrl?: string | null;
}): EmbedBuilder {
  // Falsy-coerce: empty string, null, undefined all fall back to ".".
  // The repository always returns a non-empty string, but defensive
  // coercion here keeps the embed correct even if a future caller
  // forgets to validate.
  const prefix = ((opts.prefix && opts.prefix.length > 0) ? opts.prefix : '.').slice(0, 16);
  const guildName = (opts.guildName ?? 'this server').slice(0, 96);
  const supportConfigured = !!opts.supportUrl && opts.supportUrl.trim().length > 0;

  const description =
    `Thanks for adding ${BRAND_NAME} to **${guildName}**!\n\n` +
    `${BRAND_TAGLINE}\n\n` +
    `I provide everything your community needs to stay safe, organized, ` +
    `and engaged — moderation, security, automation, and community ` +
    `management tools in one cohesive bot.`;

  const fields: EmbedField[] = [
    {
      name: '🚀 Getting Started',
      value:
        `Run \`/help\` to browse every command, or check \`${prefix}help\` for ` +
        `the full legacy command list.`,
      inline: false,
    },
    {
      name: '⚙️ Setup',
      value:
        `Run \`/setup\` to configure welcome messages, logging channels, ` +
        `automod, antinuke and more — all in one guided flow.`,
      inline: false,
    },
    {
      name: '🔧 Prefix',
      value:
        `Your server prefix is \`${prefix}\`. You can change it any time ` +
        `with \`/prefix set ${prefix}:new.prefix\`.`,
      inline: true,
    },
    {
      name: '💬 Support',
      value: supportConfigured
        ? 'Join the official support server for help, updates, and feedback.'
        : 'Support server not configured by the bot owner yet.',
      inline: true,
    },
  ];

  return buildEmbed({
    title: `Welcome to ${BRAND_NAME}!`,
    description,
    fields,
    tone: 'welcome',
    timestamp: Date.now(),
  });
}

/**
 * Build the polished reply sent when a user directly mentions Zabron
 * (`<@BOT_ID>` / `@Zabron`).
 *
 * Layout contract:
 *   - Title:    "👋 Hey! I'm Zabron."
 *   - Desc:     short value proposition + how to get help
 *   - Fields:   Commands / Prefix / Support
 *   - Tone:     'info' (uses INFO_COLOR)
 *
 * `supportUrl` controls whether the Support field mentions the
 * configured invite link textually; the caller decides whether to add
 * a Link button row.
 */
export function mentionHelpEmbed(opts: {
  /** The actual guild prefix from the repository. */
  prefix: string;
  /** Optional pre-validated support server URL. */
  supportUrl?: string | null;
}): EmbedBuilder {
  // Falsy-coerce: empty string, null, undefined all fall back to ".".
  const prefix = ((opts.prefix && opts.prefix.length > 0) ? opts.prefix : '.').slice(0, 16);
  const supportConfigured = !!opts.supportUrl && opts.supportUrl.trim().length > 0;

  const description =
    `Use \`/help\` to explore my commands.\n` +
    `Your server prefix is \`${prefix}\` — you can also use \`${prefix}help\`.`;

  const fields: EmbedField[] = [
    {
      name: '📖 Commands',
      value: `Run \`/help\` to see every command, or \`${prefix}help\` for the legacy list.`,
      inline: false,
    },
    {
      name: '⚙️ Setup',
      value: `Run \`/setup\` to configure moderation, logging, automod and more.`,
      inline: false,
    },
    {
      name: '💬 Support',
      value: supportConfigured
        ? 'Join the Zabron Support Server for help and updates.'
        : 'Support server is not configured by the bot owner yet.',
      inline: true,
    },
  ];

  return buildEmbed({
    title: `👋 Hey! I'm ${BRAND_NAME}.`,
    description,
    fields,
    tone: 'info',
    timestamp: Date.now(),
  });
}

/**
 * Build the optional button row containing the Support button.
 *
 * Returns `null` when no URL is configured so callers can skip adding
 * a row at all (Discord rejects empty ActionRows).
 */
export function supportButtonRow(opts: {
  supportUrl: string | null;
  label?: string;
}): ActionRowBuilder<ButtonBuilder> | null {
  if (!opts.supportUrl) return null;
  const label = (opts.label ?? `💬 Support Server`).slice(0, 80);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    linkButton(opts.supportUrl, label),
  );
}
