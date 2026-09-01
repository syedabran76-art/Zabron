/**
 * Zabron — Slash command dispatcher.
 *
 * Translates Discord ChatInputCommandInteraction events into the
 * shared CommandContext and runs the matching registered command.
 */

import {
  ChatInputCommandInteraction,
  Events,
  Interaction,
} from 'discord.js';

import type { CommandContext } from '../types/index.js';
import { getCommand } from './registry.js';
import { checkCooldown } from './cooldown.js';
import {
  hasBotPermissions,
  hasUserPermissions,
  hasPermissionForBitfield,
  permissionToName,
} from '../utils/permissions.js';
import { logger } from '../utils/logger.js';

export function attachSlashHandler(client: any): void {
  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    if (!interaction.isChatInputCommand()) return;
    await runSlash(interaction);
  });
}

async function runSlash(interaction: ChatInputCommandInteraction): Promise<void> {
  const def = getCommand(interaction.commandName);
  if (!def) {
    await replySlash(interaction, `Unknown command: ${interaction.commandName}`);
    return;
  }
  if (def.guildOnly !== false && !interaction.guild) {
    await replySlash(interaction, 'This command can only be used in a server.');
    return;
  }

  // Permission parity with prefix dispatcher — Discord's `default_member_permissions`
  // only enforces on initial install, not when admins edit the command afterwards.
  // Re-check at runtime so we never silently let a user bypass intended perms.
  if (interaction.guild && interaction.member) {
    if (def.userPermissions && def.userPermissions.length) {
      const member = interaction.member as any;
      // For interaction payloads, `member.permissions` is a raw permission string
      // (the bitfield as a decimal string), not a GuildMember object.
      // We use the centralized hasPermissionForBitfield() helper which delegates
      // to discord.js's PermissionsBitField.has() — that natively accepts string
      // permission names ("ManageGuild") AND bigint AND number without ever
      // calling BigInt("ManageGuild") ourselves.
      let rawPerms: string | bigint | undefined;
      if (typeof member.permissions === 'bigint' || typeof member.permissions === 'string') {
        rawPerms = member.permissions;
      } else {
        const fetched = await interaction.guild.members
          .fetch(interaction.user.id)
          .catch(() => null);
        if (fetched) rawPerms = fetched.permissions.bitfield;
      }
      if (rawPerms !== undefined) {
        const missing = def.userPermissions.filter(
          (p) => !hasPermissionForBitfield(rawPerms as string | bigint, p),
        );
        if (missing.length) {
          const names = missing.map(permissionToName).filter(Boolean).join(', ');
          await replySlash(
            interaction,
            `You are missing the following permission${missing.length > 1 ? 's' : ''}: ${names}.`,
            true,
          );
          return;
        }
      }
    }
    if (def.botPermissions && def.botPermissions.length) {
      const me = await interaction.guild.members.fetchMe().catch(() => null);
      if (me) {
        const check = hasBotPermissions(me, def.botPermissions);
        if (!check.ok) {
          await replySlash(interaction, check.reason ?? 'Zabron is missing permissions.', true);
          return;
        }
      }
    }
  }

  let args: Record<string, unknown> = {};
  try {
    if (def.parseSlash) {
      args = await def.parseSlash(interaction);
    }
  } catch (err) {
    logger.warn('Slash argument parsing failed', { command: def.name, err: String(err) });
    await replySlash(interaction, `Invalid arguments: ${(err as Error).message}`);
    return;
  }

  const ctx: CommandContext = {
    source: 'slash',
    guild: interaction.guild,
    user: interaction.user,
    member: interaction.member as any,
    interaction,
    message: undefined,
    channel: interaction.channel as any,
    args,
    raw: [],
  };

  if (def.cooldownSeconds && interaction.guildId) {
    const cd = checkCooldown({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      command: def.name,
      seconds: def.cooldownSeconds,
    });
    if (!cd.allowed) {
      await replySlash(interaction, `Please wait ${cd.displayRemaining} before using this command again.`, true);
      return;
    }
  }

  try {
    await def.run(ctx);
  } catch (err) {
    logger.error('Slash command error', { command: def.name, err: String(err) });
    await replySlash(interaction, 'An unexpected error occurred while executing this command. The incident has been logged.');
  }
}

async function replySlash(interaction: ChatInputCommandInteraction, message: string, ephemeral = true): Promise<void> {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: message, ephemeral });
    } else {
      await interaction.reply({ content: message, ephemeral });
    }
  } catch (err) {
    logger.warn('Failed to reply to slash interaction', { err: String(err) });
  }
}