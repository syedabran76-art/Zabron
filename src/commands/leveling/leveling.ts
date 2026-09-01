/**
 * /rank, /leaderboard, /leveling — XP and ranks.
 */

import { ChatInputCommandInteraction, Message, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import type { CommandContext, CommandDefinition } from '../../types/index.js';
import { registerCommand } from '../../handlers/registry.js';
import { respond, replyError } from '../../handlers/respond.js';
import { buildEmbed, leveling } from '../../embeds/builders.js';
import { resolveUser } from '../../utils/permissions.js';
import { getDatabase } from '../../db/database.js';
import { addXp, getLevelingUser, getLeaderboard } from '../../db/repositories.js';

interface LevelingCfg {
  enabled: boolean;
  xpMin: number;
  xpMax: number;
  cooldownSeconds: number;
  announceChannel: string | null;
  levelUpMessage: string | null;
}

function getCfg(guildId: string): LevelingCfg {
  const row = getDatabase().prepare('SELECT enabled, xp_min as xpMin, xp_max as xpMax, cooldown_seconds as cooldownSeconds, announce_channel as announceChannel, level_up_message as levelUpMessage FROM leveling_config WHERE guild_id = ?').get(guildId) as LevelingCfg | undefined;
  return row ?? { enabled: false, xpMin: 15, xpMax: 25, cooldownSeconds: 60, announceChannel: null, levelUpMessage: null };
}

function setCfg(guildId: string, patch: Partial<LevelingCfg>): LevelingCfg {
  const current = getCfg(guildId);
  const next = { ...current, ...patch };
  getDatabase().prepare(`INSERT INTO leveling_config (guild_id, enabled, xp_min, xp_max, cooldown_seconds, level_up_message, announce_channel, excluded_channels, excluded_roles, no_xp_roles, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, '', '', '', ?) ON CONFLICT(guild_id) DO UPDATE SET enabled = excluded.enabled, xp_min = excluded.xp_min, xp_max = excluded.xp_max, cooldown_seconds = excluded.cooldown_seconds, level_up_message = excluded.level_up_message, announce_channel = excluded.announce_channel`).run(next.enabled ? 1 : 0, next.xpMin, next.xpMax, next.cooldownSeconds, next.levelUpMessage, next.announceChannel, Date.now());
  return next;
}

export function xpForLevel(level: number): number {
  return 5 * level * level + 50 * level + 100;
}

export function levelFromXp(xp: number): number {
  let level = 0;
  while (xpForLevel(level + 1) <= xp) level++;
  return level;
}

const rank: CommandDefinition = {
  name: 'rank',
  description: 'Show XP/level for a user.',
  category: 'leveling',
  cooldownSeconds: 3,
  buildSlash() {
    return new SlashCommandBuilder().setName('rank').setDescription('Show rank.').addUserOption((o) => o.setName('user').setDescription('User to inspect (defaults to you)').setRequired(false));
  },
  async parseSlash(i: ChatInputCommandInteraction) { return { user: i.options.getUser('user') }; },
  async parsePrefix(m: Message, raw: string[]) {
    const user = raw[0] ? await resolveUser(m.guild!, raw[0]) : null;
    return { user };
  },
  async run(ctx: CommandContext) {
    if (!ctx.guild) return;
    const cfg = getCfg(ctx.guild.id);
    const user = (ctx.args as any).user ?? ctx.user;
    const data = getLevelingUser(ctx.guild.id, user.id);
    const level = levelFromXp(data.xp);
    const nextLevelXp = xpForLevel(level + 1);
    const progress = Math.min(100, Math.floor((data.xp - xpForLevel(level)) / (nextLevelXp - xpForLevel(level)) * 100));
    await respond(ctx, { embeds: [leveling(`${user.tag} — Level ${level}`, `XP: **${data.xp}**\nNext level: **${nextLevelXp}** XP\nProgress: **${progress}%**\nMessages: **${data.totalMessages}**`).setThumbnail(user.displayAvatarURL())] });
    void cfg;
  },
};

const leaderboard: CommandDefinition = {
  name: 'leaderboard',
  description: 'Show the XP leaderboard.',
  category: 'leveling',
  cooldownSeconds: 5,
  buildSlash() { return new SlashCommandBuilder().setName('leaderboard').setDescription('Show leaderboard.'); },
  parseSlash() { return {}; },
  parsePrefix() { return {}; },
  async run(ctx: CommandContext) {
    if (!ctx.guild) return;
    const list = getLeaderboard(ctx.guild.id, 10);
    if (!list.length) { await respond(ctx, { embeds: [buildEmbed({ tone: 'info', title: 'Leaderboard is empty' })] }); return; }
    await respond(ctx, { embeds: [leveling('🏆 Leaderboard', list.map((u, idx) => `**${idx + 1}.** <@${u.userId}> — Level ${levelFromXp(u.xp)} (${u.xp} XP)`).join('\n'))] });
  },
};

const levelingCmd: CommandDefinition = {
  name: 'leveling',
  description: 'Configure leveling.',
  category: 'leveling',
  userPermissions: ['ManageGuild'],
  cooldownSeconds: 5,

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('leveling')
      .setDescription('Configure leveling.')
      .addSubcommand((s) => s.setName('enable').setDescription('Enable'))
      .addSubcommand((s) => s.setName('disable').setDescription('Disable'))
      .addSubcommand((s) => s.setName('set').setDescription('Set XP').addIntegerOption((o) => o.setName('min').setDescription('Minimum XP per message').setRequired(false)).addIntegerOption((o) => o.setName('max').setDescription('Maximum XP per message').setRequired(false)).addIntegerOption((o) => o.setName('cooldown').setDescription('Cooldown in seconds').setRequired(false)))
      .addSubcommand((s) => s.setName('announce').setDescription('Set announcement channel').addChannelOption((o) => o.setName('channel').setDescription('Level-up announcement channel').setRequired(true)))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
  },

  async parseSlash(i: ChatInputCommandInteraction) {
    return { sub: i.options.getSubcommand(), min: i.options.getInteger('min'), max: i.options.getInteger('max'), cooldown: i.options.getInteger('cooldown'), channel: i.options.getChannel('channel') };
  },

  async parsePrefix(_m: Message, raw: string[]) {
    return { sub: raw[0] ?? 'enable', min: null, max: null, cooldown: null, channel: null };
  },

  async run(ctx: CommandContext) {
    if (!ctx.guild) return;
    const args = ctx.args as any;
    if (args.sub === 'enable') { setCfg(ctx.guild.id, { enabled: true }); await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Leveling enabled' })] }); return; }
    if (args.sub === 'disable') { setCfg(ctx.guild.id, { enabled: false }); await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Leveling disabled' })] }); return; }
    if (args.sub === 'set') {
      const patch: any = {};
      if (args.min !== null) patch.xpMin = args.min;
      if (args.max !== null) patch.xpMax = args.max;
      if (args.cooldown !== null) patch.cooldownSeconds = args.cooldown;
      setCfg(ctx.guild.id, patch);
      await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Leveling settings updated' })] });
      return;
    }
    if (args.sub === 'announce') {
      if (!args.channel) return;
      setCfg(ctx.guild.id, { announceChannel: args.channel.id });
      await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Announcement channel set' })] });
    }
  },
};

const xp: CommandDefinition = {
  name: 'xp',
  description: 'Grant or remove XP from a user.',
  category: 'leveling',
  userPermissions: ['ManageGuild'],
  cooldownSeconds: 3,
  buildSlash() {
    return new SlashCommandBuilder().setName('xp').setDescription('Modify XP.').addUserOption((o) => o.setName('user').setDescription('Target user').setRequired(true)).addIntegerOption((o) => o.setName('amount').setDescription('XP delta (negative to remove)').setRequired(true));
  },
  async parseSlash(i: ChatInputCommandInteraction) { return { user: i.options.getUser('user', true), amount: i.options.getInteger('amount', true) }; },
  async parsePrefix(m: Message, raw: string[]) {
    const user = await resolveUser(m.guild!, raw[0]);
    if (!user) throw new Error('User required');
    return { user, amount: Number(raw[1]) };
  },
  async run(ctx: CommandContext) {
    if (!ctx.guild) return;
    const { user, amount } = ctx.args as any;
    addXp(ctx.guild.id, user.id, amount, Date.now());
    await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'XP updated', description: `<@${user.id}> now has ${getLevelingUser(ctx.guild.id, user.id).xp} XP.` })] });
  },
};

[rank, leaderboard, levelingCmd, xp].forEach(registerCommand);
export default rank;