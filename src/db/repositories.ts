/**
 * Zabron — Repository layer.
 *
 * All database access goes through these functions so that command
 * files do not have to know SQL. This keeps tests predictable and the
 * schema changeable without rewriting the commands.
 */

import { getDatabase } from './database.js';
import type {
  GuildSettings,
  ModerationAction,
  ModerationCase,
  Ticket,
  Giveaway,
  LevelingUser,
  AutomationWorkflow,
} from '../types/index.js';

// ---------- Guild settings ----------

const DEFAULT_PREFIX = '.';

export function getGuildSettings(guildId: string): GuildSettings {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId) as any;
  if (row) {
    return mapGuildSettings(row);
  }
  const now = Date.now();
  db.prepare(
    `INSERT INTO guild_settings (guild_id, prefix, panic_mode, created_at, updated_at)
     VALUES (?, ?, 0, ?, ?)`,
  ).run(guildId, DEFAULT_PREFIX, now, now);
  return {
    guildId,
    prefix: DEFAULT_PREFIX,
    modLogChannel: null,
    panicMode: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateGuildSettings(
  guildId: string,
  patch: Partial<Omit<GuildSettings, 'guildId' | 'createdAt' | 'updatedAt'>>,
): GuildSettings {
  const current = getGuildSettings(guildId);
  const next: GuildSettings = {
    ...current,
    ...patch,
    guildId,
    updatedAt: Date.now(),
  };
  getDatabase()
    .prepare(
      `UPDATE guild_settings SET prefix = ?, mod_log_channel = ?, panic_mode = ?, updated_at = ?
       WHERE guild_id = ?`,
    )
    .run(next.prefix, next.modLogChannel, next.panicMode ? 1 : 0, next.updatedAt, guildId);
  return next;
}

export function getAllGuildIds(): string[] {
  return (getDatabase().prepare('SELECT guild_id FROM guild_settings').all() as any[]).map(
    (r) => r.guild_id,
  );
}

function mapGuildSettings(row: any): GuildSettings {
  return {
    guildId: row.guild_id,
    prefix: row.prefix,
    modLogChannel: row.mod_log_channel ?? null,
    panicMode: Boolean(row.panic_mode),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------- Moderation cases ----------

export function insertModerationCase(c: Omit<ModerationCase, 'createdAt'> & { createdAt?: number }): ModerationCase {
  const createdAt = c.createdAt ?? Date.now();
  getDatabase()
    .prepare(
      `INSERT INTO moderation_cases (case_id, guild_id, target_id, moderator_id, action, reason, duration, created_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      c.id,
      c.guildId,
      c.targetId,
      c.moderatorId,
      c.action,
      c.reason,
      c.duration,
      createdAt,
      c.metadata,
    );
  return { ...c, createdAt };
}

export function listCasesForGuild(guildId: string, limit = 50): ModerationCase[] {
  const rows = getDatabase()
    .prepare(
      `SELECT * FROM moderation_cases WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?`,
    )
    .all(guildId, limit) as any[];
  return rows.map(mapCase);
}

export function listCasesForUser(guildId: string, targetId: string, limit = 50): ModerationCase[] {
  const rows = getDatabase()
    .prepare(
      `SELECT * FROM moderation_cases WHERE guild_id = ? AND target_id = ? ORDER BY created_at DESC LIMIT ?`,
    )
    .all(guildId, targetId, limit) as any[];
  return rows.map(mapCase);
}

export function getCase(guildId: string, caseId: string): ModerationCase | null {
  const row = getDatabase()
    .prepare('SELECT * FROM moderation_cases WHERE guild_id = ? AND case_id = ?')
    .get(guildId, caseId) as any;
  return row ? mapCase(row) : null;
}

function mapCase(row: any): ModerationCase {
  return {
    id: row.case_id,
    guildId: row.guild_id,
    targetId: row.target_id,
    moderatorId: row.moderator_id,
    action: row.action as ModerationAction,
    reason: row.reason,
    duration: row.duration,
    createdAt: row.created_at,
    metadata: row.metadata,
  };
}

// ---------- Warnings ----------

export function addWarning(
  guildId: string,
  userId: string,
  moderatorId: string,
  reason: string | null,
): { id: number; createdAt: number } {
  const createdAt = Date.now();
  const info = getDatabase()
    .prepare(
      `INSERT INTO warnings (guild_id, user_id, moderator_id, reason, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(guildId, userId, moderatorId, reason, createdAt);
  return { id: info.lastInsertRowid as number, createdAt };
}

export function listWarnings(guildId: string, userId: string): Array<{
  id: number;
  moderatorId: string;
  reason: string | null;
  createdAt: number;
}> {
  return (getDatabase()
    .prepare(
      `SELECT id, moderator_id as moderatorId, reason, created_at as createdAt FROM warnings
       WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC`,
    )
    .all(guildId, userId) as any[]);
}

export function clearWarnings(guildId: string, userId: string): number {
  const info = getDatabase()
    .prepare('DELETE FROM warnings WHERE guild_id = ? AND user_id = ?')
    .run(guildId, userId);
  return info.changes;
}

export function warningCount(guildId: string, userId: string): number {
  const row = getDatabase()
    .prepare('SELECT COUNT(*) as c FROM warnings WHERE guild_id = ? AND user_id = ?')
    .get(guildId, userId) as any;
  return row?.c ?? 0;
}

// ---------- Logging ----------

export function getLoggingConfig(guildId: string, category: string): { channelId: string | null; enabled: boolean } {
  const row = getDatabase()
    .prepare('SELECT channel_id, enabled FROM logging_config WHERE guild_id = ? AND category = ?')
    .get(guildId, category) as any;
  if (!row) return { channelId: null, enabled: false };
  return { channelId: row.channel_id, enabled: Boolean(row.enabled) };
}

/**
 * Set (or clear) the destination channel for a logging category.
 *
 * When a non-null channelId is provided the category is automatically
 * enabled. Passing `null` clears the channel and leaves the enabled flag
 * unchanged so admins can keep "disabled" state on a category even
 * after clearing its channel.
 */
export function setLoggingChannel(guildId: string, category: string, channelId: string | null): void {
  const db = getDatabase();
  if (channelId) {
    db.prepare(
      `INSERT INTO logging_config (guild_id, category, channel_id, enabled)
       VALUES (?, ?, ?, 1)
       ON CONFLICT(guild_id, category) DO UPDATE SET channel_id = excluded.channel_id, enabled = 1`,
    ).run(guildId, category, channelId);
  } else {
    db.prepare(
      `INSERT INTO logging_config (guild_id, category, channel_id, enabled)
       VALUES (?, ?, NULL, 0)
       ON CONFLICT(guild_id, category) DO UPDATE SET channel_id = NULL, enabled = 0`,
    ).run(guildId, category);
  }
}

/**
 * Toggle the enabled flag for a logging category.
 *
 * Returns `false` if the category has no channel configured — there's
 * no point enabling a category that has nowhere to write to.
 */
export function setLoggingEnabled(guildId: string, category: string, enabled: boolean): boolean {
  const db = getDatabase();
  const existing = getLoggingConfig(guildId, category);
  if (!existing.channelId && enabled) return false;
  db.prepare(
    `INSERT INTO logging_config (guild_id, category, channel_id, enabled)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(guild_id, category) DO UPDATE SET enabled = excluded.enabled`,
  ).run(guildId, category, existing.channelId, enabled ? 1 : 0);
  return true;
}

export function getAllLoggingChannels(guildId: string): Record<string, string | null> {
  const rows = getDatabase()
    .prepare('SELECT category, channel_id FROM logging_config WHERE guild_id = ? AND enabled = 1')
    .all(guildId) as any[];
  const out: Record<string, string | null> = {};
  for (const r of rows) out[r.category] = r.channel_id;
  return out;
}

/**
 * Returns true if a channel is in the per-guild message-log ignore list.
 * Used by message delete / edit handlers to mute noisy channels.
 */
export function isChannelIgnoredForLogs(guildId: string, channelId: string): boolean {
  ensureIgnoreTable();
  const row = getDatabase()
    .prepare('SELECT 1 FROM log_ignores WHERE guild_id = ? AND channel_id = ?')
    .get(guildId, channelId);
  return Boolean(row);
}

/**
 * Returns true when webhook delivery is enabled for the given category
 * in the given guild. Defaults to `true` when the row is missing so a
 * fresh install isn't muted by default.
 */
export function isWebhookDeliveryEnabled(guildId: string, category: string): boolean {
  ensureIgnoreTable();
  const row = getDatabase()
    .prepare('SELECT enabled FROM log_webhooks WHERE guild_id = ? AND category = ?')
    .get(guildId, category) as any;
  if (!row) return true;
  return Boolean(row.enabled);
}

/**
 * Lazily create the auxiliary logging tables (webhook toggle, ignored
 * channels). The migration 025 already creates them at boot for fresh
 * installs; this function lets older deployments use the helpers
 * without crashing before the migration runs.
 */
function ensureIgnoreTable(): void {
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS log_webhooks (
      guild_id TEXT NOT NULL,
      category TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (guild_id, category)
    );
    CREATE TABLE IF NOT EXISTS log_ignores (
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      PRIMARY KEY (guild_id, channel_id)
    );
  `);
}

// ---------- Tickets ----------

export function insertTicket(t: Ticket): void {
  getDatabase()
    .prepare(
      `INSERT INTO tickets (ticket_id, guild_id, channel_id, user_id, claimed_by, category, status, topic, created_at, closed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      t.ticketId,
      t.guildId,
      t.channelId,
      t.userId,
      t.claimedBy,
      t.category,
      t.status,
      t.topic,
      t.createdAt,
      t.closedAt,
    );
}

export function getTicketByChannel(channelId: string): Ticket | null {
  const row = getDatabase()
    .prepare('SELECT * FROM tickets WHERE channel_id = ?')
    .get(channelId) as any;
  return row ? mapTicket(row) : null;
}

export function getTicket(ticketId: string): Ticket | null {
  const row = getDatabase().prepare('SELECT * FROM tickets WHERE ticket_id = ?').get(ticketId) as any;
  return row ? mapTicket(row) : null;
}

export function updateTicketStatus(ticketId: string, status: Ticket['status'], claimedBy: string | null = null): void {
  const closedAt = status === 'closed' ? Date.now() : null;
  getDatabase()
    .prepare(
      `UPDATE tickets SET status = ?, claimed_by = ?, closed_at = ? WHERE ticket_id = ?`,
    )
    .run(status, claimedBy, closedAt, ticketId);
}

export function listOpenTickets(guildId: string): Ticket[] {
  const rows = getDatabase()
    .prepare(`SELECT * FROM tickets WHERE guild_id = ? AND status != 'closed'`)
    .all(guildId) as any[];
  return rows.map(mapTicket);
}

function mapTicket(row: any): Ticket {
  return {
    ticketId: row.ticket_id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    userId: row.user_id,
    claimedBy: row.claimed_by,
    category: row.category,
    status: row.status,
    topic: row.topic,
    createdAt: row.created_at,
    closedAt: row.closed_at,
  };
}

// ---------- Giveaways ----------

export function insertGiveaway(g: Giveaway): void {
  getDatabase()
    .prepare(
      `INSERT INTO giveaways (id, guild_id, channel_id, message_id, host_id, prize, winner_count, required_role_id, starts_at, ends_at, ended, cancelled, winners)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      g.id,
      g.guildId,
      g.channelId,
      g.messageId,
      g.hostId,
      g.prize,
      g.winnerCount,
      g.requiredRoleId,
      g.startsAt,
      g.endsAt,
      g.ended ? 1 : 0,
      g.cancelled ? 1 : 0,
      g.winners,
    );
}

export function setGiveawayMessageId(id: string, messageId: string): void {
  getDatabase().prepare('UPDATE giveaways SET message_id = ? WHERE id = ?').run(messageId, id);
}

export function getGiveaway(id: string): Giveaway | null {
  const row = getDatabase().prepare('SELECT * FROM giveaways WHERE id = ?').get(id) as any;
  return row ? mapGiveaway(row) : null;
}

export function listGiveaways(guildId: string, includeEnded = true): Giveaway[] {
  const sql = includeEnded
    ? 'SELECT * FROM giveaways WHERE guild_id = ? ORDER BY ends_at DESC'
    : 'SELECT * FROM giveaways WHERE guild_id = ? AND ended = 0 AND cancelled = 0 ORDER BY ends_at ASC';
  const rows = getDatabase().prepare(sql).all(guildId) as any[];
  return rows.map(mapGiveaway);
}

export function getActiveGiveaways(): Giveaway[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM giveaways WHERE ended = 0 AND cancelled = 0')
    .all() as any[];
  return rows.map(mapGiveaway);
}

export function endGiveaway(id: string, winnerIds: string[]): void {
  getDatabase()
    .prepare('UPDATE giveaways SET ended = 1, winners = ? WHERE id = ?')
    .run(JSON.stringify(winnerIds), id);
}

export function cancelGiveaway(id: string): void {
  getDatabase().prepare('UPDATE giveaways SET cancelled = 1, ended = 1 WHERE id = ?').run(id);
}

export function addGiveawayEntry(giveawayId: string, userId: string): boolean {
  try {
    getDatabase()
      .prepare('INSERT INTO giveaway_entries (giveaway_id, user_id) VALUES (?, ?)')
      .run(giveawayId, userId);
    return true;
  } catch {
    return false;
  }
}

export function removeGiveawayEntry(giveawayId: string, userId: string): void {
  getDatabase()
    .prepare('DELETE FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?')
    .run(giveawayId, userId);
}

export function getGiveawayEntries(giveawayId: string): string[] {
  const rows = getDatabase()
    .prepare('SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?')
    .all(giveawayId) as any[];
  return rows.map((r) => r.user_id);
}

function mapGiveaway(row: any): Giveaway {
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    hostId: row.host_id,
    prize: row.prize,
    winnerCount: row.winner_count,
    requiredRoleId: row.required_role_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    ended: Boolean(row.ended),
    cancelled: Boolean(row.cancelled),
    winners: row.winners,
  };
}

// ---------- Leveling ----------

export function getLevelingUser(guildId: string, userId: string): LevelingUser {
  const row = getDatabase()
    .prepare('SELECT * FROM leveling_users WHERE guild_id = ? AND user_id = ?')
    .get(guildId, userId) as any;
  if (!row) {
    return { guildId, userId, xp: 0, level: 0, totalMessages: 0, lastXpAt: 0 };
  }
  return {
    guildId: row.guild_id,
    userId: row.user_id,
    xp: row.xp,
    level: row.level,
    totalMessages: row.total_messages,
    lastXpAt: row.last_xp_at,
  };
}

export function addXp(guildId: string, userId: string, xp: number, now: number): LevelingUser {
  const current = getLevelingUser(guildId, userId);
  const next: LevelingUser = {
    ...current,
    xp: current.xp + xp,
    level: current.level,
    totalMessages: current.totalMessages + 1,
    lastXpAt: now,
  };
  getDatabase()
    .prepare(
      `INSERT INTO leveling_users (guild_id, user_id, xp, level, total_messages, last_xp_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(guild_id, user_id) DO UPDATE SET
         xp = excluded.xp,
         level = excluded.level,
         total_messages = excluded.total_messages,
         last_xp_at = excluded.last_xp_at`,
    )
    .run(next.guildId, next.userId, next.xp, next.level, next.totalMessages, next.lastXpAt);
  return next;
}

export function setLevel(guildId: string, userId: string, level: number, xp: number): void {
  getDatabase()
    .prepare(
      `INSERT INTO leveling_users (guild_id, user_id, xp, level, total_messages, last_xp_at)
       VALUES (?, ?, ?, ?, 0, 0)
       ON CONFLICT(guild_id, user_id) DO UPDATE SET level = excluded.level, xp = excluded.xp`,
    )
    .run(guildId, userId, xp, level);
}

export function getLeaderboard(guildId: string, limit = 10): LevelingUser[] {
  const rows = getDatabase()
    .prepare(
      `SELECT * FROM leveling_users WHERE guild_id = ? ORDER BY xp DESC LIMIT ?`,
    )
    .all(guildId, limit) as any[];
  return rows.map((row) => ({
    guildId: row.guild_id,
    userId: row.user_id,
    xp: row.xp,
    level: row.level,
    totalMessages: row.total_messages,
    lastXpAt: row.last_xp_at,
  }));
}

// ---------- Invites ----------

export function ensureInviteCache(guildId: string, code: string, inviterId: string | null, uses: number): void {
  getDatabase()
    .prepare(
      `INSERT INTO invite_cache (guild_id, code, inviter_id, uses) VALUES (?, ?, ?, ?)
       ON CONFLICT(guild_id, code) DO UPDATE SET inviter_id = excluded.inviter_id, uses = excluded.uses`,
    )
    .run(guildId, code, inviterId, uses);
}

export function getInviteCache(guildId: string): Array<{ code: string; inviterId: string | null; uses: number }> {
  const rows = getDatabase()
    .prepare('SELECT code, inviter_id as inviterId, uses FROM invite_cache WHERE guild_id = ?')
    .all(guildId) as any[];
  return rows;
}

export function recordInviteUse(guildId: string, code: string, userId: string, inviterId: string | null, joinedAt: number): void {
  try {
    getDatabase()
      .prepare(
        `INSERT INTO invite_uses (guild_id, code, user_id, inviter_id, joined_at) VALUES (?, ?, ?, ?, ?)`,
    )
      .run(guildId, code, userId, inviterId, joinedAt);
  } catch {
    /* duplicate */
  }
}

export function adjustInviteCount(guildId: string, userId: string, delta: number, kind: 'invites' | 'leaves' | 'fakes'): void {
  getDatabase()
    .prepare(
      `INSERT INTO invite_counts (guild_id, user_id, invites, leaves, fakes)
       VALUES (?, ?, 0, 0, 0)
       ON CONFLICT(guild_id, user_id) DO UPDATE SET ${kind} = ${kind} + ?`,
    )
    .run(guildId, userId, delta);
}

export function getInviteCounts(guildId: string, userId: string): { invites: number; leaves: number; fakes: number } {
  const row = getDatabase()
    .prepare('SELECT invites, leaves, fakes FROM invite_counts WHERE guild_id = ? AND user_id = ?')
    .get(guildId, userId) as any;
  return row ?? { invites: 0, leaves: 0, fakes: 0 };
}

export function getInviteLeaderboard(guildId: string, limit = 10): Array<{ userId: string; invites: number; leaves: number; fakes: number }> {
  const rows = getDatabase()
    .prepare(
      `SELECT user_id as userId, invites, leaves, fakes FROM invite_counts WHERE guild_id = ?
       ORDER BY (invites - leaves - fakes) DESC LIMIT ?`,
    )
    .all(guildId, limit) as any[];
  return rows;
}

// ---------- Automation ----------

export function listWorkflows(guildId: string): AutomationWorkflow[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM automation_workflows WHERE guild_id = ? ORDER BY created_at DESC')
    .all(guildId) as any[];
  return rows.map(mapWorkflow);
}

export function insertWorkflow(w: AutomationWorkflow): void {
  getDatabase()
    .prepare(
      `INSERT INTO automation_workflows (id, guild_id, name, enabled, trigger, conditions, actions, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      w.id,
      w.guildId,
      w.name,
      w.enabled ? 1 : 0,
      w.trigger,
      w.conditions,
      w.actions,
      w.createdAt,
    );
}

export function deleteWorkflow(guildId: string, id: string): boolean {
  const info = getDatabase()
    .prepare('DELETE FROM automation_workflows WHERE guild_id = ? AND id = ?')
    .run(guildId, id);
  return info.changes > 0;
}

export function getWorkflowsForTrigger(guildId: string, trigger: string): AutomationWorkflow[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM automation_workflows WHERE guild_id = ? AND trigger = ? AND enabled = 1')
    .all(guildId, trigger) as any[];
  return rows.map(mapWorkflow);
}

function mapWorkflow(row: any): AutomationWorkflow {
  return {
    id: row.id,
    guildId: row.guild_id,
    name: row.name,
    enabled: Boolean(row.enabled),
    trigger: row.trigger,
    conditions: row.conditions,
    actions: row.actions,
    createdAt: row.created_at,
  };
}

// ---------- Custom commands ----------

export function upsertCustomCommand(guildId: string, name: string, response: string, asEmbed: boolean): void {
  getDatabase()
    .prepare(
      `INSERT INTO custom_commands (guild_id, name, response, embed, use_count, created_at)
       VALUES (?, ?, ?, ?, 0, ?)
       ON CONFLICT(guild_id, name) DO UPDATE SET response = excluded.response, embed = excluded.embed`,
    )
    .run(guildId, name, response, asEmbed ? 1 : 0, Date.now());
}

export function deleteCustomCommand(guildId: string, name: string): boolean {
  const info = getDatabase()
    .prepare('DELETE FROM custom_commands WHERE guild_id = ? AND name = ?')
    .run(guildId, name);
  return info.changes > 0;
}

export function getCustomCommand(guildId: string, name: string): { response: string; embed: boolean } | null {
  const row = getDatabase()
    .prepare('SELECT response, embed FROM custom_commands WHERE guild_id = ? AND name = ?')
    .get(guildId, name) as any;
  if (!row) return null;
  return { response: row.response, embed: Boolean(row.embed) };
}

export function listCustomCommands(guildId: string): Array<{ name: string; response: string; embed: boolean }> {
  return (getDatabase()
    .prepare('SELECT name, response, embed FROM custom_commands WHERE guild_id = ? ORDER BY name')
    .all(guildId) as any[]).map((row) => ({ name: row.name, response: row.response, embed: Boolean(row.embed) }));
}

export function incrementCustomCommandUsage(guildId: string, name: string): void {
  getDatabase()
    .prepare('UPDATE custom_commands SET use_count = use_count + 1 WHERE guild_id = ? AND name = ?')
    .run(guildId, name);
}

// ---------- Autoresponders ----------

export interface AutoresponderRow {
  guildId: string;
  name: string;
  trigger: string;
  match: 'contains' | 'exact' | 'regex' | 'starts';
  response: string;
  channels: string[];
  roles: string[];
  cooldownSeconds: number;
  enabled: boolean;
  createdAt: number;
}

export function upsertAutoresponder(row: AutoresponderRow): void {
  getDatabase()
    .prepare(
      `INSERT INTO autoresponders (guild_id, name, trigger, match, response, channels, roles, cooldown_seconds, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(guild_id, name) DO UPDATE SET trigger = excluded.trigger, match = excluded.match, response = excluded.response, channels = excluded.channels, roles = excluded.roles, cooldown_seconds = excluded.cooldown_seconds, enabled = excluded.enabled`,
    )
    .run(
      row.guildId,
      row.name,
      row.trigger,
      row.match,
      row.response,
      row.channels.join(','),
      row.roles.join(','),
      row.cooldownSeconds,
      row.enabled ? 1 : 0,
      row.createdAt,
    );
}

export function deleteAutoresponder(guildId: string, name: string): boolean {
  const info = getDatabase()
    .prepare('DELETE FROM autoresponders WHERE guild_id = ? AND name = ?')
    .run(guildId, name);
  return info.changes > 0;
}

export function listAutoresponders(guildId: string): AutoresponderRow[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM autoresponders WHERE guild_id = ? ORDER BY name')
    .all(guildId) as any[];
  return rows.map(mapAutoresponder);
}

export function getAutoresponder(guildId: string, name: string): AutoresponderRow | null {
  const row = getDatabase()
    .prepare('SELECT * FROM autoresponders WHERE guild_id = ? AND name = ?')
    .get(guildId, name) as any;
  return row ? mapAutoresponder(row) : null;
}

function mapAutoresponder(row: any): AutoresponderRow {
  return {
    guildId: row.guild_id,
    name: row.name,
    trigger: row.trigger,
    match: row.match,
    response: row.response,
    channels: row.channels ? String(row.channels).split(',').filter(Boolean) : [],
    roles: row.roles ? String(row.roles).split(',').filter(Boolean) : [],
    cooldownSeconds: row.cooldown_seconds,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
  };
}

// ---------- Sticky messages ----------

export function upsertStickyMessage(guildId: string, channelId: string, content: string, messageId: string | null): void {
  getDatabase()
    .prepare(
      `INSERT INTO sticky_messages (guild_id, channel_id, message_id, content, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(guild_id, channel_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`,
    )
    .run(guildId, channelId, messageId, content, Date.now());
}

export function updateStickyMessageId(guildId: string, channelId: string, messageId: string): void {
  getDatabase()
    .prepare('UPDATE sticky_messages SET message_id = ?, updated_at = ? WHERE guild_id = ? AND channel_id = ?')
    .run(messageId, Date.now(), guildId, channelId);
}

export function deleteStickyMessage(guildId: string, channelId: string): void {
  getDatabase()
    .prepare('DELETE FROM sticky_messages WHERE guild_id = ? AND channel_id = ?')
    .run(guildId, channelId);
}

export function listStickyMessages(guildId: string): Array<{ channelId: string; messageId: string | null; content: string }> {
  return (getDatabase()
    .prepare('SELECT channel_id as channelId, message_id as messageId, content FROM sticky_messages WHERE guild_id = ?')
    .all(guildId) as any[]);
}

// ---------- Reminders ----------

export function insertReminder(row: { id: string; guildId: string | null; userId: string; message: string; remindAt: number; createdAt: number }): void {
  getDatabase()
    .prepare(
      `INSERT INTO reminders (id, guild_id, user_id, message, remind_at, delivered, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
    )
    .run(row.id, row.guildId, row.userId, row.message, row.remindAt, row.createdAt);
}

export function listReminders(userId: string): Array<{ id: string; message: string; remindAt: number; createdAt: number; guildId: string | null }> {
  return (getDatabase()
    .prepare('SELECT id, message, remind_at as remindAt, created_at as createdAt, guild_id as guildId FROM reminders WHERE user_id = ? AND delivered = 0 ORDER BY remind_at ASC')
    .all(userId) as any[]);
}

export function deleteReminder(userId: string, id: string): boolean {
  const info = getDatabase()
    .prepare('DELETE FROM reminders WHERE user_id = ? AND id = ?')
    .run(userId, id);
  return info.changes > 0;
}

export function dueReminders(now: number): Array<{ id: string; userId: string; message: string; guildId: string | null; remindAt: number }> {
  return (getDatabase()
    .prepare(
      `SELECT id, user_id as userId, message, guild_id as guildId, remind_at as remindAt
       FROM reminders WHERE delivered = 0 AND remind_at <= ?`,
    )
    .all(now) as any[]);
}

export function markReminderDelivered(id: string): void {
  getDatabase().prepare('UPDATE reminders SET delivered = 1 WHERE id = ?').run(id);
}

// ---------- Stat channels ----------

export function setStatChannel(guildId: string, kind: string, channelId: string, template: string): void {
  getDatabase()
    .prepare(
      `INSERT INTO stat_channels (guild_id, kind, channel_id, template)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(guild_id, kind) DO UPDATE SET channel_id = excluded.channel_id, template = excluded.template`,
    )
    .run(guildId, kind, channelId, template);
}

export function removeStatChannel(guildId: string, kind: string): void {
  getDatabase().prepare('DELETE FROM stat_channels WHERE guild_id = ? AND kind = ?').run(guildId, kind);
}

export function listStatChannels(guildId: string): Array<{ kind: string; channelId: string; template: string }> {
  return (getDatabase()
    .prepare('SELECT kind, channel_id as channelId, template FROM stat_channels WHERE guild_id = ?')
    .all(guildId) as any[]);
}

// ---------- AFK ----------

export function setAfk(guildId: string, userId: string, reason: string | null): void {
  getDatabase()
    .prepare(
      `INSERT INTO afk_users (guild_id, user_id, reason, since) VALUES (?, ?, ?, ?)
       ON CONFLICT(guild_id, user_id) DO UPDATE SET reason = excluded.reason, since = excluded.since`,
    )
    .run(guildId, userId, reason, Date.now());
}

export function clearAfk(guildId: string, userId: string): boolean {
  const info = getDatabase()
    .prepare('DELETE FROM afk_users WHERE guild_id = ? AND user_id = ?')
    .run(guildId, userId);
  return info.changes > 0;
}

export function getAfk(guildId: string, userId: string): { reason: string | null; since: number } | null {
  const row = getDatabase()
    .prepare('SELECT reason, since FROM afk_users WHERE guild_id = ? AND user_id = ?')
    .get(guildId, userId) as any;
  if (!row) return null;
  return { reason: row.reason, since: row.since };
}

// ---------- Temp voice ----------

export function setTempvoiceGenerator(guildId: string, channelId: string, categoryId: string | null): void {
  getDatabase()
    .prepare(
      `INSERT INTO tempvoice_config (guild_id, generator_channel_id, category_id)
       VALUES (?, ?, ?)
       ON CONFLICT(guild_id) DO UPDATE SET generator_channel_id = excluded.generator_channel_id, category_id = excluded.category_id`,
    )
    .run(guildId, channelId, categoryId);
}

export function getTempvoiceConfig(guildId: string): { generatorChannelId: string; categoryId: string | null } | null {
  const row = getDatabase()
    .prepare('SELECT generator_channel_id as generatorChannelId, category_id as categoryId FROM tempvoice_config WHERE guild_id = ?')
    .get(guildId) as any;
  return row ?? null;
}

export function registerTempvoice(guildId: string, channelId: string, ownerId: string): void {
  getDatabase()
    .prepare('INSERT OR REPLACE INTO tempvoice_channels (guild_id, channel_id, owner_id, created_at) VALUES (?, ?, ?, ?)')
    .run(guildId, channelId, ownerId, Date.now());
}

export function deleteTempvoice(channelId: string): void {
  getDatabase().prepare('DELETE FROM tempvoice_channels WHERE channel_id = ?').run(channelId);
}

export function getTempvoice(channelId: string): { guildId: string; ownerId: string } | null {
  const row = getDatabase()
    .prepare('SELECT guild_id as guildId, owner_id as ownerId FROM tempvoice_channels WHERE channel_id = ?')
    .get(channelId) as any;
  return row ?? null;
}

// ---------- Cooldowns ----------

export function setCooldown(guildId: string, userId: string, command: string, seconds: number): void {
  const expires = Date.now() + seconds * 1000;
  getDatabase()
    .prepare(
      `INSERT INTO cooldowns (guild_id, user_id, command, ts) VALUES (?, ?, ?, ?)
       ON CONFLICT(guild_id, user_id, command) DO UPDATE SET ts = excluded.ts`,
    )
    .run(guildId, userId, command, expires);
}

export function getCooldownRemaining(guildId: string, userId: string, command: string): number {
  const row = getDatabase()
    .prepare('SELECT ts FROM cooldowns WHERE guild_id = ? AND user_id = ? AND command = ?')
    .get(guildId, userId, command) as any;
  if (!row) return 0;
  return Math.max(0, row.ts - Date.now());
}

// ---------- Temp bans (restart-safe scheduled unbans) ----------

export function insertTempBan(guildId: string, userId: string, expiresAt: number, reason: string | null): void {
  getDatabase()
    .prepare(
      `INSERT INTO temp_bans (guild_id, user_id, expires_at, reason, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(guild_id, user_id) DO UPDATE SET
         expires_at = excluded.expires_at,
         reason = excluded.reason,
         created_at = excluded.created_at`,
    )
    .run(guildId, userId, expiresAt, reason, Date.now());
}

export function deleteTempBan(guildId: string, userId: string): void {
  getDatabase().prepare('DELETE FROM temp_bans WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
}

export function dueTempBans(now: number): Array<{ guildId: string; userId: string }> {
  return (getDatabase()
    .prepare('SELECT guild_id as guildId, user_id as userId FROM temp_bans WHERE expires_at <= ?')
    .all(now) as any[]);
}

export function pendingTempBans(guildId: string): Array<{ userId: string; expiresAt: number }> {
  return (getDatabase()
    .prepare('SELECT user_id as userId, expires_at as expiresAt FROM temp_bans WHERE guild_id = ?')
    .all(guildId) as any[]);
}

// ---------- Panic snapshot (restore prior protection state) ----------

export function savePanicSnapshot(
  guildId: string,
  antinukeEnabled: boolean,
  antiraidEnabled: boolean,
  automodEnabled: boolean,
): void {
  getDatabase()
    .prepare(
      `INSERT INTO panic_snapshot (guild_id, antinuke_enabled, antiraid_enabled, automod_enabled, taken_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(guild_id) DO UPDATE SET
         antinuke_enabled = excluded.antinuke_enabled,
         antiraid_enabled = excluded.antiraid_enabled,
         automod_enabled = excluded.automod_enabled,
         taken_at = excluded.taken_at`,
    )
    .run(guildId, antinukeEnabled ? 1 : 0, antiraidEnabled ? 1 : 0, automodEnabled ? 1 : 0, Date.now());
}

export function loadPanicSnapshot(guildId: string): {
  antinukeEnabled: boolean;
  antiraidEnabled: boolean;
  automodEnabled: boolean;
  takenAt: number;
} | null {
  const row = getDatabase()
    .prepare(
      'SELECT antinuke_enabled as antinukeEnabled, antiraid_enabled as antiraidEnabled, automod_enabled as automodEnabled, taken_at as takenAt FROM panic_snapshot WHERE guild_id = ?',
    )
    .get(guildId) as any;
  if (!row) return null;
  return {
    antinukeEnabled: Boolean(row.antinukeEnabled),
    antiraidEnabled: Boolean(row.antiraidEnabled),
    automodEnabled: Boolean(row.automodEnabled),
    takenAt: row.takenAt,
  };
}

export function clearPanicSnapshot(guildId: string): void {
  getDatabase().prepare('DELETE FROM panic_snapshot WHERE guild_id = ?').run(guildId);
}

// ---------- Channel locks (restart-safe scheduled unlocks) ----------

export function recordChannelLock(guildId: string, channelId: string, lockedBy: string, expiresAt: number | null): void {
  getDatabase()
    .prepare(
      `INSERT INTO channel_locks (guild_id, channel_id, locked_by, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(guild_id, channel_id) DO UPDATE SET
         locked_by = excluded.locked_by,
         expires_at = excluded.expires_at,
         created_at = excluded.created_at`,
    )
    .run(guildId, channelId, lockedBy, expiresAt, Date.now());
}

export function clearChannelLock(guildId: string, channelId: string): void {
  getDatabase().prepare('DELETE FROM channel_locks WHERE guild_id = ? AND channel_id = ?').run(guildId, channelId);
}

export function dueChannelUnlocks(now: number): Array<{ guildId: string; channelId: string }> {
  return (getDatabase()
    .prepare('SELECT guild_id as guildId, channel_id as channelId FROM channel_locks WHERE expires_at IS NOT NULL AND expires_at <= ?')
    .all(now) as any[]);
}

export function activeLocksForGuild(guildId: string): Array<{ channelId: string; expiresAt: number | null }> {
  return (getDatabase()
    .prepare('SELECT channel_id as channelId, expires_at as expiresAt FROM channel_locks WHERE guild_id = ?')
    .all(guildId) as any[]);
}