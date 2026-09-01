/**
 * Zabron — Security core: antinuke, antiraid, panic mode, automod.
 *
 * Pure functions where possible so they can be unit-tested without a
 * Discord client. Event handlers wrap these functions and react to
 * guild audit-log events.
 */

import { getDatabase } from '../db/database.js';

export interface AntinukeConfig {
  guildId: string;
  enabled: boolean;
  thresholdBans: number;
  thresholdKicks: number;
  thresholdChannels: number;
  thresholdRoles: number;
  thresholdWebhooks: number;
  windowSeconds: number;
  punishAction: 'ban' | 'kick' | 'strip';
}

export interface AntiraidConfig {
  guildId: string;
  enabled: boolean;
  joinThreshold: number;
  joinWindowSeconds: number;
  accountAgeDays: number;
  action: 'kick' | 'ban' | 'lockdown';
}

const DEFAULT_ANTINUKE: Omit<AntinukeConfig, 'guildId'> = {
  enabled: false,
  thresholdBans: 3,
  thresholdKicks: 3,
  thresholdChannels: 3,
  thresholdRoles: 3,
  thresholdWebhooks: 3,
  windowSeconds: 10,
  punishAction: 'ban',
};

const DEFAULT_ANTIRAID: Omit<AntiraidConfig, 'guildId'> = {
  enabled: false,
  joinThreshold: 5,
  joinWindowSeconds: 10,
  accountAgeDays: 7,
  action: 'kick',
};

// ---------- Antinuke ----------

export function getAntinukeConfig(guildId: string): AntinukeConfig {
  const row = getDatabase().prepare('SELECT * FROM antinuke_config WHERE guild_id = ?').get(guildId) as any;
  if (!row) return { guildId, ...DEFAULT_ANTINUKE };
  return {
    guildId: row.guild_id,
    enabled: Boolean(row.enabled),
    thresholdBans: row.threshold_bans,
    thresholdKicks: row.threshold_kicks,
    thresholdChannels: row.threshold_channels,
    thresholdRoles: row.threshold_roles,
    thresholdWebhooks: row.threshold_webhooks,
    windowSeconds: row.window_seconds,
    punishAction: row.punish_action,
  };
}

export function setAntinukeConfig(guildId: string, patch: Partial<Omit<AntinukeConfig, 'guildId'>>): AntinukeConfig {
  const current = getAntinukeConfig(guildId);
  const next = { ...current, ...patch, guildId };
  getDatabase()
    .prepare(
      `INSERT INTO antinuke_config (guild_id, enabled, threshold_bans, threshold_kicks, threshold_channels, threshold_roles, threshold_webhooks, window_seconds, punish_action, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(guild_id) DO UPDATE SET enabled = excluded.enabled, threshold_bans = excluded.threshold_bans, threshold_kicks = excluded.threshold_kicks, threshold_channels = excluded.threshold_channels, threshold_roles = excluded.threshold_roles, threshold_webhooks = excluded.threshold_webhooks, window_seconds = excluded.window_seconds, punish_action = excluded.punish_action`,
    )
    .run(
      next.guildId,
      next.enabled ? 1 : 0,
      next.thresholdBans,
      next.thresholdKicks,
      next.thresholdChannels,
      next.thresholdRoles,
      next.thresholdWebhooks,
      next.windowSeconds,
      next.punishAction,
      Date.now(),
    );
  return next;
}

export function isWhitelisted(guildId: string, targetId: string): boolean {
  const row = getDatabase()
    .prepare('SELECT 1 FROM antinuke_whitelist WHERE guild_id = ? AND target_id = ?')
    .get(guildId, targetId);
  return Boolean(row);
}

/**
 * Returns true if `targetId` is directly whitelisted OR if `targetId`
 * references a role and any of the user's role IDs is whitelisted.
 * Pass `memberRoleIds = []` to skip the role check.
 */
export function isWhitelistedWithRoles(guildId: string, targetId: string, memberRoleIds: readonly string[]): boolean {
  if (isWhitelisted(guildId, targetId)) return true;
  if (!memberRoleIds.length) return false;
  const placeholders = memberRoleIds.map(() => '?').join(',');
  const row = getDatabase()
    .prepare(
      `SELECT 1 FROM antinuke_whitelist
       WHERE guild_id = ? AND kind = 'role' AND target_id IN (${placeholders})
       LIMIT 1`,
    )
    .get(guildId, ...memberRoleIds);
  return Boolean(row);
}

