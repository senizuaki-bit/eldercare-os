import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import type { Logger } from '@eldercare/observability';
import type {
  EmergencyNotificationProvider,
  EmergencyNotificationReceipt,
} from './fake-emergency-notification.js';

export const EMERGENCY_SLA_QUEUE = 'emergency-sla-v1';
export const EMERGENCY_SLA_JOB = 'escalate';

export type EmergencySlaStage = 'ACKNOWLEDGEMENT' | 'ARRIVAL' | 'RESOLUTION';

export interface EmergencySlaJobData {
  readonly schemaVersion: '1.0';
  readonly escalationId: string;
  readonly emergencyEventId: string;
  readonly organizationId: string;
  readonly facilityId: string;
  readonly stage: EmergencySlaStage;
  readonly reasonCode: string;
  readonly basisTransitionVersion: number;
  readonly dueAt: string;
}

export interface PendingEmergencyEscalation {
  readonly id: string;
  readonly emergencyEventId: string;
  readonly organizationId: string;
  readonly facilityId: string;
  readonly stage: EmergencySlaStage;
  readonly reasonCode: string;
  readonly basisTransitionVersion: number;
  readonly dueAt: Date;
}

export interface EmergencyCancellationCursor {
  readonly cancelledAt: Date;
  readonly id: string;
}

export interface CancelledEmergencyEscalation {
  readonly id: string;
  readonly cancelledAt: Date;
}

export interface EmergencyEscalationClaim extends PendingEmergencyEscalation {
  readonly elderId: string;
  readonly status:
    | 'OPEN'
    | 'ACKNOWLEDGED'
    | 'RESPONDING'
    | 'RESOLVED'
    | 'REVIEWED';
  readonly notificationIdempotencyKey: string;
  readonly aggregateVersion: number;
  readonly correlationId: string;
}

export interface EmergencySlaRepository {
  listPending(limit: number): Promise<readonly PendingEmergencyEscalation[]>;
  listCancelled(
    after: EmergencyCancellationCursor,
    limit: number,
  ): Promise<readonly CancelledEmergencyEscalation[]>;
  prepareDelivery(escalationId: string, now: Date): Promise<EmergencyEscalationClaim | null>;
  completeDelivery(
    claim: EmergencyEscalationClaim,
    receipt: EmergencyNotificationReceipt,
  ): Promise<void>;
  recordDeliveryFailure(claim: EmergencyEscalationClaim, reasonCode: string): Promise<void>;
}

export interface EmergencySlaQueueOptions {
  readonly redisUrl: string;
  readonly prefix?: string;
  readonly now?: () => Date;
}

const CANCELLATION_RECONCILIATION_LOOKBACK_MS = 24 * 60 * 60_000;

export function emergencySlaJobId(escalationId: string): string {
  return `emergency--${escalationId}`;
}

export class EmergencySlaScheduler {
  private readonly queue: Queue<EmergencySlaJobData>;
  private readonly connection: Redis;
  private readonly now: () => Date;
  private cancellationCursor: EmergencyCancellationCursor;

  constructor(options: EmergencySlaQueueOptions) {
    this.now = options.now ?? (() => new Date());
    this.cancellationCursor = initialEmergencyCancellationCursor(this.now());
    this.connection = createBullConnection(options.redisUrl);
    this.queue = new Queue<EmergencySlaJobData>(EMERGENCY_SLA_QUEUE, {
      connection: this.connection,
      prefix: options.prefix ?? 'eldercare:m04',
      defaultJobOptions: {
        attempts: 8,
        backoff: { type: 'exponential', delay: 1_000 },
        removeOnComplete: { age: 86_400, count: 10_000 },
        removeOnFail: { age: 604_800, count: 10_000 },
      },
    });
  }

  async schedule(escalation: PendingEmergencyEscalation): Promise<void> {
    const jobId = emergencySlaJobId(escalation.id);
    const existing = await this.queue.getJob(jobId);
    if (existing !== undefined) {
      const state = await existing.getState();
      if (state !== 'completed' && state !== 'failed') return;
      await existing.remove();
    }

    await this.queue.add(
      EMERGENCY_SLA_JOB,
      toJobData(escalation),
      {
        jobId,
        delay: Math.max(0, escalation.dueAt.getTime() - this.now().getTime()),
      },
    );
  }

  async cancel(escalationId: string): Promise<'removed' | 'not_found' | 'in_flight'> {
    const job = await this.queue.getJob(emergencySlaJobId(escalationId));
    if (job === undefined) return 'not_found';
    try {
      await job.remove();
      return 'removed';
    } catch {
      return 'in_flight';
    }
  }

