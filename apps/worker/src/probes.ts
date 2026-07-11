import { Redis } from 'ioredis';
import { Pool } from 'pg';

export interface DependencyProbe {
  check(): Promise<Record<'postgres' | 'redis', 'ok' | 'error'>>;
  close(): Promise<void>;
}

export interface ProbeClients {
  pool: Pick<Pool, 'query' | 'end'>;
  redis: Pick<Redis, 'status' | 'connect' | 'ping' | 'quit'>;
}

export function createDependencyProbe(databaseUrl: string, redisUrl: string, timeoutMs: number): DependencyProbe {
  const pool = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: timeoutMs,
    max: 2,
    query_timeout: timeoutMs
  });
  const redis = new Redis(redisUrl, {
    commandTimeout: timeoutMs,
    connectTimeout: timeoutMs,
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    retryStrategy: null
  });

  return createDependencyProbeFromClients({ pool, redis }, timeoutMs);
}

export function createDependencyProbeFromClients(clients: ProbeClients, timeoutMs: number): DependencyProbe {
  const { pool, redis } = clients;
  let redisConnection: Promise<void> | undefined;

  const ensureRedisConnected = async (): Promise<void> => {
    if (redis.status === 'ready') return;
    redisConnection ??= redis.connect().then(() => undefined);
    const currentAttempt = redisConnection;
    try {
      await currentAttempt;
    } finally {
      if (redisConnection === currentAttempt) redisConnection = undefined;
    }
  };

  const pingRedis = async (): Promise<string> => {
    await ensureRedisConnected();
    return withTimeout(redis.ping(), timeoutMs);
  };

  return {
    async check() {
      const [postgresResult, redisResult] = await Promise.allSettled([
        pool.query('SELECT 1'),
        pingRedis()
      ]);

      return {
        postgres: postgresResult.status === 'fulfilled' ? 'ok' : 'error',
        redis: redisResult.status === 'fulfilled' ? 'ok' : 'error'
      };
    },
    async close() {
      await Promise.allSettled([pool.end(), redis.quit()]);
    }
  };
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Dependency probe timed out')), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
