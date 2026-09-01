/**
 * Zabron — Discord client bootstrap.
 */

import 'dotenv/config';

import { Client, GatewayIntentBits, Partials, ActivityType } from 'discord.js';

import { logger, logFromLevel } from '../utils/logger.js';
import { initDatabase } from '../db/database.js';
import { attachSlashHandler } from '../handlers/slashDispatcher.js';
import { attachPrefixHandler } from '../handlers/prefixDispatcher.js';
import { attachEventHandlers } from '../events/handlers.js';
import { configureAI } from '../ai/provider.js';
import { dueTempBans, dueChannelUnlocks, deleteTempBan, clearChannelLock, getActiveGiveaways, endGiveaway, getGiveawayEntries } from '../db/repositories.js';

/**
 * Background scheduler that:
 *   - unbans users whose temp-ban expired (restart-safe)
 *   - unlocks channels whose lock expired (restart-safe)
 *   - ends giveaways whose endsAt elapsed while the bot was offline
 *
 * Runs every 30s, idempotent, all errors swallowed. Timer is unref'd so
 * it never blocks process shutdown.
 */
function startScheduler(client: Client): void {
  const tick = async () => {
    try {
      const now = Date.now();

      // Temp bans
      for (const row of dueTempBans(now)) {
        try {
          const guild = await client.guilds.fetch(row.guildId).catch(() => null);
          await guild?.members.unban(row.userId, 'Temp ban expired').catch(() => {});
          deleteTempBan(row.guildId, row.userId);
        } catch (err) {
          logger.warn('temp-ban recovery failed', { err: String(err) });
        }
      }

      // Channel locks
      for (const row of dueChannelUnlocks(now)) {
        try {
          const guild = await client.guilds.fetch(row.guildId).catch(() => null);
          const channel = await guild?.channels.fetch(row.channelId).catch(() => null);
          if (channel && 'permissionOverwrites' in channel && guild) {
            const everyone = guild.roles.everyone;
            await (channel as any).permissionOverwrites.edit(everyone, { SendMessages: null }).catch(() => {});
          }
          clearChannelLock(row.guildId, row.channelId);
        } catch (err) {
          logger.warn('channel unlock recovery failed', { err: String(err) });
        }
      }

      // Giveaways
      for (const g of getActiveGiveaways()) {
        if (g.endsAt > now) continue;
        const entries = getGiveawayEntries(g.id);
        const winners: string[] = [];
        const pool = [...entries];
        while (winners.length < g.winnerCount && pool.length) {
          winners.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
        }
        endGiveaway(g.id, winners);
        try {
          const guild = await client.guilds.fetch(g.guildId).catch(() => null);
          const channel = guild ? await guild.channels.fetch(g.channelId).catch(() => null) : null;
          if (channel && 'send' in channel) {
            const list = winners.length ? winners.map((w) => `<@${w}>`).join(', ') : 'No entries.';
            await (channel as any).send({ content: `🎉 Giveaway **${g.prize}** ended. Winner${winners.length > 1 ? 's' : ''}: ${list}` });
          }
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      logger.warn('scheduler tick failed', { err: String(err) });
    }
  };

  // Run once immediately on boot to recover from downtime, then every 30s.
  void tick();
  const handle = setInterval(tick, 30_000);
  handle.unref?.();
}

// Re-exported so other modules can import scheduler helpers if needed.
export { startScheduler };

/**
 * Presence / activity rotation.
 *
 * Design principles:
 *   - Concise, professional text. Never exposes sensitive information
 *     (no guild names, no user IDs, no shard IDs, no internal counts).
 *   - Slow rotation (90s) so it never looks frantic. The rotation timer
 *     is unref'd so it never blocks shutdown.
 *   - A static "Starting up…" presence is set BEFORE Discord login via
 *     `applyStartupPresence()`, then a polished dynamic rotation begins
 *     once the gateway handshake completes (`ready` event).
 *   - Reconnect-safe: the rotation handles stale `guilds.cache` by
 *     simply reflecting the current cache size; if the cache is empty
 *     during a brief reconnect, the placeholder reads `—`.
 *   - Status is `online` while healthy.
 */
type PresenceTemplate = {
  /** Activity text. Use `{guilds}` as a placeholder for live count. */
  name: string;
  type: ActivityType;
};

/**
 * Static activity used while the bot is booting (before Discord login
 * completes) and during reconnects. Same string across the codebase
 * so the bot never advertises capabilities it does not own.
 */
const STARTING_PRESENCE: PresenceTemplate = {
  name: 'Starting up…',
  type: ActivityType.Watching,
};

/**
 * Rotating activity pool used after `ready` fires. Each entry is short,
 * semantic, and uses the {guilds} placeholder where dynamic data is
 * genuinely useful. Avoid noisy or spammy text.
 */
const ACTIVE_PRESENCES: PresenceTemplate[] = [
  { name: 'Protecting {guilds} servers',            type: ActivityType.Watching },
  { name: '/help · Protect · Automate · Manage',   type: ActivityType.Listening },
  { name: 'Monitoring security',                    type: ActivityType.Watching },
  { name: 'Securing your community',                type: ActivityType.Watching },
];

let presenceTimer: NodeJS.Timeout | null = null;
let presenceIndex = 0;

/**
 * Apply a single presence to the bot. No-op if the user isn't ready
 * yet (setPresence is silently dropped by discord.js in that case).
 */
function applyPresence(
  client: Client,
  template: PresenceTemplate,
  status: 'online' | 'idle' | 'dnd' | 'invisible' = 'online',
): void {
  if (!client.user) return;
  const guilds = client.guilds?.cache?.size ?? 0;
  const guildsDisplay = guilds > 0 ? String(guilds) : '—';
  const text = template.name.replace(/\{guilds\}/g, guildsDisplay);
  try {
    client.user.setPresence({
      activities: [{ name: text, type: template.type }],
      status,
    });
  } catch {
    /* swallow — presence updates are best-effort */
  }
}

/**
 * Apply the static "starting" presence. Called BEFORE client.login()
 * so users see a professional status immediately as the bot comes
 * online (within Discord's visibility window).
 */
export function applyStartupPresence(client: Client): void {
  applyPresence(client, STARTING_PRESENCE, 'online');
}

/**
 * Begin the polished presence rotation. Called from the `ready` event
 * so we have an authoritative guild count and stable identity.
 *
 * Replaces any previously installed rotation timer, so this is safe to
 * call from `ready` and from `reconnect`/manual `ready`-like hooks.
 */
function startPresenceRotation(client: Client): void {
  // Clear any prior rotation (e.g. from a reconnect).
  if (presenceTimer) {
    clearInterval(presenceTimer);
    presenceTimer = null;
  }
  presenceIndex = 0;
  // Render the first template immediately so users see a polished
  // activity right after `ready` fires — not the old startup text.
  applyPresence(
    client,
    ACTIVE_PRESENCES[presenceIndex % ACTIVE_PRESENCES.length],
    'online',
  );
  // Rotate every 90 seconds. Slow enough to feel curated, not spammy.
  presenceTimer = setInterval(() => {
    presenceIndex = (presenceIndex + 1) % ACTIVE_PRESENCES.length;
    applyPresence(client, ACTIVE_PRESENCES[presenceIndex], 'online');
  }, 90_000);
  presenceTimer.unref?.();
}

export function createClient(): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildInvites,
      GatewayIntentBits.GuildBans,
      GatewayIntentBits.GuildWebhooks,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember, Partials.User],
  });

  logger.configure(logFromLevel(process.env.LOG_LEVEL), process.env.LOG_LEVEL === 'debug');
  initDatabase();
  configureAI();

  client.once('ready', (c) => {
    logger.info('Zabron ready', { tag: c.user.tag, guilds: c.guilds.cache.size });
    startPresenceRotation(c);
  });

  // Reconnect/resume hooks. discord.js emits `reconnecting` while the
  // gateway is down and `ready` again when it recovers. We swap the
  // presence to the static "starting" template so users see a
  // professional status during the outage window. The rotation timer
  // is also cleared so it doesn't fire stale calls while disconnected.
  client.on('reconnecting', () => {
    logger.info('Discord reconnecting — switching to starting presence');
    if (presenceTimer) {
      clearInterval(presenceTimer);
      presenceTimer = null;
    }
    applyPresence(client, STARTING_PRESENCE, 'idle');
  });

  client.on('resume', (replayed) => {
    logger.info('Discord resume — restoring presence rotation', { replayed });
    startPresenceRotation(client);
  });

  client.on('error', (err) => logger.warn('Discord client error', { err: String(err) }));
  client.on('shardError', (err) => logger.warn('Shard error', { err: String(err) }));
  client.on('warn', (msg) => logger.warn('Discord warning', { msg }));
  client.on('rateLimit', (info) => logger.warn('Rate limited', { route: info.route, limit: info.limit }));

  attachSlashHandler(client);
  attachPrefixHandler(client);
  attachEventHandlers(client);
  startScheduler(client);

  return client;
}

export async function startBot(): Promise<void> {
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    logger.error('Missing DISCORD_TOKEN. Set it in your .env file.');
    process.exit(1);
  }
  const client = createClient();

  // Apply the static "Starting up…" presence BEFORE login so users see
  // a professional status as soon as Discord knows about the bot.
  // (setPresence is silently dropped by discord.js until `ready` fires,
  // but this guarantees we don't accidentally inherit stale data and
  // documents the intended presence contract.)
  applyStartupPresence(client);

  await client.login(token);

  process.on('unhandledRejection', (reason) => logger.error('Unhandled rejection', { reason: String(reason) }));
  process.on('uncaughtException', (err) => logger.error('Uncaught exception', { err: String(err) }));
  process.on('SIGINT', () => shutdown(client));
  process.on('SIGTERM', () => shutdown(client));
}

function shutdown(client: Client): void {
  logger.info('Shutting down...');
  client.destroy();
  process.exit(0);
}