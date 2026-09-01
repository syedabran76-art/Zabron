/**
 * Zabron — Regression tests for permission normalisation.
 *
 * Background: The slash dispatcher previously built a synthetic
 * permission object that did `BigInt(perms) & BigInt(p)`. When
 * commands declared `userPermissions: ['ManageGuild']`, this
 * crashed with `SyntaxError: Cannot convert ManageGuild to a BigInt`.
 *
 * The centralised helpers in src/utils/permissions.ts must:
 *   1. Accept string names, bigints, numbers and PermissionsBitField.
 *   2. Never throw "Cannot convert <string> to a BigInt".
 *   3. Delegate to PermissionsBitField.has() for the actual check.
 *   4. Handle invalid input gracefully.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  PermissionFlagsBits,
  PermissionsBitField,
  type PermissionResolvable,
} from 'discord.js';

import {
  toPermissionBit,
  hasPermissionForBitfield,
  permissionToName,
  hasUserPermissions,
  hasBotPermissions,
} from '../src/utils/permissions.js';

// ---------------------------------------------------------------------------
// toPermissionBit() — centralised name → bigint conversion
// ---------------------------------------------------------------------------

test('toPermissionBit: returns bigint for known permission names', () => {
  const names = [
    'Administrator',
    'ManageGuild',
    'ManageChannels',
    'BanMembers',
    'KickMembers',
    'ManageMessages',
    'ManageRoles',
  ] as const;

  for (const name of names) {
    const bit = toPermissionBit(name);
    assert.strictEqual(typeof bit, 'bigint', `${name} should map to bigint`);
    assert.strictEqual(bit, PermissionFlagsBits[name], `${name} should equal PermissionFlagsBits.${name}`);
  }
});

test('toPermissionBit: returns bigint when given bigint', () => {
  const bit = toPermissionBit(PermissionFlagsBits.Administrator);
  assert.strictEqual(typeof bit, 'bigint');
  assert.strictEqual(bit, PermissionFlagsBits.Administrator);
});

test('toPermissionBit: converts number to bigint', () => {
  const num = Number(PermissionFlagsBits.ManageGuild);
  const bit = toPermissionBit(num);
  assert.strictEqual(typeof bit, 'bigint');
  assert.strictEqual(bit, BigInt(num));
});

test('toPermissionBit: extracts bitfield from PermissionsBitField', () => {
  const field = new PermissionsBitField(PermissionFlagsBits.Administrator);
  const bit = toPermissionBit(field);
  assert.strictEqual(typeof bit, 'bigint');
  assert.strictEqual(bit, PermissionFlagsBits.Administrator);
});

test('toPermissionBit: throws on unknown permission name (does NOT crash BigInt)', () => {
  // This is the regression check: previously BigInt("ManageGuild") would
  // throw SyntaxError. With toPermissionBit, an unknown name must throw
  // a clear Error, not the misleading BigInt SyntaxError.
  assert.throws(
    () => toPermissionBit('ThisIsNotARealPermission'),
    /Unknown permission name/,
  );
});

test('toPermissionBit: throws on invalid input type', () => {
  assert.throws(
    () => toPermissionBit({} as unknown),
    /Invalid permission input/,
  );
  assert.throws(
    () => toPermissionBit(null as unknown),
    /Invalid permission input/,
  );
});

// ---------------------------------------------------------------------------
// hasPermissionForBitfield() — slash dispatcher path
// ---------------------------------------------------------------------------

test('hasPermissionForBitfield: Administrator name check via string bitfield', () => {
  // User with only ManageGuild
  const raw = String(PermissionFlagsBits.ManageGuild);
  assert.strictEqual(hasPermissionForBitfield(raw, 'Administrator'), false);
  assert.strictEqual(hasPermissionForBitfield(raw, 'ManageGuild'), true);
});

test('hasPermissionForBitfield: ManageGuild check', () => {
  const raw = String(PermissionFlagsBits.ManageGuild);
  assert.strictEqual(hasPermissionForBitfield(raw, 'ManageGuild'), true);
  assert.strictEqual(hasPermissionForBitfield(raw, 'ManageChannels'), false);
});

test('hasPermissionForBitfield: ManageChannels check', () => {
  const raw = String(
    PermissionFlagsBits.ManageChannels | PermissionFlagsBits.ManageMessages,
  );
  assert.strictEqual(hasPermissionForBitfield(raw, 'ManageChannels'), true);
  assert.strictEqual(hasPermissionForBitfield(raw, 'ManageGuild'), false);
});

test('hasPermissionForBitfield: BanMembers check', () => {
  const raw = String(PermissionFlagsBits.BanMembers);
  assert.strictEqual(hasPermissionForBitfield(raw, 'BanMembers'), true);
  assert.strictEqual(hasPermissionForBitfield(raw, 'KickMembers'), false);
});

test('hasPermissionForBitfield: KickMembers check', () => {
  const raw = String(PermissionFlagsBits.KickMembers);
  assert.strictEqual(hasPermissionForBitfield(raw, 'KickMembers'), true);
  assert.strictEqual(hasPermissionForBitfield(raw, 'BanMembers'), false);
});

test('hasPermissionForBitfield: bigint bitfield input', () => {
  const raw = PermissionFlagsBits.Administrator;
  assert.strictEqual(hasPermissionForBitfield(raw, 'ManageGuild'), true,
    'Administrator implies all permissions');
  assert.strictEqual(hasPermissionForBitfield(raw, 'BanMembers'), true);
});

test('hasPermissionForBitfield: accepts bigint PermissionResolvable', () => {
  const raw = String(PermissionFlagsBits.ManageChannels);
  assert.strictEqual(
    hasPermissionForBitfield(raw, PermissionFlagsBits.ManageChannels),
    true,
  );
});

// ---------------------------------------------------------------------------
// permissionToName() — error-message formatting
// ---------------------------------------------------------------------------

test('permissionToName: formats string name with spaces', () => {
  assert.strictEqual(permissionToName('ManageGuild'), 'Manage Guild');
  assert.strictEqual(permissionToName('Administrator'), 'Administrator');
  assert.strictEqual(permissionToName('ManageChannels'), 'Manage Channels');
});

test('permissionToName: resolves bigint flag back to name', () => {
  assert.strictEqual(
    permissionToName(PermissionFlagsBits.Administrator),
    'Administrator',
  );
  assert.strictEqual(
    permissionToName(PermissionFlagsBits.ManageGuild),
    'Manage Guild',
  );
  assert.strictEqual(
    permissionToName(PermissionFlagsBits.BanMembers),
    'Ban Members',
  );
});

// ---------------------------------------------------------------------------
// hasUserPermissions / hasBotPermissions — successful AND denied paths
// ---------------------------------------------------------------------------

/** Build a minimal GuildMember-like stub for hasUserPermissions/hasBotPermissions. */
function stubMember(perms: bigint | string): any {
  return {
    permissions: new PermissionsBitField(BigInt(perms)),
  };
}

