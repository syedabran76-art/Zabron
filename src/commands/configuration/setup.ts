/**
 * /setup — Interactive onboarding wizard.
 */

import { ActionRowBuilder, ChannelType, ChatInputCommandInteraction, Message, PermissionFlagsBits, SlashCommandBuilder, StringSelectMenuBuilder } from 'discord.js';

import type { CommandContext, CommandDefinition } from '../../types/index.js';
import { registerCommand } from '../../handlers/registry.js';
import { respond } from '../../handlers/respond.js';
import { buildEmbed, configuration } from '../../embeds/builders.js';
import { setLoggingChannel, setLoggingEnabled } from '../../db/repositories.js';
import { LOG_CATEGORIES } from '../../types/index.js';
import { getAntinukeConfig, setAntinukeConfig } from '../../services/security.js';
import { getDatabase } from '../../db/database.js';

const def: CommandDefinition = {
  name: 'setup',
  description: 'Run the interactive setup wizard.',
  category: 'configuration',
  userPermissions: ['Administrator'],
  cooldownSeconds: 30,

  buildSlash() { return new SlashCommandBuilder().setName('setup').setDescription('Run interactive setup.').setDefaultMemberPermissions(PermissionFlagsBits.Administrator); },
  parseSlash() { return {}; },
  parsePrefix() { return {}; },

  async run(ctx: CommandContext) {
    if (!ctx.guild || !ctx.member) return;
    const me = await ctx.guild.members.fetchMe();
    const everyone = ctx.guild.roles.everyone;

    // Create log category & channels
    let category = ctx.guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === 'Zabron Logs');
    if (!category) category = await ctx.guild.channels.create({ name: 'Zabron Logs', type: ChannelType.GuildCategory });
    for (const cat of LOG_CATEGORIES) {
      const channelName = `📋・${cat}`;
      const ch = await ctx.guild.channels.create({ name: channelName, type: ChannelType.GuildText, parent: category.id });
      await ch.permissionOverwrites.edit(everyone, { ViewChannel: false });
      await ch.permissionOverwrites.edit(me, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
      setLoggingChannel(ctx.guild.id, cat, ch.id);
      setLoggingEnabled(ctx.guild.id, cat, true);
    }

    // Enable antinuke with sensible defaults
    setAntinukeConfig(ctx.guild.id, { enabled: true });

    // Enable leveling config if not present
    getDatabase().prepare('INSERT OR IGNORE INTO leveling_config (guild_id, enabled, xp_min, xp_max, cooldown_seconds, level_up_message, announce_channel, excluded_channels, excluded_roles, no_xp_roles, created_at) VALUES (?, 0, 15, 25, 60, NULL, NULL, "", "", "", ?)').run(ctx.guild.id, Date.now());

    await respond(ctx, { embeds: [configuration('Setup complete', `Created a \`Zabron Logs\` category with one channel per logging category.\nEnabled antinuke protection with safe defaults.\n\nNext steps:\n• /welcome setup\n• /tickets setup\n• /automod enable\n• /leveling enable`)] });
  },
};

registerCommand(def);
export default def;