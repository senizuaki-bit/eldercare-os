import { z } from 'zod';

import {
  dateOnlySchema,
  displayTextSchema,
  isoTimestampSchema,
  pageInfoSchema,
  recordCodeSchema,
  sortDirectionSchema,
  uuidSchema,
  versionSchema,
} from './common.js';

export const staffStatusSchema = z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']);
export const teamStatusSchema = z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']);
export const teamMembershipRoleSchema = z.enum(['MEMBER', 'LEAD']);
export const shiftStatusSchema = z.enum(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']);
export const shiftAssignmentStatusSchema = z.enum(['ASSIGNED', 'ACCEPTED', 'CANCELLED']);
export const shiftScopeKindSchema = z.enum(['FACILITY', 'FLOOR', 'ZONE']);
export const elderCareAssignmentRoleSchema = z.enum(['PRIMARY', 'SUPPORT']);

const versionedStaffingShape = {
  id: uuidSchema,
  organizationId: uuidSchema,
  facilityId: uuidSchema,
  version: versionSchema,
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
};

export const staffProfileSchema = z
  .object({
    ...versionedStaffingShape,
    userId: uuidSchema,
    employeeCode: recordCodeSchema,
    displayName: displayTextSchema,
    jobTitle: z.string().trim().min(1).max(120),
    status: staffStatusSchema,
    hiredAt: dateOnlySchema.nullable(),
    endedAt: dateOnlySchema.nullable(),
    primaryTeamId: uuidSchema.nullable(),
  })
  .strict()
  .refine(
    (staff) => staff.hiredAt === null || staff.endedAt === null || staff.endedAt >= staff.hiredAt,
    { path: ['endedAt'], message: 'must not be before hiredAt' },
  );

export const staffCreateRequestSchema = z
  .object({
    userId: uuidSchema,
    employeeCode: recordCodeSchema,
    jobTitle: z.string().trim().min(1).max(120),
    status: staffStatusSchema.default('ACTIVE'),
    hiredAt: dateOnlySchema.optional(),
    primaryTeamId: uuidSchema.optional(),
  })
  .strict();

export const staffUpdateRequestSchema = z
  .object({
    expectedVersion: versionSchema,
    employeeCode: recordCodeSchema.optional(),
    jobTitle: z.string().trim().min(1).max(120).optional(),
    status: staffStatusSchema.optional(),
    hiredAt: dateOnlySchema.nullable().optional(),
    endedAt: dateOnlySchema.nullable().optional(),
    primaryTeamId: uuidSchema.nullable().optional(),
    reasonCode: recordCodeSchema.optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).some((key) => key !== 'expectedVersion' && key !== 'reasonCode'), {
    message: 'at least one mutable field is required',
  })
  .refine(
    (input) => (input.status === undefined && input.endedAt === undefined) || input.reasonCode !== undefined,
    { path: ['reasonCode'], message: 'is required for status or end-date transitions' },
  )
  .refine(
    (input) =>
      input.hiredAt == null || input.endedAt == null || input.endedAt >= input.hiredAt,
    { path: ['endedAt'], message: 'must not be before hiredAt' },
  );

export const staffQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().max(128).optional(),
    status: staffStatusSchema.optional(),
    teamId: uuidSchema.optional(),
    jobTitle: z.string().trim().max(120).optional(),
    sort: z.enum(['displayName', 'employeeCode', 'jobTitle', 'status', 'updatedAt']).default('displayName'),
    direction: sortDirectionSchema.default('asc'),
  })
  .strict();

export const staffPageSchema = z
  .object({ items: z.array(staffProfileSchema), pageInfo: pageInfoSchema })
  .strict();

export const teamSchema = z
  .object({
    ...versionedStaffingShape,
    code: recordCodeSchema,
    name: displayTextSchema,
    description: z.string().trim().max(1000).nullable(),
    status: teamStatusSchema,
    activeMemberCount: z.number().int().min(0),
  })
  .strict();

