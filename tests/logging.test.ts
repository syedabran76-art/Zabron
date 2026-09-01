/**
 * Zabron — Logging system regression tests.
 *
 * Covers:
 *   - Audit log executor helper: target matching, stale-entry rejection,
 *     unknown-executor fallback, multi-action filtering, error isolation.
 *   - Logging config repository: set/disable/webhook/ignore behaviour.
 *   - Embed formatting: central builders always used; required fields
 *     present (actor/target/channel/time).
 *   - Failure modes: missing channel, API errors, partial messages.
 *
 * The tests do NOT spin up a real Discord client — they exercise the
 * pure logic that the event handlers depend on.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { initDatabase, getDatabase } from '../src/db/database.js';
import {
  getLoggingConfig,
  setLoggingChannel,
  setLoggingEnabled,
  getAllLoggingChannels,
  isChannelIgnoredForLogs,
  isWebhookDeliveryEnabled,
} from '../src/db/repositories.js';
import {
  generateEventId,
  buildLogEmbed,
  buildActorInfo,
  resolveAuditExecutor,
  safeFetchMessage,
  type AuditResolution,
  type LogEventOptions,
  __internal as loggingInternal,
} from '../src/services/logging.js';
import { buildEmbed } from '../src/embeds/builders.js';

// ============================================================================
// Setup — initialise the database once for all tests
// ============================================================================

initDatabase(':memory:');

// ============================================================================
// generateEventId()
// ============================================================================

test('generateEventId: returns a category-prefixed id', () => {
  const id = generateEventId('message');
  assert.match(id, /^MSG-/);
  assert.match(id, /-\d{5}$/);
});

test('generateEventId: fallback prefix for unknown categories', () => {
  const id = generateEventId('not-a-real-category');
  assert.match(id, /^LOG-/);
});

test('generateEventId: ids are unique across calls', () => {
  const a = new Set<string>();
  for (let i = 0; i < 50; i++) a.add(generateEventId('message'));
  assert.equal(a.size, 50, 'IDs should not collide');
});

// ============================================================================
// buildActorInfo()
// ============================================================================

test('buildActorInfo: returns undefined for falsy input', () => {
  assert.strictEqual(buildActorInfo(null), undefined);
  assert.strictEqual(buildActorInfo(undefined), undefined);
});

test('buildActorInfo: passes through ActorInfo objects unchanged', () => {
  const a = { id: '123', tag: 'user#0001', avatar: 'http://x' };
  const out = buildActorInfo(a);
  assert.deepStrictEqual(out, a);
});

// ============================================================================
// resolveAuditExecutor() — core audit-log attribution logic
// ============================================================================

/**
 * Build a fake Guild + AuditLog object suitable for unit testing
 * resolveAuditExecutor without a live Discord client.
 */
function fakeGuildAndAudit(
  entries: Array<{
    action: number;
    targetId?: string | null;
    channelId?: string | null;
    createdTimestamp: number;
    executorId?: string | null;
    executorTag?: string | null;
    reason?: string | null;
  }>,
): { guild: any; audit: any } {
  // Map entries to objects compatible with GuildAuditLogsEntry.
  const mapped = entries.map((e, idx) => ({
    action: e.action,
    targetId: e.targetId ?? null,
    createdTimestamp: e.createdTimestamp,
    executor: e.executorId
      ? {
          id: e.executorId,
          tag: e.executorTag ?? `mod${idx}#0001`,
          username: `mod${idx}`,
          displayAvatarURL: () => `https://cdn/${e.executorId}`,
        }
      : null,
    reason: e.reason ?? null,
    extra: e.channelId ? { channel: { id: e.channelId } } : null,
  }));
  const guild = {
    fetchAuditLogs: async () => ({
      entries: {
        values: () => mapped.values(),
        size: mapped.length,
        filter: (fn: (entry: any) => boolean) => {
          const filtered = mapped.filter(fn);
          return {
            size: filtered.length,
            values: () => filtered.values(),
            filter: (fn2: any) => fakeGuildAndAudit([]).audit.entries.filter(fn2),
            first: () => filtered[0] ?? null,
            get: (id: string) => filtered.find((x) => (x as any).id === id) ?? null,
            [Symbol.iterator]: () => filtered.values(),
          };
        },
        first: () => mapped[0] ?? null,
        get: (id: string) => mapped.find((x) => (x as any).id === id) ?? null,
        [Symbol.iterator]: () => mapped.values(),
      },
    }),
  };
  return { guild, audit: { entries: mapped } };
}

