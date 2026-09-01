/**
 * Zabron — Automation engine.
 *
 * Workflows are JSON-defined (event → conditions → actions). The engine
 * is event-driven: handlers call `runWorkflowsForTrigger()` whenever a
 * relevant Discord event fires.
 */

import type { Guild, GuildMember, User } from 'discord.js';

import type { AutomationConditionType, AutomationEvent } from '../types/index.js';
import { getWorkflowsForTrigger } from '../db/repositories.js';
import { logger } from '../utils/logger.js';

export interface AutomationCondition {
  type: AutomationConditionType;
  value: string | number;
  field?: string;
}

export interface AutomationAction {
  type:
    | 'send_message'
    | 'send_dm'
    | 'add_role'
    | 'remove_role'
    | 'kick'
    | 'ban'
    | 'timeout'
    | 'warn'
    | 'log';
  channel?: string;
  message?: string;
  role?: string;
  duration?: string;
  reason?: string;
}

export interface WorkflowContext {
  guild: Guild;
  user?: User | GuildMember;
  channel?: { id: string; name?: string };
  message?: { id: string; content: string; author: { id: string; tag: string } };
  raw?: Record<string, unknown>;
}

export function parseJSON<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export function evaluateConditions(conditions: AutomationCondition[], ctx: WorkflowContext): boolean {
  for (const cond of conditions) {
    if (!matchesCondition(cond, ctx)) return false;
  }
  return true;
}

function matchesCondition(cond: AutomationCondition, ctx: WorkflowContext): boolean {
  switch (cond.type) {
    case 'equals': {
      const field = String((ctx.raw as any)?.[cond.field as string] ?? '');
      return field === String(cond.value);
    }
    case 'contains': {
      const field = String((ctx.raw as any)?.[cond.field as string] ?? '');
      return field.toLowerCase().includes(String(cond.value).toLowerCase());
    }
    case 'regex': {
      const field = String((ctx.raw as any)?.[cond.field as string] ?? '');
      try { return new RegExp(String(cond.value)).test(field); } catch { return false; }
    }
    case 'role': {
      if (!ctx.user || !('roles' in ctx.user)) return false;
      return ctx.user.roles.cache.has(String(cond.value));
    }
    case 'channel': {
      return ctx.channel?.id === String(cond.value);
    }
    default:
      return true;
  }
}

export async function runActions(actions: AutomationAction[], ctx: WorkflowContext): Promise<void> {
  for (const action of actions) {
    try {
      await runAction(action, ctx);
    } catch (err) {
      logger.warn('Automation action failed', { type: action.type, err: String(err) });
    }
  }
}

async function runAction(action: AutomationAction, ctx: WorkflowContext): Promise<void> {
  const client = ctx.guild.client;
  switch (action.type) {
    case 'send_message': {
      if (!action.channel || !action.message) return;
      const channel = await client.channels.fetch(action.channel).catch(() => null);
      if (channel && 'send' in channel) await (channel as any).send(action.message);
      break;
    }
    case 'send_dm': {
      if (!ctx.user || !action.message) return;
      // Runtime duck-type: any object with a callable `send` is DM-able.
      const candidate = ctx.user as unknown as { id?: string; send?: (m: string) => Promise<unknown> };
      const direct = typeof candidate.send === 'function' ? candidate : null;
      const fetched = !direct && candidate.id ? await client.users.fetch(candidate.id).catch(() => null) : null;
      const u = direct ?? fetched;
      if (u && typeof (u as any).send === 'function') await (u as any).send(action.message).catch(() => {});
      break;
    }
    case 'add_role': {
      if (!ctx.user || !action.role || !('roles' in ctx.user)) return;
      const role = await ctx.guild.roles.fetch(action.role).catch(() => null);
      if (!role) return;
      await (ctx.user as GuildMember).roles.add(role).catch(() => {});
      break;
    }
    case 'remove_role': {
      if (!ctx.user || !action.role || !('roles' in ctx.user)) return;
      const role = await ctx.guild.roles.fetch(action.role).catch(() => null);
      if (!role) return;
      await (ctx.user as GuildMember).roles.remove(role).catch(() => {});
      break;
    }
    case 'kick': {
      if (!ctx.user) return;
      const m = await ctx.guild.members.fetch(ctx.user.id).catch(() => null);
      await m?.kick(action.reason ?? undefined).catch(() => {});
      break;
    }
    case 'ban': {
      if (!ctx.user) return;
      await ctx.guild.members.ban(ctx.user.id, { reason: action.reason ?? undefined }).catch(() => {});
      break;
    }
    case 'timeout': {
      if (!ctx.user) return;
      const m = await ctx.guild.members.fetch(ctx.user.id).catch(() => null);
      const ms = parseDurationMs(action.duration ?? '10m');
      await m?.timeout(ms, action.reason ?? undefined).catch(() => {});
      break;
    }
    case 'warn': {
      if (!ctx.user) return;
      const { addWarning } = await import('../db/repositories.js');
      addWarning(ctx.guild.id, ctx.user.id, client.user!.id, action.reason ?? null);
      break;
    }
    case 'log': {
      const { logEvent, buildActorInfo } = await import('./logging.js');
      await logEvent({
        guildId: ctx.guild.id,
        category: 'general',
        title: action.message ?? 'Automation log',
        author: ctx.user ? buildActorInfo(ctx.user) : undefined,
        client,
      });
      break;
    }
  }
}

function parseDurationMs(input: string): number {
  const match = /^(\d+)\s*([a-z]+)$/i.exec(input.trim());
  if (!match) return 10 * 60_000;
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  const map: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return value * (map[unit] ?? 60_000);
}

export async function runWorkflowsForTrigger(guildId: string, trigger: AutomationEvent, ctx: WorkflowContext): Promise<void> {
  const workflows = getWorkflowsForTrigger(guildId, trigger);
  for (const wf of workflows) {
    const conditions = parseJSON<AutomationCondition[]>(wf.conditions, []);
    const actions = parseJSON<AutomationAction[]>(wf.actions, []);
    if (!evaluateConditions(conditions, ctx)) continue;
    await runActions(actions, ctx);
  }
}