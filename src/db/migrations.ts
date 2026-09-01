/**
 * Zabron — Database migrations.
 *
 * Migrations are forward-only SQL statements. Each entry runs once and
 * is recorded in `migrations`. New schema changes should always be
 * appended, never edited in place.
 */

import type { ZDatabase } from './database.js';

export interface Migration {
  id: string;
  description: string;
  up: (db: ZDatabase) => void;
}

export const MIGRATIONS: Migration[] = [
  {
    id: '001-init-guild-settings',
    description: 'Guild settings and prefix configuration.',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS guild_settings (
          guild_id TEXT PRIMARY KEY,
          prefix TEXT NOT NULL DEFAULT '.',
          mod_log_channel TEXT,
          panic_mode INTEGER NOT NULL DEFAULT 0,
          welcome_channel TEXT,
          welcome_message TEXT,
          welcome_dm TEXT,
          welcome_role TEXT,
          goodbye_channel TEXT,
          goodbye_message TEXT,
          autorole TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);
    },
  },
  {
    id: '002-logging',
    description: 'Logging configuration per category.',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS logging_config (
          guild_id TEXT NOT NULL,
          category TEXT NOT NULL,
          channel_id TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          PRIMARY KEY (guild_id, category)
        );
      `);
    },
  },
  {
    id: '003-moderation',
    description: 'Moderation cases and warnings.',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS moderation_cases (
          case_id TEXT PRIMARY KEY,
          guild_id TEXT NOT NULL,
          target_id TEXT NOT NULL,
          moderator_id TEXT NOT NULL,
          action TEXT NOT NULL,
          reason TEXT,
          duration INTEGER,
          created_at INTEGER NOT NULL,
          metadata TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_cases_guild_target ON moderation_cases (guild_id, target_id);
        CREATE INDEX IF NOT EXISTS idx_cases_guild_time ON moderation_cases (guild_id, created_at);

        CREATE TABLE IF NOT EXISTS warnings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          guild_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          moderator_id TEXT NOT NULL,
          reason TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_warns_user ON warnings (guild_id, user_id);
      `);
    },
  },
  {
    id: '004-security',
    description: 'Antinuke, antiraid, panic, automod, whitelist.',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS antinuke_config (
          guild_id TEXT PRIMARY KEY,
          enabled INTEGER NOT NULL DEFAULT 0,
          threshold_bans INTEGER NOT NULL DEFAULT 3,
          threshold_kicks INTEGER NOT NULL DEFAULT 3,
          threshold_channels INTEGER NOT NULL DEFAULT 3,
          threshold_roles INTEGER NOT NULL DEFAULT 3,
          threshold_webhooks INTEGER NOT NULL DEFAULT 3,
          window_seconds INTEGER NOT NULL DEFAULT 10,
          punish_action TEXT NOT NULL DEFAULT 'ban',
          created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS antinuke_whitelist (
          guild_id TEXT NOT NULL,
          target_id TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'user',
          PRIMARY KEY (guild_id, target_id)
        );

        CREATE TABLE IF NOT EXISTS antinuke_trackers (
          guild_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          action TEXT NOT NULL,
          ts INTEGER NOT NULL,
          PRIMARY KEY (guild_id, user_id, action)
        );

        CREATE TABLE IF NOT EXISTS antiraid_config (
          guild_id TEXT PRIMARY KEY,
          enabled INTEGER NOT NULL DEFAULT 0,
          join_threshold INTEGER NOT NULL DEFAULT 5,
          join_window_seconds INTEGER NOT NULL DEFAULT 10,
          account_age_days INTEGER NOT NULL DEFAULT 7,
          action TEXT NOT NULL DEFAULT 'kick',
          verification_role TEXT,
          created_at INTEGER NOT NULL
        );
      `);
    },
  },
  {
    id: '005-automod',
    description: 'Automod rules and exemptions.',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS automod_config (
          guild_id TEXT PRIMARY KEY,
          enabled INTEGER NOT NULL DEFAULT 0,
          spam_messages INTEGER NOT NULL DEFAULT 5,
          spam_interval_seconds INTEGER NOT NULL DEFAULT 5,
          mention_limit INTEGER NOT NULL DEFAULT 5,
          link_block INTEGER NOT NULL DEFAULT 0,
          invite_block INTEGER NOT NULL DEFAULT 0,
          caps_percent INTEGER NOT NULL DEFAULT 80,
          caps_min_length INTEGER NOT NULL DEFAULT 10,
          blocked_words TEXT NOT NULL DEFAULT '',
          duplicate_limit INTEGER NOT NULL DEFAULT 5,
          punishment TEXT NOT NULL DEFAULT 'delete',
          warn_threshold INTEGER NOT NULL DEFAULT 3,
          created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS automod_exemptions (
          guild_id TEXT NOT NULL,
          target_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          PRIMARY KEY (guild_id, target_id, kind)
        );
      `);
    },
  },
  {
    id: '006-tickets',
    description: 'Tickets, categories, support roles, transcripts.',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tickets (
          ticket_id TEXT PRIMARY KEY,
          guild_id TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          claimed_by TEXT,
          category TEXT NOT NULL DEFAULT 'general',
          status TEXT NOT NULL DEFAULT 'open',
          topic TEXT,
          created_at INTEGER NOT NULL,
          closed_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_tickets_guild ON tickets (guild_id);
        CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets (user_id);

        CREATE TABLE IF NOT EXISTS ticket_categories (
          guild_id TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          support_role_id TEXT,
          PRIMARY KEY (guild_id, name)
        );

        CREATE TABLE IF NOT EXISTS ticket_panels (
          guild_id TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          message_id TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT,
          categories TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (guild_id, message_id)
        );
      `);
    },
  },
  {
    id: '007-giveaways',
    description: 'Giveaways and entries.',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS giveaways (
          id TEXT PRIMARY KEY,
          guild_id TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          message_id TEXT,
          host_id TEXT NOT NULL,
          prize TEXT NOT NULL,
          winner_count INTEGER NOT NULL DEFAULT 1,
          required_role_id TEXT,
          starts_at INTEGER NOT NULL,
          ends_at INTEGER NOT NULL,
          ended INTEGER NOT NULL DEFAULT 0,
          cancelled INTEGER NOT NULL DEFAULT 0,
          winners TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_giveaways_guild ON giveaways (guild_id);
        CREATE INDEX IF NOT EXISTS idx_giveaways_end ON giveaways (ends_at);

        CREATE TABLE IF NOT EXISTS giveaway_entries (
          giveaway_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          PRIMARY KEY (giveaway_id, user_id)
        );
      `);
    },
  },
  {
    id: '008-leveling',
    description: 'XP, levels, rewards.',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS leveling_config (
          guild_id TEXT PRIMARY KEY,
          enabled INTEGER NOT NULL DEFAULT 0,
          xp_min INTEGER NOT NULL DEFAULT 15,
          xp_max INTEGER NOT NULL DEFAULT 25,
          cooldown_seconds INTEGER NOT NULL DEFAULT 60,
          level_up_message TEXT,
          announce_channel TEXT,
          excluded_channels TEXT NOT NULL DEFAULT '',
          excluded_roles TEXT NOT NULL DEFAULT '',
          no_xp_roles TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS leveling_users (
          guild_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          xp INTEGER NOT NULL DEFAULT 0,
          level INTEGER NOT NULL DEFAULT 0,
          total_messages INTEGER NOT NULL DEFAULT 0,
          last_xp_at INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (guild_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS level_rewards (
          guild_id TEXT NOT NULL,
          level INTEGER NOT NULL,
          role_id TEXT NOT NULL,
          PRIMARY KEY (guild_id, level)
        );
      `);
    },
  },
  {
    id: '009-roles',
    description: 'Role panels (button / select / reaction).',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS role_panels (
          guild_id TEXT NOT NULL,
          message_id TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT,
          roles TEXT NOT NULL,
          mode TEXT NOT NULL DEFAULT 'toggle',
          created_at INTEGER NOT NULL,
          PRIMARY KEY (guild_id, message_id)
        );
      `);
    },
  },
  {
    id: '010-invites',
    description: 'Invite tracking.',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS invite_counts (
          guild_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          invites INTEGER NOT NULL DEFAULT 0,
          leaves INTEGER NOT NULL DEFAULT 0,
          fakes INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (guild_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS invite_uses (
          guild_id TEXT NOT NULL,
          code TEXT NOT NULL,
          user_id TEXT NOT NULL,
          inviter_id TEXT,
          joined_at INTEGER NOT NULL,
          PRIMARY KEY (guild_id, code, user_id)
        );

        CREATE TABLE IF NOT EXISTS invite_cache (
          guild_id TEXT NOT NULL,
          code TEXT NOT NULL,
          inviter_id TEXT,
          uses INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (guild_id, code)
        );
      `);
    },
  },
  {
    id: '011-automation',
    description: 'Automation engine: workflows.',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS automation_workflows (
          id TEXT PRIMARY KEY,
          guild_id TEXT NOT NULL,
          name TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          trigger TEXT NOT NULL,
          conditions TEXT NOT NULL DEFAULT '[]',
          actions TEXT NOT NULL DEFAULT '[]',
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_workflows_guild ON automation_workflows (guild_id);
      `);
    },
  },
  {
    id: '012-custom-commands',
    description: 'Custom commands.',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS custom_commands (
          guild_id TEXT NOT NULL,
          name TEXT NOT NULL,
          response TEXT NOT NULL,
          embed INTEGER NOT NULL DEFAULT 0,
          use_count INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (guild_id, name)
        );
      `);
    },
  },
  {
    id: '013-autoresponder',
    description: 'Autoresponder rules.',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS autoresponders (
          guild_id TEXT NOT NULL,
          name TEXT NOT NULL,
          trigger TEXT NOT NULL,
          match TEXT NOT NULL DEFAULT 'contains',
          response TEXT NOT NULL,
          channels TEXT NOT NULL DEFAULT '',
          roles TEXT NOT NULL DEFAULT '',
          cooldown_seconds INTEGER NOT NULL DEFAULT 0,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (guild_id, name)
        );
      `);
    },
  },
  {
    id: '014-sticky',
    description: 'Sticky messages.',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sticky_messages (
          guild_id TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          message_id TEXT,
          content TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (guild_id, channel_id)
        );
      `);
    },
  },
  {
    id: '015-reminders',
    description: 'User reminders.',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS reminders (
          id TEXT PRIMARY KEY,
          guild_id TEXT,
          user_id TEXT NOT NULL,
          message TEXT NOT NULL,
          remind_at INTEGER NOT NULL,
          delivered INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminders (user_id);
        CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders (remind_at);
      `);
    },
  },
  {
    id: '016-stats',
    description: 'Statistic channels configuration.',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS stat_channels (
          guild_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          template TEXT NOT NULL,
          PRIMARY KEY (guild_id, kind)
        );
      `);
    },
  },
  {
    id: '017-polls-suggestions',
    description: 'Polls, suggestions, starboard.',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS polls (
          id TEXT PRIMARY KEY,
          guild_id TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          message_id TEXT,
          question TEXT NOT NULL,
          options TEXT NOT NULL,
          multi INTEGER NOT NULL DEFAULT 0,
          ends_at INTEGER,
          created_by TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS poll_votes (
          poll_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          option_index INTEGER NOT NULL,
          PRIMARY KEY (poll_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS suggestions (
          id TEXT PRIMARY KEY,
          guild_id TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          message_id TEXT,
          author_id TEXT NOT NULL,
          content TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS starboard (
          guild_id TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          threshold INTEGER NOT NULL DEFAULT 3,
          PRIMARY KEY (guild_id)
        );

        CREATE TABLE IF NOT EXISTS starboard_entries (
          guild_id TEXT NOT NULL,
          message_id TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          stars INTEGER NOT NULL DEFAULT 0,
          posted_message_id TEXT,
          PRIMARY KEY (guild_id, message_id)
        );
      `);
    },
  },
  {
    id: '018-afk',
    description: 'AFK state.',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS afk_users (
          guild_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          reason TEXT,
          since INTEGER NOT NULL,
          PRIMARY KEY (guild_id, user_id)
        );
      `);
    },
  },
  {
    id: '019-tempvoice',
    description: 'Temporary voice channels.',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tempvoice_config (
          guild_id TEXT PRIMARY KEY,
          generator_channel_id TEXT NOT NULL,
          category_id TEXT
        );

        CREATE TABLE IF NOT EXISTS tempvoice_channels (
          guild_id TEXT NOT NULL,
          channel_id TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
      `);
    },
  },
  {
    id: '020-misc',
    description: 'Misc bookkeeping.',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS cooldowns (
          guild_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          command TEXT NOT NULL,
          ts INTEGER NOT NULL,
          PRIMARY KEY (guild_id, user_id, command)
        );
      `);
    },
  },
  {
    // Fix: original antinuke_trackers had PRIMARY KEY (guild_id, user_id, action)
    // which caused every UPSERT to collapse to a single row, making the
    // threshold counter permanently equal to 1 and rendering antinuke inert.
    // Replace with an append-only log that autoincrements so multiple
    // events for the same action can be counted within the window.
    id: '021-fix-antinuke-tracker',
    description: 'Antinuke tracker as append-only log so threshold actually counts.',
    up: (db) => {
      db.exec(`
        DROP TABLE IF EXISTS antinuke_trackers;
        CREATE TABLE antinuke_trackers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          guild_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          action TEXT NOT NULL,
          ts INTEGER NOT NULL
        );
        CREATE INDEX idx_antinuke_trackers_lookup
          ON antinuke_trackers (guild_id, user_id, action, ts);
      `);
    },
  },
  {
    // Fix: persist temp-ban expiry so scheduled unban survives restart.
    id: '022-temp-bans',
    description: 'Pending temp-ban expiries.',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS temp_bans (
          guild_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          reason TEXT,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (guild_id, user_id)
        );
      `);
    },
  },
  {
    // Fix: persist panic-mode "previous state" so disabling panic mode
    // can restore antinuke/antiraid/automod to their pre-panic flags.
    id: '023-panic-snapshot',
    description: 'Snapshot of protection flags taken when panic mode was enabled.',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS panic_snapshot (
          guild_id TEXT PRIMARY KEY,
          antinuke_enabled INTEGER NOT NULL,
          antiraid_enabled INTEGER NOT NULL,
          automod_enabled INTEGER NOT NULL,
          taken_at INTEGER NOT NULL
        );
      `);
    },
  },
  {
    // Fix: persist active channel locks with optional auto-unlock so
    // the bot can resume locks across restarts instead of dropping them.
    id: '024-channel-locks',
    description: 'Active channel locks, with optional auto-unlock expiry.',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS channel_locks (
          guild_id TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          locked_by TEXT NOT NULL,
          expires_at INTEGER,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (guild_id, channel_id)
        );
      `);
    },
  },
  {
    // Webhook delivery toggle per category + per-channel ignore list so
    // the logging command can disable specific event types or mute
    // noisy channels (e.g. bot spam / image channels) without re-routing
    // the rest of the audit stream.
    id: '025-log-webhooks-and-ignores',
    description: 'Webhook delivery toggle per log category + per-channel ignore list.',
    up: (db) => {
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
    },
  },
];