/**
 * /antinuke — Configure antinuke thresholds, punishment, whitelist.
 */

import { ChatInputCommandInteraction, Message, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import type { CommandContext, CommandDefinition } from '../../types/index.js';
import { registerCommand } from '../../handlers/registry.js';
import { respond } from '../../handlers/respond.js';
import { buildEmbed, configChange, actionDone } from '../../embeds/builders.js';
import {
  addWhitelist,
  getAntinukeConfig,
  listWhitelist,
  removeWhitelist,
  setAntinukeConfig,
} from '../../services/security.js';

const def: CommandDefinition = {
  name: 'antinuke',
  description: 'Configure antinuke protection.',
  category: 'security',
  userPermissions: ['Administrator'],
  cooldownSeconds: 5,

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('antinuke')
      .setDescription('Configure antinuke protection.')
      .addSubcommand((s) => s.setName('status').setDescription('Show current antinuke configuration'))
      .addSubcommand((s) => s.setName('enable').setDescription('Enable antinuke'))
      .addSubcommand((s) => s.setName('disable').setDescription('Disable antinuke'))
      .addSubcommand((s) => s.setName('threshold').setDescription('Set thresholds').addIntegerOption((o) => o.setName('bans').setDescription('Max bans per window').setRequired(false)).addIntegerOption((o) => o.setName('kicks').setDescription('Max kicks per window').setRequired(false)).addIntegerOption((o) => o.setName('channels').setDescription('Max channel deletions per window').setRequired(false)).addIntegerOption((o) => o.setName('roles').setDescription('Max role deletions per window').setRequired(false)).addIntegerOption((o) => o.setName('webhooks').setDescription('Max webhook creations per window').setRequired(false)).addIntegerOption((o) => o.setName('window').setDescription('Window in seconds').setRequired(false)))
      .addSubcommand((s) => s.setName('punishment').setDescription('Set punishment').addStringOption((o) => o.setName('action').setDescription('Action to take when triggered').addChoices({ name: 'ban', value: 'ban' }, { name: 'kick', value: 'kick' }, { name: 'strip', value: 'strip' }).setRequired(true)))
      .addSubcommand((s) => s.setName('whitelist').setDescription('Whitelist user/role').addStringOption((o) => o.setName('target').setDescription('User or role ID to whitelist').setRequired(true)).addStringOption((o) => o.setName('mode').setDescription('Add or remove').addChoices({ name: 'add', value: 'add' }, { name: 'remove', value: 'remove' }).setRequired(false)))
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
  },

  async parseSlash(i: ChatInputCommandInteraction) {
    const sub = i.options.getSubcommand();
    const obj: any = { sub };
    if (sub === 'threshold') {
      obj.bans = i.options.getInteger('bans');
      obj.kicks = i.options.getInteger('kicks');
      obj.channels = i.options.getInteger('channels');
      obj.roles = i.options.getInteger('roles');
      obj.webhooks = i.options.getInteger('webhooks');
      obj.window = i.options.getInteger('window');
    } else if (sub === 'punishment') {
      obj.action = i.options.getString('action', true);
    } else if (sub === 'whitelist') {
      obj.target = i.options.getString('target', true)?.replace(/[<@&>]/g, '');
      obj.mode = i.options.getString('mode') ?? 'add';
    }
    return obj;
  },

  async parsePrefix(_m: Message, raw: string[]) {
    return { sub: raw[0] ?? 'status', action: raw[1], target: raw[1], mode: raw[2] ?? 'add', bans: null, kicks: null, channels: null, roles: null, webhooks: null, window: null };
  },

  async run(ctx: CommandContext) {
    if (!ctx.guild) return;
    const args = ctx.args as any;
    const config = getAntinukeConfig(ctx.guild.id);

    if (args.sub === 'status') {
      const whitelist = listWhitelist(ctx.guild.id);
      await respond(ctx, {
        embeds: [buildEmbed({
          tone: 'security',
          title: `🛡 Antinuke — ${config.enabled ? '🟢 Enabled' : '🔴 Disabled'}`,
          description: `Active thresholds within a **${config.windowSeconds}s** rolling window.`,
          fields: [
            { name: 'Bans',     value: `\`${config.thresholdBans}\``,     inline: true },
            { name: 'Kicks',    value: `\`${config.thresholdKicks}\``,    inline: true },
            { name: 'Channels', value: `\`${config.thresholdChannels}\``, inline: true },
            { name: 'Roles',    value: `\`${config.thresholdRoles}\``,    inline: true },
            { name: 'Webhooks', value: `\`${config.thresholdWebhooks}\``, inline: true },
            { name: 'Punishment', value: `\`${config.punishAction}\``, inline: true },
            { name: 'Whitelisted users/roles', value: `\`${whitelist.length}\``, inline: true },
          ],
        })],
      });
      return;
    }
    if (args.sub === 'enable') {
      const previous = config.enabled;
      setAntinukeConfig(ctx.guild.id, { enabled: true });
      await respond(ctx, { embeds: [configChange({
        setting: 'Antinuke',
        previous: previous ? '🟢 Enabled' : '🔴 Disabled',
        current: '🟢 Enabled',
        actor: { id: ctx.user.id, tag: ctx.user.tag },
      })] });
      return;
    }
    if (args.sub === 'disable') {
      const previous = config.enabled;
      setAntinukeConfig(ctx.guild.id, { enabled: false });
      await respond(ctx, { embeds: [configChange({
        setting: 'Antinuke',
        previous: previous ? '🟢 Enabled' : '🔴 Disabled',
        current: '🔴 Disabled',
        actor: { id: ctx.user.id, tag: ctx.user.tag },
      })] });
      return;
    }
    if (args.sub === 'threshold') {
      const before = {
        bans: config.thresholdBans,
        kicks: config.thresholdKicks,
        channels: config.thresholdChannels,
        roles: config.thresholdRoles,
        webhooks: config.thresholdWebhooks,
        window: config.windowSeconds,
      };
      const patch: any = {};
      if (args.bans) patch.thresholdBans = args.bans;
      if (args.kicks) patch.thresholdKicks = args.kicks;
      if (args.channels) patch.thresholdChannels = args.channels;
      if (args.roles) patch.thresholdRoles = args.roles;
      if (args.webhooks) patch.thresholdWebhooks = args.webhooks;
      if (args.window) patch.windowSeconds = args.window;
      setAntinukeConfig(ctx.guild.id, patch);
      const after = { ...before, ...patch };
      const summary = [
        `Bans: \`${before.bans}\` → \`${after.thresholdBans}\``,
        `Kicks: \`${before.kicks}\` → \`${after.thresholdKicks}\``,
        `Channels: \`${before.channels}\` → \`${after.thresholdChannels}\``,
        `Roles: \`${before.roles}\` → \`${after.thresholdRoles}\``,
        `Webhooks: \`${before.webhooks}\` → \`${after.thresholdWebhooks}\``,
        `Window: \`${before.window}s\` → \`${after.windowSeconds}s\``,
      ].join('\n');
      await respond(ctx, { embeds: [actionDone({
        action: 'Antinuke thresholds updated',
        target: ctx.guild.name,
        detail: summary,
      })] });
      return;
    }
    if (args.sub === 'punishment') {
      const before = config.punishAction;
      setAntinukeConfig(ctx.guild.id, { punishAction: args.action });
      await respond(ctx, { embeds: [configChange({
        setting: 'Antinuke punishment',
        previous: `\`${before}\``,
        current: `\`${args.action}\``,
        actor: { id: ctx.user.id, tag: ctx.user.tag },
      })] });
      return;
    }
    if (args.sub === 'whitelist') {
      if (args.mode === 'add') {
        addWhitelist(ctx.guild.id, args.target, 'user');
        await respond(ctx, { embeds: [actionDone({
          action: 'Whitelisted',
          target: `<@${args.target}>`,
          detail: '🛡 This user can no longer trigger antinuke detections.',
        })] });
      } else {
        removeWhitelist(ctx.guild.id, args.target);
        await respond(ctx, { embeds: [actionDone({
          action: 'Removed from whitelist',
          target: `<@${args.target}>`,
          detail: '🛡 Antinuke will now act on this user again.',
        })] });
      }
    }
    },
};

registerCommand(def);
export default def;