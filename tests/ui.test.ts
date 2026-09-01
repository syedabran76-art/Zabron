/**
 * Zabron — Tests for the centralized UI / embed design system.
 *
 * Covers:
 *   - Tone → color mapping
 *   - Status indicators (healthy / degraded / blocked)
 *   - Formatting helpers (truncate, mentionUser, fmtDuration, etc.)
 *   - Specialized builders (permissionError, moderationAction, securityAlert)
 *   - List helpers (paginateList, numberedList)
 *   - Brand constants
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Import the design system — use the compiled JS to mirror production usage.
// ---------------------------------------------------------------------------
import * as builders from '../dist/embeds/builders.js';
import type {
  EmbedField,
} from 'discord.js';

const {
  BRAND_NAME,
  BRAND_TAGLINE,
  BRAND_COLOR,
  SUCCESS_COLOR,
  ERROR_COLOR,
  WARNING_COLOR,
  INFO_COLOR,
  SECURITY_COLOR,
  MOD_COLOR,
  CONFIG_COLOR,
  TICKET_COLOR,
  VOICE_COLOR,
  AUTOMATION_COLOR,
  COMMUNITY_COLOR,
  SYSTEM_COLOR,
  STATUS_INDICATOR,
  wsStatus,
  memoryStatus,
  truncate,
  mentionUser,
  tagUser,
  mentionChannel,
  nameChannel,
  mentionRole,
  nameRole,
  fmtDuration,
  buildEmbed,
  permissionError,
  moderationAction,
  securityAlert,
  configChange,
  actionDone,
  pingResult,
  paginateList,
  numberedList,
  confirmRow,
} = builders;

// ---------------------------------------------------------------------------
// Brand constants
// ---------------------------------------------------------------------------

test('BRAND_NAME is Zabron', () => {
  assert.strictEqual(BRAND_NAME, 'Zabron');
});

test('BRAND_COLOR is a valid hex (0x prefix)', () => {
  assert.strictEqual(typeof BRAND_COLOR, 'number');
  assert.ok(BRAND_COLOR >= 0 && BRAND_COLOR <= 0xffffff, 'should be a valid 24-bit color');
});

// ---------------------------------------------------------------------------
// Color palette
// ---------------------------------------------------------------------------

test('All semantic colors are valid 24-bit numbers', () => {
  const colors = [
    SUCCESS_COLOR, ERROR_COLOR, WARNING_COLOR, INFO_COLOR, SECURITY_COLOR,
    MOD_COLOR, CONFIG_COLOR, TICKET_COLOR, VOICE_COLOR, AUTOMATION_COLOR,
    COMMUNITY_COLOR, SYSTEM_COLOR,
  ];
  for (const c of colors) {
    assert.strictEqual(typeof c, 'number', `${c} should be a number`);
    assert.ok(c >= 0 && c <= 0xffffff, `${c} should be a valid 24-bit color`);
  }
});

// ---------------------------------------------------------------------------
// Status indicators
// ---------------------------------------------------------------------------

test('STATUS_INDICATOR has all expected levels', () => {
  assert.ok('healthy' in STATUS_INDICATOR);
  assert.ok('degraded' in STATUS_INDICATOR);
  assert.ok('blocked' in STATUS_INDICATOR);
  assert.ok('unknown' in STATUS_INDICATOR);
});

test('STATUS_INDICATOR values are emoji strings', () => {
  for (const val of Object.values(STATUS_INDICATOR) as string[]) {
    assert.strictEqual(typeof val, 'string');
    assert.ok(val.length >= 1);
  }
});

test('wsStatus: healthy < 100ms', () => {
  assert.strictEqual(wsStatus(50), 'healthy');
  assert.strictEqual(wsStatus(99), 'healthy');
});

test('wsStatus: degraded 100–249ms', () => {
  assert.strictEqual(wsStatus(100), 'degraded');
  assert.strictEqual(wsStatus(200), 'degraded');
  assert.strictEqual(wsStatus(249), 'degraded');
});

test('wsStatus: blocked ≥ 250ms', () => {
  assert.strictEqual(wsStatus(250), 'blocked');
  assert.strictEqual(wsStatus(999), 'blocked');
});

test('wsStatus: unknown for negative', () => {
  assert.strictEqual(wsStatus(-1), 'unknown');
});

test('memoryStatus: healthy < 200MB', () => {
  assert.strictEqual(memoryStatus(100), 'healthy');
  assert.strictEqual(memoryStatus(199), 'healthy');
});

test('memoryStatus: degraded 200–499MB', () => {
  assert.strictEqual(memoryStatus(200), 'degraded');
  assert.strictEqual(memoryStatus(350), 'degraded');
});

test('memoryStatus: blocked ≥ 500MB', () => {
  assert.strictEqual(memoryStatus(500), 'blocked');
  assert.strictEqual(memoryStatus(1000), 'blocked');
});

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

test('truncate: returns original if under limit', () => {
  assert.strictEqual(truncate('hello', 10), 'hello');
  assert.strictEqual(truncate('hello', 5), 'hello');
});

test('truncate: appends suffix and cuts at boundary', () => {
  // truncate(maxLen) = slice(0, maxLen - suffix.length) + suffix
  // truncate('hello world', 8) → slice(0, 7) + '…' → 'hello w…'
  assert.strictEqual(truncate('hello world', 8), 'hello w…');
});

test('truncate: respects custom suffix length', () => {
  assert.strictEqual(truncate('hello world', 9, '~'), 'hello wo~');
});

test('truncate: empty string returns empty', () => {
  assert.strictEqual(truncate('', 10), '');
  assert.strictEqual(truncate(null as any, 10), null as any);
});

test('mentionUser: returns valid Discord mention', () => {
  const mention = mentionUser({ id: '123456789' });
  assert.strictEqual(mention, '<@123456789>');
});

test('tagUser: returns tag for object with tag', () => {
  assert.strictEqual(tagUser({ id: '1', tag: 'User#0001' }), 'User#0001');
});

test('tagUser: falls back to id if no tag', () => {
  assert.strictEqual(tagUser({ id: '123' }), '123');
});

test('mentionChannel: returns Discord channel mention', () => {
  assert.strictEqual(mentionChannel({ id: '999' }), '<#999>');
});

test('nameChannel: returns hash-prefixed name', () => {
  assert.strictEqual(nameChannel({ id: '999', name: 'general' }), '#general');
  assert.strictEqual(nameChannel({ id: '999' }), '#999');
});

test('mentionRole: returns Discord role mention', () => {
  assert.strictEqual(mentionRole({ id: '777' }), '<@&777>');
});

test('nameRole: returns role name', () => {
  assert.strictEqual(nameRole({ id: '777', name: 'Moderator' }), 'Moderator');
  assert.strictEqual(nameRole({ id: '777' }), '@777');
});

test('fmtDuration: formats correctly', () => {
  assert.strictEqual(fmtDuration(0), '0 seconds');
  assert.strictEqual(fmtDuration(1_000), '1s');
  assert.strictEqual(fmtDuration(60_000), '1m');
  assert.strictEqual(fmtDuration(3_600_000), '1h');
  assert.strictEqual(fmtDuration(86_400_000), '1d');
  assert.strictEqual(fmtDuration(3_600_000 + 600_000), '1h 10m'); // 1h 10m
});

// ---------------------------------------------------------------------------
// buildEmbed — tone system
// ---------------------------------------------------------------------------

test('buildEmbed: sets correct color for each tone', () => {
  assert.strictEqual(buildEmbed({ tone: 'success'     }).data.color, SUCCESS_COLOR);
  assert.strictEqual(buildEmbed({ tone: 'error'       }).data.color, ERROR_COLOR);
  assert.strictEqual(buildEmbed({ tone: 'warning'     }).data.color, WARNING_COLOR);
  assert.strictEqual(buildEmbed({ tone: 'info'        }).data.color, INFO_COLOR);
  assert.strictEqual(buildEmbed({ tone: 'security'   }).data.color, SECURITY_COLOR);
  assert.strictEqual(buildEmbed({ tone: 'moderation'  }).data.color, MOD_COLOR);
  assert.strictEqual(buildEmbed({ tone: 'configuration' }).data.color, CONFIG_COLOR);
  assert.strictEqual(buildEmbed({ tone: 'ticket'     }).data.color, TICKET_COLOR);
  assert.strictEqual(buildEmbed({ tone: 'voice'       }).data.color, VOICE_COLOR);
  assert.strictEqual(buildEmbed({ tone: 'automation'  }).data.color, AUTOMATION_COLOR);
  assert.strictEqual(buildEmbed({ tone: 'community'   }).data.color, COMMUNITY_COLOR);
  assert.strictEqual(buildEmbed({ tone: 'system'     }).data.color, SYSTEM_COLOR);
});

test('buildEmbed: default tone is brand', () => {
  assert.strictEqual(buildEmbed({}).data.color, BRAND_COLOR);
});

test('buildEmbed: adds tone indicator to title', () => {
  assert.ok(buildEmbed({ title: 'Ban', tone: 'moderation' }).data.title?.startsWith('⚒'));
  assert.ok(buildEmbed({ title: 'Sec', tone: 'security'  }).data.title?.startsWith('🛡'));
  assert.ok(buildEmbed({ title: 'Err', tone: 'error'     }).data.title?.startsWith('✗'));
});

test('buildEmbed: sets footer with brand name', () => {
  const footer = buildEmbed({}).data.footer?.text ?? '';
  assert.ok(footer.includes(BRAND_NAME), `footer "${footer}" should include "${BRAND_NAME}"`);
});

test('buildEmbed: custom footer appended to brand', () => {
  const footer = buildEmbed({ footer: 'Custom text' }).data.footer?.text ?? '';
  assert.ok(footer.includes('Custom text') && footer.includes(BRAND_NAME));
});

test('buildEmbed: sets timestamp', () => {
  const ts = buildEmbed({}).data.timestamp;
  assert.strictEqual(typeof ts, 'string');
  assert.ok(ts!.length > 0);
});

test('buildEmbed: respects max field count', () => {
  const fields = Array.from({ length: 25 }, (_, i) => ({ name: `f${i}`, value: 'v', inline: false }));
  const embed = buildEmbed({ fields });
  assert.strictEqual(embed.data.fields?.length, 25);
});

// ---------------------------------------------------------------------------
// permissionError
// ---------------------------------------------------------------------------

test('permissionError: builds with single permission', () => {
  const embed = permissionError('ManageMessages');
  assert.strictEqual(embed.data.color, ERROR_COLOR);
  assert.ok(embed.data.title?.includes('Permission'));
  assert.ok(embed.data.description?.includes('ManageMessages'));
});

test('permissionError: builds with multiple permissions', () => {
  const embed = permissionError(['BanMembers', 'KickMembers']);
  assert.ok(embed.data.description?.includes('BanMembers'));
  assert.ok(embed.data.description?.includes('KickMembers'));
});

test('permissionError: includes action context', () => {
  const embed = permissionError('BanMembers', 'ban this member');
  assert.ok(embed.data.description?.includes('ban this member'));
});

// ---------------------------------------------------------------------------
// moderationAction
// ---------------------------------------------------------------------------

test('moderationAction: sets moderation tone', () => {
  const embed = moderationAction({
    action: 'Ban',
    target: { id: '1', tag: 'Target#0001' },
    moderator: { id: '2', tag: 'Mod#0002' },
    caseId: 'ABC-1234',
  });
  assert.strictEqual(embed.data.color, MOD_COLOR);
  assert.ok(embed.data.title?.startsWith('⚒'));
});

test('moderationAction: includes case ID', () => {
  const embed = moderationAction({
    action: 'Kick',
    target: { id: '1', tag: 'User#1' },
    moderator: { id: '2', tag: 'Mod#2' },
    caseId: 'XYZ-9999',
  });
  assert.ok(embed.data.fields?.some((f) => f.value.includes('XYZ-9999')));
});

test('moderationAction: omits optional fields when not provided', () => {
  const embed = moderationAction({
    action: 'Warn',
    target: { id: '1', tag: 'User#1' },
    moderator: { id: '2', tag: 'Mod#2' },
    caseId: 'W-001',
  });
  const fieldNames = embed.data.fields?.map((f) => f.name) ?? [];
  assert.ok(!fieldNames.includes('Reason'));
  assert.ok(!fieldNames.includes('Duration'));
});

test('moderationAction: includes reason when provided', () => {
  const embed = moderationAction({
    action: 'Ban',
    target: { id: '1', tag: 'User#1' },
    moderator: { id: '2', tag: 'Mod#2' },
    reason: 'Spam',
    caseId: 'B-001',
  });
  assert.ok(embed.data.fields?.some((f) => f.name === 'Reason' && f.value === 'Spam'));
});

test('moderationAction: truncates long reason', () => {
  const longReason = 'x'.repeat(2000);
  const embed = moderationAction({
    action: 'Ban',
    target: { id: '1', tag: 'User#1' },
    moderator: { id: '2', tag: 'Mod#2' },
    reason: longReason,
    caseId: 'B-001',
  });
  const reasonField = embed.data.fields?.find((f) => f.name === 'Reason');
  assert.ok(reasonField, 'should have a Reason field');
  assert.ok((reasonField?.value?.length ?? 0) <= 1027, 'should be truncated to ≤ 1024 + suffix');
});

// ---------------------------------------------------------------------------
// securityAlert
// ---------------------------------------------------------------------------

test('securityAlert: sets security tone', () => {
  const embed = securityAlert({
    title: 'Mass ban detected',
    eventId: 'SEC-001',
    risk: 'HIGH',
    actor: { id: '1', tag: 'Attacker#0001' },
    target: { id: '2', tag: 'Victim#0002' },
    action: 'ban',
  });
  assert.strictEqual(embed.data.color, SECURITY_COLOR);
  assert.ok(embed.data.title?.startsWith('🛡'));
});

test('securityAlert: includes risk in footer', () => {
  const embed = securityAlert({
    title: 'Test',
    eventId: 'SEC-042',
    risk: 'CRITICAL',
  });
  const footer = embed.data.footer?.text ?? '';
  assert.ok(footer.includes('SEC-042'));
  assert.ok(footer.includes('CRITICAL'));
});

test('securityAlert: risk emoji matches level', () => {
  const critical = securityAlert({ title: 'T', eventId: 'X', risk: 'CRITICAL' });
  const high     = securityAlert({ title: 'T', eventId: 'X', risk: 'HIGH' });
  const medium  = securityAlert({ title: 'T', eventId: 'X', risk: 'MEDIUM' });
  const low     = securityAlert({ title: 'T', eventId: 'X', risk: 'LOW' });

  const criticalRiskField = critical.data.fields?.find((f) => f.name === '⚠️ Risk');
  const highRiskField     = high.data.fields?.find((f) => f.name === '⚠️ Risk');
  const mediumRiskField   = medium.data.fields?.find((f) => f.name === '⚠️ Risk');
  const lowRiskField      = low.data.fields?.find((f) => f.name === '⚠️ Risk');

  assert.ok(criticalRiskField?.value?.includes('🚨'));
  assert.ok(highRiskField?.value?.includes('🔴'));
  assert.ok(mediumRiskField?.value?.includes('🟡'));
  assert.ok(lowRiskField?.value?.includes('🟢'));
});

// ---------------------------------------------------------------------------
// configChange
// ---------------------------------------------------------------------------

test('configChange: sets configuration tone', () => {
  const embed = configChange({
    setting: 'Prefix',
    current: '!',
    actor: { id: '1', tag: 'Admin#0001' },
  });
  assert.strictEqual(embed.data.color, CONFIG_COLOR);
});

test('configChange: shows previous value when provided', () => {
  const embed = configChange({
    setting: 'Prefix',
    previous: '.',
    current: '!',
    actor: { id: '1', tag: 'Admin#0001' },
  });
  assert.ok(embed.data.fields?.some((f) => f.name === 'Previous'));
});

// ---------------------------------------------------------------------------
// actionDone
// ---------------------------------------------------------------------------

test('actionDone: sets success tone', () => {
  const embed = actionDone({ action: 'Ban', target: '<@123>' });
  assert.strictEqual(embed.data.color, SUCCESS_COLOR);
  assert.ok(embed.data.title?.startsWith('✓'));
});

test('actionDone: includes detail when provided', () => {
  const embed = actionDone({ action: 'Lock', target: '<#456>', detail: 'Reason: spam' });
  assert.ok(embed.data.description?.includes('Reason: spam'));
});

// ---------------------------------------------------------------------------
// pingResult
// ---------------------------------------------------------------------------

test('pingResult: uses warning tone for degraded ws', () => {
  const embed = pingResult({ wsLatency: 200, uptime: '1h', memoryMB: 150, guildCount: 10 });
  // 200ms = degraded, degraded uses warning tone
  assert.strictEqual(embed.data.color, WARNING_COLOR);
});

test('pingResult: uses success tone for healthy ws', () => {
  const embed = pingResult({ wsLatency: 50, uptime: '1h', memoryMB: 150, guildCount: 10 });
  assert.strictEqual(embed.data.color, SUCCESS_COLOR);
});

test('pingResult: uses error tone when a subsystem is blocked', () => {
  // memoryMB 600 = blocked, wsLatency 150 = degraded → blocked wins → ERROR_COLOR
  const embed = pingResult({ wsLatency: 150, uptime: '1h', memoryMB: 600, guildCount: 10 });
  assert.strictEqual(embed.data.color, ERROR_COLOR);
});

test('pingResult: uses warning tone when only ws is degraded', () => {
  // wsLatency 150 = degraded, memoryMB 150 = healthy → warning tone
  const embed = pingResult({ wsLatency: 150, uptime: '1h', memoryMB: 150, guildCount: 10 });
  assert.strictEqual(embed.data.color, WARNING_COLOR);
});

test('pingResult: includes all four metrics', () => {
  const embed = pingResult({ wsLatency: 80, uptime: '2h 30m', memoryMB: 250, guildCount: 5 });
  const fieldNames = embed.data.fields?.map((f) => f.name) ?? [];
  assert.ok(fieldNames.includes('💓 WebSocket'));
  assert.ok(fieldNames.includes('⏱ Uptime'));
  assert.ok(fieldNames.includes('💾 Memory'));
  assert.ok(fieldNames.includes('🌐 Servers'));
});

// ---------------------------------------------------------------------------
// paginateList
// ---------------------------------------------------------------------------

test('paginateList: empty list returns placeholder', () => {
  const fields = paginateList([]);
  assert.strictEqual(fields.length, 1);
  assert.ok(fields[0].value.includes('No results'));
});

test('paginateList: single page when items fit perPage', () => {
  const items = ['a', 'b', 'c'];
  const fields = paginateList(items, { title: 'Test', perPage: 10 });
  assert.strictEqual(fields.length, 1);
  assert.strictEqual(fields[0].name, 'Test');
});

test('paginateList: multiple pages when items exceed perPage', () => {
  const items = Array.from({ length: 15 }, (_, i) => `item-${i}`);
  const fields = paginateList(items, { title: 'Test', perPage: 5 });
  assert.strictEqual(fields.length, 3);
  assert.ok(fields[0].name.includes('page 1/3'));
  assert.ok(fields[1].name.includes('page 2/3'));
  assert.ok(fields[2].name.includes('page 3/3'));
});

test('paginateList: respects custom title', () => {
  const fields = paginateList(['x'], { title: 'Custom Title' });
  assert.strictEqual(fields[0].name, 'Custom Title');
});

// ---------------------------------------------------------------------------
// numberedList
// ---------------------------------------------------------------------------

test('numberedList: empty list returns placeholder', () => {
  const fields = numberedList([]);
  assert.ok(fields[0].value.includes('No results'));
});

test('numberedList: numbers items correctly', () => {
  const fields = numberedList([
    { label: 'First', value: 'one' },
    { label: 'Second', value: 'two' },
  ]);
  assert.ok(fields[0].value.includes('1.'));
  assert.ok(fields[0].value.includes('2.'));
});

test('numberedList: truncates long content', () => {
  const longContent = Array.from({ length: 200 }, (_, i) => ({
    label: `Item ${i}`,
    value: 'x'.repeat(100),
  }));
  const fields = numberedList(longContent as any, { maxLen: 500 });
  // Should not throw and should return truncated content
  assert.strictEqual(typeof fields[0].value, 'string');
  assert.ok(fields[0].value.length <= 503); // 500 + suffix
});

// ---------------------------------------------------------------------------
// confirmRow
// ---------------------------------------------------------------------------

test('confirmRow: creates row with confirm and cancel buttons', () => {
  const row = confirmRow('my-action');
  const components = row.toJSON().components;
  assert.strictEqual(components.length, 2);
  assert.ok(components[0].custom_id?.includes('confirm'));
  assert.ok(components[1].custom_id?.includes('cancel'));
  assert.strictEqual(components[0].label, 'Confirm');
  assert.strictEqual(components[1].label, 'Cancel');
});
