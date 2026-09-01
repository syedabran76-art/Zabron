/**
 * Zabron — Cooldown tracker.
 *
 * Tracks per-user cooldowns per guild + command. Backed by SQLite so
 * cooldowns survive restarts.
 */

import { getCooldownRemaining, setCooldown } from '../db/repositories.js';
import { discordTime } from '../utils/duration.js';

export interface CooldownOptions {
  guildId: string;
  userId: string;
  command: string;
  seconds: number;
}

export interface CooldownResult {
  allowed: boolean;
  remainingMs: number;
  displayRemaining: string;
}

export function checkCooldown(opts: CooldownOptions): CooldownResult {
  if (!opts.seconds || opts.seconds <= 0) {
    return { allowed: true, remainingMs: 0, displayRemaining: '0s' };
  }
  const remaining = getCooldownRemaining(opts.guildId, opts.userId, opts.command);
  if (remaining > 0) {
    return {
      allowed: false,
      remainingMs: remaining,
      displayRemaining: `${Math.ceil(remaining / 1000)}s`,
    };
  }
  setCooldown(opts.guildId, opts.userId, opts.command, opts.seconds);
  return { allowed: true, remainingMs: 0, displayRemaining: '0s' };
}

export function formatCooldown(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export { discordTime };