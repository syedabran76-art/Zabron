/**
 * Zabron — Onboarding service.
 *
 * Centralised module that:
 *   1. Decides WHERE to send the welcome message when the bot joins
 *      a new guild. Preference order:
 *        a) The guild's configured `systemChannel` — if the bot has
 *           SendMessages + EmbedLinks there.
 *        b) The first text-like channel where the bot has
 *           ViewChannel + SendMessages + EmbedLinks.
 *        c) If neither works, fail SILENTLY — never crash, never DM
 *           random members, never guess who invited the bot.
 *   2. Builds the welcome payload (embed + optional Support button).
 *   3. Performs the actual `send()` and reports whether it landed.
 *
 * Idempotency: we keep an in-memory `Set<string>` of guild IDs that
 * have already received a welcome message in the current process.
 * Discord emits `GuildCreate` on every reconnect as well, so without
 * this guard a brief network blip would trigger a duplicate welcome.
 * The set is intentionally per-process — a bot restart legitimately
 * warrants a fresh greeting if Discord replays the event.
 *
 * This module is the SOLE place that knows how to onboard a guild.
 * The event handler in src/events/handlers.ts calls
 * `sendGuildWelcomeMessage(guild)` and never reaches into the channel
 * selection logic directly.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  AuditLogEvent,
  ChannelType,
  Guild,
  GuildChannel,
  MessageCreateOptions,
  PermissionFlagsBits,
  PermissionsBitField,
} from 'discord.js';

import { getGuildSettings } from '../db/repositories.js';
import {
  welcomeEmbed,
  inviterDmEmbed,
  mentionHelpEmbed,
  supportButtonRow,
  WELCOME_COLOR,
} from '../embeds/builders.js';
import { getSupportServerUrl } from '../config/support.js';
import { resolveAuditExecutor, ActorInfo } from './logging.js';
import { logger } from '../utils/logger.js';

/**
 * Channel types the bot can send an embed into. We deliberately
 * exclude Forums (no `.send()`), DM channels and DMs with bots.
 */
const SENDABLE_CHANNEL_TYPES: ReadonlySet<ChannelType> = new Set<ChannelType>([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread,
  // Voice / Stage channels technically accept `.send()` for status
  // messages, but admins rarely expect them to host onboarding copy.
  // We include them in the FALLBACK path so the bot never silently
  // fails when a server has no text channels at all.
  ChannelType.GuildVoice,
  ChannelType.GuildStageVoice,
]);

/**
 * Permissions the bot needs in order to send a polished embed.
 *
 * ViewChannel is required to even SEE the channel in cache; the
 * SendMessages / EmbedLinks pair lets us deliver the rich onboarding
 * card. Without EmbedLinks the embed is silently downgraded by
 * Discord into URL-only text, which would ruin the experience.
 */
const REQUIRED_BOT_PERMS: ReadonlyArray<keyof typeof PermissionFlagsBits> = [
  'ViewChannel',
  'SendMessages',
  'EmbedLinks',
];

export type WelcomeSendStatus =
  | 'sent'
  | 'duplicate'        // already sent this process run
  | 'no-system-channel'
  | 'no-permissions'
  | 'send-failed';

export interface WelcomeSendResult {
  status: WelcomeSendStatus;
  /** ID of the channel we sent the welcome message to, when applicable. */
  channelId?: string;
  /** Reason for the outcome (mostly for logging/debugging). */
  reason?: string;
}

// ---------------------------------------------------------------------------
// Idempotency tracking
// ---------------------------------------------------------------------------

/**
 * Guilds we have already welcomed in this process. Cleared on restart,
 * which is intentional: a restart is a legitimate moment to re-introduce
 * ourselves if Discord replays GuildCreate.
 */
const welcomedGuilds = new Set<string>();

/**
 * Guilds for which we have already attempted the inviter DM in this
 * process. Kept SEPARATE from {@link welcomedGuilds} so the public
 * welcome and the inviter DM never block each other on the very first
 * GuildCreate event — the welcome doesn't know whether the DM
 * succeeded, and vice versa.
 *
 * Why this exists:
 *   - Discord replays GuildCreate on every reconnect. Without a guard,
 *     a brief network blip would trigger a duplicate "thanks for
 *     inviting me" DM.
 *   - The guard is intentionally per-process. A bot restart legitimately
 *     warrants a fresh DM if Discord replays the event.
 */