export const teamCreateRequestSchema = z
  .object({
    code: recordCodeSchema,
    name: displayTextSchema,
    description: z.string().trim().max(1000).optional(),
    status: teamStatusSchema.default('ACTIVE'),
  })
  .strict();

export const teamUpdateRequestSchema = z
  .object({
    expectedVersion: versionSchema,
    code: recordCodeSchema.optional(),
    name: displayTextSchema.optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    status: teamStatusSchema.optional(),
    reasonCode: recordCodeSchema.optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).some((key) => key !== 'expectedVersion' && key !== 'reasonCode'), {
    message: 'at least one mutable field is required',
  })
  .refine((input) => input.status === undefined || input.reasonCode !== undefined, {
    path: ['reasonCode'],
    message: 'is required for status transitions',
  });

export const teamsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().max(128).optional(),
    status: teamStatusSchema.optional(),
    sort: z.enum(['code', 'name', 'status', 'activeMemberCount']).default('name'),
    direction: sortDirectionSchema.default('asc'),
  })
  .strict();

export const teamsPageSchema = z
  .object({ items: z.array(teamSchema), pageInfo: pageInfoSchema })
  .strict();

export const teamMembershipSchema = z
  .object({
    id: uuidSchema,
    organizationId: uuidSchema,
    facilityId: uuidSchema,
    teamId: uuidSchema,
    staffProfileId: uuidSchema,
    role: teamMembershipRoleSchema,
    activeFrom: isoTimestampSchema,
    activeUntil: isoTimestampSchema.nullable(),
    version: versionSchema,
  })
  .strict()
  .refine(
    (membership) =>
      membership.activeUntil === null ||
      Date.parse(membership.activeUntil) > Date.parse(membership.activeFrom),
    { path: ['activeUntil'], message: 'must be after activeFrom' },
  );

export const teamMembershipCreateRequestSchema = z
  .object({
    staffProfileId: uuidSchema,
    role: teamMembershipRoleSchema.default('MEMBER'),
    activeFrom: isoTimestampSchema,
    activeUntil: isoTimestampSchema.optional(),
  })
  .strict()
  .refine(
    (membership) =>
      membership.activeUntil === undefined ||
      Date.parse(membership.activeUntil) > Date.parse(membership.activeFrom),
    { path: ['activeUntil'], message: 'must be after activeFrom' },
  );

export const teamMembershipUpdateRequestSchema = z
  .object({
    expectedVersion: versionSchema,
    role: teamMembershipRoleSchema.optional(),
    activeUntil: isoTimestampSchema.nullable().optional(),
    reasonCode: recordCodeSchema.optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).some((key) => key !== 'expectedVersion' && key !== 'reasonCode'), {
    message: 'at least one mutable field is required',
  })
  .refine((input) => input.activeUntil === undefined || input.reasonCode !== undefined, {
    path: ['reasonCode'],
    message: 'is required for membership end-date transitions',
  });

const shiftAssignmentScopeInputShape = {
  kind: shiftScopeKindSchema,
  floorId: uuidSchema.optional(),
  zoneId: uuidSchema.optional(),
};

export const shiftAssignmentScopeInputSchema = z
  .object(shiftAssignmentScopeInputShape)
  .strict()
  .superRefine(validateShiftScope);

export const shiftAssignmentScopeSchema = z
  .object({ id: uuidSchema, shiftAssignmentId: uuidSchema, ...shiftAssignmentScopeInputShape })
  .strict()
  .superRefine(validateShiftScope);

export const elderCareAssignmentSchema = z
  .object({
    id: uuidSchema,
    shiftAssignmentId: uuidSchema,
    elderId: uuidSchema,
    role: elderCareAssignmentRoleSchema,
  })
  .strict();

export const shiftAssignmentSchema = z
  .object({
    id: uuidSchema,
    organizationId: uuidSchema,
    facilityId: uuidSchema,
    shiftId: uuidSchema,
    staffProfileId: uuidSchema,
    staffDisplayName: displayTextSchema,
    status: shiftAssignmentStatusSchema,
    scopes: z.array(shiftAssignmentScopeSchema).max(64),
    elderAssignments: z.array(elderCareAssignmentSchema).max(100),
    version: versionSchema,
    assignedAt: isoTimestampSchema,
  })
  .strict();

