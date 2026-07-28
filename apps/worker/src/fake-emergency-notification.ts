import { createHash } from 'node:crypto';
import type { Logger } from '@eldercare/observability';

export interface EmergencyNotificationRequest {
  readonly organizationId: string;
  readonly facilityId: string;
  readonly emergencyEventId: string;
  readonly escalationId: string;
  readonly stage: 'ACKNOWLEDGEMENT' | 'ARRIVAL' | 'RESOLUTION';
  readonly reasonCode: string;
  readonly idempotencyKey: string;
}

export interface EmergencyNotificationReceipt {
  readonly provider: 'FAKE';
  readonly providerReference: string;
  readonly deliveredAt: Date;
}

export interface EmergencyNotificationProvider {
  send(request: EmergencyNotificationRequest): Promise<EmergencyNotificationReceipt>;
}

export interface FamilyEmergencyNotificationRequest {
  readonly organizationId: string;
  readonly facilityId: string;
  readonly emergencyEventId: string;
  readonly deliveryId: string;
  readonly familyRelationshipId: string;
  readonly stage: 'OPENED' | 'ACKNOWLEDGED' | 'RESPONDING' | 'RESOLVED' | 'REVIEWED';
  readonly channel: 'IN_APP' | 'SMS' | 'PHONE' | 'EMAIL';
  readonly idempotencyKey: string;
}

export interface FamilyEmergencyNotificationProvider {
  sendFamily(
    request: FamilyEmergencyNotificationRequest,
  ): Promise<EmergencyNotificationReceipt>;
}

export class FakeEmergencyNotificationProvider
  implements EmergencyNotificationProvider, FamilyEmergencyNotificationProvider
{
  private readonly receipts = new Map<string, EmergencyNotificationReceipt>();

  constructor(
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  send(request: EmergencyNotificationRequest): Promise<EmergencyNotificationReceipt> {
    const existing = this.receipts.get(request.idempotencyKey);
    if (existing !== undefined) return Promise.resolve(existing);

    const receipt: EmergencyNotificationReceipt = {
      provider: 'FAKE',
      providerReference: `fake-${createHash('sha256')
        .update(request.idempotencyKey)
        .digest('hex')
        .slice(0, 24)}`,
      deliveredAt: this.now(),
    };
    this.receipts.set(request.idempotencyKey, receipt);
    this.logger.info('Fake emergency notification delivered', {
      emergencyEventId: request.emergencyEventId,
      escalationId: request.escalationId,
      stage: request.stage,
      reasonCode: request.reasonCode,
      provider: receipt.provider,
    });
    return Promise.resolve(receipt);
  }

  sendFamily(
    request: FamilyEmergencyNotificationRequest,
  ): Promise<EmergencyNotificationReceipt> {
    const existing = this.receipts.get(request.idempotencyKey);
    if (existing !== undefined) return Promise.resolve(existing);

    const receipt = this.createReceipt(request.idempotencyKey);
    this.receipts.set(request.idempotencyKey, receipt);
    this.logger.info('Fake family emergency notification delivered', {
      emergencyEventId: request.emergencyEventId,
      deliveryId: request.deliveryId,
      familyRelationshipId: request.familyRelationshipId,
      stage: request.stage,
      channel: request.channel,
      provider: receipt.provider,
    });
    return Promise.resolve(receipt);
  }

  private createReceipt(idempotencyKey: string): EmergencyNotificationReceipt {
    return {
      provider: 'FAKE',
      providerReference: `fake-${createHash('sha256')
        .update(idempotencyKey)
        .digest('hex')
        .slice(0, 24)}`,
      deliveredAt: this.now(),
    };
  }
}