const inviterDmSentGuilds = new Set<string>();

/**
 * Test-only hook to reset idempotency state between cases.
 * NOT exported through any public API — only used by tests/onboarding.test.ts.
 */
export function __resetWelcomeStateForTests(): void {
  welcomedGuilds.clear();
  inviterDmSentGuilds.clear();
}

/** Whether a guild has already been welcomed in this process run. */
export function hasAlreadyWelcomed(guildId: string): boolean {
  return welcomedGuilds.has(guildId);
}

/** Mark a guild as welcomed (idempotent: marking twice is a no-op). */
function markWelcomed(guildId: string): void {
  welcomedGuilds.add(guildId);
}

/**
 * Whether a guild has already had an inviter DM attempt (sent or
 * skipped) in this process run.
 */
export function hasAlreadyAttemptedInviterDm(guildId: string): boolean {
  return inviterDmSentGuilds.has(guildId);
}

/**
 * Mark a guild as having had an inviter DM attempt (idempotent:
 * marking twice is a no-op). We mark regardless of outcome (sent or
 * skipped) so a reconnect never re-attempts a guild we already know
 * we couldn't DM.
 */
function markInviterDmAttempted(guildId: string): void {
  inviterDmSentGuilds.add(guildId);
}

// ---------------------------------------------------------------------------
// Channel selection
// ---------------------------------------------------------------------------

/**
 * Determine whether `channel` is a text-like channel we can `.send()` into.
 *
 * Accepts the wider GuildBasedChannel union because every concrete
 * channel type implements `.send()` in v14 (we map to a stricter
 * GuildChannel below where it matters).
 *
 * Exported for tests; not part of the public runtime API.
 */
export function isSendableTextChannel(
  channel: { type: ChannelType } | undefined | null,
): boolean {
  if (!channel) return false;
  return SENDABLE_CHANNEL_TYPES.has(channel.type);
}

/**
 * Check whether the bot has the perms required to render a polished
 * embed in `channel`. Returns `true` when ALL required permissions are
 * present. We use `channel.permissionsFor(guild.members.me)` so the
 * check respects per-channel overwrites.
 */
export function botCanSendWelcome(
  channel: GuildChannel,
  guild: Guild,
): { ok: boolean; missing: string[] } {
  const me = guild.members?.me;
  if (!me) {
    // The bot's own GuildMember hasn't populated yet (very fresh
    // session). Fall back to PermissionsBitField defaults — this is
    // rare and worst case the subsequent send() will fail and be
    // caught by the try/catch in sendGuildWelcomeMessage().
    const fallback = new PermissionsBitField(channel.guild?.roles?.everyone?.permissions?.bitfield ?? 0n);
    const missing: string[] = [];
    for (const permName of REQUIRED_BOT_PERMS) {
      if (!fallback.has(permName as any)) missing.push(permName);
    }
    return { ok: missing.length === 0, missing };
  }
  const perms = channel.permissionsFor(me);
  if (!perms) {
    return { ok: false, missing: [...REQUIRED_BOT_PERMS] };
  }
  const missing: string[] = [];
  for (const permName of REQUIRED_BOT_PERMS) {
    if (!perms.has(permName as any)) missing.push(permName);
  }
  return { ok: missing.length === 0, missing };
}

type SendableGuildChannel = GuildChannel & {
  send: (options?: unknown) => Promise<unknown>;
};

/**
 * Choose the first acceptable channel using the documented preference:
 *   1. System channel (if usable)
 *   2. First channel in the cache where the bot has the required perms
 *
 * Returns `null` when no channel is suitable.
 */
