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
  mentionHelpEmbed,
  supportButtonRow,
  WELCOME_COLOR,
} from '../embeds/builders.js';
import { getSupportServerUrl } from '../config/support.js';
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
 * Test-only hook to reset idempotency state between cases.
 * NOT exported through any public API — only used by tests/onboarding.test.ts.
 */
export function __resetWelcomeStateForTests(): void {
  welcomedGuilds.clear();
}

/** Whether a guild has already been welcomed in this process run. */
export function hasAlreadyWelcomed(guildId: string): boolean {
  return welcomedGuilds.has(guildId);
}

/** Mark a guild as welcomed (idempotent: marking twice is a no-op). */
function markWelcomed(guildId: string): void {
  welcomedGuilds.add(guildId);
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