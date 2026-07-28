import { Injectable } from '@nestjs/common';
import type { TaskUpdateEvent } from '@eldercare/contracts';
import { filter, mergeMap, type Observable, Subject } from 'rxjs';

export interface CaregiverTaskUpdateScope {
  readonly elderId: string;
  readonly workOrderId: string;
  readonly assigneeStaffProfileId: string | null;
  readonly targetTeamId: string | null;
}

export interface ScopedTaskUpdate extends CaregiverTaskUpdateScope {
  readonly organizationId: string;
  readonly facilityId: string;
  readonly event: TaskUpdateEvent;
}

@Injectable()
export class TaskUpdatesService {
  private readonly updates = new Subject<ScopedTaskUpdate>();

  publish(update: ScopedTaskUpdate): void {
    this.updates.next(update);
  }

  forFacility(
    organizationId: string,
    facilityId: string,
    authorize: () => boolean | Promise<boolean>,
  ): Observable<TaskUpdateEvent> {
    return this.updates.pipe(
      filter((update) => update.organizationId === organizationId && update.facilityId === facilityId),
      mergeMap(async (update) => {
        try {
          return await authorize() ? update.event : null;
        } catch {
          return null;
        }
      }),
      filter((event): event is TaskUpdateEvent => event !== null),
    );
  }

  forCaregiver(
    organizationId: string,
    facilityId: string,
    authorize: (scope: CaregiverTaskUpdateScope) => boolean | Promise<boolean>,
  ): Observable<TaskUpdateEvent> {
    return this.updates.pipe(
      filter(
        (update) =>
          update.organizationId === organizationId &&
          update.facilityId === facilityId,
      ),
      mergeMap(async (update) => {
        try {
          const allowed = await authorize({
            elderId: update.elderId,
            workOrderId: update.workOrderId,
            assigneeStaffProfileId: update.assigneeStaffProfileId,
            targetTeamId: update.targetTeamId,
          });
          return allowed ? update.event : null;
        } catch {
          return null;
        }
      }),
      filter((event): event is TaskUpdateEvent => event !== null),
    );
  }
}