export function pickWelcomeChannel(
  guild: Guild,
): { channel: SendableGuildChannel; reason: string } | null {
  // 1. System channel.
  // Discord exposes it via guild.systemChannel. It may be null on small
  // guilds that haven't enabled Community features. We tolerate both.
  const sys = guild.systemChannel;
  if (sys && isSendableTextChannel(sys)) {
    const check = botCanSendWelcome(sys, guild);
    if (check.ok) {
      return { channel: sys as SendableGuildChannel, reason: 'system-channel' };
    }
    logger.debug?.('onboarding: system channel rejected', {
      guildId: guild.id,
      channelId: sys.id,
      missing: check.missing,
    });
  }

  // 2. Fallback: scan every channel in the cache (text-like only).
  const channels = Array.from(guild.channels.cache.values()) as GuildChannel[];
  // Sort by position so the "first" channel is deterministic.
  // `position` is on GuildChannel; threads inherit it through their parent.
  channels.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  for (const ch of channels) {
    if (!isSendableTextChannel(ch)) continue;
    const check = botCanSendWelcome(ch, guild);
    if (check.ok) {
      // All entries in SENDABLE_CHANNEL_TYPES have `.send()`; the cast
      // is safe and keeps callers from having to re-narrow.
      return {
        channel: ch as SendableGuildChannel,
        reason: 'fallback',
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Welcome message construction
// ---------------------------------------------------------------------------

/**
 * Build the complete `MessageCreateOptions` payload for a guild welcome.
 * Exported so tests can inspect the exact payload without doing a real send.
 */
export function buildWelcomePayload(guild: Guild): {
  payload: MessageCreateOptions;
  supportConfigured: boolean;
} {
  const settings = getGuildSettings(guild.id);
  const prefix = settings.prefix || '.';
  const supportUrl = getSupportServerUrl();

  const embed = welcomeEmbed({
    guildName: guild.name,
    prefix,
    supportUrl,
  });

  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  const supportRow = supportButtonRow({ supportUrl });
  if (supportRow) components.push(supportRow);

  // Touch the constant so future palette changes don't go unnoticed by
  // tree-shakers; the embed's tone already drives the actual color.
  void WELCOME_COLOR;

  const payload: MessageCreateOptions = {
    embeds: [embed],
    components: components.length ? components : undefined,
    // Welcome messages intentionally do not mention anyone by default.
    allowedMentions: { parse: [] },
  };
  return { payload, supportConfigured: !!supportUrl };
}

// ---------------------------------------------------------------------------
// Public entry point — invoked by the GuildCreate event handler
// ---------------------------------------------------------------------------

/**
 * Send the welcome message to a freshly-joined guild.
 *
 * Behaviour:
 *   - Returns `{ status: 'duplicate' }` if this process has already
 *     welcomed the guild (Discord re-emits GuildCreate on reconnects).
 *   - Picks the best channel (system, then fallback) and sends the
 *     embed; on success marks the guild as welcomed and returns
 *     `{ status: 'sent', channelId }`.
 *   - On `no suitable channel` or `permission failure` returns a
 *     structured failure status WITHOUT throwing. The caller can
 *     log this if desired; we never crash the gateway.
 *
 * This function is the ONLY public surface for sending a welcome
 * message; do not call channel.send() directly from elsewhere.
 */
export async function sendGuildWelcomeMessage(guild: Guild): Promise<WelcomeSendResult> {
  if (!guild) return { status: 'no-system-channel', reason: 'no-guild' };

  // Idempotency: do not spam welcomes across reconnects.
  if (welcomedGuilds.has(guild.id)) {
    return { status: 'duplicate', reason: 'already-welcomed-this-process' };
  }

  const picked = pickWelcomeChannel(guild);
  if (!picked) {
    logger.warn?.('onboarding: no suitable welcome channel', { guildId: guild.id });
    return { status: 'no-system-channel', reason: 'no-channel-with-perms' };
  }

  const { payload, supportConfigured } = buildWelcomePayload(guild);

  try {
    await picked.channel.send(payload);
    markWelcomed(guild.id);
    logger.info('onboarding: welcome message sent', {
      guildId: guild.id,
      channelId: picked.channel.id,
      reason: picked.reason,
      supportConfigured,
    });
    return { status: 'sent', channelId: picked.channel.id, reason: picked.reason };
  } catch (err) {
    // Failure here is non-fatal — the bot still works in the guild.
    logger.warn('onboarding: welcome send failed', {
      guildId: guild.id,
      channelId: picked.channel.id,
      err: (err as Error).message,
    });
    return { status: 'send-failed', channelId: picked.channel.id, reason: (err as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Bot mention reply payload — for src/events/handlers.ts
// ---------------------------------------------------------------------------

/**
 * Build the mention-reply payload. Always uses the GUILD's current
 * prefix from the repository; never hardcodes a value.
 */
export function buildMentionReplyPayload(guildId: string): {
  payload: MessageCreateOptions;
  supportConfigured: boolean;
} {
  const settings = getGuildSettings(guildId);
  const prefix = settings.prefix || '.';
  const supportUrl = getSupportServerUrl();

  const embed = mentionHelpEmbed({ prefix, supportUrl });

  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  const supportRow = supportButtonRow({ supportUrl });
  if (supportRow) components.push(supportRow);

  const payload: MessageCreateOptions = {
    embeds: [embed],
    components: components.length ? components : undefined,
    allowedMentions: { parse: [] },
  };
  return { payload, supportConfigured: !!supportUrl };
}

// ---------------------------------------------------------------------------
// Inviter DM — sent to the user who added Zabron to the guild
// ---------------------------------------------------------------------------

/**
 * Maximum age (ms) for a `BotAdd` audit entry to be considered the
 * current onboarding event. We pick a generous window (5 min) because
 * audit log entries can lag behind the gateway event during heavy
 * Discord load. This is well below Discord's prune window (~45 days)
 * but large enough to cover the worst-case latency.
 */
const INVITER_AUDIT_MAX_AGE_MS = 5 * 60_000;

/**
 * Number of recent audit-log entries to scan when looking for the
 * `BotAdd` action. 25 is a comfortable default; a busy guild can have
 * dozens of entries per minute and we want to be confident the BotAdd
 * entry is included in our slice.
 */
const INVITER_AUDIT_LIMIT = 25;

export type InviterResolutionStatus =
  | 'resolved'           // Successfully resolved the inviter user ID.
  | 'no-audit-permission' // Bot lacks VIEW_AUDIT_LOG.
  | 'no-matching-entry'   // No recent BotAdd entry for the bot.
  | 'no-executor'         // Entry found but has no executor field.
  | 'wrong-target'        // Entry's target does not match the bot's user ID.
  | 'audit-error';        // Discord API failure during audit log fetch.

export interface InviterResolution {
  status: InviterResolutionStatus;
  /** The inviter's ActorInfo (only present when status === 'resolved'). */
  inviter?: ActorInfo;
  /** Diagnostic reason for logging/debugging. */
  reason?: string;
}

/**
 * Resolve the Discord user who just invited/added Zabron to a guild.
 *
 * Strategy:
 *   1. Fetch the guild's recent audit log (limited, no type filter).
 *   2. Look for the `AuditLogEvent.BotAdd` action. Discord creates this
 *      entry whenever a bot user joins a guild.
 *   3. Match the entry's `targetId` to Zabron's own user ID
 *      (`client.user.id`). This guarantees we never attribute the
 *      wrong bot-add (Discord also writes BotAdd entries when OTHER
 *      bots join; we only care about the one that added us).
 *   4. Use the entry's `executor` as the inviter.
 *
 * Failure modes (all return a structured `InviterResolution` instead
 * of throwing):
 *   - `no-audit-permission`: Bot lacks `ViewAuditLog`.
 *   - `no-matching-entry`:   No recent BotAdd entry exists (vanishingly
 *                            rare in practice; usually means the entry
 *                            was pruned).
 *   - `no-executor`:         Entry exists but has no executor field
 *                            (e.g. Discord webhook actions).
 *   - `wrong-target`:        Defensive — a BotAdd for a different bot.
 *   - `audit-error`:         Discord API rejection (rate limit, etc.).
 *
 * We deliberately do NOT guess the inviter from guild member listings.
 * The audit log is the authoritative source of "who clicked the
 * authorize button", and we only attribute when we have an actual
 * match.
 */
export async function detectInviter(
  guild: Guild,
  botUserId: string,
): Promise<InviterResolution> {
  if (!guild || !botUserId) {
    return { status: 'audit-error', reason: 'missing-guild-or-bot-user-id' };
  }

  // Permission pre-check: fetchAuditLogs returns 403 when the bot lacks
  // VIEW_AUDIT_LOG. We could optimistically try-and-catch, but the
  // explicit pre-check gives us a more accurate status code for logs.
  const me = guild.members?.me;
  if (me) {
    const perms = me.permissions;
    if (!perms || !perms.has(PermissionFlagsBits.ViewAuditLog)) {
      logger.debug?.('onboarding: bot lacks ViewAuditLog; skipping inviter DM', { guildId: guild.id });
      return { status: 'no-audit-permission', reason: 'missing-ViewAuditLog' };
    }
  }

  let resolution;
  try {
    resolution = await resolveAuditExecutor({
      guild,
      action: AuditLogEvent.BotAdd,
      // The BotAdd entry's targetId is the added bot's user ID. We
      // require it to match Zabron's ID so we never attribute the
      // wrong bot-add (other bots joining the same guild within the
      // window would also produce BotAdd entries).
      targetId: botUserId,
      maxAgeMs: INVITER_AUDIT_MAX_AGE_MS,
      limit: INVITER_AUDIT_LIMIT,
    });
  } catch (err) {
    logger.warn('onboarding: detectInviter audit fetch threw', {
      guildId: guild.id,
      err: (err as Error).message,
    });
    return { status: 'audit-error', reason: (err as Error).message };
  }

  if (!resolution.entry) {
    // No matching entry in the recent slice. Two possibilities:
    //   a) Audit log lag → we used a 5min window; if the entry is
    //      still missing after that, it has likely been pruned or
    //      the audit log was truncated.
    //   b) The bot was re-added or the audit log was reset.
    return { status: 'no-matching-entry', reason: 'no-BotAdd-in-window' };
  }

  // The resolver already enforces the targetId match, but we double-
  // check here as a defence-in-depth measure so a future change to the
  // resolver cannot accidentally let a non-matching entry through.
  if (resolution.entry.targetId !== botUserId) {
    return { status: 'wrong-target', reason: `targetId=${resolution.entry.targetId ?? 'null'}` };
  }

  if (!resolution.executor) {
    return { status: 'no-executor', reason: 'entry-without-executor' };
  }

  return { status: 'resolved', inviter: resolution.executor };
}

/**
 * Build the MessageCreateOptions payload sent to the inviter's DMs.
 * Exported so tests can inspect the exact payload without doing a
 * real send.
 */
export function buildInviterDmPayload(): {
  payload: MessageCreateOptions;
  supportConfigured: boolean;
} {
  const supportUrl = getSupportServerUrl();

  const embed = inviterDmEmbed({ supportUrl });

  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  const supportRow = supportButtonRow({ supportUrl });
  if (supportRow) components.push(supportRow);

  const payload: MessageCreateOptions = {
    embeds: [embed],
    components: components.length ? components : undefined,
    // No mention parsing — DMs already address the recipient.
    allowedMentions: { parse: [] },
  };
  return { payload, supportConfigured: !!supportUrl };
}

export type InviterDmStatus =
  | 'sent'        // DM landed in the inviter's DMs.
  | 'duplicate'   // Already sent for this onboarding event.
  | 'no-inviter'  // Could not resolve the inviter.
  | 'self-add'    // Inviter IS the bot (no need to DM itself).
  | 'dm-failed'   // User has DMs disabled or rejected the DM.
  | 'no-bot-user' // Bot user ID is not available (test stub edge case).
  | 'no-client';  // Client reference missing.

export interface InviterDmResult {
  status: InviterDmStatus;
  /** Inviter user ID, when known. */
  inviterId?: string;
  /** Optional diagnostic reason. */
  reason?: string;
}

/**
 * Send the polished "thanks for inviting me" DM to the user who just
 * added Zabron to `guild`.
 *
 * Behaviour contract:
 *   - Idempotent: one DM per onboarding event (per process run). Same
 *     Set used by the public welcome — both flows are tied to the
 *     GuildCreate lifecycle.
 *   - Never crashes on:
 *       * Missing/inaccessible audit log (no inviter → skip).
 *       * Inviter has DMs disabled or has blocked the bot.
 *       * Discord API rejection (rate limit, network).
 *   - Never DM's every guild member. The recipient is always the
 *     resolved inviter or nobody.
 *   - Does NOT retry aggressively. One attempt, then silently bail.
 *
 * This is the SOLE entry point for inviter DMs. Event handlers must
 * call this rather than fetching the audit log and DMing manually.
 */
export async function sendInviterDm(
  guild: Guild,
  client: { user?: { id?: string } | null } | null | undefined,
): Promise<InviterDmResult> {
  if (!guild) return { status: 'no-inviter', reason: 'no-guild' };
  if (!client) return { status: 'no-client', reason: 'no-client' };

  const botUserId = client.user?.id;
  if (!botUserId) return { status: 'no-bot-user', reason: 'bot-user-id-unknown' };

  // Idempotency: per-process guard against duplicate DMs on reconnect.
  // We use a DEDICATED Set (separate from the public welcome's dedup
  // set) so the two flows don't block each other on the very first
  // GuildCreate. The guard covers every outcome (sent, skipped,
  // rejected) so a reconnect never re-attempts a guild we already
  // processed — that would be the "aggressive retry" path we want to
  // avoid.
  if (inviterDmSentGuilds.has(guild.id)) {
    return { status: 'duplicate', reason: 'already-attempted-this-process' };
  }

  // Resolve the inviter. Failures are STRUCTURAL — we do not retry
  // and we do not guess.
  const resolution = await detectInviter(guild, botUserId);
  if (resolution.status !== 'resolved' || !resolution.inviter) {
    logger.info('onboarding: inviter DM skipped', {
      guildId: guild.id,
      status: resolution.status,
      reason: resolution.reason,
    });
    // Still mark the attempt: we don't want a reconnect to keep
    // trying to detect the inviter for the same guild, because the
    // conditions won't change within the lifetime of this process.
    markInviterDmAttempted(guild.id);
    return { status: 'no-inviter', reason: resolution.status };
  }

  const inviter = resolution.inviter;

  // Defensive: never DM the bot itself. (Can happen if a stale audit
  // entry somehow points back to the bot.)
  if (inviter.id === botUserId) {
    markInviterDmAttempted(guild.id);
    return { status: 'self-add', inviterId: inviter.id, reason: 'inviter-is-bot' };
  }

  // Build payload BEFORE attempting the send so that even a missing
  // support URL doesn't affect DM-send correctness.
  const { payload, supportConfigured } = buildInviterDmPayload();

  // Attempt the DM. Errors are caught and surfaced as a structured
  // failure status — they NEVER crash the gateway.
  try {
    // We use the raw client.users.fetch + send() path because the
    // AuditLogEvent.BotAdd entry gives us an Executor with id+tag,
    // not a full User object. Fetching the User gives us a fresh
    // object whose .createDM() / .send() can deliver the message.
    const user = await (client as any).users?.fetch?.(inviter.id);
    if (!user || typeof user.send !== 'function') {
      logger.info('onboarding: inviter DM skipped — user not fetchable', {
        guildId: guild.id,
        inviterId: inviter.id,
      });
      // Mark as attempted so a reconnect doesn't retry.
      markInviterDmAttempted(guild.id);
      return { status: 'dm-failed', inviterId: inviter.id, reason: 'user-not-fetchable' };
    }

    await user.send(payload);

    // Mark the attempt on success so a reconnect doesn't re-send.
    markInviterDmAttempted(guild.id);

    logger.info('onboarding: inviter DM sent', {
      guildId: guild.id,
      inviterId: inviter.id,
      inviterTag: inviter.tag,
      supportConfigured,
    });

    return { status: 'sent', inviterId: inviter.id };
  } catch (err) {
    const reason = (err as Error).message ?? 'unknown';
    logger.info('onboarding: inviter DM rejected', {
      guildId: guild.id,
      inviterId: inviter.id,
      inviterTag: inviter.tag,
      reason,
    });
    // Mark the attempt on failure so a reconnect doesn't keep
    // hammering a user who has DMs disabled. Single best-effort
    // attempt per onboarding event — Discord's "blocked"/"DMs closed"
    // state is sticky and won't change within this process lifetime.
    markInviterDmAttempted(guild.id);
    return { status: 'dm-failed', inviterId: inviter.id, reason };
  }
}