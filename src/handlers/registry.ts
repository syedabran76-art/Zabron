/**
 * Zabron — Command registry.
 *
 * Every command registers itself here exactly once. Both slash and
 * prefix handlers consult this registry so they always agree on what
 * exists.
 */

import type { CommandDefinition } from '../types/index.js';

const commands = new Map<string, CommandDefinition>();

export function registerCommand(definition: CommandDefinition): void {
  if (commands.has(definition.name)) {
    throw new Error(`Command "${definition.name}" is already registered.`);
  }
  commands.set(definition.name, definition);
}

export function getCommand(name: string): CommandDefinition | undefined {
  return commands.get(name);
}

export function listCommands(): CommandDefinition[] {
  return Array.from(commands.values());
}

export function listByCategory(): Record<string, CommandDefinition[]> {
  const out: Record<string, CommandDefinition[]> = {};
  for (const def of commands.values()) {
    (out[def.category] ||= []).push(def);
  }
  for (const cat of Object.keys(out)) {
    out[cat].sort((a, b) => a.name.localeCompare(b.name));
  }
  return out;
}