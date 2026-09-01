/**
 * Zabron — Lightweight structured logger.
 *
 * Avoids external dependencies so we can be confident it works in
 * Termux and minimal Linux environments. Supports levels, contextual
 * fields, JSON output, and timestamp formatting.
 */

type Level = 'trace' | 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<Level, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
};

const LEVEL_LABEL: Record<Level, string> = {
  trace: 'TRACE',
  debug: 'DEBUG',
  info: 'INFO ',
  warn: 'WARN ',
  error: 'ERROR',
};

export interface LogContext {
  [key: string]: unknown;
}

class Logger {
  private minLevel: number = LEVEL_RANK.info;
  private json: boolean = false;
  private scope: string = 'core';

  constructor(scope = 'core') {
    this.scope = scope;
  }

  configure(level: Level, json = false): void {
    this.minLevel = LEVEL_RANK[level] ?? LEVEL_RANK.info;
    this.json = json;
  }

  child(scope: string): Logger {
    const child = new Logger(`${this.scope}:${scope}`);
    child.minLevel = this.minLevel;
    child.json = this.json;
    return child;
  }

  trace(msg: string, ctx?: LogContext): void {
    this.write('trace', msg, ctx);
  }

  debug(msg: string, ctx?: LogContext): void {
    this.write('debug', msg, ctx);
  }

  info(msg: string, ctx?: LogContext): void {
    this.write('info', msg, ctx);
  }

  warn(msg: string, ctx?: LogContext): void {
    this.write('warn', msg, ctx);
  }

  error(msg: string, ctx?: LogContext): void {
    this.write('error', msg, ctx);
  }

  private write(level: Level, msg: string, ctx?: LogContext): void {
    if (LEVEL_RANK[level] < this.minLevel) return;
    const ts = new Date().toISOString();
    if (this.json) {
      const payload = {
        ts,
        level,
        scope: this.scope,
        msg,
        ...(ctx ?? {}),
      };
      // eslint-disable-next-line no-console
      console[level === 'error' ? 'error' : 'log'](JSON.stringify(payload));
      return;
    }
    const tail = ctx && Object.keys(ctx).length ? ` ${stringifyCtx(ctx)}` : '';
    const line = `${ts} ${LEVEL_LABEL[level]} [${this.scope}] ${msg}${tail}`;
    // eslint-disable-next-line no-console
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  }
}

function stringifyCtx(ctx: LogContext): string {
  try {
    const safe: LogContext = {};
    for (const [k, v] of Object.entries(ctx)) {
      // Redact anything that smells like a secret.
      if (/token|secret|key|password/i.test(k) && typeof v === 'string') {
        safe[k] = '[REDACTED]';
      } else if (v instanceof Error) {
        safe[k] = `${v.name}: ${v.message}`;
      } else {
        safe[k] = v;
      }
    }
    return JSON.stringify(safe);
  } catch {
    return '[unserialisable]';
  }
}

export const logger = new Logger('zabron');

export function logFromLevel(level: string | undefined): Level {
  const normalised = (level ?? 'info').toLowerCase() as Level;
  return LEVEL_RANK[normalised] !== undefined ? normalised : 'info';
}