export function addWhitelist(guildId: string, targetId: string, kind: 'user' | 'role' = 'user'): void {
  getDatabase()
    .prepare(
      `INSERT INTO antinuke_whitelist (guild_id, target_id, kind) VALUES (?, ?, ?)
       ON CONFLICT(guild_id, target_id) DO UPDATE SET kind = excluded.kind`,
    )
    .run(guildId, targetId, kind);
}

export function removeWhitelist(guildId: string, targetId: string): void {
  getDatabase().prepare('DELETE FROM antinuke_whitelist WHERE guild_id = ? AND target_id = ?').run(guildId, targetId);
}

export function listWhitelist(guildId: string): Array<{ targetId: string; kind: 'user' | 'role' }> {
  return (getDatabase()
    .prepare('SELECT target_id as targetId, kind FROM antinuke_whitelist WHERE guild_id = ?')
    .all(guildId) as any[]);
}

/**
 * Track an antinuke event. Returns true if the threshold was exceeded
 * within the configured window — meaning the actor should be punished.
 */
export function trackAntinukeEvent(guildId: string, userId: string, action: string): boolean {
  const config = getAntinukeConfig(guildId);
  if (!config.enabled) return false;
  if (isWhitelisted(guildId, userId)) return false;

  const thresholdMap: Record<string, number> = {
    ban: config.thresholdBans,
    kick: config.thresholdKicks,
    channel_create: config.thresholdChannels,
    channel_delete: config.thresholdChannels,
    role_create: config.thresholdRoles,
    role_delete: config.thresholdRoles,
    webhook_create: config.thresholdWebhooks,
    webhook_delete: config.thresholdWebhooks,
  };
  const threshold = thresholdMap[action] ?? Number.MAX_SAFE_INTEGER;

  const db = getDatabase();
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;

  // Append a fresh row. The tracker table is intentionally append-only so
  // multiple events for the same (guild, user, action) accumulate within
  // the configured window.
  db.prepare(
    `INSERT INTO antinuke_trackers (guild_id, user_id, action, ts)
     VALUES (?, ?, ?, ?)`,
  ).run(guildId, userId, action, now);

  // Opportunistic cleanup: drop rows older than the largest configured
  // window so the table never bloats indefinitely.
  const maxWindowMs = Math.max(windowMs, 60_000);
  db.prepare(
    `DELETE FROM antinuke_trackers WHERE guild_id = ? AND ts < ?`,
  ).run(guildId, now - maxWindowMs * 10);

  const recentRow = db
    .prepare(
      `SELECT COUNT(*) as c FROM antinuke_trackers
       WHERE guild_id = ? AND user_id = ? AND action = ? AND ts > ?`,
    )
    .get(guildId, userId, action, now - windowMs) as any;

  return (recentRow?.c ?? 0) >= threshold;
}

// ---------- Antiraid ----------

export function getAntiraidConfig(guildId: string): AntiraidConfig {
  const row = getDatabase().prepare('SELECT * FROM antiraid_config WHERE guild_id = ?').get(guildId) as any;
  if (!row) return { guildId, ...DEFAULT_ANTIRAID };
  return {
    guildId: row.guild_id,
    enabled: Boolean(row.enabled),
    joinThreshold: row.join_threshold,
    joinWindowSeconds: row.join_window_seconds,
    accountAgeDays: row.account_age_days,
    action: row.action,
  };
}

export function setAntiraidConfig(guildId: string, patch: Partial<Omit<AntiraidConfig, 'guildId'>>): AntiraidConfig {
  const current = getAntiraidConfig(guildId);
  const next = { ...current, ...patch, guildId };
  getDatabase()
    .prepare(
      `INSERT INTO antiraid_config (guild_id, enabled, join_threshold, join_window_seconds, account_age_days, action, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(guild_id) DO UPDATE SET enabled = excluded.enabled, join_threshold = excluded.join_threshold, join_window_seconds = excluded.join_window_seconds, account_age_days = excluded.account_age_days, action = excluded.action`,
    )
    .run(
      next.guildId,
      next.enabled ? 1 : 0,
      next.joinThreshold,
      next.joinWindowSeconds,
      next.accountAgeDays,
      next.action,
      Date.now(),
    );
  return next;
}

// ---------- Automod ----------

