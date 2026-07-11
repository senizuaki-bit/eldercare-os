import { Inject, Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import type { ServiceConfig } from '@eldercare/config';
import { Redis } from 'ioredis';
import { Pool } from 'pg';
import { READINESS_DEPENDENCIES, SERVICE_CONFIG } from '../tokens.js';

export type ReadinessChecks = Record<'postgres' | 'redis', 'ok' | 'error'>;

export interface ReadinessDependencies {
  pool: Pick<Pool, 'query' | 'end'>;
  redis: Pick<Redis, 'status' | 'connect' | 'ping' | 'quit'>;
}

@Injectable()
export class ReadinessService implements OnModuleDestroy {
  private readonly pool: ReadinessDependencies['pool'];
  private readonly redis: ReadinessDependencies['redis'];
  private redisConnection: Promise<void> | undefined;

  constructor(
    @Inject(SERVICE_CONFIG) private readonly config: ServiceConfig,
    @Optional() @Inject(READINESS_DEPENDENCIES) dependencies?: ReadinessDependencies
  ) {
    this.pool = dependencies?.pool ?? new Pool({
      connectionString: config.databaseUrl,
      connectionTimeoutMillis: config.readinessTimeoutMs,
      idleTimeoutMillis: 5_000,
      max: 2,
      query_timeout: config.readinessTimeoutMs
    });
    this.redis = dependencies?.redis ?? new Redis(config.redisUrl, {
      commandTimeout: config.readinessTimeoutMs,
      connectTimeout: config.readinessTimeoutMs,
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      retryStrategy: null
    });
  }

  async check(): Promise<ReadinessChecks> {
    const [postgres, redis] = await Promise.allSettled([
      this.pool.query('SELECT 1'),
      this.pingRedis()
    ]);

    return {
      postgres: postgres.status === 'fulfilled' ? 'ok' : 'error',
      redis: redis.status === 'fulfilled' ? 'ok' : 'error'
    };
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.pool.end(), this.redis.quit()]);
  }

  private async pingRedis(): Promise<string> {
    await this.ensureRedisConnected();
    return withTimeout(this.redis.ping(), this.config.readinessTimeoutMs);
  }

  private async ensureRedisConnected(): Promise<void> {
    if (this.redis.status === 'ready') return;

    this.redisConnection ??= this.redis.connect().then(() => undefined);
    const currentAttempt = this.redisConnection;
    try {
      await currentAttempt;
    } finally {
      if (this.redisConnection === currentAttempt) this.redisConnection = undefined;
    }
  }
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