test('resolveAuditExecutor: returns null executor when no entries match', async () => {
  const { guild } = fakeGuildAndAudit([]);
  const result: AuditResolution = await resolveAuditExecutor({
    guild,
    action: 72, // MessageDelete
    targetId: 'msg1',
  });
  assert.strictEqual(result.executor, null);
  assert.strictEqual(result.executorId, null);
});

test('resolveAuditExecutor: matches the correct entry by target', async () => {
  const { guild } = fakeGuildAndAudit([
    { action: 20, targetId: 'other', createdTimestamp: Date.now(), executorId: 'modA', executorTag: 'A#0001' },
    { action: 72, targetId: 'msg1', createdTimestamp: Date.now(), executorId: 'modB', executorTag: 'B#0001' },
  ]);
  const result = await resolveAuditExecutor({
    guild,
    action: 72,
    targetId: 'msg1',
  });
  assert.ok(result.executor, 'should resolve executor');
  assert.strictEqual(result.executor!.id, 'modB');
  assert.strictEqual(result.executor!.tag, 'B#0001');
});

test('resolveAuditExecutor: rejects stale entries older than maxAgeMs', async () => {
  const old = Date.now() - 5 * 60_000; // 5 min ago
  const { guild } = fakeGuildAndAudit([
    { action: 72, targetId: 'msg1', createdTimestamp: old, executorId: 'modOld' },
    { action: 72, targetId: 'msg1', createdTimestamp: Date.now(), executorId: 'modNew' },
  ]);
  // Discord returns entries newest-first, so the recent one is at the start.
  const result = await resolveAuditExecutor({
    guild,
    action: 72,
    targetId: 'msg1',
    maxAgeMs: 30_000,
  });
  assert.ok(result.executor);
  assert.strictEqual(result.executor!.id, 'modNew');
});

test('resolveAuditExecutor: filters by action when multiple types supplied', async () => {
  const { guild } = fakeGuildAndAudit([
    { action: 22, targetId: 'msg1', createdTimestamp: Date.now(), executorId: 'banMod' }, // MemberBanAdd
    { action: 72, targetId: 'msg1', createdTimestamp: Date.now() + 10, executorId: 'delMod' }, // MessageDelete
  ]);
  const result = await resolveAuditExecutor({
    guild,
    action: [72, 73],
    targetId: 'msg1',
  });
  assert.ok(result.executor);
  assert.strictEqual(result.executor!.id, 'delMod');
});

test('resolveAuditExecutor: falls back to "Unknown" executor when entry has no executor', async () => {
  const { guild } = fakeGuildAndAudit([
    { action: 72, targetId: 'msg1', createdTimestamp: Date.now(), executorId: null },
  ]);
  const result = await resolveAuditExecutor({
    guild,
    action: 72,
    targetId: 'msg1',
  });
  assert.strictEqual(result.executor, null);
  assert.strictEqual(result.executorId, null);
  assert.ok(result.entry, 'entry should still be returned for caller inspection');
});

test('resolveAuditExecutor: never throws when fetchAuditLogs rejects', async () => {
  const guild = {
    fetchAuditLogs: async () => {
      throw new Error('rate limited');
    },
  };
  const result = await resolveAuditExecutor({
    guild,
    action: 72,
    targetId: 'msg1',
  });
  assert.strictEqual(result.executor, null);
  assert.strictEqual(result.entry, null);
});

test('resolveAuditExecutor: matches by channelId when targetId also provided', async () => {
  const { guild } = fakeGuildAndAudit([
    { action: 73, targetId: 'channel1', channelId: 'channel1', createdTimestamp: Date.now(), executorId: 'bulkMod' },
  ]);
  // Note: bulk delete targetId == channelId, so we can search by channel.
  const result = await resolveAuditExecutor({
    guild,
    action: 73,
    targetId: 'channel1',
    channelId: 'channel1',
  });
  assert.ok(result.executor);
  assert.strictEqual(result.executor!.id, 'bulkMod');
});

