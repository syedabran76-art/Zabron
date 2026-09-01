/**
 * /nick + .nick — Change or clear a member's nickname.
 */

import { ChatInputCommandInteraction, Message, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import type { CommandContext, CommandDefinition } from '../../types/index.js';
import { registerCommand } from '../../handlers/registry.js';
import { respond, replyError } from '../../handlers/respond.js';
import { resolveUser } from '../../utils/permissions.js';
import { canActOn } from '../../utils/permissions.js';
import { actionDone } from '../../embeds/builders.js';
import { logEvent, buildActorInfo } from '../../services/logging.js';

const def: CommandDefinition = {
  name: 'nick',
  description: 'Change or clear a member\'s nickname.',
  usage: '/nick <user> <new-name|none>',
  category: 'moderation',
  userPermissions: ['ManageNicknames'],
  botPermissions: ['ManageNicknames'],
  cooldownSeconds: 3,

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('nick')
      .setDescription('Change a member\'s nickname.')
      .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
      .addStringOption((o) => o.setName('nickname').setDescription('New nickname (leave empty to clear)').setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames);
  },

  async parseSlash(i: ChatInputCommandInteraction) {
    return { user: i.options.getUser('user', true), nickname: i.options.getString('nickname') };
  },

  async parsePrefix(m: Message, raw: string[]) {
    const user = await resolveUser(m.guild!, raw[0]);
    if (!user) throw new Error(`Could not resolve user "${raw[0]}"`);
    return { user, nickname: raw.slice(1).join(' ') || null };
  },

  async run(ctx: CommandContext) {
    if (!ctx.guild || !ctx.member || !ctx.channel) return;
    const { user, nickname } = ctx.args as any;
    const target = await ctx.guild.members.fetch(user.id).catch(() => null);
    if (!target) { await replyError(ctx, 'User is not a member of this server.'); return; }
    const bot = await ctx.guild.members.fetchMe();
    const hierarchy = canActOn({ guild: ctx.guild, executor: ctx.member, bot, target });
    if (!hierarchy.ok) { await replyError(ctx, hierarchy.reason!); return; }

    const finalNick = nickname && nickname.toLowerCase() !== 'none' ? nickname.slice(0, 32) : null;
    await target.setNickname(finalNick, `by ${ctx.user.tag}`).catch(async (err) => {
      await replyError(ctx, `Failed: ${err.message}`);
    });
    await respond(ctx, {
      embeds: [actionDone({
        action: 'Nickname updated',
        target: `<@${user.id}>`,
        detail: `New nickname: **${finalNick ?? '_(cleared)_'}**`,
      })],
    });
    await logEvent({
      guildId: ctx.guild.id,
      category: 'member',
      title: 'Nickname changed',
      fields: [{ name: 'New nickname', value: finalNick ?? '(cleared)', inline: true }],
      author: buildActorInfo(ctx.member),
      target: buildActorInfo(user),
      client: ctx.guild.client,
    });
  },
};

registerCommand(def);
export default def;