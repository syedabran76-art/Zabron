/**
 * Zabron — Slash command builder serialization test.
 *
 * Walks every registered command, forces @discordjs/builders validators
 * ON, then walks the produced JSON tree to find any option missing
 * a description or name. This catches the "Expected a string primitive"
 * class of bugs from @discordjs/builders at build time.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Side-effect import → register every command.
import '../src/commands/index.js';

import { enableValidators } from '@discordjs/builders';
import { listCommands } from '../src/handlers/registry.js';

// Force builders validation on.
enableValidators();

const visit = (node: any, path: string, fails: string[]): void => {
  if (!node || typeof node !== 'object') return;
  // Root command body has type=1 (CHAT_INPUT) but is not "options".
  if (node.type === undefined) return;

  if (typeof node.name !== 'string' || node.name.length === 0) {
    fails.push(`${path}: missing name`);
  }
  // Subcommands and subcommand groups don't require description,
  // but every leaf option does.
  const isSub = node.type === 1 /* SUB_COMMAND */ || node.type === 2 /* SUB_COMMAND_GROUP */;
  if (!isSub) {
    if (typeof node.description !== 'string' || node.description.length === 0) {
      fails.push(`${path} (type=${node.type}): missing description for option "${node.name}"`);
    }
  }
  if (Array.isArray(node.options)) {
    for (const opt of node.options) {
      visit(opt, `${path}/${node.name}`, fails);
    }
  }
};

test('every registered command builds a valid slash definition (no "Expected a string primitive")', () => {
  const commands = listCommands();
  assert.ok(commands.length > 0, 'registry must not be empty after importing the barrel');

  const failures: Array<{ name: string; error: string; json?: any }> = [];

  for (const def of commands) {
    try {
      const built = def.buildSlash();
      const json = typeof (built as any).toJSON === 'function'
        ? (built as any).toJSON()
        : built;
      const localFails: string[] = [];
      visit(json, def.name, localFails);
      if (localFails.length > 0) {
        failures.push({ name: def.name, error: localFails.join('; '), json });
      }
    } catch (err) {
      failures.push({ name: def.name, error: (err as Error).message });
    }
  }

  if (failures.length > 0) {
    const summary = failures
      .map((f) => `  - ${f.name}: ${f.error}`)
      .join('\n');
    assert.fail(
      `${failures.length} of ${commands.length} commands failed:\n${summary}\n\nFirst offender JSON:\n${JSON.stringify(failures[0]?.json, null, 2)}`,
    );
  }
});

test('every command has a non-empty top-level description', () => {
  const commands = listCommands();
  for (const def of commands) {
    assert.ok(
      typeof def.description === 'string' && def.description.trim().length > 0,
      `command ${def.name} is missing or has empty top-level description`,
    );
  }
});