test('resolveAuditExecutor: ignores entries with mismatched target when targetId supplied', async () => {
  const { guild } = fakeGuildAndAudit([
    { action: 72, targetId: 'wrong', createdTimestamp: Date.now(), executorId: 'wrongMod' },
    { action: 72, targetId: 'right', createdTimestamp: Date.now(), executorId: 'rightMod' },
  ]);
  // Discord orders newest-first; if a recent entry is wrong and the
  // older one is correct, the resolver must SKIP the wrong one.
  const result = await resolveAuditExecutor({
    guild,
    action: 72,
    targetId: 'right',
  });
  assert.ok(result.executor);
  assert.strictEqual(result.executor!.id, 'rightMod');
});

test('resolveAuditExecutor: returns null when targetId is supplied but no entry matches', async () => {
  const { guild } = fakeGuildAndAudit([
    { action: 72, targetId: 'msgA', createdTimestamp: Date.now(), executorId: 'modA' },
  ]);
  const result = await resolveAuditExecutor({
    guild,
    action: 72,
    targetId: 'msgB', // different target
  });
  assert.strictEqual(result.executor, null);
});

// ============================================================================
// safeFetchMessage()
// ============================================================================

test('safeFetchMessage: returns null on partial fetch failure', async () => {
  const partial = {
    partial: true,
    fetch: async () => { throw new Error('Unknown Message'); },
  };
  const out = await safeFetchMessage(partial as any);
  assert.strictEqual(out, null);
});

test('safeFetchMessage: returns the message when fetch succeeds', async () => {
  const full = { id: 'm1', content: 'hello' };
  const partial = {
    partial: true,
    fetch: async () => full,
  };
  const out = await safeFetchMessage(partial as any);
  assert.strictEqual(out, full);
});

test('safeFetchMessage: returns the message unchanged when it is not partial', async () => {
  const full = { id: 'm1', partial: false } as any;
  const out = await safeFetchMessage(full);
  assert.strictEqual(out, full);
});

// ============================================================================
// buildLogEmbed() — centralised embed formatting
// ============================================================================

test('buildLogEmbed: always renders Actor, Channel, Time fields', () => {
  const embed = buildLogEmbed(
    {
      client: {} as any,
      guildId: 'g1',
      category: 'message',
      title: 'Test event',
      actor: { id: 'u1', tag: 'alice#0001', avatar: 'http://avatar' },
      target: { id: 'u2', tag: 'bob#0001' },
      channelId: 'c1',
    } as LogEventOptions,
    'MSG-TEST-00001',
    Date.now(),
  );
  const json = embed.toJSON();
  const names = (json.fields ?? []).map((f) => f.name);
  assert.ok(names.includes('👤 Actor'), 'should have Actor field');
  assert.ok(names.includes('🎯 Target'), 'should have Target field');
  assert.ok(names.includes('📍 Channel'), 'should have Channel field');
  assert.ok(names.includes('🕒 Time'), 'should have Time field');
});

test('buildLogEmbed: shows "Unknown" when actor is explicitly null', () => {
  const embed = buildLogEmbed(
    {
      client: {} as any,
      guildId: 'g1',
      category: 'message',
      title: 'Test',
      actor: null,
    } as LogEventOptions,
    'MSG-XYZ-00001',
    Date.now(),
  );
  const json = embed.toJSON();
  const actorField = (json.fields ?? []).find((f) => f.name === '👤 Actor');
  assert.ok(actorField);
  assert.match(actorField!.value, /Unknown/);
});

test('buildLogEmbed: embeds the eventId in the footer', () => {
  const embed = buildLogEmbed(
    {
      client: {} as any,
      guildId: 'g1',
      category: 'security',
      title: 'Test',
    } as LogEventOptions,
    'SEC-TEST-00099',
    Date.now(),
  );
  const json = embed.toJSON();
  assert.match(json.footer?.text ?? '', /SEC-TEST-00099/);
});

test('buildLogEmbed: appends supplied extra fields', () => {
  const embed = buildLogEmbed(
    {
      client: {} as any,
      guildId: 'g1',
      category: 'message',
      title: 'Test',
      fields: [{ name: 'Custom', value: 'value', inline: true }],
    } as LogEventOptions,
    'MSG-CUSTOM-00001',
    Date.now(),
  );
  const json = embed.toJSON();
  assert.ok((json.fields ?? []).some((f) => f.name === 'Custom'));
});