  async reconcile(
    repository: EmergencySlaRepository,
    batchSize = 500,
  ): Promise<number> {
    const cancelled = await repository.listCancelled(
      this.cancellationCursor,
      batchSize,
    );
    const reconciledCancellations: CancelledEmergencyEscalation[] = [];
    for (const cancellation of cancelled) {
      const outcome = await this.cancel(cancellation.id);
      if (outcome === 'in_flight') break;
      reconciledCancellations.push(cancellation);
    }
    this.cancellationCursor = advanceEmergencyCancellationCursor(
      this.cancellationCursor,
      reconciledCancellations,
    );

    const pending = await repository.listPending(batchSize);
    for (const escalation of pending) await this.schedule(escalation);
    return pending.length;
  }

  async close(): Promise<void> {
    await this.queue.close();
    await closeRedis(this.connection);
  }
}

export function initialEmergencyCancellationCursor(
  now: Date,
): EmergencyCancellationCursor {
  return {
    cancelledAt: new Date(
      now.getTime() - CANCELLATION_RECONCILIATION_LOOKBACK_MS,
    ),
    id: '00000000-0000-0000-0000-000000000000',
  };
}

export function advanceEmergencyCancellationCursor(
  current: EmergencyCancellationCursor,
  cancellations: readonly CancelledEmergencyEscalation[],
): EmergencyCancellationCursor {
  return cancellations.at(-1) ?? current;
}

export class EmergencySlaProcessor {
  constructor(
    private readonly repository: EmergencySlaRepository,
    private readonly notifications: EmergencyNotificationProvider,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async process(job: Job<EmergencySlaJobData>): Promise<'delivered' | 'stale'> {
    const claim = await this.repository.prepareDelivery(job.data.escalationId, this.now());
    if (claim === null) {
      this.logger.info('Emergency escalation skipped after current-state check', {
        escalationId: job.data.escalationId,
        emergencyEventId: job.data.emergencyEventId,
        stage: job.data.stage,
      });
      return 'stale';
    }

    try {
      const receipt = await this.notifications.send({
        organizationId: claim.organizationId,
        facilityId: claim.facilityId,
        emergencyEventId: claim.emergencyEventId,
        escalationId: claim.id,
        stage: claim.stage,
        reasonCode: claim.reasonCode,
        idempotencyKey: claim.notificationIdempotencyKey,
      });
      await this.repository.completeDelivery(claim, receipt);
      return 'delivered';
    } catch (error) {
      await this.repository.recordDeliveryFailure(claim, classifyDeliveryFailure(error));
      throw error;
    }
  }
}

export class EmergencySlaWorker {
  private readonly worker: Worker<EmergencySlaJobData>;
  private readonly connection: Redis;

  constructor(
    processor: EmergencySlaProcessor,
    logger: Logger,
    options: EmergencySlaQueueOptions,
  ) {
    this.connection = createBullConnection(options.redisUrl);
    this.worker = new Worker<EmergencySlaJobData>(
      EMERGENCY_SLA_QUEUE,
      (job) => processor.process(job),
      {
        connection: this.connection,
        prefix: options.prefix ?? 'eldercare:m04',
        concurrency: 4,
      },
    );
    this.worker.on('failed', (job, error) => {
      logger.warn('Emergency SLA job failed', {
        escalationId: job?.data.escalationId,
        reasonCode: classifyDeliveryFailure(error),
      });
    });
    this.worker.on('error', () => {
      logger.error('Emergency SLA worker connection error', {
        reasonCode: 'EMERGENCY_SLA_WORKER_ERROR',
      });
    });
  }

  async close(): Promise<void> {
    await this.worker.close();
    await closeRedis(this.connection);
  }
}

function toJobData(escalation: PendingEmergencyEscalation): EmergencySlaJobData {
  return {
    schemaVersion: '1.0',
    escalationId: escalation.id,
    emergencyEventId: escalation.emergencyEventId,
    organizationId: escalation.organizationId,
    facilityId: escalation.facilityId,
    stage: escalation.stage,
    reasonCode: escalation.reasonCode,
    basisTransitionVersion: escalation.basisTransitionVersion,
    dueAt: escalation.dueAt.toISOString(),
  };
}

function createBullConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, {
    enableOfflineQueue: true,
    maxRetriesPerRequest: null,
  });
}

async function closeRedis(connection: Redis): Promise<void> {
  if (connection.status === 'end') return;
  try {
    await connection.quit();
  } catch {
    connection.disconnect();
  }
}

function classifyDeliveryFailure(error: unknown): string {
  return error instanceof Error && error.name === 'TimeoutError'
    ? 'FAKE_NOTIFICATION_TIMEOUT'
    : 'FAKE_NOTIFICATION_FAILED';
}