test('hasUserPermissions: returns ok:true when all perms present (success)', () => {
  const member = stubMember(
    PermissionFlagsBits.Administrator,
  );
  const result = hasUserPermissions(member, ['ManageGuild', 'BanMembers']);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, undefined);
});

test('hasUserPermissions: returns ok:false when perms missing (denied)', () => {
  const member = stubMember(PermissionFlagsBits.ManageMessages);
  const result = hasUserPermissions(member, ['ManageGuild']);
  assert.strictEqual(result.ok, false);
  assert.ok(
    result.reason?.includes('Manage Guild'),
    `expected reason to mention the missing permission, got: ${result.reason}`,
  );
});

test('hasUserPermissions: returns ok:false for multiple missing perms', () => {
  const member = stubMember(PermissionFlagsBits.ManageMessages);
  const result = hasUserPermissions(member, ['ManageGuild', 'BanMembers']);
  assert.strictEqual(result.ok, false);
  assert.ok(result.reason?.includes('permissions'));
});

test('hasUserPermissions: empty required list => ok', () => {
  const member = stubMember(0n);
  assert.strictEqual(hasUserPermissions(member, []).ok, true);
  assert.strictEqual(hasUserPermissions(member).ok, true);
});

test('hasBotPermissions: returns ok:true when bot has all perms (success)', () => {
  const bot = stubMember(
    PermissionFlagsBits.BanMembers | PermissionFlagsBits.KickMembers,
  );
  const result = hasBotPermissions(bot, ['BanMembers', 'KickMembers']);
  assert.strictEqual(result.ok, true);
});

test('hasBotPermissions: returns ok:false when bot missing perms (denied)', () => {
  const bot = stubMember(PermissionFlagsBits.ManageMessages);
  const result = hasBotPermissions(bot, ['BanMembers']);
  assert.strictEqual(result.ok, false);
  assert.ok(result.reason?.includes('Zabron'));
  assert.ok(result.reason?.includes('Ban Members'));
});

// ---------------------------------------------------------------------------
// Crash regression — the actual reported runtime error
// ---------------------------------------------------------------------------

test('REGRESSION: slash-dispatcher path no longer crashes on string permission names', () => {
  // Simulate the EXACT line that used to throw:
  //   BigInt(perms) & BigInt(p as bigint | number)
  // where `p` was "ManageGuild" / "ManageChannels" / "Administrator".
  //
  // The old code crashed with:  SyntaxError: Cannot convert ManageGuild to a BigInt
  //
  // The new code path must work cleanly for every string name commands use.
  const commandsLikeZabron = [
    { def: 'userPermissions: ["ManageGuild"]', perms: String(PermissionFlagsBits.ManageGuild) },
    { def: 'userPermissions: ["ManageChannels"]', perms: String(PermissionFlagsBits.ManageChannels) },
    { def: 'userPermissions: ["Administrator"]', perms: String(PermissionFlagsBits.Administrator) },
    { def: 'userPermissions: ["BanMembers"]', perms: String(PermissionFlagsBits.BanMembers) },
    { def: 'userPermissions: ["KickMembers"]', perms: String(PermissionFlagsBits.KickMembers) },
  ];

  for (const c of commandsLikeZabron) {
    const match = c.def.match(/"(\w+)"/);
    const permName = match?.[1] as PermissionResolvable | undefined;
    assert.ok(permName, 'sanity: every test entry should have a permission name');
    // Should NOT throw
    const allowed = hasPermissionForBitfield(c.perms, permName!);
    assert.strictEqual(allowed, true, `${permName} should be present in ${c.perms}`);
  }
});

test('REGRESSION: the synthetic BigInt AND pattern is gone', () => {
  // Static check: ensure no source file under src/ still does
  // `BigInt(perms) & BigInt(p` — the broken pattern.
  const slashDispatcher = readFileSync(
    join(process.cwd(), 'src/handlers/slashDispatcher.ts'),
    'utf8',
  );
  assert.ok(
    !/BigInt\(perms\)\s*&\s*BigInt\(p/.test(slashDispatcher),
    'slashDispatcher.ts must NOT contain the old BigInt(perms) & BigInt(p) synthetic check',
  );
});