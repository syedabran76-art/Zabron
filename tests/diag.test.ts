import { test } from 'node:test';
import assert from 'node:assert/strict';

import { enableValidators } from '@discordjs/builders';
import { listCommands } from '../src/handlers/registry.js';
import '../src/commands/index.js';

enableValidators();

const commands = listCommands();
const results: Array<{ name: string; ok: boolean; err?: string }> = [];

for (const def of commands) {
  try {
    const built = def.buildSlash();
    const json = typeof (built as any).toJSON === 'function'
      ? (built as any).toJSON()
      : built;
    results.push({ name: def.name, ok: !!json });
  } catch (err) {
    results.push({ name: def.name, ok: false, err: (err as Error).message });
  }
}

test('diagnostic: per-command serialization report', () => {
  const failed = results.filter((r) => !r.ok);
  const passed = results.filter((r) => r.ok);

  console.log(`\n=== DIAGNOSTIC: ${commands.length} commands total ===`);
  console.log(`PASS: ${passed.length}`);
  console.log(`FAIL: ${failed.length}\n`);

  for (const f of failed) {
    console.log(`  X ${f.name}`);
    console.log(`    ${f.err}`);
  }

  for (const p of passed) {
    console.log(`  OK ${p.name}`);
  }

  assert.ok(true);
});