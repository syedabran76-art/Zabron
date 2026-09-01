/**
 * Zabron — Entry point.
 *
 * The bot's primary runtime. Imports every command module so each one
 * self-registers, then starts the Discord client.
 */

import { startBot } from './services/client.js';
import { logger } from './utils/logger.js';

// Side-effect: register every command with the registry.
// Single source of truth: src/commands/index.ts
import './commands/index.js';

import { listCommands } from './handlers/registry.js';

logger.info('Starting Zabron...', { commands: listCommands().length });

startBot().catch((err) => {
  logger.error('Fatal startup error', { err: String(err) });
  process.exit(1);
});
