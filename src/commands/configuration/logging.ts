/**
 * /logging — Per-category logging configuration.
 *
 * Zeon-style configuration with actor/target attribution. New subcommands:
 *   /logging set        — set a category to a channel
 *   /logging disable    — disable a category
 *   /logging status     — show current config
 *   /logging create     — auto-create a "Zabron Logs" category with channels
 *   /logging test       — send a sample embed to a category
 *   /logging reset      — clear all categories
 *   /logging categories — list all categories
 *   /logging webhooks   — toggle webhook delivery
 *   /logging ignore     — ignore a channel from message logs
 *   /logging unignore   — unignore a channel
 *   /logging ignores    — list ignored channels
 */

import { ChatInputCommandInteraction, Message, PermissionFlagsBits, SlashCommandBuilder, ChannelType } from 'discord.js';

import type { CommandContext, CommandDefinition } from '../../types/index.js';
import { registerCommand } from '../../handlers/registry.js';
import { respond } from '../../handlers/respond.js';
import { buildEmbed } from '../../embeds/builders.js';
import { setLoggingChannel, setLoggingEnabled, getAllLoggingChannels, getLoggingConfig } from '../../db/repositories.js';
import { LOG_CATEGORIES, LogCategory } from '../../types/index.js';
import { getDatabase } from '../../db/database.js';
import { logEvent, generateEventId } from '../../services/logging.js';