export interface AutomodConfig {
  guildId: string;
  enabled: boolean;
  spamMessages: number;
  spamIntervalSeconds: number;
  mentionLimit: number;
  linkBlock: boolean;
  inviteBlock: boolean;
  capsPercent: number;
  capsMinLength: number;
  blockedWords: string[];
  duplicateLimit: number;
  punishment: 'delete' | 'warn' | 'timeout' | 'kick';
  warnThreshold: number;
}

const DEFAULT_AUTOMOD: Omit<AutomodConfig, 'guildId'> = {
  enabled: false,
  spamMessages: 5,
  spamIntervalSeconds: 5,
  mentionLimit: 5,
  linkBlock: false,
  inviteBlock: false,
  capsPercent: 80,
  capsMinLength: 10,
  blockedWords: [],
  duplicateLimit: 5,
  punishment: 'delete',
  warnThreshold: 3,
};

export function getAutomodConfig(guildId: string): AutomodConfig {
  const row = getDatabase().prepare('SELECT * FROM automod_config WHERE guild_id = ?').get(guildId) as any;
  if (!row) return { guildId, ...DEFAULT_AUTOMOD };
  return {
    guildId: row.guild_id,
    enabled: Boolean(row.enabled),
    spamMessages: row.spam_messages,
    spamIntervalSeconds: row.spam_interval_seconds,
    mentionLimit: row.mention_limit,
    linkBlock: Boolean(row.link_block),
    inviteBlock: Boolean(row.invite_block),
    capsPercent: row.caps_percent,
    capsMinLength: row.caps_min_length,
    blockedWords: row.blocked_words ? String(row.blocked_words).split('|').filter(Boolean) : [],
    duplicateLimit: row.duplicate_limit,
    punishment: row.punishment,
    warnThreshold: row.warn_threshold,
  };
}

export function setAutomodConfig(guildId: string, patch: Partial<Omit<AutomodConfig, 'guildId'>>): AutomodConfig {
  const current = getAutomodConfig(guildId);
  const next = { ...current, ...patch, guildId };
  getDatabase()
    .prepare(
      `INSERT INTO automod_config (guild_id, enabled, spam_messages, spam_interval_seconds, mention_limit, link_block, invite_block, caps_percent, caps_min_length, blocked_words, duplicate_limit, punishment, warn_threshold, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(guild_id) DO UPDATE SET enabled = excluded.enabled, spam_messages = excluded.spam_messages, spam_interval_seconds = excluded.spam_interval_seconds, mention_limit = excluded.mention_limit, link_block = excluded.link_block, invite_block = excluded.invite_block, caps_percent = excluded.caps_percent, caps_min_length = excluded.caps_min_length, blocked_words = excluded.blocked_words, duplicate_limit = excluded.duplicate_limit, punishment = excluded.punishment, warn_threshold = excluded.warn_threshold`,
    )
    .run(
      next.guildId,
      next.enabled ? 1 : 0,
      next.spamMessages,
      next.spamIntervalSeconds,
      next.mentionLimit,
      next.linkBlock ? 1 : 0,
      next.inviteBlock ? 1 : 0,
      next.capsPercent,
      next.capsMinLength,
      next.blockedWords.join('|'),
      next.duplicateLimit,
      next.punishment,
      next.warnThreshold,
      Date.now(),
    );
  return next;
}

export function addAutomodExemption(guildId: string, targetId: string, kind: 'user' | 'role' | 'channel'): void {
  getDatabase()
    .prepare('INSERT OR IGNORE INTO automod_exemptions (guild_id, target_id, kind) VALUES (?, ?, ?)')
    .run(guildId, targetId, kind);
}

export function removeAutomodExemption(guildId: string, targetId: string): void {
  getDatabase().prepare('DELETE FROM automod_exemptions WHERE guild_id = ? AND target_id = ?').run(guildId, targetId);
}

export function isAutomodExempt(guildId: string, targetId: string): boolean {
  const row = getDatabase()
    .prepare('SELECT 1 FROM automod_exemptions WHERE guild_id = ? AND target_id = ?')
    .get(guildId, targetId);
  return Boolean(row);
}

export function listAutomodExemptions(guildId: string): Array<{ targetId: string; kind: string }> {
  return (getDatabase()
    .prepare('SELECT target_id as targetId, kind FROM automod_exemptions WHERE guild_id = ?')
    .all(guildId) as any[]);
}