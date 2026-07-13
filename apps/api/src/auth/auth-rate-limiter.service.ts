import { createHash } from 'node:crypto';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { ServiceConfig } from '@eldercare/config';
import { Redis } from 'ioredis';
import { SERVICE_CONFIG } from '../tokens.js';

export interface LoginRateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

@Injectable()
export class AuthRateLimiterService implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor(@Inject(SERVICE_CONFIG) private readonly config: ServiceConfig) {
    this.redis = new Redis(config.redisUrl, {
      commandTimeout: config.readinessTimeoutMs,
      connectTimeout: config.readinessTimeoutMs,
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      retryStrategy: null,
    });
  }

  async consume(loginName: string, remoteAddress: string): Promise<LoginRateLimitDecision> {
    await this.ensureConnected();
    const windowMilliseconds = this.config.authRateLimitWindowSeconds * 1_000;
    const accountKey = `${this.config.authRateLimitKeyPrefix}:account:${hashKey(loginName)}`;
    const networkKey = `${this.config.authRateLimitKeyPrefix}:network:${hashKey(remoteAddress)}`;
    const script = `
      local account = redis.call('INCR', KEYS[1])
      if account == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
      local network = redis.call('INCR', KEYS[2])
      if network == 1 then redis.call('PEXPIRE', KEYS[2], ARGV[1]) end
      local accountTtl = redis.call('PTTL', KEYS[1])
      local networkTtl = redis.call('PTTL', KEYS[2])
      return {account, network, accountTtl, networkTtl}
    `;
    const raw = await this.redis.eval(
      script,
      2,
      accountKey,
      networkKey,
      String(windowMilliseconds),
    );
    if (!Array.isArray(raw) || raw.length !== 4) {
      throw new Error('Authentication rate limiter returned an invalid result');
    }

    const [accountCount, networkCount, accountTtl, networkTtl] = raw.map(Number);
    const maxAttempts = this.config.authRateLimitMaxAttempts;
    const allowed =
      (accountCount ?? maxAttempts + 1) <= maxAttempts &&
      (networkCount ?? maxAttempts * 4 + 1) <= maxAttempts * 4;
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil(Math.max(accountTtl ?? 0, networkTtl ?? 0) / 1_000),
    );
    return { allowed, retryAfterSeconds };
  }

  async resetAccount(loginName: string): Promise<void> {
    await this.ensureConnected();
    await this.redis.del(`${this.config.authRateLimitKeyPrefix}:account:${hashKey(loginName)}`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis.status !== 'end') {
      await this.redis.quit().catch(() => undefined);
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.redis.status === 'ready') return;
    if (this.redis.status === 'wait') {
      await this.redis.connect();
      return;
    }
    if (this.redis.status !== 'connecting' && this.redis.status !== 'connect') {
      throw new Error('Authentication rate limiter is unavailable');
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Authentication rate limiter connection timed out'));
      }, this.config.readinessTimeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        this.redis.off('ready', onReady);
        this.redis.off('error', onError);
      };
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error('Authentication rate limiter is unavailable'));
      };
      this.redis.once('ready', onReady);
      this.redis.once('error', onError);
    });
  }
}

function hashKey(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
