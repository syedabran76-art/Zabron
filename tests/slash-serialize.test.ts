// Verify that every registered command's buildSlash() can produce a valid JSON payload.
// Catches the "Expected a string primitive" / "Expected at most X choices" /
// "Invalid string length" type errors that occur when an option or subcommand is
// missing a required field.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Use tsx to import the TypeScript source directly.
import '../src/commands/index.js';
import { listCommands } from '../src/handlers/registry.js';

test('every registered command serializes via buildSlash().toJSON()', () => {
  const all = listCommands();
  assert.equal(all.length, 89, `Expected 89 commands, got ${all.length}`);
  const failures: string[] = [];
  for (const def of all) {
    try {
      const builder = def.buildSlash();
      const json = builder.toJSON();
      // Recursively walk the JSON and ensure every option and subcommand has a name+description.
      const walk = (node: any, path: string): void => {
        if (Array.isArray(node)) {
          node.forEach((n, i) => walk(n, `${path}[${i}]`));
          return;
        }
        if (node && typeof node === 'object') {
          if (typeof node.name === 'string') {
            assert.ok(typeof node.name === 'string' && node.name.length > 0, `${path}.name`);
            // Options and subcommands both require a description.
            if (node.type === undefined || node.type === 1 /* SUB_COMMAND */ || node.type === 2 /* GROUP */) {
              // command/option types — but not for sub_command groups, which have their own description
            }
            if ((node.options || []).length) {
              for (const o of node.options) {
                if (typeof o.name !== 'string' || o.name.length === 0) {
                  failures.push(`${def.name}: option missing name at ${path}`);
                }
                if (typeof o.description !== 'string' || o.description.length === 0) {
                  failures.push(`${def.name}: option "${o.name ?? '(unnamed)'}" missing description at ${path}`);
                }
              }
            }
          }
          for (const k of Object.keys(node)) walk(node[k], `${path}.${k}`);
        }
      };
      walk(json, def.name);
    } catch (err) {
      failures.push(`${def.name}: ${(err as Error).message}`);
    }
  }
  if (failures.length) {
    assert.fail(`${failures.length} command(s) failed to serialize:\n  - ${failures.join('\n  - ')}`);
  }
});
