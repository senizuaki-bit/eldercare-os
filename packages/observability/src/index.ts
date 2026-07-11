export const REDACTED_VALUE = '[REDACTED]';

const CIRCULAR_VALUE = '[CIRCULAR]';
const TRUNCATED_VALUE = '[TRUNCATED]';
const MAX_REDACTION_DEPTH = 24;

const SENSITIVE_KEY_PARTS = [
  'authorization',
  'cookie',
  'token',
  'secret',
  'password',
  'passcode',
  'apikey',
  'accesskey',
  'privatekey',
  'audio',
  'recording',
  'voice',
  'transcript',
  'latitude',
  'longitude',
  'coordinate',
  'location',
  'medical',
  'diagnos',
  'healthcontent',
  'healthnote',
  'emotion',
  'familycommunication',
  'paymentcredential',
  'paymenttoken',
  'cardnumber',
  'cvv',
  'phone',
  'email',
  'address',
  'fullname',
  'displayname',
  'eldername',
  'nationalid',
] as const;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
}

function redactString(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, `Bearer ${REDACTED_VALUE}`)
    .replace(
      /([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)[^@\s/]+@/gi,
      `$1${REDACTED_VALUE}@`,
    )
    .replace(
      /\b(?:password|secret|token|api[_-]?key)=([^\s&]+)/gi,
      (match) => `${match.slice(0, match.indexOf('=') + 1)}${REDACTED_VALUE}`,
    )
    .replace(
      /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
      REDACTED_VALUE,
    )
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]');
}

function redactValue(value: unknown, ancestors: WeakSet<object>, depth: number): unknown {
  if (depth > MAX_REDACTION_DEPTH) {
    return TRUNCATED_VALUE;
  }

  if (value === null || value === undefined || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return redactString(value);
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : String(value);
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'symbol' || typeof value === 'function') {
    return String(value);
  }

  if (ancestors.has(value)) {
    return CIRCULAR_VALUE;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
    };
  }

  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      return value.map((item) => redactValue(item, ancestors, depth + 1));
    }

    if (value instanceof Map) {
      return Object.fromEntries(
        [...value.entries()].map(([key, item]) => {
          const stringKey = String(key);
          return [
            stringKey,
            isSensitiveKey(stringKey)
              ? REDACTED_VALUE
              : redactValue(item, ancestors, depth + 1),
          ];
        }),
      );
    }

    if (value instanceof Set) {
      return [...value].map((item) => redactValue(item, ancestors, depth + 1));
    }

    const redacted: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      if (isSensitiveKey(key)) {
        redacted[key] = REDACTED_VALUE;
        continue;
      }

      try {
        redacted[key] = redactValue(
          (value as Record<string, unknown>)[key],
          ancestors,
          depth + 1,
        );
      } catch {
        redacted[key] = REDACTED_VALUE;
      }
    }

    return redacted;
  } finally {
    ancestors.delete(value);
  }
}

export function redactSensitive(value: unknown): unknown {
  return redactValue(value, new WeakSet<object>(), 0);
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogContext = Readonly<Record<string, unknown>>;
export type LogSink = (serializedEntry: string) => void;

export interface LoggerOptions {
  readonly service: string;
  readonly level?: LogLevel;
  readonly base?: LogContext;
  readonly sink?: LogSink;
  readonly now?: () => Date;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

const LEVEL_PRIORITY: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const consoleSink: LogSink = (line) => {
  console.log(line);
};

export function createLogger(serviceOrOptions: string | LoggerOptions): Logger {
  const options: LoggerOptions =
    typeof serviceOrOptions === 'string'
      ? { service: serviceOrOptions }
      : serviceOrOptions;
  const service = options.service.trim();

  if (service.length === 0) {
    throw new Error('Logger service name is required');
  }

  const minimumLevel = options.level ?? 'info';
  const sink = options.sink ?? consoleSink;
  const now = options.now ?? (() => new Date());
  const base = options.base ?? {};

  const write = (level: LogLevel, message: string, context: LogContext = {}): void => {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[minimumLevel]) {
      return;
    }

    const safeContext = redactSensitive({ ...base, ...context });
    sink(
      JSON.stringify({
        timestamp: now().toISOString(),
        level,
        service,
        message: redactString(message),
        context: safeContext,
      }),
    );
  };

  return {
    debug: (message, context) => write('debug', message, context),
    info: (message, context) => write('info', message, context),
    warn: (message, context) => write('warn', message, context),
    error: (message, context) => write('error', message, context),
  };
}