const elderAssignmentInputSchema = z
  .object({ elderId: uuidSchema, role: elderCareAssignmentRoleSchema.default('PRIMARY') })
  .strict();

export const shiftAssignmentCreateRequestSchema = z
  .object({
    staffProfileId: uuidSchema,
    status: shiftAssignmentStatusSchema.default('ASSIGNED'),
    scopes: z.array(shiftAssignmentScopeInputSchema).min(1).max(64),
    elderAssignments: z.array(elderAssignmentInputSchema).max(100).default([]),
  })
  .strict()
  .superRefine(validateAssignmentUniqueness);

export const shiftAssignmentUpdateRequestSchema = z
  .object({
    expectedVersion: versionSchema,
    status: shiftAssignmentStatusSchema.optional(),
    scopes: z.array(shiftAssignmentScopeInputSchema).min(1).max(64).optional(),
    elderAssignments: z.array(elderAssignmentInputSchema).max(100).optional(),
    reasonCode: recordCodeSchema.optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).some((key) => key !== 'expectedVersion' && key !== 'reasonCode'), {
    message: 'at least one mutable field is required',
  })
  .refine((input) => input.status === undefined || input.reasonCode !== undefined, {
    path: ['reasonCode'],
    message: 'is required for status transitions',
  })
  .superRefine(validateAssignmentUniqueness);

export const shiftSchema = z
  .object({
    ...versionedStaffingShape,
    teamId: uuidSchema.nullable(),
    code: recordCodeSchema,
    name: displayTextSchema,
    startsAt: isoTimestampSchema,
    endsAt: isoTimestampSchema,
    status: shiftStatusSchema,
    assignments: z.array(shiftAssignmentSchema).max(200),
  })
  .strict()
  .refine((shift) => Date.parse(shift.endsAt) > Date.parse(shift.startsAt), {
    path: ['endsAt'],
    message: 'must be after startsAt',
  });

export const shiftCreateRequestSchema = z
  .object({
    teamId: uuidSchema.optional(),
    code: recordCodeSchema,
    name: displayTextSchema,
    startsAt: isoTimestampSchema,
    endsAt: isoTimestampSchema,
    status: shiftStatusSchema.default('SCHEDULED'),
  })
  .strict()
  .refine((shift) => Date.parse(shift.endsAt) > Date.parse(shift.startsAt), {
    path: ['endsAt'],
    message: 'must be after startsAt',
  });

export const shiftUpdateRequestSchema = z
  .object({
    expectedVersion: versionSchema,
    teamId: uuidSchema.nullable().optional(),
    code: recordCodeSchema.optional(),
    name: displayTextSchema.optional(),
    startsAt: isoTimestampSchema.optional(),
    endsAt: isoTimestampSchema.optional(),
    status: shiftStatusSchema.optional(),
    reasonCode: recordCodeSchema.optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).some((key) => key !== 'expectedVersion' && key !== 'reasonCode'), {
    message: 'at least one mutable field is required',
  })
  .refine((input) => input.status === undefined || input.reasonCode !== undefined, {
    path: ['reasonCode'],
    message: 'is required for status transitions',
  })
  .refine(
    (shift) =>
      shift.startsAt === undefined ||
      shift.endsAt === undefined ||
      Date.parse(shift.endsAt) > Date.parse(shift.startsAt),
    { path: ['endsAt'], message: 'must be after startsAt' },
  );

export const shiftsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
    from: isoTimestampSchema,
    to: isoTimestampSchema,
    teamId: uuidSchema.optional(),
    staffProfileId: uuidSchema.optional(),
    status: shiftStatusSchema.optional(),
    sort: z.enum(['startsAt', 'endsAt', 'name', 'status']).default('startsAt'),
    direction: sortDirectionSchema.default('asc'),
  })
  .strict()
  .superRefine((query, context) => {
    const from = Date.parse(query.from);
    const to = Date.parse(query.to);
    if (to <= from) {
      context.addIssue({ code: 'custom', path: ['to'], message: 'must be after from' });
    }
    if (to - from > 14 * 24 * 60 * 60 * 1000) {
      context.addIssue({ code: 'custom', path: ['to'], message: 'range cannot exceed 14 days' });
    }
  });

