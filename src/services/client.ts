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

const STATUSES = [
  { name: 'Protecting your community', type: ActivityType.Watching },
  { name: '{guilds} servers', type: ActivityType.Watching },
  { name: 'Monitoring security', type: ActivityType.Playing },
  { name: '/help to get started', type: ActivityType.Listening },
];

let statusIndex = 0;
function rotatePresence(client: Client): void {
  const update = () => {
    const template = STATUSES[statusIndex % STATUSES.length];
    statusIndex++;
    const text = template.name.replace('{guilds}', String(client.guilds.cache.size));
    client.user?.setPresence({ activities: [{ name: text, type: template.type }], status: 'online' });
  };
  update();
  setInterval(update, 30_000).unref();
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
    rotatePresence(c);
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