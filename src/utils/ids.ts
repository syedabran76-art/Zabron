/**
 * Zabron — Unique ID generators for moderation cases, security events,
 * tickets, giveaways and automation workflows.
 */

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function randomToken(length = 8): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHA[Math.floor(Math.random() * ALPHA.length)];
  }
  return out;
}

export function caseId(): string {
  return `${Date.now().toString(36).toUpperCase()}-${randomToken(4)}`;
}

export function eventId(prefix: string): string {
  return `${prefix.toUpperCase()}-${randomToken(6)}`;
}

export function ticketId(): string {
  return `T-${randomToken(5)}`;
}

export function giveawayId(): string {
  return `G-${randomToken(6)}`;
}