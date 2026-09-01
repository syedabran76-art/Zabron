/**
 * Zabron — Sticky message runtime.
 *
 * Re-posts the sticky message after every new message in the channel,
 * deleting the previous sticky.
 */

import type { Message, TextChannel } from 'discord.js';

import { getDatabase } from '../db/database.js';
import { listStickyMessages, updateStickyMessageId, upsertStickyMessage } from '../db/repositories.js';

export async function handleSticky(message: Message): Promise<void> {
  if (!message.guild || message.author.bot || !message.channel.isTextBased()) return;
  const channel = message.channel as TextChannel;
  const rows = listStickyMessages(message.guild.id);
  const stick = rows.find((r) => r.channelId === channel.id);
  if (!stick) return;
  if (stick.messageId === message.id) return;
  try {
    if (stick.messageId) {
      const old = await channel.messages.fetch(stick.messageId).catch(() => null);
      if (old) await old.delete().catch(() => {});
    }
    const newMsg = await channel.send(stick.content);
    updateStickyMessageId(message.guild.id, channel.id, newMsg.id);
  } catch {
    /* ignore */
  }
}

export function getSticky(guildId: string, channelId: string) {
  const row = getDatabase().prepare('SELECT * FROM sticky_messages WHERE guild_id = ? AND channel_id = ?').get(guildId, channelId);
  return row ?? null;
}

export function setSticky(guildId: string, channelId: string, content: string, messageId: string | null): void {
  upsertStickyMessage(guildId, channelId, content, messageId);
}