const def: CommandDefinition = {
  name: 'logging',
  description: 'Configure logging channels per category.',
  category: 'logging',
  userPermissions: ['ManageGuild'],
  cooldownSeconds: 5,

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('logging')
      .setDescription('Manage log channels.')
      .addSubcommand((s) =>
        s.setName('set')
          .setDescription('Set a category to a channel')
          .addStringOption((o) =>
            o.setName('category')
              .setDescription('Category')
              .setRequired(true)
              .addChoices(...LOG_CATEGORIES.map((c) => ({ name: c, value: c }))),
          )
          .addChannelOption((o) => o.setName('channel').setDescription('Channel').setRequired(true)),
      )
      .addSubcommand((s) =>
        s.setName('disable')
          .setDescription('Disable a category')
          .addStringOption((o) =>
            o.setName('category')
              .setDescription('Category to disable')
              .setRequired(true)
              .addChoices(...LOG_CATEGORIES.map((c) => ({ name: c, value: c }))),
          ),
      )
      .addSubcommand((s) => s.setName('status').setDescription('Show current config'))
      .addSubcommand((s) => s.setName('create').setDescription('Auto-create a default log category with channels'))
      .addSubcommand((s) =>
        s.setName('test')
          .setDescription('Send a sample log embed to a category')
          .addStringOption((o) =>
            o.setName('category')
              .setDescription('Category')
              .setRequired(true)
              .addChoices(...LOG_CATEGORIES.map((c) => ({ name: c, value: c }))),
          ),
      )
      .addSubcommand((s) => s.setName('reset').setDescription('Clear all logging categories'))
      .addSubcommand((s) => s.setName('categories').setDescription('List all categories'))
      .addSubcommand((s) =>
        s.setName('webhooks')
          .setDescription('Toggle webhook delivery for a category')
          .addStringOption((o) =>
            o.setName('category')
              .setDescription('Category')
              .setRequired(true)
              .addChoices(...LOG_CATEGORIES.map((c) => ({ name: c, value: c }))),
          )
          .addBooleanOption((o) => o.setName('enabled').setDescription('Enable webhooks').setRequired(true)),
      )
      .addSubcommand((s) =>
        s.setName('ignore')
          .setDescription('Ignore a channel from message logs')
          .addChannelOption((o) => o.setName('channel').setDescription('Channel to ignore').setRequired(true)),
      )
      .addSubcommand((s) =>
        s.setName('unignore')
          .setDescription('Stop ignoring a channel')
          .addChannelOption((o) => o.setName('channel').setDescription('Channel to unignore').setRequired(true)),
      )
      .addSubcommand((s) => s.setName('ignores').setDescription('List ignored channels'))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
  },

  async parseSlash(i: ChatInputCommandInteraction) {
    return {
      sub: i.options.getSubcommand(),
      category: i.options.getString('category'),
      channel: i.options.getChannel('channel'),
      enabled: i.options.getBoolean('enabled'),
    };
  },

  async parsePrefix(_m: Message, raw: string[]) {
    return { sub: raw[0] ?? 'status', category: raw[1], channel: null, enabled: null };
  },

  async run(ctx: CommandContext) {
    if (!ctx.guild) return;
    const { sub, category, channel, enabled } = ctx.args as any;

    if (sub === 'set') {
      if (!category || !LOG_CATEGORIES.includes(category as LogCategory)) {
        await respond(ctx, { embeds: [buildEmbed({ tone: 'error', title: 'Invalid category' })] });
        return;
      }
      if (!channel) {
        await respond(ctx, { embeds: [buildEmbed({ tone: 'warning', title: 'Provide a channel' })] });
        return;
      }
      setLoggingChannel(ctx.guild.id, category, channel.id);
      setLoggingEnabled(ctx.guild.id, category, true);
      await respond(ctx, {
        embeds: [
          buildEmbed({
            tone: 'success',
            title: 'Logging updated',
            description: `**${category}** → <#${channel.id}>`,
          }),
        ],
      });
      return;
    }

    if (sub === 'disable') {
      if (!category) return;
      setLoggingEnabled(ctx.guild.id, category, false);
      await respond(ctx, {
        embeds: [buildEmbed({ tone: 'success', title: 'Disabled', description: `**${category}** logging is now off.` })],
      });
      return;
    }

    if (sub === 'create') {
      await autoCreateChannels(ctx);
      return;
    }

    if (sub === 'test') {
      if (!category || !LOG_CATEGORIES.includes(category as LogCategory)) {
        await respond(ctx, { embeds: [buildEmbed({ tone: 'error', title: 'Invalid category' })] });
        return;
      }
      const cfg = getLoggingConfig(ctx.guild.id, category);
      if (!cfg.enabled || !cfg.channelId) {
        await respond(ctx, {
          embeds: [buildEmbed({ tone: 'warning', title: 'No channel configured', description: `**${category}** is not set up.` })],
        });
        return;
      }
      const result = await logEvent({
        guildId: ctx.guild.id,
        category: category as LogCategory,
        title: 'Test log entry',
        description: 'This is what a real log entry will look like in this channel.',
        fields: [
          { name: 'Status', value: '`OK`', inline: true },
          { name: 'Sample field', value: 'Value can be anything', inline: true },
        ],
        actor: ctx.member
          ? { id: ctx.member.id, tag: ctx.user.tag, avatar: ctx.user.displayAvatarURL() }
          : { id: ctx.user.id, tag: ctx.user.tag, avatar: ctx.user.displayAvatarURL() },
        target: { id: ctx.user.id, tag: ctx.user.tag, avatar: ctx.user.displayAvatarURL() },
        risk: 'LOW',
        channelId: ctx.channel?.id ?? undefined,
        eventId: generateEventId(category),
        client: ctx.guild.client,
      });
      await respond(ctx, {
        embeds: [
          buildEmbed({
            tone: result.ok ? 'success' : 'error',
            title: result.ok ? 'Test sent' : 'Test failed',
            description: result.ok
              ? `Sample log delivered to <#${result.channelId}>.`
              : `Could not deliver: ${result.reason ?? 'unknown error'}`,
          }),
        ],
      });
      return;
    }

    if (sub === 'reset') {
      const db = getDatabase();
      db.prepare('DELETE FROM logging_config WHERE guild_id = ?').run(ctx.guild.id);
      db.prepare('DELETE FROM log_ignores WHERE guild_id = ?').run(ctx.guild.id);
      await respond(ctx, {
        embeds: [buildEmbed({ tone: 'success', title: 'Reset complete', description: 'All logging channels cleared.' })],
      });
      return;
    }

    if (sub === 'categories') {
      const list = LOG_CATEGORIES.map((c) => `• **${c}**`).join('\n');
      await respond(ctx, {
        embeds: [
          buildEmbed({
            tone: 'info',
            title: `Logging categories (${LOG_CATEGORIES.length})`,
            description: list,
          }),
        ],
      });
      return;
    }

    if (sub === 'webhooks') {
      if (!category || !LOG_CATEGORIES.includes(category as LogCategory)) {
        await respond(ctx, { embeds: [buildEmbed({ tone: 'error', title: 'Invalid category' })] });
        return;
      }
      ensureWebhookTable();
      const db = getDatabase();
      db.prepare(
        `INSERT INTO log_webhooks (guild_id, category, enabled) VALUES (?, ?, ?)
         ON CONFLICT(guild_id, category) DO UPDATE SET enabled = excluded.enabled`,
      ).run(ctx.guild.id, category, enabled ? 1 : 0);
      await respond(ctx, {
        embeds: [
          buildEmbed({
            tone: 'success',
            title: 'Webhook delivery updated',
            description: `**${category}** webhooks: ${enabled ? 'enabled' : 'disabled'}`,
          }),
        ],
      });
      return;
    }

    if (sub === 'ignore') {
      if (!channel) {
        await respond(ctx, { embeds: [buildEmbed({ tone: 'warning', title: 'Provide a channel' })] });
        return;
      }
      ensureWebhookTable();
      getDatabase()
        .prepare('INSERT OR IGNORE INTO log_ignores (guild_id, channel_id) VALUES (?, ?)')
        .run(ctx.guild.id, channel.id);
      await respond(ctx, {
        embeds: [buildEmbed({ tone: 'success', title: 'Channel ignored', description: `<#${channel.id}> will be skipped by message logs.` })],
      });
      return;
    }

    if (sub === 'unignore') {
      if (!channel) {
        await respond(ctx, { embeds: [buildEmbed({ tone: 'warning', title: 'Provide a channel' })] });
        return;
      }
      ensureWebhookTable();
      getDatabase()
        .prepare('DELETE FROM log_ignores WHERE guild_id = ? AND channel_id = ?')
        .run(ctx.guild.id, channel.id);
      await respond(ctx, {
        embeds: [buildEmbed({ tone: 'success', title: 'Channel unignored', description: `<#${channel.id}> is no longer skipped.` })],
      });
      return;
    }

    if (sub === 'ignores') {
      ensureWebhookTable();
      const rows = getDatabase()
        .prepare('SELECT channel_id as channelId FROM log_ignores WHERE guild_id = ?')
        .all(ctx.guild.id) as any[];
      const list = rows.length ? rows.map((r) => `• <#${r.channelId}>`).join('\n') : '_No ignored channels._';
      await respond(ctx, {
        embeds: [buildEmbed({ tone: 'log', title: `Ignored channels (${rows.length})`, description: list })],
      });
      return;
    }

    // default: status
    const map = getAllLoggingChannels(ctx.guild.id);
    const fields = LOG_CATEGORIES.map((c) => ({
      name: c,
      value: map[c] ? `<#${map[c]}>` : '—',
      inline: true,
    }));
    await respond(ctx, { embeds: [buildEmbed({ tone: 'log', title: 'Logging configuration', fields })] });
  },
};

