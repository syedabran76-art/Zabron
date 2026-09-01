/**
 * Zabron — Variable substitution.
 *
 * Supports {user}, {username}, {server}, {member_count}, {mention},
 * {user_id}, {guild_id} and {channel}. Used by welcome, goodbye,
 * custom commands and autoresponders.
 */

import type { GuildMember, Guild } from 'discord.js';

export type VariableMap = Partial<{
  user: GuildMember | { user: { id: string; username: string } };
  guild: Guild;
}>;

export function resolveVariables(input: string, ctx: VariableMap = {}): string {
  if (!input) return '';
  const guild = ctx.guild;
  const member = ctx.user;

  const userId = member && 'id' in member ? member.id : '';
  const username =
    member && 'user' in member
      ? member.user.username
      : '';
  const mention = member && 'id' in member ? `<@${member.id}>` : '';
  const guildId = guild?.id ?? '';
  const guildName = guild?.name ?? '';
  const memberCount = guild?.memberCount ?? 0;
  const channel = guild && 'channels' in guild ? `<#${(guild as Guild).channels.cache.first()?.id ?? ''}>` : '';

  return input
    .replaceAll('{user}', username)
    .replaceAll('{username}', username)
    .replaceAll('{mention}', mention)
    .replaceAll('{user_id}', userId)
    .replaceAll('{server}', guildName)
    .replaceAll('{guild}', guildName)
    .replaceAll('{guild_id}', guildId)
    .replaceAll('{member_count}', String(memberCount))
    .replaceAll('{channel}', channel);
}