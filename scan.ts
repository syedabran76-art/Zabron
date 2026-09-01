import './src/commands/index.ts';
import { listCommands } from './src/handlers/registry.ts';

const defs = listCommands();
console.log('Total registered:', defs.length);

let ok = 0, fail = 0;
const fails: string[] = [];

for (const def of defs) {
  try {
    const built = def.buildSlash();
    const json = typeof (built as any).toJSON === 'function' ? (built as any).toJSON() : built;
    if (!json.name || !json.description) {
      fails.push(def.name + ': name/desc missing');
      fail++;
    } else {
      ok++;
    }
  } catch (e) {
    fails.push(def.name + ': ' + (e as Error).message);
    fail++;
  }
}

console.log('OK:', ok, 'FAIL:', fail);
console.log('--- FAILURES ---');
for (const f of fails) console.log(' -', f);