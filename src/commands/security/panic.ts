/**
 * /panic — Toggle emergency lockdown.
 */

import { ChatInputCommandInteraction, Message, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import type { CommandContext, CommandDefinition } from '../../types/index.js';
import { registerCommand } from '../../handlers/registry.js';
import { respond } from '../../handlers/respond.js';
import {
  getGuildSettings,
  updateGuildSettings,
  savePanicSnapshot,
  loadPanicSnapshot,
  clearPanicSnapshot,
} from '../../db/repositories.js';
import { buildEmbed } from '../../embeds/builders.js';
import {
  setAntinukeConfig,
  setAntiraidConfig,
  setAutomodConfig,
  getAntinukeConfig,
  getAntiraidConfig,
  getAutomodConfig,
} from '../../services/security.js';
import { logEvent, buildActorInfo } from '../../services/logging.js';

const def: CommandDefinition = {
  name: 'panic',
  description: 'Toggle emergency lockdown of all protections.',
  category: 'security',
  userPermissions: ['Administrator'],
  cooldownSeconds: 10,

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('panic')
      .setDescription('Toggle panic mode.')
      .addSubcommand((s) => s.setName('enable').setDescription('Activate panic mode'))
      .addSubcommand((s) => s.setName('disable').setDescription('Deactivate panic mode'))
      .addSubcommand((s) => s.setName('status').setDescription('View panic mode state'))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
  },

  async parseSlash(i: ChatInputCommandInteraction) {
    return { sub: i.options.getSubcommand() };
  },

  async parsePrefix(_m: Message, raw: string[]) {
    return { sub: raw[0] ?? 'status' };
  },

  async run(ctx: CommandContext) {
    if (!ctx.guild || !ctx.member) return;
    const settings = getGuildSettings(ctx.guild.id);
    const { sub } = ctx.args as any;
    if (sub === 'status') {
      await respond(ctx, { embeds: [buildEmbed({ tone: 'security', title: 'Panic mode', description: settings.panicMode ? '🟠 ACTIVE — all protections enforced aggressively.' : '🟢 Off' })] });
      return;
    }
    if (sub === 'enable') {
      // Snapshot pre-panic protection state so disable can restore it.
      const an = getAntinukeConfig(ctx.guild.id);
      const ar = getAntiraidConfig(ctx.guild.id);
      const am = getAutomodConfig(ctx.guild.id);
      savePanicSnapshot(ctx.guild.id, an.enabled, ar.enabled, am.enabled);
      updateGuildSettings(ctx.guild.id, { panicMode: true });
      setAntinukeConfig(ctx.guild.id, { enabled: true });
      setAntiraidConfig(ctx.guild.id, { enabled: true });
      setAutomodConfig(ctx.guild.id, { enabled: true });
      await respond(ctx, { embeds: [buildEmbed({ tone: 'warning', title: 'Panic mode enabled', description: 'All protections increased. Only administrators can issue commands until disabled.' })] });
      await logEvent({ guildId: ctx.guild.id, category: 'security', title: 'Panic mode enabled', author: buildActorInfo(ctx.member), client: ctx.guild.client });
      return;
    }
    if (sub === 'disable') {
      updateGuildSettings(ctx.guild.id, { panicMode: false });
      // Restore prior protection flags so disable actually reverts state.
      const snap = loadPanicSnapshot(ctx.guild.id);
      if (snap) {
        setAntinukeConfig(ctx.guild.id, { enabled: snap.antinukeEnabled });
        setAntiraidConfig(ctx.guild.id, { enabled: snap.antiraidEnabled });
        setAutomodConfig(ctx.guild.id, { enabled: snap.automodEnabled });
        clearPanicSnapshot(ctx.guild.id);
      }
      await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Panic mode disabled' })] });
      await logEvent({ guildId: ctx.guild.id, category: 'security', title: 'Panic mode disabled', author: buildActorInfo(ctx.member), client: ctx.guild.client });
    }
  },
};

registerCommand(def);
export default def;