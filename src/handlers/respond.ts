/**
 * Zabron — Unified response helper.
 *
 * Both slash and prefix commands produce CommandContext objects. This
 * module exposes a single `respond()` that decides how to send the
 * reply based on the source — keeping business logic source-agnostic.
 */

import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  InteractionCallbackResponse,
  InteractionResponse,
  Message,
  MessageCreateOptions,
  MessageReplyOptions,
} from 'discord.js';
import type { CommandContext, WritableChannel } from '../types/index.js';

export interface RespondOptions {
  embeds?: EmbedBuilder[];
  content?: string;
  ephemeral?: boolean;
  components?: any[];
  files?: any[];
  allowedMentions?: MessageCreateOptions['allowedMentions'];
}

/**
 * Returns a channel that supports `.send()` if available, else null.
 * Forum channels and partial group DMs are excluded because they do not
 * expose `send()` in this discord.js version.
 */
function writableChannel(channel: CommandContext['channel']): WritableChannel | null {
  if (!channel) return null;
  // Partial group DMs are read-only.
  if ((channel as any).partial) return null;
  return channel;
}

export async function respond(ctx: CommandContext, options: RespondOptions): Promise<Message | void> {
  const payload: any = {
    content: options.content,
    embeds: options.embeds,
    components: options.components,
    files: options.files,
    allowedMentions: options.allowedMentions ?? { parse: [] },
  };
  if (ctx.source === 'slash' && ctx.interaction) {
    const int = ctx.interaction;
    if (int.deferred || int.replied) {
      // followUp returns InteractionCallbackResponse — unwrap to get the Message.
      const resp = await int.followUp({ ...payload, ephemeral: options.ephemeral });
      return await unwrapInteractionCallback(resp);
    }
    const resp = await int.reply({ ...payload, ephemeral: options.ephemeral });
    return await unwrapInteractionCallback(resp);
  }
  if (ctx.source === 'prefix' && ctx.message) {
    const ch = writableChannel(ctx.channel);
    if (!ch) return;
    const opts: MessageReplyOptions = { ...payload, reply: { messageReference: ctx.message.id } };
    try {
      return await ch.send(opts as MessageCreateOptions);
    } catch {
      return ch.send(payload as MessageCreateOptions);
    }
  }
}

/**
 * Unwrap `InteractionCallbackResponse` -> `Message | void`.
 * `InteractionCallbackResponse.resource.message` holds the resulting message
 * (if Discord sent one back), otherwise the response is purely ephemeral
 * acknowledgement and we return undefined.
 */
async function unwrapInteractionCallback(resp: InteractionCallbackResponse | InteractionResponse | Message): Promise<Message | void> {
  if (resp instanceof Message) return resp;
  // InteractionResponse exposes fetch(); InteractionCallbackResponse exposes resource.message.
  if ('resource' in resp) {
    return resp.resource?.message ?? undefined;
  }
  // Legacy InteractionResponse — fetch the underlying message.
  try {
    return await (resp as InteractionResponse).fetch();
  } catch {
    return;
  }
}

export async function deferReply(ctx: CommandContext, ephemeral = false): Promise<void> {
  if (ctx.source === 'slash' && ctx.interaction && !ctx.interaction.deferred) {
    await ctx.interaction.deferReply({ ephemeral });
  }
}

export async function editReply(ctx: CommandContext, options: RespondOptions): Promise<void> {
  if (ctx.source === 'slash' && ctx.interaction) {
    // editReply is defined on ChatInputCommandInteraction (not the base Interaction).
    await (ctx.interaction as ChatInputCommandInteraction).editReply(options as unknown as Parameters<ChatInputCommandInteraction['editReply']>[0]);
  } else {
    const ch = writableChannel(ctx.channel);
    if (ch) await ch.send(options as MessageCreateOptions);
  }
}

export async function replyError(ctx: CommandContext, message: string): Promise<Message | void> {
  const { error } = await import('../embeds/builders.js');
  return respond(ctx, { embeds: [error('Error', message)], ephemeral: ctx.source === 'slash' });
}

export async function replySuccess(ctx: CommandContext, title: string, description?: string): Promise<Message | void> {
  const { success } = await import('../embeds/builders.js');
  return respond(ctx, { embeds: [success(title, description)] });
}

export async function replyWarning(ctx: CommandContext, title: string, description?: string): Promise<Message | void> {
  const { warning } = await import('../embeds/builders.js');
  return respond(ctx, { embeds: [warning(title, description)] });
}

export async function replyInfo(ctx: CommandContext, title: string, description?: string): Promise<Message | void> {
  const { info } = await import('../embeds/builders.js');
  return respond(ctx, { embeds: [info(title, description)] });
}

// ---------- Category-specific helpers ----------

export async function replyModeration(ctx: CommandContext, title: string, description?: string): Promise<Message | void> {
  const { moderation } = await import('../embeds/builders.js');
  return respond(ctx, { embeds: [moderation(title, description)] });
}

export async function replySecurity(ctx: CommandContext, title: string, description?: string): Promise<Message | void> {
  const { security } = await import('../embeds/builders.js');
  return respond(ctx, { embeds: [security(title, description)] });
}

export async function replyConfig(ctx: CommandContext, title: string, description?: string): Promise<Message | void> {
  const { configuration } = await import('../embeds/builders.js');
  return respond(ctx, { embeds: [configuration(title, description)] });
}

export async function replyTicket(ctx: CommandContext, title: string, description?: string): Promise<Message | void> {
  const { ticket } = await import('../embeds/builders.js');
  return respond(ctx, { embeds: [ticket(title, description)] });
}

export async function replyGiveaway(ctx: CommandContext, title: string, description?: string): Promise<Message | void> {
  const { giveaway } = await import('../embeds/builders.js');
  return respond(ctx, { embeds: [giveaway(title, description)] });
}

export async function replyLeveling(ctx: CommandContext, title: string, description?: string): Promise<Message | void> {
  const { leveling } = await import('../embeds/builders.js');
  return respond(ctx, { embeds: [leveling(title, description)] });
}

export async function replySystem(ctx: CommandContext, title: string, description?: string): Promise<Message | void> {
  const { system } = await import('../embeds/builders.js');
  return respond(ctx, { embeds: [system(title, description)] });
}

export async function replyVoice(ctx: CommandContext, title: string, description?: string): Promise<Message | void> {
  const { voice } = await import('../embeds/builders.js');
  return respond(ctx, { embeds: [voice(title, description)] });
}

export async function replyAutomation(ctx: CommandContext, title: string, description?: string): Promise<Message | void> {
  const { automation } = await import('../embeds/builders.js');
  return respond(ctx, { embeds: [automation(title, description)] });
}

export async function replyCommunity(ctx: CommandContext, title: string, description?: string): Promise<Message | void> {
  const { community } = await import('../embeds/builders.js');
  return respond(ctx, { embeds: [community(title, description)] });
}

/**
 * Convenience: defer a slash reply immediately so the interaction never
 * shows "Application did not respond".
 */
export async function deferIfSlash(ctx: CommandContext, ephemeral = false): Promise<void> {
  if (ctx.source === 'slash' && ctx.interaction && !ctx.interaction.deferred) {
    await ctx.interaction.deferReply({ ephemeral });
  }
}

/**
 * Edit an interaction that we deferred — convenience for slash flows.
 */
export async function resolveInteractionTarget(
  interaction: ChatInputCommandInteraction | Message,
): Promise<Message | ChatInputCommandInteraction> {
  return interaction;
}