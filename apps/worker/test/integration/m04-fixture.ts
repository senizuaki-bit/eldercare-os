import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@eldercare/db';

export interface M04IntegrationFixture {
  readonly organizationId: string;
  readonly organizationSlug: string;
  readonly facilityId: string;
  readonly facilityCode: string;
  readonly elderId: string;
  readonly sourceBindingId: string;
  readonly sourceId: string;
}

export async function createM04IntegrationFixture(
  database: PrismaClient,
): Promise<M04IntegrationFixture> {
  const organization = await database.organization.findUniqueOrThrow({
    where: { slug: 'qinglan-demo' },
  });
  const facility = await database.facility.findFirstOrThrow({
    where: {
      organizationId: organization.id,
      code: 'QL-MAIN',
      status: 'ACTIVE',
    },
  });
  const canonicalBinding = await database.emergencySourceBinding.findUniqueOrThrow({
    where: { id: 'b4000000-0000-4000-8000-000000000001' },
  });
  const sourceId = `call-it-${randomUUID().replaceAll('-', '')}`;
  const sourceBinding = await database.emergencySourceBinding.create({
    data: {
      organizationId: organization.id,
      facilityId: facility.id,
      elderId: canonicalBinding.elderId,
      sourceKind: 'IOT_BUTTON',
      externalSourceId: sourceId,
      displayLabel: 'Integration call device',
    },
  });

  return {
    organizationId: organization.id,
    organizationSlug: organization.slug,
    facilityId: facility.id,
    facilityCode: facility.code,
    elderId: canonicalBinding.elderId,
    sourceBindingId: sourceBinding.id,
    sourceId,
  };
}

export async function deleteM04IntegrationFixture(
  database: PrismaClient,
  fixture: M04IntegrationFixture,
): Promise<void> {
  const signals = await database.emergencySignal.findMany({
    where: { sourceBindingId: fixture.sourceBindingId },
    select: { emergencyEventId: true },
  });
  const eventIds = [...new Set(signals.map((signal) => signal.emergencyEventId))];
  if (eventIds.length > 0) {
    const events = { emergencyEventId: { in: eventIds } };
    await database.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL eldercare.seed_mode = 'on'");
      await transaction.outboxEvent.deleteMany({
        where: {
          aggregateType: { in: ['EMERGENCY_EVENT', 'EmergencyEvent'] },
          aggregateId: { in: eventIds },
        },
      });
      await transaction.emergencyNotificationDelivery.deleteMany({ where: events });
      await transaction.emergencyFamilySummary.deleteMany({ where: events });
      await transaction.emergencyReview.deleteMany({ where: events });
      await transaction.emergencyResolution.deleteMany({ where: events });
      await transaction.emergencyEscalation.deleteMany({ where: events });
      await transaction.emergencyResponseMilestone.deleteMany({ where: events });
      await transaction.emergencyResponder.deleteMany({ where: events });
      await transaction.emergencyAcknowledgement.deleteMany({ where: events });
      await transaction.emergencyRelatedEvent.deleteMany({
        where: {
          OR: [
            { primaryEventId: { in: eventIds } },
            { relatedEventId: { in: eventIds } },
          ],
        },
      });
      await transaction.emergencyTransition.deleteMany({ where: events });
      await transaction.emergencyLocationSnapshot.deleteMany({ where: events });
      await transaction.emergencySignal.deleteMany({
        where: { sourceBindingId: fixture.sourceBindingId },
      });
      await transaction.elderTimelineEntry.deleteMany({
        where: {
          sourceResourceType: 'EmergencyEvent',
          sourceResourceId: { in: eventIds },
        },
      });
      await transaction.emergencyEvent.deleteMany({
        where: { id: { in: eventIds } },
      });
    });
  }
  await database.emergencySourceBinding.deleteMany({
    where: { id: fixture.sourceBindingId },
  });
}