async function autoCreateChannels(ctx: CommandContext): Promise<void> {
  if (!ctx.guild || !ctx.member) return;
  const me = await ctx.guild.members.fetchMe();
  const everyone = ctx.guild.roles.everyone;
  let category = ctx.guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === 'zabron logs');
  if (!category) {
    category = await ctx.guild.channels.create({ name: 'Zabron Logs', type: ChannelType.GuildCategory, reason: `Auto-created by ${ctx.user.tag}` });
  }
  const created: string[] = [];
  for (const cat of LOG_CATEGORIES) {
    const channelName = `📋・${cat}`;
    const ch = await ctx.guild.channels.create({ name: channelName, type: ChannelType.GuildText, parent: category.id, reason: `Auto log channel: ${cat}` });
    await ch.permissionOverwrites.edit(everyone, { ViewChannel: false });
    if (me) await ch.permissionOverwrites.edit(me, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
    setLoggingChannel(ctx.guild.id, cat, ch.id);
    setLoggingEnabled(ctx.guild.id, cat, true);
    created.push(`<#${ch.id}>`);
  }
  await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Logging channels created', description: created.join('\n') })] });
}

/**
 * Lazily create the auxiliary logging tables (webhook toggle, ignored
 * channels). Migration 025 will create them at boot for fresh installs;
 * this function is here so existing deployments don't crash on the
 * webhooks / ignore subcommands before the migration runs.
 */
function ensureWebhookTable(): void {
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS log_webhooks (
      guild_id TEXT NOT NULL,
      category TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (guild_id, category)
    );
    CREATE TABLE IF NOT EXISTS log_ignores (
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      PRIMARY KEY (guild_id, channel_id)
    );
  `);
}

registerCommand(def);
export default def;