export const shiftsPageSchema = z
  .object({ items: z.array(shiftSchema), pageInfo: pageInfoSchema })
  .strict();

function validateShiftScope(
  scope: { kind: z.infer<typeof shiftScopeKindSchema>; floorId?: string; zoneId?: string },
  context: z.RefinementCtx,
): void {
  if (scope.kind === 'FACILITY' && (scope.floorId !== undefined || scope.zoneId !== undefined)) {
    context.addIssue({ code: 'custom', message: 'FACILITY scope cannot include floorId or zoneId' });
  }
  if (scope.kind === 'FLOOR' && (scope.floorId === undefined || scope.zoneId !== undefined)) {
    context.addIssue({ code: 'custom', message: 'FLOOR scope requires only floorId' });
  }
  if (scope.kind === 'ZONE' && (scope.floorId === undefined || scope.zoneId === undefined)) {
    context.addIssue({ code: 'custom', message: 'ZONE scope requires floorId and zoneId' });
  }
}

function validateAssignmentUniqueness(
  assignment: {
    scopes?: readonly { kind: string; floorId?: string; zoneId?: string }[];
    elderAssignments?: readonly { elderId: string }[];
  },
  context: z.RefinementCtx,
): void {
  const scopeKeys = new Set<string>();
  for (const [index, scope] of (assignment.scopes ?? []).entries()) {
    const key = `${scope.kind}:${scope.floorId ?? ''}:${scope.zoneId ?? ''}`;
    if (scopeKeys.has(key)) {
      context.addIssue({ code: 'custom', path: ['scopes', index], message: 'duplicate scope' });
    }
    scopeKeys.add(key);
  }
  const elderIds = new Set<string>();
  for (const [index, elder] of (assignment.elderAssignments ?? []).entries()) {
    if (elderIds.has(elder.elderId)) {
      context.addIssue({
        code: 'custom',
        path: ['elderAssignments', index, 'elderId'],
        message: 'duplicate elder assignment',
      });
    }
    elderIds.add(elder.elderId);
  }
}

export type StaffStatus = z.infer<typeof staffStatusSchema>;
export type StaffProfile = z.infer<typeof staffProfileSchema>;
export type StaffCreateRequest = z.input<typeof staffCreateRequestSchema>;
export type StaffUpdateRequest = z.infer<typeof staffUpdateRequestSchema>;
export type StaffQuery = z.output<typeof staffQuerySchema>;
export type StaffPage = z.infer<typeof staffPageSchema>;
export type Team = z.infer<typeof teamSchema>;
export type TeamCreateRequest = z.input<typeof teamCreateRequestSchema>;
export type TeamUpdateRequest = z.infer<typeof teamUpdateRequestSchema>;
export type TeamsQuery = z.output<typeof teamsQuerySchema>;
export type TeamsPage = z.infer<typeof teamsPageSchema>;
export type TeamMembership = z.infer<typeof teamMembershipSchema>;
export type Shift = z.infer<typeof shiftSchema>;
export type ShiftCreateRequest = z.input<typeof shiftCreateRequestSchema>;
export type ShiftUpdateRequest = z.infer<typeof shiftUpdateRequestSchema>;
export type ShiftsQuery = z.output<typeof shiftsQuerySchema>;
export type ShiftsPage = z.infer<typeof shiftsPageSchema>;
export type ShiftAssignment = z.infer<typeof shiftAssignmentSchema>;
export type ShiftAssignmentCreateRequest = z.input<typeof shiftAssignmentCreateRequestSchema>;
export type ShiftAssignmentUpdateRequest = z.infer<typeof shiftAssignmentUpdateRequestSchema>;
