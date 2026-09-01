/**
 * /serverinfo + /memberinfo + /roleinfo + /channelinfo
 */

import { ChatInputCommandInteraction, Message, SlashCommandBuilder } from 'discord.js';

import type { CommandContext, CommandDefinition } from '../../types/index.js';
import { registerCommand } from '../../handlers/registry.js';
import { respond } from '../../handlers/respond.js';
import { resolveUser } from '../../utils/permissions.js';
import { buildEmbed } from '../../embeds/builders.js';
import { discordTime } from '../../utils/duration.js';

const serverinfo: CommandDefinition = {
  name: 'serverinfo',
  description: 'Display information about the current server.',
  category: 'management',

  buildSlash() {
    return new SlashCommandBuilder().setName('serverinfo').setDescription('Server info.');
  },

  parseSlash() { return {}; },
  parsePrefix() { return {}; },

  async run(ctx: CommandContext) {
    if (!ctx.guild) return;
    const g = ctx.guild;
    const embed = buildEmbed({
      tone: 'info',
      title: g.name,
      thumbnailURL: g.iconURL({ size: 256 }) ?? undefined,
      fields: [
        { name: 'ID', value: g.id, inline: true },
        { name: 'Owner', value: `<@${g.ownerId}>`, inline: true },
        { name: 'Members', value: `${g.memberCount}`, inline: true },
        { name: 'Channels', value: `${g.channels.cache.size}`, inline: true },
        { name: 'Roles', value: `${g.roles.cache.size}`, inline: true },
        { name: 'Created', value: discordTime(g.createdTimestamp, 'F'), inline: true },
        { name: 'Verification', value: String(g.verificationLevel), inline: true },
        { name: 'Boosts', value: `${g.premiumSubscriptionCount ?? 0} (tier ${g.premiumTier})`, inline: true },
      ],
    });
    await respond(ctx, { embeds: [embed] });
  },
};

const memberinfo: CommandDefinition = {
  name: 'memberinfo',
  description: 'Show information about a member.',
  category: 'management',

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('memberinfo')
      .setDescription('Member info.')
      .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true));
  },

  async parseSlash(i: ChatInputCommandInteraction) {
    return { user: i.options.getUser('user', true) };
  },

  async parsePrefix(m: Message, raw: string[]) {
    const user = await resolveUser(m.guild!, raw[0]);
    if (!user) throw new Error(`Could not resolve "${raw[0]}"`);
    return { user };
  },

  async run(ctx: CommandContext) {
    if (!ctx.guild) return;
    const { user } = ctx.args as any;
    const member = await ctx.guild.members.fetch(user.id).catch(() => null);
    const embed = buildEmbed({
      tone: 'info',
      title: `${user.tag}`,
      thumbnailURL: user.displayAvatarURL({ size: 256 }),
      fields: [
        { name: 'ID', value: user.id, inline: true },
        { name: 'Bot', value: user.bot ? 'Yes' : 'No', inline: true },
        { name: 'Account created', value: discordTime(user.createdTimestamp, 'F'), inline: true },
        ...(member
          ? [
              { name: 'Joined', value: discordTime(member.joinedTimestamp ?? 0, 'F'), inline: true },
              { name: 'Nickname', value: member.nickname ?? '(none)', inline: true },
              { name: 'Top role', value: member.roles.highest.name, inline: true },
            ]
          : []),
      ],
    });
    await respond(ctx, { embeds: [embed] });
  },
};

const roleinfo: CommandDefinition = {
  name: 'roleinfo',
  description: 'Show information about a role.',
  category: 'management',

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('roleinfo')
      .setDescription('Role info.')
      .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true));
  },

  async parseSlash(i: ChatInputCommandInteraction) {
    return { role: i.options.getRole('role', true) };
  },

  async parsePrefix(m: Message, raw: string[]) {
    const id = raw[0]?.replace(/[<@&>]/g, '');
    const role = await m.guild!.roles.fetch(id!).catch(() => null);
    if (!role) throw new Error('Role not found.');
    return { role };
  },

  async run(ctx: CommandContext) {
    const { role } = ctx.args as any;
    const embed = buildEmbed({
      tone: 'info',
      title: `@${role.name}`,
      fields: [
        { name: 'ID', value: role.id, inline: true },
        { name: 'Position', value: String(role.position), inline: true },
        { name: 'Color', value: role.hexColor, inline: true },
        { name: 'Hoisted', value: role.hoist ? 'Yes' : 'No', inline: true },
        { name: 'Mentionable', value: role.mentionable ? 'Yes' : 'No', inline: true },
        { name: 'Members', value: String(role.members.size), inline: true },
      ],
    });
    await respond(ctx, { embeds: [embed] });
  },
};

const channelinfo: CommandDefinition = {
  name: 'channelinfo',
  description: 'Show information about the current channel.',
  category: 'management',

  buildSlash() {
    return new SlashCommandBuilder().setName('channelinfo').setDescription('Channel info.');
  },

  parseSlash() { return {}; },
  parsePrefix() { return {}; },

  async run(ctx: CommandContext) {
    if (!ctx.channel) return;
    const c = ctx.channel as any;
    const embed = buildEmbed({
      tone: 'info',
      title: `#${c.name}`,
      fields: [
        { name: 'ID', value: c.id, inline: true },
        { name: 'Type', value: String(c.type), inline: true },
        { name: 'Created', value: discordTime(c.createdTimestamp ?? Date.now(), 'F'), inline: true },
        { name: 'NSFW', value: c.nsfw ? 'Yes' : 'No', inline: true },
      ],
    });
    await respond(ctx, { embeds: [embed] });
  },
};

registerCommand(serverinfo);
registerCommand(memberinfo);
registerCommand(roleinfo);
registerCommand(channelinfo);
export default serverinfo;