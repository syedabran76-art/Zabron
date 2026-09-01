/**
 * Zabron — Prefix command dispatcher.
 *
 * Parses incoming messages for the configured guild prefix and
 * dispatches them to the same CommandContext pipeline that slash
 * commands use.
 */

import {
  Events,
  Message,
  PermissionFlagsBits,
  GuildMember,
  User,
  ChannelType,
} from 'discord.js';

import type { CommandContext } from '../types/index.js';
import { getCommand } from './registry.js';
import { getGuildSettings } from '../db/repositories.js';
import { checkCooldown } from './cooldown.js';
import { logger } from '../utils/logger.js';
import { hasUserPermissions, hasBotPermissions, isGuildOwner, canActOn } from '../utils/permissions.js';

export function attachPrefixHandler(client: any): void {
  client.on(Events.MessageCreate, async (message: Message) => {
    if (!message.guild) return;
    if (message.author.bot) return;
    if (message.channel.type === ChannelType.DM) return;

    const settings = getGuildSettings(message.guild.id);
    const prefix = settings.prefix || '.';
    if (!message.content.startsWith(prefix)) return;

    const raw = message.content.slice(prefix.length).trim();
    if (!raw) return;
    const [name, ...rest] = raw.split(/\s+/);
    if (!name) return;

    const def = getCommand(name.toLowerCase());
    if (!def) return;

    const member = (await message.guild.members.fetch({ user: message.author.id, cache: false }).catch(() => null)) as GuildMember | null;
    const botMember = (await message.guild.members.fetchMe().catch(() => null)) as GuildMember | null;
    if (!member || !botMember) return;

    if (def.guildOnly === false) return;
    if (def.allowDm !== true && !message.guild) return;

    if (def.userPermissions && def.userPermissions.length) {
      const check = hasUserPermissions(member, def.userPermissions);
      if (!check.ok) {
        await message.reply({ content: check.reason ?? 'Insufficient permissions.' });
        return;
      }
    }
    if (def.botPermissions && def.botPermissions.length) {
      const check = hasBotPermissions(botMember, def.botPermissions);
      if (!check.ok) {
        await message.reply({ content: check.reason ?? 'Zabron is missing permissions.' });
        return;
      }
    }

    if (def.cooldownSeconds) {
      const cd = checkCooldown({
        guildId: message.guild.id,
        userId: message.author.id,
        command: def.name,
        seconds: def.cooldownSeconds,
      });
      if (!cd.allowed) {
        await message.reply({ content: `Please wait ${cd.displayRemaining} before using this command again.` });
        return;
      }
    }

    let args: Record<string, unknown> = {};
    try {
      if (def.parsePrefix) {
        args = await def.parsePrefix(message, rest);
      }
    } catch (err) {
      logger.warn('Prefix argument parsing failed', { command: def.name, err: String(err) });
      await message.reply({ content: `Invalid arguments: ${(err as Error).message}` });
      return;
    }

    const ctx: CommandContext = {
      source: 'prefix',
      guild: message.guild,
      user: message.author,
      member,
      interaction: undefined,
      message,
      channel: message.channel as any,
      args,
      raw: rest,
    };

    try {
      await def.run(ctx);
    } catch (err) {
      logger.error('Prefix command error', { command: def.name, err: String(err) });
      try {
        await message.reply('An unexpected error occurred while executing this command.');
      } catch {
        /* ignore */
      }
    }
  });
}

export { isGuildOwner, canActOn, hasUserPermissions, hasBotPermissions };