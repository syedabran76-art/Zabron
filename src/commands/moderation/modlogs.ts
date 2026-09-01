/**
 * /modlogs + /case + /cases — View moderation case history.
 */

import { ChatInputCommandInteraction, Message, SlashCommandBuilder } from 'discord.js';

import type { CommandContext, CommandDefinition } from '../../types/index.js';
import { registerCommand } from '../../handlers/registry.js';
import { respond } from '../../handlers/respond.js';
import { listCasesForGuild, listCasesForUser, getCase } from '../../db/repositories.js';
import { resolveUser } from '../../utils/permissions.js';
import { buildEmbed, listResult, emptyState } from '../../embeds/builders.js';
import { discordTime } from '../../utils/duration.js';

const def: CommandDefinition = {
  name: 'modlogs',
  description: 'View moderation history for the server or a user.',
  usage: '/modlogs [user] [limit]',
  category: 'moderation',
  userPermissions: ['ModerateMembers'],
  cooldownSeconds: 3,

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('modlogs')
      .setDescription('View moderation history.')
      .addUserOption((o) => o.setName('user').setDescription('Optional user filter').setRequired(false))
      .addIntegerOption((o) => o.setName('limit').setDescription('Max results').setMinValue(1).setMaxValue(50).setRequired(false));
  },

  async parseSlash(i: ChatInputCommandInteraction) {
    return { user: i.options.getUser('user'), limit: i.options.getInteger('limit') ?? 15 };
  },

  async parsePrefix(m: Message, raw: string[]) {
    const user = raw[0] ? await resolveUser(m.guild!, raw[0]) : undefined;
    const limit = Number(raw[1]) || 15;
    return { user, limit };
  },

  async run(ctx: CommandContext) {
    if (!ctx.guild) return;
    const { user, limit } = ctx.args as any;
    const list = user
      ? listCasesForUser(ctx.guild.id, user.id, limit)
      : listCasesForGuild(ctx.guild.id, limit);

    if (!list.length) {
      await respond(ctx, { embeds: [emptyState({
        title: user ? `📋 ${user.tag} — clean record` : '📋 No server cases',
        message: user
          ? `${user.tag} has no moderation history on this server.`
          : 'No moderation actions have been recorded yet.',
        tone: 'moderation',
      })] });
      return;
    }

    const items = list.map((c) =>
      `\`${c.id}\` — **${c.action.toUpperCase()}** · <@${c.targetId}> · ${discordTime(c.createdAt, 'R')}\nReason: ${c.reason ?? '_None_'}`
    );
    await respond(ctx, { embeds: [listResult({
      title: user ? `📋 Cases — ${user.tag}` : '📋 Server cases',
      items,
      summary: `${list.length} case${list.length === 1 ? '' : 's'} shown (max ${limit}).`,
      perPage: 10,
      tone: 'moderation',
    })] });
  },
};

const caseDef: CommandDefinition = {
  name: 'case',
  description: 'Show a single moderation case by ID.',
  category: 'moderation',
  userPermissions: ['ModerateMembers'],

  buildSlash() {
    return new SlashCommandBuilder().setName('case').setDescription('Show a case.').addStringOption((o) => o.setName('id').setDescription('Case ID').setRequired(true));
  },

  async parseSlash(i: ChatInputCommandInteraction) {
    return { id: i.options.getString('id', true) };
  },

  async parsePrefix(_m: Message, raw: string[]) {
    return { id: raw[0] };
  },

  async run(ctx: CommandContext) {
    if (!ctx.guild) return;
    const { id } = ctx.args as any;
    const c = getCase(ctx.guild.id, id);
    if (!c) {
      await respond(ctx, { embeds: [buildEmbed({ tone: 'warning', title: 'Case not found', description: `No case with ID "${id}".` })] });
      return;
    }
    const embed = buildEmbed({
      tone: 'moderation',
      title: `Case ${c.id} — ${c.action.toUpperCase()}`,
      fields: [
        { name: 'Target', value: `<@${c.targetId}>`, inline: true },
        { name: 'Moderator', value: `<@${c.moderatorId}>`, inline: true },
        { name: 'When', value: discordTime(c.createdAt, 'F'), inline: true },
        { name: 'Reason', value: c.reason ?? 'No reason', inline: false },
      ],
    });
    await respond(ctx, { embeds: [embed] });
  },
};

const casesDef: CommandDefinition = {
  name: 'cases',
  description: 'Alias for /modlogs.',
  category: 'moderation',
  userPermissions: ['ModerateMembers'],
  buildSlash() {
    return new SlashCommandBuilder().setName('cases').setDescription('View moderation cases.').addUserOption((o) => o.setName('user').setDescription('Filter by user').setRequired(false)).addIntegerOption((o) => o.setName('limit').setDescription('Max results').setRequired(false));
  },
  async parseSlash(i: ChatInputCommandInteraction) {
    return { user: i.options.getUser('user'), limit: i.options.getInteger('limit') ?? 15 };
  },
  async parsePrefix(m: Message, raw: string[]) {
    const user = raw[0] ? await resolveUser(m.guild!, raw[0]) : undefined;
    return { user, limit: 15 };
  },
  async run(ctx: CommandContext) {
    await def.run(ctx);
  },
};

registerCommand(def);
registerCommand(caseDef);
registerCommand(casesDef);
export default def;