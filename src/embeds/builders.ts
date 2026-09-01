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
export const BRAND_TAGLINE = 'Server Operating System';
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

  return buildEmbed({
    title: opts.action,
    description: `${mentionUser(opts.target)} ${opts.action.toLowerCase()}d.`,
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
 * Ping / diagnostic embed with semantic status indicators.
 */
export function pingResult(opts: {
  wsLatency:     number;
  uptime:        string;
  memoryMB:      number;
  guildCount:    number;
}): EmbedBuilder {
  const ws = wsStatus(opts.wsLatency);
  const mem = memoryStatus(opts.memoryMB);

  const fields: EmbedField[] = [
    { name: '💓 WebSocket', value: `\`${opts.wsLatency}ms\` — ${STATUS_INDICATOR[ws]} ${ws}`, inline: true },
    { name: '⏱ Uptime',    value: opts.uptime, inline: true },
    { name: '💾 Memory',    value: `\`${opts.memoryMB}MB\` — ${STATUS_INDICATOR[mem]} ${mem}`, inline: true },
    { name: '🌐 Servers',  value: String(opts.guildCount), inline: true },
  ];

  return buildEmbed({
    title: '🏓 Pong',
    description: `All systems operational.`,
    fields,
    tone: ws === 'blocked' ? 'warning' : ws === 'degraded' ? 'warning' : 'success',
    timestamp: Date.now(),
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
