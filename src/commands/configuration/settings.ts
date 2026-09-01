/**
 * /settings — View or tweak key guild settings.
 */

import { ChatInputCommandInteraction, Message, SlashCommandBuilder } from 'discord.js';

import type { CommandContext, CommandDefinition } from '../../types/index.js';
import { registerCommand } from '../../handlers/registry.js';
import { respond } from '../../handlers/respond.js';
import { buildEmbed } from '../../embeds/builders.js';
import { getGuildSettings } from '../../db/repositories.js';
import { getAntinukeConfig, getAntiraidConfig, getAutomodConfig } from '../../services/security.js';

const def: CommandDefinition = {
  name: 'settings',
  description: 'Show all current settings.',
  category: 'configuration',

  buildSlash() { return new SlashCommandBuilder().setName('settings').setDescription('Show all settings.'); },
  parseSlash() { return {}; },
  parsePrefix() { return {}; },

  async run(ctx: CommandContext) {
    if (!ctx.guild) return;
    const settings = getGuildSettings(ctx.guild.id);
    const an = getAntinukeConfig(ctx.guild.id);
    const ar = getAntiraidConfig(ctx.guild.id);
    const am = getAutomodConfig(ctx.guild.id);
    const features = [an.enabled, ar.enabled, am.enabled].filter(Boolean).length;
    const overall: '🟢' | '🟡' | '🔴' = features === 3 ? '🟢' : features > 0 ? '🟡' : '🔴';
    const overallLabel = features === 3 ? 'Fully protected' : features > 0 ? 'Partial protection' : 'No protections enabled';
    await respond(ctx, {
      embeds: [buildEmbed({
        tone: 'configuration',
        title: `⚙ Zabron Settings — ${overall} ${overallLabel}`,
        description: `Prefix: \`${settings.prefix}\``,
        fields: [
          { name: 'Panic mode', value: settings.panicMode ? '🟠 ACTIVE' : '🟢 Off', inline: true },
          { name: 'Antinuke', value: an.enabled ? '🟢 Enabled' : '🔴 Disabled', inline: true },
          { name: 'Antiraid', value: ar.enabled ? '🟢 Enabled' : '🔴 Disabled', inline: true },
          { name: 'Automod', value: am.enabled ? '🟢 Enabled' : '🔴 Disabled', inline: true },
          { name: 'Mod log channel', value: settings.modLogChannel ? `<#${settings.modLogChannel}>` : '—', inline: true },
        ],
      })],
    });
  },
};

registerCommand(def);
export default def;