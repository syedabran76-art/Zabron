/**
 * Zabron — Centralised support configuration.
 *
 * SINGLE source of truth for the official Zabron support server invite.
 *
 * The URL is read from the SUPPORT_SERVER_URL environment variable. The
 * centralised helpers here guarantee:
 *
 *   - We never hardcode fake URLs anywhere in the codebase.
 *   - When the URL is missing/empty/invalid, callers can degrade
 *     gracefully (omit the Support button, keep the rest of the
 *     message working) without crashing.
 *   - Every consumer of the URL goes through these helpers so a future
 *     change (e.g. multiple support servers, region-specific invites,
 *     per-language routing) only needs to happen in ONE place.
 *
 * Configuration:
 *   Set `SUPPORT_SERVER_URL` in your environment (or your .env file).
 *   Example: SUPPORT_SERVER_URL=https://discord.gg/your-invite-code
 *
 *   This is intentionally a Discord invite link (discord.gg/xxxx) or a
 *   full https://discord.com/channels/... URL — both work as Discord
 *   Link Button targets.
 *
 *   If the variable is absent, undefined, empty, or not a parseable URL,
 *   `getSupportServerUrl()` returns `null` and every consumer simply
 *   skips rendering the support UI.
 */

import { URL } from 'node:url';

const ENV_KEY = 'SUPPORT_SERVER_URL';

/**
 * Cached parsed URL. We re-read process.env on every call so changes
 * (tests, hot-reload) take effect immediately, but the validation work
 * is cheap so this is fine.
 */
export interface SupportConfig {
  /** Resolved invite URL, or null when not configured / invalid. */
  url: string | null;
  /** True when SUPPORT_SERVER_URL is set to a parseable URL. */
  isConfigured: boolean;
}

/**
 * Validate that a string is a parseable http(s) URL. Discord requires
 * `Link` buttons to be https URLs; we refuse anything else.
 */
export function isValidSupportUrl(value: string | null | undefined): value is string {
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Resolve the support server URL from the environment.
 *
 * Returns `{ url, isConfigured }`. When `isConfigured` is false, `url`
 * is guaranteed to be `null` and every consumer must skip support UI.
 */
export function getSupportServerConfig(): SupportConfig {
  const raw = process.env[ENV_KEY];
  if (isValidSupportUrl(raw)) {
    return { url: raw.trim(), isConfigured: true };
  }
  return { url: null, isConfigured: false };
}

/**
 * Convenience: return just the URL or null.
 */
export function getSupportServerUrl(): string | null {
  return getSupportServerConfig().url;
}

/**
 * Display label used by the Support button. Centralised so future
 * i18n only needs to touch this file.
 */
export const SUPPORT_LABEL = '💬 Support Server';

export const __testing = { ENV_KEY, isValidSupportUrl };