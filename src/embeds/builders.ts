/**
 * Zabron — Centralized Embed Design System.
 *
 * All user-facing embeds should be built using these helpers so that
 * branding, colors, footers and timestamps stay consistent across
 * moderation, security, logging, configuration and feature responses.
 *
 * Direct calls to `new EmbedBuilder()` from command files are discouraged.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ColorResolvable,
  EmbedBuilder,
  EmbedField,
} from 'discord.js';

export const BRAND_NAME = 'Zabron';
export const BRAND_TAGLINE = 'Server Operating System';
export const BRAND_COLOR = 0x6c5ce7; // Primary brand purple
export const SUCCESS_COLOR = 0x2ecc71;
export const ERROR_COLOR = 0xe74c3c;
export const WARNING_COLOR = 0xf39c12;
export const INFO_COLOR = 0x3498db;
export const SECURITY_COLOR = 0xff3860;
export const MOD_COLOR = 0x9b59b6;
export const CONFIG_COLOR = 0x1abc9c;
export const LOG_COLOR = 0x34495e;
export const TICKET_COLOR = 0x16a085;
export const GIVEAWAY_COLOR = 0xe67e22;
export const LEVELING_COLOR = 0xf1c40f;
export const WELCOME_COLOR = 0x00cec9;
export const HELP_COLOR = 0x6c5ce7;

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
  | 'help';

const TONE_TO_COLOR: Record<EmbedTone, ColorResolvable> = {
  brand: BRAND_COLOR,
  success: SUCCESS_COLOR,
  error: ERROR_COLOR,
  warning: WARNING_COLOR,
  info: INFO_COLOR,
  security: SECURITY_COLOR,
  moderation: MOD_COLOR,
  configuration: CONFIG_COLOR,
  log: LOG_COLOR,
  ticket: TICKET_COLOR,
  giveaway: GIVEAWAY_COLOR,
  leveling: LEVELING_COLOR,
  welcome: WELCOME_COLOR,
  help: HELP_COLOR,
};

const TONE_TO_INDICATOR: Record<EmbedTone, string> = {
  brand: '◆',
  success: '✓',
  error: '✗',
  warning: '⚠',
  info: 'ℹ',
  security: '🛡',
  moderation: '⚒',
  configuration: '⚙',
  log: '📋',
  ticket: '🎫',
  giveaway: '🎉',
  leveling: '📈',
  welcome: '👋',
  help: '📖',
};

export interface EmbedOptions {
  title?: string;
  description?: string;
  fields?: EmbedField[];
  author?: { name: string; iconURL?: string };
  footer?: string;
  imageURL?: string;
  thumbnailURL?: string;
  url?: string;
  timestamp?: Date | number;
  tone?: EmbedTone;
}

export interface BannerOptions extends EmbedOptions {
  /** Optional event ID shown in footer (e.g. SEC-1042). */
  eventId?: string;
}

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

// ---------- High-level builders used across the codebase ----------

export function success(title: string, description?: string): EmbedBuilder {
  return buildEmbed({ title, description, tone: 'success' });
}

export function error(title: string, description?: string): EmbedBuilder {
  return buildEmbed({ title, description, tone: 'error' });
}

export function warning(title: string, description?: string): EmbedBuilder {
  return buildEmbed({ title, description, tone: 'warning' });
}

export function info(title: string, description?: string): EmbedBuilder {
  return buildEmbed({ title, description, tone: 'info' });
}

export function security(title: string, description?: string, eventId?: string): EmbedBuilder {
  return buildBanner({ title, description, tone: 'security', eventId });
}

export function moderation(title: string, description?: string): EmbedBuilder {
  return buildEmbed({ title, description, tone: 'moderation' });
}

export function log(title: string, description?: string): EmbedBuilder {
  return buildEmbed({ title, description, tone: 'log' });
}

export function configuration(title: string, description?: string): EmbedBuilder {
  return buildEmbed({ title, description, tone: 'configuration' });
}

export function ticket(title: string, description?: string): EmbedBuilder {
  return buildEmbed({ title, description, tone: 'ticket' });
}

export function giveaway(title: string, description?: string): EmbedBuilder {
  return buildEmbed({ title, description, tone: 'giveaway' });
}

export function leveling(title: string, description?: string): EmbedBuilder {
  return buildEmbed({ title, description, tone: 'leveling' });
}

export function welcome(title: string, description?: string): EmbedBuilder {
  return buildEmbed({ title, description, tone: 'welcome' });
}

export function help(title: string, description?: string): EmbedBuilder {
  return buildEmbed({ title, description, tone: 'help' });
}

// ---------- Reusable buttons ----------

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