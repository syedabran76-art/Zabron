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

    // Compute a top-level security status by inspecting the protection
    // layers. Any disabled protection while panic is off = degraded.
    const layers = [an.enabled, ar.enabled, am.enabled];
    const allArmed = layers.every(Boolean) && !settings.panicMode;
    const overall = settings.panicMode
      ? '🟠'
      : allArmed ? '🟢' : layers.some(Boolean) ? '🟡' : '🔴';
    const statusLabel = settings.panicMode
      ? 'PANIC MODE ACTIVE'
      : allArmed ? 'All systems armed' : 'Partial coverage';

    const embed = buildEmbed({
      tone: 'security',
      title: `🛡 Security Dashboard — ${overall} ${statusLabel}`,
      description: 'Real-time status of every protection layer.',
      fields: [
        { name: 'Antinuke', value: an.enabled ? '🟢 Enabled' : '🔴 Disabled', inline: true },
        { name: 'Antiraid', value: ar.enabled ? '🟢 Enabled' : '🔴 Disabled', inline: true },
        { name: 'Automod', value: am.enabled ? '🟢 Enabled' : '🔴 Disabled', inline: true },
        { name: 'Panic Mode', value: settings.panicMode ? '🟠 ACTIVE' : '🟢 Off', inline: true },
        { name: 'Whitelist', value: `\`${whitelist.length}\` entr${whitelist.length === 1 ? 'y' : 'ies'}`, inline: true },
        { name: 'Window', value: `\`${an.windowSeconds}s\``, inline: true },
        { name: 'Ban limit', value: `\`${an.thresholdBans}\``, inline: true },
        { name: 'Kick limit', value: `\`${an.thresholdKicks}\``, inline: true },
        { name: 'Channel limit', value: `\`${an.thresholdChannels}\``, inline: true },
        { name: 'Role limit', value: `\`${an.thresholdRoles}\``, inline: true },
        { name: 'Webhook limit', value: `\`${an.thresholdWebhooks}\``, inline: true },
        { name: 'Antinuke punish', value: `\`${an.punishAction}\``, inline: true },
      ],
    });
    await respond(ctx, { embeds: [embed] });
  },
};

registerCommand(def);
export default def;