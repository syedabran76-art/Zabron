/**
 * Zabron — Automod scanner.
 *
 * Pure evaluation helpers that take a message and config and return
 * what action the bot should take. The message handler consults these
 * functions before allowing a message through.
 */

import type { AutomodConfig } from './security.js';

const URL_REGEX = /\b(?:https?:\/\/|www\.)[^\s<]+\b/i;
const INVITE_REGEX = /discord(?:app)?\.(?:gg|com\/invite)\/[a-zA-Z0-9-]+/i;
const MENTION_REGEX = /<@!?\d{17,20}>/g;

export interface AutomodVerdict {
  triggered: boolean;
  reason?: string;
  action: 'none' | 'delete' | 'warn' | 'timeout' | 'kick';
  /**
   * Optional sub-classifier so the log embed can show the exact rule that
   * fired (e.g. "blocked-word:foo", "spam:5/5s", "link"). Pure audit detail.
   */
  matches?: string;
  /**
   * Number of messages / mentions in the rule window at the time the
   * verdict was issued. Used to render the threshold in the audit log.
   */
  count?: number;
}

const NOOP: AutomodVerdict = { triggered: false, action: 'none' };

export function evaluateMessage(
  content: string,
  config: AutomodConfig,
  recentMessages: { content: string; ts: number }[],
): AutomodVerdict {
  if (!config.enabled) return NOOP;

  // Blocked words
  const lower = content.toLowerCase();
  for (const word of config.blockedWords) {
    if (!word) continue;
    if (lower.includes(word.toLowerCase())) {
      return { triggered: true, reason: `Blocked word: ${word}`, action: config.punishment, matches: `blocked-word:${word}`, count: 1 };
    }
  }

  // Mention spam
  const mentions = content.match(MENTION_REGEX) ?? [];
  if (mentions.length >= config.mentionLimit) {
    return { triggered: true, reason: 'Mass mentions', action: config.punishment, matches: `mentions:${mentions.length}/${config.mentionLimit}`, count: mentions.length };
  }

  // Links
  if (config.linkBlock && URL_REGEX.test(content)) {
    return { triggered: true, reason: 'Links blocked', action: config.punishment, matches: 'link', count: 1 };
  }

  // Invites
  if (config.inviteBlock && INVITE_REGEX.test(content)) {
    return { triggered: true, reason: 'Invites blocked', action: config.punishment, matches: 'invite', count: 1 };
  }

  // Excessive caps
  if (content.length >= config.capsMinLength) {
    const letters = content.replace(/[^A-Za-z]/g, '');
    const caps = letters.replace(/[^A-Z]/g, '');
    if (letters.length > 0 && caps.length / letters.length * 100 >= config.capsPercent) {
      return { triggered: true, reason: 'Excessive caps', action: config.punishment, matches: `caps:${config.capsPercent}%`, count: 1 };
    }
  }

  // Spam — N messages within interval
  if (recentMessages.length >= config.spamMessages) {
    const windowStart = Date.now() - config.spamIntervalSeconds * 1000;
    const recent = recentMessages.filter((m) => m.ts >= windowStart);
    if (recent.length >= config.spamMessages) {
      return { triggered: true, reason: 'Spam', action: config.punishment, matches: `spam:${recent.length}/${config.spamIntervalSeconds}s`, count: recent.length };
    }
  }

  // Duplicates
  if (config.duplicateLimit > 0) {
    const dupes = recentMessages.filter((m) => m.content.trim() === content.trim()).length;
    if (dupes >= config.duplicateLimit) {
      return { triggered: true, reason: 'Duplicate spam', action: config.punishment, matches: `duplicate:${dupes}/${config.duplicateLimit}`, count: dupes };
    }
  }

  return NOOP;
}