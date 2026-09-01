/**
 * Zabron — Slash command registration script.
 *
 * Run with `npm run register` after configuring CLIENT_ID / DEV_GUILDS.
 */

import 'dotenv/config';

import { REST, Routes } from 'discord.js';

import { logger } from '../utils/logger.js';
import { listCommands } from './registry.js';

// Side-effect: load every command module so the registry is populated
// before we read it. This is the same import the bot's main entry point
// uses (src/index.ts -> src/commands/index.ts).
import '../commands/index.js';

export async function registerSlashCommands(): Promise<void> {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.CLIENT_ID;
  if (!token || !clientId) {
    logger.error('DISCORD_TOKEN and CLIENT_ID are required.');
    process.exit(1);
  }

  const defs = listCommands();
  const payload = defs.map((d) => {
    const built = d.buildSlash();
    if ('toJSON' in built && typeof (built as any).toJSON === 'function') {
      return (built as any).toJSON();
    }
    return built;
  });

  const rest = new REST({ version: '10' }).setToken(token);
  const guilds = process.env.DEV_GUILDS?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];

  if (guilds.length) {
    for (const guildId of guilds) {
      logger.info(`Registering ${payload.length} slash commands for ${guildId}`);
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: payload });
    }
  } else {
    logger.info(`Registering ${payload.length} global slash commands`);
    await rest.put(Routes.applicationCommands(clientId), { body: payload });
  }
  logger.info('Slash command registration complete.');
}

// Minimal CLI entry point: only run when this file is executed directly
// (`npm run register` -> `node dist/handlers/registerCommands.js`), not when
// imported as a module.
if (require.main === module) {
  registerSlashCommands().catch((err) => {
    logger.error(`Slash command registration failed: ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof Error && err.stack) {
      logger.error(err.stack);
    }
    process.exit(1);
  });
}