import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { ServiceConfig } from '@eldercare/config';
import { createPrismaClient, type PrismaClient } from '@eldercare/db';
import { SERVICE_CONFIG } from '../tokens.js';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly client: PrismaClient;

  constructor(@Inject(SERVICE_CONFIG) config: ServiceConfig) {
    this.client = createPrismaClient(config.databaseUrl);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
