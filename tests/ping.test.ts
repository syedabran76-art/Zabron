/**
 * Zabron — Tests for the centralized pingResult dashboard.
 *
 * Verifies that:
 *   - Negative / non-finite latency never appears in the embed as "-1ms"
 *   - Status indicators reflect the latency correctly
 *   - Title + description always carry the right "system health" tone
 *   - Ping falls back to "unknown" when no heartbeat is available
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  pingResult,
  pingFields,
  fmtLatency,
  fmtMemory,
  fmtUptime,
  STATUS_INDICATOR,
  type PingMetrics,
} from '../src/embeds/builders.js';

const baseMetrics: PingMetrics = {
  wsLatency: 50,
  uptimeMs: 60_000,
  memoryMB: 120,
  guildCount: 5,
};

// ---------------------------------------------------------------------------
// fmtLatency — never surfaces a negative value
// ---------------------------------------------------------------------------

test('fmtLatency: never returns -1 for unavailable values', () => {
  for (const bad of [-1, -1_000, NaN, Infinity, -Infinity]) {
    const out = fmtLatency(bad);
    assert.strictEqual(out.display, '—', `fmtLatency(${bad}) should display "—"`);
    assert.strictEqual(out.known, false);
    assert.strictEqual(out.status, 'unknown');
  }
});

test('fmtLatency: rounds positive values and classifies them', () => {
  assert.deepStrictEqual(fmtLatency(45),    { display: '45ms',  known: true, status: 'healthy' });
  assert.deepStrictEqual(fmtLatency(99.4),  { display: '99ms',  known: true, status: 'healthy' });
  assert.deepStrictEqual(fmtLatency(100),   { display: '100ms', known: true, status: 'degraded' });
  assert.deepStrictEqual(fmtLatency(249),   { display: '249ms', known: true, status: 'degraded' });
  assert.deepStrictEqual(fmtLatency(250),   { display: '250ms', known: true, status: 'blocked' });
  assert.deepStrictEqual(fmtLatency(999),   { display: '999ms', known: true, status: 'blocked' });
});

// ---------------------------------------------------------------------------
// pingFields — no negative values leak through
// ---------------------------------------------------------------------------

test('pingFields: never leaks negative ws latency', () => {
  const fields = pingFields({ ...baseMetrics, wsLatency: -1 });
  const ws = fields.find((f) => f.name === '💓 WebSocket');
  assert.ok(ws, 'should have a WebSocket field');
  assert.ok(!/-1/.test(ws!.value), `WebSocket field should not contain "-1", got: ${ws!.value}`);
  assert.ok(ws!.value.includes('—'), `WebSocket field should display "—", got: ${ws!.value}`);
});

test('pingFields: never leaks NaN/Infinity', () => {
  for (const bad of [NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER * 2]) {
    const fields = pingFields({ ...baseMetrics, wsLatency: bad });
    const ws = fields.find((f) => f.name === '💓 WebSocket');
    assert.ok(ws, 'should have a WebSocket field');
    assert.ok(!ws!.value.includes('NaN'), `must not contain NaN: ${ws!.value}`);
    assert.ok(!ws!.value.includes('Infinity'), `must not contain Infinity: ${ws!.value}`);
  }
});

test('pingFields: includes Uptime, Memory and Servers fields', () => {
  const fields = pingFields(baseMetrics);
  const names = fields.map((f) => f.name);
  assert.ok(names.includes('💓 WebSocket'));
  assert.ok(names.includes('⏱ Uptime'));
  assert.ok(names.includes('💾 Memory'));
  assert.ok(names.includes('🌐 Servers'));
});

// ---------------------------------------------------------------------------
// pingResult — title + tone
// ---------------------------------------------------------------------------

test('pingResult: never displays -1ms in title, description or any field', () => {
  const embed = pingResult({ wsLatency: -1, uptimeMs: 60_000, memoryMB: 120, guildCount: 5 });
  const title = embed.data.title ?? '';
  const description = embed.data.description ?? '';
  const fieldValues = (embed.data.fields ?? []).map((f) => `${f.name} ${f.value}`).join('\n');

  for (const surface of [title, description, fieldValues]) {
    assert.ok(!/-1/.test(surface), `must not contain "-1": ${surface}`);
  }
});

test('pingResult: shows "—" with unknown status when heartbeat is unavailable', () => {
  const embed = pingResult({ wsLatency: -1, uptimeMs: 60_000, memoryMB: 120, guildCount: 5 });
  const description = embed.data.description ?? '';
  // "awaiting heartbeat" or "—" indicator appears
  assert.ok(description.includes(STATUS_INDICATOR.unknown), `description should include ⚪ indicator`);
});

test('pingResult: healthy tone for low latency', () => {
  const embed = pingResult({ wsLatency: 50, uptimeMs: 60_000, memoryMB: 120, guildCount: 5 });
  assert.strictEqual(embed.data.color, 0x2ecc71 /* SUCCESS_COLOR */);
  assert.ok((embed.data.title ?? '').includes('Healthy'));
});

test('pingResult: warning tone for degraded ws', () => {
  const embed = pingResult({ wsLatency: 200, uptimeMs: 60_000, memoryMB: 120, guildCount: 5 });
  assert.strictEqual(embed.data.color, 0xf39c12 /* WARNING_COLOR */);
  assert.ok((embed.data.title ?? '').includes('Degraded'));
});

test('pingResult: error tone for blocked ws', () => {
  const embed = pingResult({ wsLatency: 500, uptimeMs: 60_000, memoryMB: 120, guildCount: 5 });
  assert.strictEqual(embed.data.color, 0xe74c3c /* ERROR_COLOR */);
  assert.ok((embed.data.title ?? '').includes('Blocked'));
});

test('pingResult: description includes a subsystem summary line', () => {
  const embed = pingResult({ wsLatency: 50, uptimeMs: 60_000, memoryMB: 120, guildCount: 5 });
  const description = embed.data.description ?? '';
  assert.ok(description.includes('WebSocket'));
  assert.ok(description.includes('Memory'));
  assert.ok(description.includes('System'));
});

// ---------------------------------------------------------------------------
// fmtMemory + fmtUptime — safety helpers
// ---------------------------------------------------------------------------

test('fmtMemory: handles negative values', () => {
  const out = fmtMemory(-1);
  assert.strictEqual(out.display, '—');
  assert.strictEqual(out.status, 'unknown');
});

test('fmtUptime: returns "—" for invalid ms', () => {
  assert.strictEqual(fmtUptime(0), '—');
  assert.strictEqual(fmtUptime(-1), '—');
  assert.strictEqual(fmtUptime(Number.NaN), '—');
});