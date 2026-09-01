/**
 * Zabron — Permission and hierarchy utilities.
 *
 * Every dangerous command must run its action through these helpers
 * before mutating the server. The helpers provide uniform error
 * messages and never accidentally allow moderators to act on:
 *   - the server owner
 *   - themselves, when inappropriate
 *   - the bot itself
 *   - members above the bot
 *   - members the bot cannot see
 *
 * IMPORTANT: This module is the SINGLE source of truth for translating
 * permission names ("ManageGuild", "Administrator", …) into bitfield
 * values. Discord.js v14 exposes `PermissionFlagsBits.<Name>` as `bigint`
 * and its `PermissionsBitField.has()` natively accepts string names,
 * so callers should prefer passing names through to `.has()` directly.
 *
 * The only place that needs explicit bitwise arithmetic is the slash
 * dispatcher, because `Interaction.member.permissions` arrives as a
 * raw permission string (not a GuildMember). That code path is
 * isolated in `hasPermissionForBitfield()` below.
 */

import {
  Guild,
  GuildMember,
  PermissionFlagsBits,
  PermissionResolvable,
  PermissionsBitField,
  User,
} from 'discord.js';

export interface ReasonCheck {
  ok: boolean;
  reason?: string;
}

export interface PermissionContext {
  guild: Guild;
  executor: GuildMember;
  bot: GuildMember;
  target?: GuildMember | User;
}

export function isGuildOwner(guild: Guild, userId: string): boolean {
  return guild.ownerId === userId;
}

/**
 * Check whether `executor` can act on `target` according to Discord's
 * role hierarchy and our protection rules.
 */
export function canActOn(ctx: PermissionContext): ReasonCheck {
  const { guild, executor, bot, target } = ctx;

  if (target) {
    const targetId = 'id' in target ? target.id : '';

    if (targetId === guild.ownerId && executor.id !== guild.ownerId) {
      return { ok: false, reason: 'You cannot act on the server owner.' };
    }

    if (targetId === bot.user.id) {
      return { ok: false, reason: 'Zabron cannot act on itself.' };
    }

    if ('roles' in target && target.roles) {
      // Executor hierarchy check
      if (
        executor.id !== guild.ownerId &&
        executor.roles.highest.position <= target.roles.highest.position
      ) {
        return {
          ok: false,
          reason: 'You cannot act on a member with an equal or higher role.',
        };
      }
      // Bot hierarchy check
      if (bot.roles.highest.position <= target.roles.highest.position) {
        return {
          ok: false,
          reason: 'Zabron cannot act on a member with an equal or higher role.',
        };
      }
    }
  }

  return { ok: true };
}

/**
 * Centralised permission-name → bit conversion.
 *
 * Accepts anything that discord.js v14 accepts as `PermissionResolvable`:
 *   - bigint           (e.g. PermissionFlagsBits.Administrator)
 *   - number           (legacy numeric flags)
 *   - string           (e.g. "ManageGuild", "BanMembers")
 *   - PermissionsBitField
 *
 * For strings, looks up the matching key in `PermissionFlagsBits`.
 * Throws a descriptive Error if the string is not a known permission,
 * so the caller can surface a clear failure instead of a BigInt crash.
 */
export function toPermissionBit(p: unknown): bigint {
  if (typeof p === 'bigint') return p;
  if (typeof p === 'number') return BigInt(p);
  if (p instanceof PermissionsBitField) return p.bitfield;
  if (typeof p === 'string') {
    const flags = PermissionFlagsBits as unknown as Record<string, bigint>;
    const bit = flags[p];
    if (bit === undefined) {
      throw new Error(`Unknown permission name: "${p}"`);
    }
    return bit;
  }
  throw new Error(
    `Invalid permission input: expected bigint, number, string or PermissionsBitField, got ${typeof p}`,
  );
}

/**
 * Check whether a raw permission bitfield (string | bigint) contains
 * the given `PermissionResolvable`. This is what the slash dispatcher
 * needs because `Interaction.member.permissions` is a raw string.
 *
 * Implementation: builds a temporary `PermissionsBitField` from the
 * raw bitfield so we can use discord.js's native `.has()` which already
 * accepts strings, bigints and numbers correctly.
 */
export function hasPermissionForBitfield(
  rawPerms: string | bigint | number,
  required: PermissionResolvable,
): boolean {
  const bitfield = new PermissionsBitField(BigInt(rawPerms));
  return bitfield.has(required);
}

/**
 * Check whether the executor has all of the listed permission bits.
 * Uses discord.js's native GuildMember.permissions.has() which
 * natively accepts PermissionResolvable (strings, bigints, etc.).
 */
export function hasUserPermissions(
  executor: GuildMember,
  required: PermissionResolvable[] = [],
): ReasonCheck {
  if (!required.length) return { ok: true };
  const missing = required.filter((p) => !executor.permissions.has(p));
  if (missing.length) {
    const names = missing
      .map((p) => permissionToName(p))
      .filter(Boolean)
      .join(', ');
    return {
      ok: false,
      reason: `You are missing the following permission${missing.length > 1 ? 's' : ''}: ${names}.`,
    };
  }
  return { ok: true };
}

/**
 * Check whether the bot has all of the listed permission bits.
 * Uses discord.js's native GuildMember.permissions.has().
 */
export function hasBotPermissions(
  bot: GuildMember,
  required: PermissionResolvable[] = [],
): ReasonCheck {
  if (!required.length) return { ok: true };
  const missing = required.filter((p) => !bot.permissions.has(p));
  if (missing.length) {
    const names = missing
      .map((p) => permissionToName(p))
      .filter(Boolean)
      .join(', ');
    return {
      ok: false,
      reason: `Zabron is missing the following permission${missing.length > 1 ? 's' : ''}: ${names}.`,
    };
  }
  return { ok: true };
}

export function permissionToName(p: PermissionResolvable): string {
  if (typeof p === 'string') {
    return p.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();
  }
  // BigInt flag lookup
  const flags = PermissionFlagsBits as unknown as Record<string, bigint>;
  for (const [name, value] of Object.entries(flags)) {
    if (typeof value === 'bigint' && value === (p as unknown as bigint)) {
      return name.replace(/([A-Z])/g, ' $1').trim();
    }
  }
  return 'Unknown';
}

/**
 * Resolve a user from either a mention, an ID or a username.
 * Returns `null` if the user could not be found.
 */
export async function resolveUser(
  guild: Guild,
  input: string | null | undefined,
): Promise<User | null> {
  if (!input) return null;
  const cleaned = input.replace(/[<@!>]/g, '').trim();
  if (!cleaned) return null;

  // Mention / ID
  if (/^\d{17,20}$/.test(cleaned)) {
    try {
      return await guild.client.users.fetch(cleaned);
    } catch {
      return null;
    }
  }

  // Username#discriminator lookup
  if (cleaned.includes('#')) {
    const [name, discrim] = cleaned.split('#');
    const members = await guild.members.fetch({ query: name }).catch(() => new Map());
    for (const member of members.values()) {
      if (
        member.user.username.toLowerCase() === name.toLowerCase() &&
        member.user.discriminator === discrim
      ) {
        return member.user;
      }
    }
    return null;
  }

  // Fuzzy username lookup
  try {
    const members = await guild.members.fetch({ query: cleaned, limit: 5 });
    for (const member of members.values()) {
      if (member.user.username.toLowerCase() === cleaned.toLowerCase()) {
        return member.user;
      }
    }
    if (members.size > 0) {
      return members.first()!.user;
    }
  } catch {
    /* no-op */
  }
  return null;
}