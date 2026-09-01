/**
 * /voicekick + .voicekick — Disconnects a member from voice.
 */

import { ChatInputCommandInteraction, Message, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import type { CommandContext, CommandDefinition } from '../../types/index.js';
import { registerCommand } from '../../handlers/registry.js';
import { respond, replyError } from '../../handlers/respond.js';
import { resolveUser } from '../../utils/permissions.js';
import { canActOn } from '../../utils/permissions.js';
import { buildEmbed } from '../../embeds/builders.js';

const def: CommandDefinition = {
  name: 'voicekick',
  description: 'Disconnect a member from a voice channel.',
  usage: '/voicekick <user> [reason]',
  category: 'moderation',
  userPermissions: ['MoveMembers'],
  botPermissions: ['MoveMembers'],
  cooldownSeconds: 3,

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('voicekick')
      .setDescription('Disconnect a member from voice.')
      .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.MoveMembers);
  },

  async parseSlash(i: ChatInputCommandInteraction) {
    return { user: i.options.getUser('user', true), reason: i.options.getString('reason') };
  },

  async parsePrefix(m: Message, raw: string[]) {
    const user = await resolveUser(m.guild!, raw[0]);
    if (!user) throw new Error(`Could not resolve user "${raw[0]}"`);
    return { user, reason: raw.slice(1).join(' ') || null };
  },

  async run(ctx: CommandContext) {
    if (!ctx.guild || !ctx.member) return;
    const { user, reason } = ctx.args as any;
    const target = await ctx.guild.members.fetch(user.id).catch(() => null);
    if (!target) { await replyError(ctx, 'User is not in the server.'); return; }
    const bot = await ctx.guild.members.fetchMe();
    const hierarchy = canActOn({ guild: ctx.guild, executor: ctx.member, bot, target });
    if (!hierarchy.ok) { await replyError(ctx, hierarchy.reason!); return; }
    if (!target.voice.channel) { await replyError(ctx, 'User is not in a voice channel.'); return; }

    await target.voice.disconnect(reason ?? undefined).catch(async (err) => {
      await replyError(ctx, `Failed: ${err.message}`);
    });
    await respond(ctx, {
      embeds: [buildEmbed({ tone: 'success', title: 'Disconnected from voice', description: `${user.tag} was removed from <#${target.voice.channel.id}>.` })],
    });
  },
};

registerCommand(def);
export default def;