// ============================================================================
// Logging configuration — repository behaviour
// ============================================================================

test('logging config: setLoggingChannel enables the category automatically', () => {
  setLoggingChannel('g-config', 'message', 'ch-1');
  const cfg = getLoggingConfig('g-config', 'message');
  assert.strictEqual(cfg.channelId, 'ch-1');
  assert.strictEqual(cfg.enabled, true);
});

test('logging config: setLoggingChannel(null) clears channel and disables', () => {
  setLoggingChannel('g-config', 'message', 'ch-1');
  setLoggingChannel('g-config', 'message', null);
  const cfg = getLoggingConfig('g-config', 'message');
  assert.strictEqual(cfg.channelId, null);
  assert.strictEqual(cfg.enabled, false);
});

test('logging config: setLoggingEnabled(false) without channel is a no-op signal', () => {
  setLoggingEnabled('g-no-channel', 'message', false);
  const cfg = getLoggingConfig('g-no-channel', 'message');
  assert.strictEqual(cfg.enabled, false);
});

test('logging config: setLoggingEnabled(true) without channel returns false', () => {
  const ok = setLoggingEnabled('g-no-channel', 'message', true);
  assert.strictEqual(ok, false);
});

test('logging config: getAllLoggingChannels returns only enabled categories', () => {
  setLoggingChannel('g-multi', 'message', 'ch-1');
  setLoggingChannel('g-multi', 'member', 'ch-2');
  setLoggingEnabled('g-multi', 'member', false);
  const all = getAllLoggingChannels('g-multi');
  assert.strictEqual(all['message'], 'ch-1');
  // Disabled categories are filtered out by the SQL query (which only
  // returns enabled rows). The returned object has no key for them.
  assert.strictEqual(all['member'], undefined);
});

test('logging config: isChannelIgnoredForLogs honours ignore list', () => {
  const db = getDatabase();
  const gid = 'g-ignore-' + Math.random().toString(36).slice(2, 8);
  db.prepare('INSERT INTO log_ignores (guild_id, channel_id) VALUES (?, ?)').run(gid, 'ch-noisy');
  assert.strictEqual(isChannelIgnoredForLogs(gid, 'ch-noisy'), true);
  assert.strictEqual(isChannelIgnoredForLogs(gid, 'ch-quiet'), false);
});

test('logging config: isWebhookDeliveryEnabled defaults to true when no row', () => {
  const gid = 'g-no-webhook-' + Math.random().toString(36).slice(2, 8);
  assert.strictEqual(isWebhookDeliveryEnabled(gid, 'message'), true);
});

test('logging config: isWebhookDeliveryEnabled honours toggle', () => {
  const db = getDatabase();
  const gid = 'g-webhook-' + Math.random().toString(36).slice(2, 8);
  db.prepare('INSERT INTO log_webhooks (guild_id, category, enabled) VALUES (?, ?, 0)').run(gid, 'message');
  assert.strictEqual(isWebhookDeliveryEnabled(gid, 'message'), false);
});

// ============================================================================
// Centralised builders still produce well-formed embeds
// ============================================================================

test('embeds/builders: buildEmbed returns a proper EmbedBuilder', () => {
  const embed = buildEmbed({ tone: 'log', title: 'Test' });
  const json = embed.toJSON();
  assert.match(json.title ?? '', /Test/);
  assert.ok(typeof json.color === 'number');
});

// ============================================================================
// Tone-for-category mapping (sanity check)
// ============================================================================

test('logging service: toneForCategory maps correctly', () => {
  const { toneForCategory } = loggingInternal as { toneForCategory(c: string): string };
  assert.strictEqual(toneForCategory('security'), 'security');
  assert.strictEqual(toneForCategory('moderation'), 'moderation');
  assert.strictEqual(toneForCategory('message'), 'log');
  assert.strictEqual(toneForCategory('member'), 'log');
  assert.strictEqual(toneForCategory('tickets'), 'ticket');
  assert.strictEqual(toneForCategory('leveling'), 'leveling');
});