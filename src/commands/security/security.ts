/**
 * /security — security dashboard (configure antinuke, antiraid, panic, automod, whitelist).
 */

import { ChatInputCommandInteraction, Message, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import type { CommandContext, CommandDefinition } from '../../types/index.js';
import { registerCommand } from '../../handlers/registry.js';
import { respond } from '../../handlers/respond.js';
import {
  getAntinukeConfig,
  getAntiraidConfig,
  getAutomodConfig,
  listWhitelist,
} from '../../services/security.js';
import { getGuildSettings } from '../../db/repositories.js';
import { buildEmbed } from '../../embeds/builders.js';

const def: CommandDefinition = {
  name: 'security',
  description: 'Show security dashboard and run interactive setup.',
  category: 'security',
  userPermissions: ['ManageGuild'],
  cooldownSeconds: 5,

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('security')
      .setDescription('Open the security dashboard.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
  },

  parseSlash() { return {}; },
  parsePrefix() { return {}; },

  async run(ctx: CommandContext) {
    if (!ctx.guild) return;
    const settings = getGuildSettings(ctx.guild.id);
    const an = getAntinukeConfig(ctx.guild.id);
    const ar = getAntiraidConfig(ctx.guild.id);
    const am = getAutomodConfig(ctx.guild.id);
    const whitelist = listWhitelist(ctx.guild.id);

    const embed = buildEmbed({
      tone: 'security',
      title: 'Security Dashboard',
      description: 'Real-time status of every protection layer.',
      fields: [
        { name: 'Antinuke', value: an.enabled ? '🟢 Enabled' : '🔴 Disabled', inline: true },
        { name: 'Antiraid', value: ar.enabled ? '🟢 Enabled' : '🔴 Disabled', inline: true },
        { name: 'Automod', value: am.enabled ? '🟢 Enabled' : '🔴 Disabled', inline: true },
        { name: 'Panic Mode', value: settings.panicMode ? '🟠 ACTIVE' : '🟢 Off', inline: true },
        { name: 'Whitelist', value: `${whitelist.length} entries`, inline: true },
        { name: 'Ban threshold', value: `${an.thresholdBans} / ${an.windowSeconds}s`, inline: true },
        { name: 'Kick threshold', value: `${an.thresholdKicks} / ${an.windowSeconds}s`, inline: true },
        { name: 'Channel threshold', value: `${an.thresholdChannels} / ${an.windowSeconds}s`, inline: true },
        { name: 'Role threshold', value: `${an.thresholdRoles} / ${an.windowSeconds}s`, inline: true },
      ],
    });
    await respond(ctx, { embeds: [embed] });
  },
};

registerCommand(def);
export default def;