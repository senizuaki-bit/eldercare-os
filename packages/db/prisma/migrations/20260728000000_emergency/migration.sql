-- CreateEnum
CREATE TYPE "EmergencyStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESPONDING', 'RESOLVED', 'REVIEWED');

-- CreateEnum
CREATE TYPE "EmergencySourceKind" AS ENUM ('ELDER_BUTTON', 'VOICE_RISK', 'IOT_BUTTON', 'STAFF_MANUAL');

-- CreateEnum
CREATE TYPE "EmergencyLocationState" AS ENUM ('CURRENT', 'STALE', 'ROOM_FALLBACK', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "EmergencyResponderStatus" AS ENUM ('OFFERED', 'ASSIGNED', 'ACKNOWLEDGED', 'RELEASED');

-- CreateEnum
CREATE TYPE "EmergencyMilestoneKind" AS ENUM ('EN_ROUTE', 'ON_SITE');

-- CreateEnum
CREATE TYPE "EmergencySlaStage" AS ENUM ('ACKNOWLEDGEMENT', 'ARRIVAL', 'RESOLUTION');

-- CreateEnum
CREATE TYPE "EmergencyEscalationStatus" AS ENUM ('SCHEDULED', 'TRIGGERED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "EscalationPolicyStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EmergencyReviewKind" AS ENUM ('COMPLETED', 'WAIVED');

-- CreateEnum
CREATE TYPE "EmergencyFamilyStage" AS ENUM ('OPENED', 'ACKNOWLEDGED', 'RESPONDING', 'RESOLVED', 'REVIEWED');

-- CreateEnum
CREATE TYPE "EmergencyNotificationChannel" AS ENUM ('IN_APP', 'SMS', 'PHONE', 'EMAIL');

-- CreateEnum
CREATE TYPE "EmergencyDeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED', 'SUPPRESSED');

-- CreateTable
CREATE TABLE "emergency_source_bindings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "elder_id" UUID NOT NULL,
    "source_kind" "EmergencySourceKind" NOT NULL,
    "external_source_id" VARCHAR(128) NOT NULL,
    "display_label" VARCHAR(160) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "emergency_source_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "elder_id" UUID NOT NULL,
    "source_kind" "EmergencySourceKind" NOT NULL,
    "reason_code" VARCHAR(64) NOT NULL,
    "status" "EmergencyStatus" NOT NULL DEFAULT 'OPEN',
    "version" INTEGER NOT NULL DEFAULT 1,
    "escalation_policy_id" UUID NOT NULL,
    "escalation_policy_version" INTEGER NOT NULL,
    "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMPTZ(3),
    "responding_at" TIMESTAMPTZ(3),
    "on_site_at" TIMESTAMPTZ(3),
    "resolved_at" TIMESTAMPTZ(3),
    "reviewed_at" TIMESTAMPTZ(3),
    "current_deadline_at" TIMESTAMPTZ(3),
    "correlation_id" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "emergency_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_signals" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "elder_id" UUID NOT NULL,
    "emergency_event_id" UUID NOT NULL,
    "source_binding_id" UUID,
    "source_user_id" UUID,
    "source_kind" "EmergencySourceKind" NOT NULL,
    "source_identity_key" VARCHAR(192) NOT NULL,
    "external_event_id" VARCHAR(128) NOT NULL,
    "request_fingerprint" CHAR(64) NOT NULL,
    "schema_version" VARCHAR(16) NOT NULL,
    "observed_at" TIMESTAMPTZ(3),
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason_code" VARCHAR(64) NOT NULL,
    "correlation_id" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emergency_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_location_snapshots" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "elder_id" UUID NOT NULL,
    "emergency_event_id" UUID NOT NULL,
    "state" "EmergencyLocationState" NOT NULL,
    "source" VARCHAR(64) NOT NULL,
    "floor_id" UUID,
    "room_id" UUID,
    "normalized_x" DECIMAL(6,5),
    "normalized_y" DECIMAL(6,5),
    "accuracy_meters" DECIMAL(8,2),
    "observed_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),
    "decided_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retention_until" TIMESTAMPTZ(3) NOT NULL,
    "fallback_reason_code" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emergency_location_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_transitions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "emergency_event_id" UUID NOT NULL,
    "from_status" "EmergencyStatus",
    "to_status" "EmergencyStatus" NOT NULL,
    "from_version" INTEGER NOT NULL,
    "to_version" INTEGER NOT NULL,
    "actor_type" "EventActorType" NOT NULL,
    "actor_user_id" UUID,
    "actor_external_id" VARCHAR(128),
    "reason_code" VARCHAR(64) NOT NULL,
    "correlation_id" VARCHAR(128) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emergency_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_related_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "primary_event_id" UUID NOT NULL,
    "related_event_id" UUID NOT NULL,
    "reason_code" VARCHAR(64) NOT NULL,
    "correlation_id" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emergency_related_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_acknowledgements" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "emergency_event_id" UUID NOT NULL,
    "staff_profile_id" UUID NOT NULL,
    "shift_assignment_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "client_observed_at" TIMESTAMPTZ(3),
    "acknowledged_at" TIMESTAMPTZ(3) NOT NULL,
    "correlation_id" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emergency_acknowledgements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_responders" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "emergency_event_id" UUID NOT NULL,
    "staff_profile_id" UUID NOT NULL,
    "shift_assignment_id" UUID NOT NULL,
    "team_id" UUID,
    "status" "EmergencyResponderStatus" NOT NULL DEFAULT 'OFFERED',
    "assigned_by_user_id" UUID,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMPTZ(3),
    "released_at" TIMESTAMPTZ(3),
    "reason_code" VARCHAR(64) NOT NULL,
    "is_emergency_elevation" BOOLEAN NOT NULL DEFAULT false,
    "elevation_reason_code" VARCHAR(64),
    "elevation_expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "emergency_responders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_responder_assignments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "emergency_event_id" UUID NOT NULL,
    "staff_profile_id" UUID NOT NULL,
    "shift_assignment_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "assigned_by_user_id" UUID NOT NULL,
    "from_version" INTEGER NOT NULL,
    "to_version" INTEGER NOT NULL,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL,
    "reason_code" VARCHAR(64) NOT NULL,
    "is_emergency_elevation" BOOLEAN NOT NULL DEFAULT false,
    "elevation_reason_code" VARCHAR(64),
    "elevation_expires_at" TIMESTAMPTZ(3),
    "correlation_id" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emergency_responder_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_response_milestones" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "emergency_event_id" UUID NOT NULL,
    "kind" "EmergencyMilestoneKind" NOT NULL,
    "staff_profile_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "from_version" INTEGER NOT NULL,
    "to_version" INTEGER NOT NULL,
    "client_observed_at" TIMESTAMPTZ(3),
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "reason_code" VARCHAR(64) NOT NULL,
    "correlation_id" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emergency_response_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escalation_policies" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "EscalationPolicyStatus" NOT NULL DEFAULT 'ACTIVE',
    "effective_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escalation_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escalation_steps" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "escalation_policy_id" UUID NOT NULL,
    "stage" "EmergencySlaStage" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "threshold_seconds" INTEGER NOT NULL,
    "reason_code" VARCHAR(64) NOT NULL,
    "notify_role_codes" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escalation_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_escalations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "emergency_event_id" UUID NOT NULL,
    "escalation_step_id" UUID NOT NULL,
    "stage" "EmergencySlaStage" NOT NULL,
    "status" "EmergencyEscalationStatus" NOT NULL DEFAULT 'SCHEDULED',
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "basis_transition_version" INTEGER NOT NULL,
    "idempotency_key" VARCHAR(192) NOT NULL,
    "triggered_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "last_error_code" VARCHAR(96),
    "correlation_id" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "emergency_escalations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_resolutions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "emergency_event_id" UUID NOT NULL,
    "resolved_by_user_id" UUID NOT NULL,
    "staff_profile_id" UUID NOT NULL,
    "summary" VARCHAR(1000) NOT NULL,
    "outcome_code" VARCHAR(64) NOT NULL,
    "family_notify" BOOLEAN NOT NULL DEFAULT false,
    "completion_checklist" JSONB NOT NULL,
    "resolved_at" TIMESTAMPTZ(3) NOT NULL,
    "correlation_id" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emergency_resolutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_reviews" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "emergency_event_id" UUID NOT NULL,
    "reviewed_by_user_id" UUID NOT NULL,
    "kind" "EmergencyReviewKind" NOT NULL,
    "summary" VARCHAR(1000),
    "waiver_reason_code" VARCHAR(64),
    "reviewed_at" TIMESTAMPTZ(3) NOT NULL,
    "correlation_id" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emergency_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_emergency_notification_preferences" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "elder_id" UUID NOT NULL,
    "family_relationship_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "notify_on_opened" BOOLEAN NOT NULL DEFAULT false,
    "notify_on_resolved" BOOLEAN NOT NULL DEFAULT true,
    "channel" "EmergencyNotificationChannel" NOT NULL DEFAULT 'IN_APP',
    "updated_by_user_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "family_emergency_notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_family_summaries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "elder_id" UUID NOT NULL,
    "emergency_event_id" UUID NOT NULL,
    "stage" "EmergencyFamilyStage" NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "summary" VARCHAR(1000) NOT NULL,
    "published_at" TIMESTAMPTZ(3) NOT NULL,
    "correlation_id" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emergency_family_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_notification_deliveries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "emergency_event_id" UUID NOT NULL,
    "family_relationship_id" UUID NOT NULL,
    "stage" "EmergencyFamilyStage" NOT NULL,
    "channel" "EmergencyNotificationChannel" NOT NULL,
    "status" "EmergencyDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "provider_key" VARCHAR(192) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "suppressed_at" TIMESTAMPTZ(3),
    "last_error_code" VARCHAR(96),
    "correlation_id" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "emergency_notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_command_receipts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "command_kind" VARCHAR(64) NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "request_fingerprint" CHAR(64) NOT NULL,
    "resource_type" VARCHAR(64) NOT NULL,
    "resource_id" VARCHAR(128) NOT NULL,
    "result_version" INTEGER NOT NULL,
    "correlation_id" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emergency_command_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "emergency_source_bindings_elder_id_active_idx" ON "emergency_source_bindings"("elder_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_source_bindings_organization_id_facility_id_exter_key" ON "emergency_source_bindings"("organization_id", "facility_id", "external_source_id");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_source_bindings_id_organization_id_facility_id_key" ON "emergency_source_bindings"("id", "organization_id", "facility_id");

-- CreateIndex
CREATE INDEX "emergency_events_organization_id_facility_id_status_opened__idx" ON "emergency_events"("organization_id", "facility_id", "status", "opened_at" DESC);

-- CreateIndex
CREATE INDEX "emergency_events_elder_id_opened_at_idx" ON "emergency_events"("elder_id", "opened_at" DESC);

-- CreateIndex
CREATE INDEX "emergency_events_correlation_id_idx" ON "emergency_events"("correlation_id");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_events_id_organization_id_facility_id_key" ON "emergency_events"("id", "organization_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_events_id_elder_id_organization_id_facility_id_key" ON "emergency_events"("id", "elder_id", "organization_id", "facility_id");

-- CreateIndex
CREATE INDEX "emergency_signals_emergency_event_id_received_at_idx" ON "emergency_signals"("emergency_event_id", "received_at");

-- CreateIndex
CREATE INDEX "emergency_signals_request_fingerprint_idx" ON "emergency_signals"("request_fingerprint");

-- CreateIndex
CREATE INDEX "emergency_signals_correlation_id_idx" ON "emergency_signals"("correlation_id");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_signals_organization_id_facility_id_source_identi_key" ON "emergency_signals"("organization_id", "facility_id", "source_identity_key", "external_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_signals_id_organization_id_facility_id_key" ON "emergency_signals"("id", "organization_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_location_snapshots_emergency_event_id_key" ON "emergency_location_snapshots"("emergency_event_id");

-- CreateIndex
CREATE INDEX "emergency_location_snapshots_elder_id_decided_at_idx" ON "emergency_location_snapshots"("elder_id", "decided_at" DESC);

-- CreateIndex
CREATE INDEX "emergency_location_snapshots_retention_until_idx" ON "emergency_location_snapshots"("retention_until");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_location_snapshots_id_organization_id_facility_id_key" ON "emergency_location_snapshots"("id", "organization_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_location_snapshots_emergency_event_id_elder_id_or_key" ON "emergency_location_snapshots"("emergency_event_id", "elder_id", "organization_id", "facility_id");

-- CreateIndex
CREATE INDEX "emergency_transitions_organization_id_facility_id_occurred__idx" ON "emergency_transitions"("organization_id", "facility_id", "occurred_at");

-- CreateIndex
CREATE INDEX "emergency_transitions_correlation_id_idx" ON "emergency_transitions"("correlation_id");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_transitions_emergency_event_id_to_version_key" ON "emergency_transitions"("emergency_event_id", "to_version");

-- CreateIndex
CREATE INDEX "emergency_related_events_organization_id_facility_id_create_idx" ON "emergency_related_events"("organization_id", "facility_id", "created_at");

-- CreateIndex
CREATE INDEX "emergency_related_events_correlation_id_idx" ON "emergency_related_events"("correlation_id");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_related_events_primary_event_id_related_event_id_key" ON "emergency_related_events"("primary_event_id", "related_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_related_events_id_organization_id_facility_id_key" ON "emergency_related_events"("id", "organization_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_acknowledgements_emergency_event_id_key" ON "emergency_acknowledgements"("emergency_event_id");

-- CreateIndex
CREATE INDEX "emergency_acknowledgements_staff_profile_id_acknowledged_at_idx" ON "emergency_acknowledgements"("staff_profile_id", "acknowledged_at");

-- CreateIndex
CREATE INDEX "emergency_acknowledgements_correlation_id_idx" ON "emergency_acknowledgements"("correlation_id");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_acknowledgements_id_organization_id_facility_id_key" ON "emergency_acknowledgements"("id", "organization_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_acknowledgements_emergency_event_id_organization__key" ON "emergency_acknowledgements"("emergency_event_id", "organization_id", "facility_id");

-- CreateIndex
CREATE INDEX "emergency_responders_staff_profile_id_status_idx" ON "emergency_responders"("staff_profile_id", "status");

-- CreateIndex
CREATE INDEX "emergency_responders_shift_assignment_id_status_idx" ON "emergency_responders"("shift_assignment_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_responders_emergency_event_id_staff_profile_id_key" ON "emergency_responders"("emergency_event_id", "staff_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_responders_id_organization_id_facility_id_key" ON "emergency_responders"("id", "organization_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_responder_assignments_emergency_event_id_to_key" ON "emergency_responder_assignments"("emergency_event_id", "to_version");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_responder_assignments_id_org_facility_key" ON "emergency_responder_assignments"("id", "organization_id", "facility_id");

-- CreateIndex
CREATE INDEX "emergency_responder_assignments_staff_assigned_at_idx" ON "emergency_responder_assignments"("staff_profile_id", "assigned_at");

-- CreateIndex
CREATE INDEX "emergency_responder_assignments_correlation_id_idx" ON "emergency_responder_assignments"("correlation_id");

-- CreateIndex
CREATE INDEX "emergency_response_milestones_organization_id_facility_id_o_idx" ON "emergency_response_milestones"("organization_id", "facility_id", "occurred_at");

-- CreateIndex
CREATE INDEX "emergency_response_milestones_correlation_id_idx" ON "emergency_response_milestones"("correlation_id");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_response_milestones_emergency_event_id_kind_key" ON "emergency_response_milestones"("emergency_event_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_response_milestones_emergency_event_id_to_version_key" ON "emergency_response_milestones"("emergency_event_id", "to_version");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_response_milestones_id_organization_id_facility_i_key" ON "emergency_response_milestones"("id", "organization_id", "facility_id");

-- CreateIndex
CREATE INDEX "escalation_policies_organization_id_facility_id_status_effe_idx" ON "escalation_policies"("organization_id", "facility_id", "status", "effective_at");

-- CreateIndex
CREATE UNIQUE INDEX "escalation_policies_facility_id_code_version_key" ON "escalation_policies"("facility_id", "code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "escalation_policies_id_organization_id_facility_id_key" ON "escalation_policies"("id", "organization_id", "facility_id");

-- CreateIndex
CREATE INDEX "escalation_steps_organization_id_facility_id_stage_idx" ON "escalation_steps"("organization_id", "facility_id", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "escalation_steps_escalation_policy_id_stage_sequence_key" ON "escalation_steps"("escalation_policy_id", "stage", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "escalation_steps_id_organization_id_facility_id_key" ON "escalation_steps"("id", "organization_id", "facility_id");

-- CreateIndex
CREATE INDEX "emergency_escalations_status_due_at_idx" ON "emergency_escalations"("status", "due_at");

-- CreateIndex
CREATE INDEX "emergency_escalations_status_cancelled_at_id_idx" ON "emergency_escalations"("status", "cancelled_at", "id");

-- CreateIndex
CREATE INDEX "emergency_escalations_correlation_id_idx" ON "emergency_escalations"("correlation_id");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_escalations_emergency_event_id_stage_escalation_s_key" ON "emergency_escalations"("emergency_event_id", "stage", "escalation_step_id", "basis_transition_version");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_escalations_organization_id_idempotency_key_key" ON "emergency_escalations"("organization_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_escalations_id_organization_id_facility_id_key" ON "emergency_escalations"("id", "organization_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_resolutions_emergency_event_id_key" ON "emergency_resolutions"("emergency_event_id");

-- CreateIndex
CREATE INDEX "emergency_resolutions_resolved_at_idx" ON "emergency_resolutions"("resolved_at");

-- CreateIndex
CREATE INDEX "emergency_resolutions_correlation_id_idx" ON "emergency_resolutions"("correlation_id");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_resolutions_id_organization_id_facility_id_key" ON "emergency_resolutions"("id", "organization_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_resolutions_emergency_event_id_organization_id_fa_key" ON "emergency_resolutions"("emergency_event_id", "organization_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_reviews_emergency_event_id_key" ON "emergency_reviews"("emergency_event_id");

-- CreateIndex
CREATE INDEX "emergency_reviews_reviewed_at_idx" ON "emergency_reviews"("reviewed_at");

-- CreateIndex
CREATE INDEX "emergency_reviews_correlation_id_idx" ON "emergency_reviews"("correlation_id");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_reviews_id_organization_id_facility_id_key" ON "emergency_reviews"("id", "organization_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_reviews_emergency_event_id_organization_id_facili_key" ON "emergency_reviews"("emergency_event_id", "organization_id", "facility_id");

-- CreateIndex
CREATE INDEX "family_emergency_notification_preferences_elder_id_enabled_idx" ON "family_emergency_notification_preferences"("elder_id", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "family_emergency_notification_preferences_id_organization_i_key" ON "family_emergency_notification_preferences"("id", "organization_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "family_emergency_notification_preferences_family_relationsh_key" ON "family_emergency_notification_preferences"("family_relationship_id", "elder_id", "organization_id", "facility_id");

-- CreateIndex
CREATE INDEX "emergency_family_summaries_elder_id_published_at_idx" ON "emergency_family_summaries"("elder_id", "published_at" DESC);

-- CreateIndex
CREATE INDEX "emergency_family_summaries_correlation_id_idx" ON "emergency_family_summaries"("correlation_id");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_family_summaries_emergency_event_id_stage_key" ON "emergency_family_summaries"("emergency_event_id", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_family_summaries_id_organization_id_facility_id_key" ON "emergency_family_summaries"("id", "organization_id", "facility_id");

-- CreateIndex
CREATE INDEX "emergency_notification_deliveries_status_next_attempt_at_idx" ON "emergency_notification_deliveries"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "emergency_notification_deliveries_correlation_id_idx" ON "emergency_notification_deliveries"("correlation_id");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_notification_deliveries_organization_id_provider__key" ON "emergency_notification_deliveries"("organization_id", "provider_key");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_notification_deliveries_emergency_event_id_family_key" ON "emergency_notification_deliveries"("emergency_event_id", "family_relationship_id", "stage", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_notification_deliveries_id_organization_id_facili_key" ON "emergency_notification_deliveries"("id", "organization_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_command_receipts_organization_id_actor_user_id_c_key" ON "emergency_command_receipts"("organization_id", "actor_user_id", "command_kind", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_command_receipts_id_organization_id_facility_key" ON "emergency_command_receipts"("id", "organization_id", "facility_id");

-- CreateIndex
CREATE INDEX "emergency_command_receipts_organization_id_facility_id_res_idx" ON "emergency_command_receipts"("organization_id", "facility_id", "resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "emergency_command_receipts_correlation_id_idx" ON "emergency_command_receipts"("correlation_id");

-- CreateIndex
CREATE UNIQUE INDEX "family_relationships_id_organization_id_facility_id_key" ON "family_relationships"("id", "organization_id", "facility_id");

-- AddForeignKey
ALTER TABLE "emergency_source_bindings" ADD CONSTRAINT "emergency_source_bindings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_source_bindings" ADD CONSTRAINT "emergency_source_bindings_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_source_bindings" ADD CONSTRAINT "emergency_source_bindings_elder_id_organization_id_facilit_fkey" FOREIGN KEY ("elder_id", "organization_id", "facility_id") REFERENCES "elders"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_events" ADD CONSTRAINT "emergency_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_events" ADD CONSTRAINT "emergency_events_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_events" ADD CONSTRAINT "emergency_events_elder_id_organization_id_facility_id_fkey" FOREIGN KEY ("elder_id", "organization_id", "facility_id") REFERENCES "elders"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_events" ADD CONSTRAINT "emergency_events_escalation_policy_id_organization_id_faci_fkey" FOREIGN KEY ("escalation_policy_id", "organization_id", "facility_id") REFERENCES "escalation_policies"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_signals" ADD CONSTRAINT "emergency_signals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_signals" ADD CONSTRAINT "emergency_signals_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_signals" ADD CONSTRAINT "emergency_signals_elder_id_organization_id_facility_id_fkey" FOREIGN KEY ("elder_id", "organization_id", "facility_id") REFERENCES "elders"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_signals" ADD CONSTRAINT "emergency_signals_emergency_event_id_elder_id_organization_fkey" FOREIGN KEY ("emergency_event_id", "elder_id", "organization_id", "facility_id") REFERENCES "emergency_events"("id", "elder_id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_signals" ADD CONSTRAINT "emergency_signals_source_binding_id_organization_id_facili_fkey" FOREIGN KEY ("source_binding_id", "organization_id", "facility_id") REFERENCES "emergency_source_bindings"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_signals" ADD CONSTRAINT "emergency_signals_source_user_id_fkey" FOREIGN KEY ("source_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_location_snapshots" ADD CONSTRAINT "emergency_location_snapshots_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_location_snapshots" ADD CONSTRAINT "emergency_location_snapshots_elder_id_organization_id_faci_fkey" FOREIGN KEY ("elder_id", "organization_id", "facility_id") REFERENCES "elders"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_location_snapshots" ADD CONSTRAINT "emergency_location_snapshots_emergency_event_id_elder_id_o_fkey" FOREIGN KEY ("emergency_event_id", "elder_id", "organization_id", "facility_id") REFERENCES "emergency_events"("id", "elder_id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_location_snapshots" ADD CONSTRAINT "emergency_location_snapshots_floor_id_organization_id_faci_fkey" FOREIGN KEY ("floor_id", "organization_id", "facility_id") REFERENCES "floors"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_location_snapshots" ADD CONSTRAINT "emergency_location_snapshots_room_id_organization_id_facil_fkey" FOREIGN KEY ("room_id", "organization_id", "facility_id") REFERENCES "rooms"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_transitions" ADD CONSTRAINT "emergency_transitions_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_transitions" ADD CONSTRAINT "emergency_transitions_emergency_event_id_organization_id_f_fkey" FOREIGN KEY ("emergency_event_id", "organization_id", "facility_id") REFERENCES "emergency_events"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_transitions" ADD CONSTRAINT "emergency_transitions_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_related_events" ADD CONSTRAINT "emergency_related_events_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_related_events" ADD CONSTRAINT "emergency_related_events_primary_event_id_organization_id__fkey" FOREIGN KEY ("primary_event_id", "organization_id", "facility_id") REFERENCES "emergency_events"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_related_events" ADD CONSTRAINT "emergency_related_events_related_event_id_organization_id__fkey" FOREIGN KEY ("related_event_id", "organization_id", "facility_id") REFERENCES "emergency_events"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_acknowledgements" ADD CONSTRAINT "emergency_acknowledgements_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_acknowledgements" ADD CONSTRAINT "emergency_acknowledgements_emergency_event_id_organization_fkey" FOREIGN KEY ("emergency_event_id", "organization_id", "facility_id") REFERENCES "emergency_events"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_acknowledgements" ADD CONSTRAINT "emergency_acknowledgements_staff_profile_id_organization_i_fkey" FOREIGN KEY ("staff_profile_id", "organization_id", "facility_id") REFERENCES "staff_profiles"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_acknowledgements" ADD CONSTRAINT "emergency_acknowledgements_shift_assignment_id_organizatio_fkey" FOREIGN KEY ("shift_assignment_id", "organization_id", "facility_id") REFERENCES "shift_assignments"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_acknowledgements" ADD CONSTRAINT "emergency_acknowledgements_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_responders" ADD CONSTRAINT "emergency_responders_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_responders" ADD CONSTRAINT "emergency_responders_emergency_event_id_organization_id_fa_fkey" FOREIGN KEY ("emergency_event_id", "organization_id", "facility_id") REFERENCES "emergency_events"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_responders" ADD CONSTRAINT "emergency_responders_staff_profile_id_organization_id_faci_fkey" FOREIGN KEY ("staff_profile_id", "organization_id", "facility_id") REFERENCES "staff_profiles"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_responders" ADD CONSTRAINT "emergency_responders_shift_assignment_id_organization_id_f_fkey" FOREIGN KEY ("shift_assignment_id", "organization_id", "facility_id") REFERENCES "shift_assignments"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_responders" ADD CONSTRAINT "emergency_responders_team_id_organization_id_facility_id_fkey" FOREIGN KEY ("team_id", "organization_id", "facility_id") REFERENCES "teams"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_responders" ADD CONSTRAINT "emergency_responders_assigned_by_user_id_fkey" FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_responder_assignments" ADD CONSTRAINT "emergency_responder_assignments_facility_org_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_responder_assignments" ADD CONSTRAINT "emergency_responder_assignments_event_org_facility_fkey" FOREIGN KEY ("emergency_event_id", "organization_id", "facility_id") REFERENCES "emergency_events"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_responder_assignments" ADD CONSTRAINT "emergency_responder_assignments_staff_org_facility_fkey" FOREIGN KEY ("staff_profile_id", "organization_id", "facility_id") REFERENCES "staff_profiles"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_responder_assignments" ADD CONSTRAINT "emergency_responder_assignments_shift_org_facility_fkey" FOREIGN KEY ("shift_assignment_id", "organization_id", "facility_id") REFERENCES "shift_assignments"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_responder_assignments" ADD CONSTRAINT "emergency_responder_assignments_team_org_facility_fkey" FOREIGN KEY ("team_id", "organization_id", "facility_id") REFERENCES "teams"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_responder_assignments" ADD CONSTRAINT "emergency_responder_assignments_actor_user_fkey" FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_response_milestones" ADD CONSTRAINT "emergency_response_milestones_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_response_milestones" ADD CONSTRAINT "emergency_response_milestones_emergency_event_id_organizat_fkey" FOREIGN KEY ("emergency_event_id", "organization_id", "facility_id") REFERENCES "emergency_events"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_response_milestones" ADD CONSTRAINT "emergency_response_milestones_staff_profile_id_organizatio_fkey" FOREIGN KEY ("staff_profile_id", "organization_id", "facility_id") REFERENCES "staff_profiles"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_response_milestones" ADD CONSTRAINT "emergency_response_milestones_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_policies" ADD CONSTRAINT "escalation_policies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_policies" ADD CONSTRAINT "escalation_policies_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_steps" ADD CONSTRAINT "escalation_steps_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_steps" ADD CONSTRAINT "escalation_steps_escalation_policy_id_organization_id_faci_fkey" FOREIGN KEY ("escalation_policy_id", "organization_id", "facility_id") REFERENCES "escalation_policies"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_escalations" ADD CONSTRAINT "emergency_escalations_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_escalations" ADD CONSTRAINT "emergency_escalations_emergency_event_id_organization_id_f_fkey" FOREIGN KEY ("emergency_event_id", "organization_id", "facility_id") REFERENCES "emergency_events"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_escalations" ADD CONSTRAINT "emergency_escalations_escalation_step_id_organization_id_f_fkey" FOREIGN KEY ("escalation_step_id", "organization_id", "facility_id") REFERENCES "escalation_steps"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_resolutions" ADD CONSTRAINT "emergency_resolutions_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_resolutions" ADD CONSTRAINT "emergency_resolutions_emergency_event_id_organization_id_f_fkey" FOREIGN KEY ("emergency_event_id", "organization_id", "facility_id") REFERENCES "emergency_events"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_resolutions" ADD CONSTRAINT "emergency_resolutions_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_resolutions" ADD CONSTRAINT "emergency_resolutions_staff_profile_id_organization_id_fac_fkey" FOREIGN KEY ("staff_profile_id", "organization_id", "facility_id") REFERENCES "staff_profiles"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_reviews" ADD CONSTRAINT "emergency_reviews_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_reviews" ADD CONSTRAINT "emergency_reviews_emergency_event_id_organization_id_facil_fkey" FOREIGN KEY ("emergency_event_id", "organization_id", "facility_id") REFERENCES "emergency_events"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_reviews" ADD CONSTRAINT "emergency_reviews_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_emergency_notification_preferences" ADD CONSTRAINT "family_emergency_notification_preferences_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_emergency_notification_preferences" ADD CONSTRAINT "family_emergency_notification_preferences_facility_id_orga_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_emergency_notification_preferences" ADD CONSTRAINT "family_emergency_notification_preferences_elder_id_organiz_fkey" FOREIGN KEY ("elder_id", "organization_id", "facility_id") REFERENCES "elders"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_emergency_notification_preferences" ADD CONSTRAINT "family_emergency_notification_preferences_family_relations_fkey" FOREIGN KEY ("family_relationship_id", "elder_id", "organization_id", "facility_id") REFERENCES "family_relationships"("id", "elder_id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_emergency_notification_preferences" ADD CONSTRAINT "family_emergency_notification_preferences_updated_by_user__fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_family_summaries" ADD CONSTRAINT "emergency_family_summaries_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_family_summaries" ADD CONSTRAINT "emergency_family_summaries_elder_id_organization_id_facili_fkey" FOREIGN KEY ("elder_id", "organization_id", "facility_id") REFERENCES "elders"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_family_summaries" ADD CONSTRAINT "emergency_family_summaries_emergency_event_id_elder_id_org_fkey" FOREIGN KEY ("emergency_event_id", "elder_id", "organization_id", "facility_id") REFERENCES "emergency_events"("id", "elder_id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_notification_deliveries" ADD CONSTRAINT "emergency_notification_deliveries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_notification_deliveries" ADD CONSTRAINT "emergency_notification_deliveries_facility_id_organization_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_notification_deliveries" ADD CONSTRAINT "emergency_notification_deliveries_emergency_event_id_organ_fkey" FOREIGN KEY ("emergency_event_id", "organization_id", "facility_id") REFERENCES "emergency_events"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_notification_deliveries" ADD CONSTRAINT "emergency_notification_deliveries_family_relationship_id_o_fkey" FOREIGN KEY ("family_relationship_id", "organization_id", "facility_id") REFERENCES "family_relationships"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_command_receipts" ADD CONSTRAINT "emergency_command_receipts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_command_receipts" ADD CONSTRAINT "emergency_command_receipts_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_command_receipts" ADD CONSTRAINT "emergency_command_receipts_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- M04 invariants that Prisma cannot express.
ALTER TABLE "emergency_events"
  ADD CONSTRAINT "emergency_events_version_positive" CHECK ("version" >= 1),
  ADD CONSTRAINT "emergency_events_timestamp_order" CHECK (
    ("acknowledged_at" IS NULL OR "acknowledged_at" >= "opened_at")
    AND ("responding_at" IS NULL OR ("acknowledged_at" IS NOT NULL AND "responding_at" >= "acknowledged_at"))
    AND ("on_site_at" IS NULL OR ("responding_at" IS NOT NULL AND "on_site_at" >= "responding_at"))
    AND ("resolved_at" IS NULL OR ("responding_at" IS NOT NULL AND "resolved_at" >= "responding_at"))
    AND ("reviewed_at" IS NULL OR ("resolved_at" IS NOT NULL AND "reviewed_at" >= "resolved_at"))
  ),
  ADD CONSTRAINT "emergency_events_status_evidence" CHECK (
    ("status" = 'OPEN' AND "acknowledged_at" IS NULL AND "responding_at" IS NULL AND "resolved_at" IS NULL AND "reviewed_at" IS NULL)
    OR ("status" = 'ACKNOWLEDGED' AND "acknowledged_at" IS NOT NULL AND "responding_at" IS NULL AND "resolved_at" IS NULL AND "reviewed_at" IS NULL)
    OR ("status" = 'RESPONDING' AND "acknowledged_at" IS NOT NULL AND "responding_at" IS NOT NULL AND "resolved_at" IS NULL AND "reviewed_at" IS NULL)
    OR ("status" = 'RESOLVED' AND "acknowledged_at" IS NOT NULL AND "responding_at" IS NOT NULL AND "resolved_at" IS NOT NULL AND "reviewed_at" IS NULL)
    OR ("status" = 'REVIEWED' AND "acknowledged_at" IS NOT NULL AND "responding_at" IS NOT NULL AND "resolved_at" IS NOT NULL AND "reviewed_at" IS NOT NULL)
  );

ALTER TABLE "emergency_signals"
  ADD CONSTRAINT "emergency_signals_fingerprint_sha256" CHECK (
    "request_fingerprint" ~ '^[a-f0-9]{64}$'
  ),
  ADD CONSTRAINT "emergency_signals_source_actor_shape" CHECK (
    ("source_kind" IN ('ELDER_BUTTON', 'STAFF_MANUAL') AND "source_user_id" IS NOT NULL)
    OR ("source_kind" IN ('VOICE_RISK', 'IOT_BUTTON') AND "source_binding_id" IS NOT NULL)
  );

ALTER TABLE "emergency_location_snapshots"
  ADD CONSTRAINT "emergency_location_retention_valid" CHECK ("retention_until" > "decided_at"),
  ADD CONSTRAINT "emergency_location_coordinates_paired" CHECK (
    ("normalized_x" IS NULL) = ("normalized_y" IS NULL)
  ),
  ADD CONSTRAINT "emergency_location_coordinates_normalized" CHECK (
    ("normalized_x" IS NULL AND "normalized_y" IS NULL)
    OR ("normalized_x" BETWEEN 0 AND 1 AND "normalized_y" BETWEEN 0 AND 1)
  ),
  ADD CONSTRAINT "emergency_location_accuracy_positive" CHECK (
    "accuracy_meters" IS NULL OR "accuracy_meters" > 0
  ),
  ADD CONSTRAINT "emergency_location_expiry_valid" CHECK (
    ("observed_at" IS NULL AND "expires_at" IS NULL)
    OR ("observed_at" IS NOT NULL AND "expires_at" IS NOT NULL AND "expires_at" > "observed_at")
  ),
  ADD CONSTRAINT "emergency_location_state_shape" CHECK (
    ("state" = 'CURRENT' AND "observed_at" IS NOT NULL AND "expires_at" IS NOT NULL)
    OR ("state" = 'STALE' AND "observed_at" IS NOT NULL AND "expires_at" IS NOT NULL AND "fallback_reason_code" IS NOT NULL)
    OR ("state" = 'ROOM_FALLBACK' AND "room_id" IS NOT NULL AND "normalized_x" IS NULL AND "normalized_y" IS NULL AND "fallback_reason_code" IS NOT NULL)
    OR ("state" = 'UNKNOWN' AND "floor_id" IS NULL AND "room_id" IS NULL AND "normalized_x" IS NULL AND "normalized_y" IS NULL AND "accuracy_meters" IS NULL AND "fallback_reason_code" IS NOT NULL)
  );

ALTER TABLE "emergency_transitions"
  ADD CONSTRAINT "emergency_transitions_version_step" CHECK ("to_version" = "from_version" + 1),
  ADD CONSTRAINT "emergency_transitions_human_finalization" CHECK (
    "to_status" NOT IN ('RESOLVED', 'REVIEWED') OR "actor_type" = 'USER'
  ),
  ADD CONSTRAINT "emergency_transitions_actor_shape" CHECK (
    ("actor_type" = 'USER' AND "actor_user_id" IS NOT NULL AND "actor_external_id" IS NULL)
    OR ("actor_type" <> 'USER' AND "actor_user_id" IS NULL AND "actor_external_id" IS NOT NULL)
  );

ALTER TABLE "emergency_related_events"
  ADD CONSTRAINT "emergency_related_events_not_self" CHECK ("primary_event_id" <> "related_event_id");

ALTER TABLE "emergency_acknowledgements"
  ADD CONSTRAINT "emergency_acknowledgements_observed_before_server" CHECK (
    "client_observed_at" IS NULL OR "client_observed_at" <= "acknowledged_at"
  );

ALTER TABLE "emergency_responders"
  ADD CONSTRAINT "emergency_responders_release_order" CHECK (
    "released_at" IS NULL OR "released_at" >= "assigned_at"
  ),
  ADD CONSTRAINT "emergency_responders_elevation_shape" CHECK (
    (
      "is_emergency_elevation" = false
      AND "elevation_reason_code" IS NULL
      AND "elevation_expires_at" IS NULL
    )
    OR (
      "is_emergency_elevation" = true
      AND "elevation_reason_code" IS NOT NULL
      AND "elevation_expires_at" IS NOT NULL
      AND "elevation_expires_at" > "assigned_at"
    )
  );

ALTER TABLE "emergency_responder_assignments"
  ADD CONSTRAINT "emergency_responder_assignments_version_step" CHECK (
    "to_version" = "from_version" + 1
  ),
  ADD CONSTRAINT "emergency_responder_assignments_elevation_shape" CHECK (
    (
      "is_emergency_elevation" = false
      AND "elevation_reason_code" IS NULL
      AND "elevation_expires_at" IS NULL
    )
    OR (
      "is_emergency_elevation" = true
      AND "elevation_reason_code" IS NOT NULL
      AND "elevation_expires_at" IS NOT NULL
      AND "elevation_expires_at" > "assigned_at"
    )
  );

ALTER TABLE "emergency_response_milestones"
  ADD CONSTRAINT "emergency_response_milestones_version_step" CHECK (
    "to_version" = "from_version" + 1
  ),
  ADD CONSTRAINT "emergency_response_milestones_observed_before_server" CHECK (
    "client_observed_at" IS NULL OR "client_observed_at" <= "occurred_at"
  );

ALTER TABLE "escalation_policies"
  ADD CONSTRAINT "escalation_policies_version_positive" CHECK ("version" >= 1);

ALTER TABLE "escalation_steps"
  ADD CONSTRAINT "escalation_steps_sequence_positive" CHECK ("sequence" >= 1),
  ADD CONSTRAINT "escalation_steps_threshold_positive" CHECK ("threshold_seconds" > 0),
  ADD CONSTRAINT "escalation_steps_notify_roles_array" CHECK (
    jsonb_typeof("notify_role_codes") = 'array'
  );

ALTER TABLE "emergency_escalations"
  ADD CONSTRAINT "emergency_escalations_basis_version_positive" CHECK (
    "basis_transition_version" >= 1
  ),
  ADD CONSTRAINT "emergency_escalations_status_timestamps" CHECK (
    ("status" = 'SCHEDULED' AND "triggered_at" IS NULL AND "cancelled_at" IS NULL)
    OR ("status" = 'TRIGGERED' AND "triggered_at" IS NOT NULL AND "cancelled_at" IS NULL)
    OR ("status" = 'CANCELLED' AND "triggered_at" IS NULL AND "cancelled_at" IS NOT NULL)
    OR ("status" = 'FAILED' AND "last_error_code" IS NOT NULL)
  );

ALTER TABLE "emergency_resolutions"
  ADD CONSTRAINT "emergency_resolutions_checklist_shape" CHECK (
    jsonb_typeof("completion_checklist") = 'object'
    AND "completion_checklist"->>'schemaVersion' = '1'
    AND "completion_checklist"->'expectedCodes' =
      '["SCENE_SAFETY_CONFIRMED","ELDER_STATE_CONFIRMED","FOLLOW_UP_HANDOFF_CONFIRMED"]'::jsonb
    AND jsonb_typeof("completion_checklist"->'confirmations') = 'array'
    AND jsonb_array_length("completion_checklist"->'confirmations') = 3
    AND "completion_checklist"#>>'{confirmations,0,code}' = 'SCENE_SAFETY_CONFIRMED'
    AND "completion_checklist"#>'{confirmations,0,confirmed}' = 'true'::jsonb
    AND "completion_checklist"#>>'{confirmations,1,code}' = 'ELDER_STATE_CONFIRMED'
    AND "completion_checklist"#>'{confirmations,1,confirmed}' = 'true'::jsonb
    AND "completion_checklist"#>>'{confirmations,2,code}' = 'FOLLOW_UP_HANDOFF_CONFIRMED'
    AND "completion_checklist"#>'{confirmations,2,confirmed}' = 'true'::jsonb
  );

ALTER TABLE "emergency_reviews"
  ADD CONSTRAINT "emergency_reviews_kind_shape" CHECK (
    ("kind" = 'COMPLETED' AND "summary" IS NOT NULL AND "waiver_reason_code" IS NULL)
    OR ("kind" = 'WAIVED' AND "summary" IS NULL AND "waiver_reason_code" IS NOT NULL)
  );

ALTER TABLE "family_emergency_notification_preferences"
  ADD CONSTRAINT "family_emergency_notification_preferences_version_positive" CHECK (
    "version" >= 1
  );

ALTER TABLE "emergency_notification_deliveries"
  ADD CONSTRAINT "emergency_notification_deliveries_attempts_nonnegative" CHECK (
    "attempts" >= 0
  ),
  ADD CONSTRAINT "emergency_notification_deliveries_status_shape" CHECK (
    ("status" = 'PENDING' AND "delivered_at" IS NULL AND "suppressed_at" IS NULL)
    OR ("status" = 'DELIVERED' AND "delivered_at" IS NOT NULL AND "suppressed_at" IS NULL)
    OR ("status" = 'FAILED' AND "last_error_code" IS NOT NULL AND "delivered_at" IS NULL AND "suppressed_at" IS NULL)
    OR ("status" = 'SUPPRESSED' AND "suppressed_at" IS NOT NULL AND "delivered_at" IS NULL)
  );

ALTER TABLE "emergency_command_receipts"
  ADD CONSTRAINT "emergency_command_receipts_kind_valid" CHECK (
    "command_kind" IN (
      'RESPONDER_ASSIGN',
      'FAMILY_NOTIFICATION_PREFERENCE_UPDATE'
    )
  ),
  ADD CONSTRAINT "emergency_command_receipts_fingerprint_sha256" CHECK (
    "request_fingerprint" ~ '^[a-f0-9]{64}$'
  ),
  ADD CONSTRAINT "emergency_command_receipts_result_version_positive" CHECK (
    "result_version" >= 1
  );

CREATE OR REPLACE FUNCTION "eldercare_validate_emergency_status_transition"()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('eldercare.seed_mode', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW."status" <> OLD."status" AND NOT (
    (OLD."status" = 'OPEN' AND NEW."status" = 'ACKNOWLEDGED')
    OR (OLD."status" = 'ACKNOWLEDGED' AND NEW."status" = 'RESPONDING')
    OR (OLD."status" = 'RESPONDING' AND NEW."status" = 'RESOLVED')
    OR (OLD."status" = 'RESOLVED' AND NEW."status" = 'REVIEWED')
  ) THEN
    RAISE EXCEPTION 'invalid emergency status transition';
  END IF;
  IF NEW."version" < OLD."version" OR NEW."version" > OLD."version" + 1 THEN
    RAISE EXCEPTION 'invalid emergency aggregate version';
  END IF;
  IF NEW."status" <> OLD."status" AND NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'emergency status transition must advance version';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "emergency_events_validate_transition"
BEFORE UPDATE ON "emergency_events"
FOR EACH ROW EXECUTE FUNCTION "eldercare_validate_emergency_status_transition"();

CREATE OR REPLACE FUNCTION "eldercare_reject_emergency_audit_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('eldercare.seed_mode', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'emergency audit facts are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "emergency_signals_append_only"
BEFORE UPDATE OR DELETE ON "emergency_signals"
FOR EACH ROW EXECUTE FUNCTION "eldercare_reject_emergency_audit_mutation"();
CREATE TRIGGER "emergency_transitions_append_only"
BEFORE UPDATE OR DELETE ON "emergency_transitions"
FOR EACH ROW EXECUTE FUNCTION "eldercare_reject_emergency_audit_mutation"();
CREATE TRIGGER "emergency_related_events_append_only"
BEFORE UPDATE OR DELETE ON "emergency_related_events"
FOR EACH ROW EXECUTE FUNCTION "eldercare_reject_emergency_audit_mutation"();
CREATE TRIGGER "emergency_acknowledgements_append_only"
BEFORE UPDATE OR DELETE ON "emergency_acknowledgements"
FOR EACH ROW EXECUTE FUNCTION "eldercare_reject_emergency_audit_mutation"();
CREATE TRIGGER "emergency_response_milestones_append_only"
BEFORE UPDATE OR DELETE ON "emergency_response_milestones"
FOR EACH ROW EXECUTE FUNCTION "eldercare_reject_emergency_audit_mutation"();
CREATE TRIGGER "emergency_resolutions_append_only"
BEFORE UPDATE OR DELETE ON "emergency_resolutions"
FOR EACH ROW EXECUTE FUNCTION "eldercare_reject_emergency_audit_mutation"();
CREATE TRIGGER "emergency_reviews_append_only"
BEFORE UPDATE OR DELETE ON "emergency_reviews"
FOR EACH ROW EXECUTE FUNCTION "eldercare_reject_emergency_audit_mutation"();
CREATE TRIGGER "emergency_family_summaries_append_only"
BEFORE UPDATE OR DELETE ON "emergency_family_summaries"
FOR EACH ROW EXECUTE FUNCTION "eldercare_reject_emergency_audit_mutation"();
CREATE TRIGGER "emergency_responder_assignments_append_only"
BEFORE UPDATE OR DELETE ON "emergency_responder_assignments"
FOR EACH ROW EXECUTE FUNCTION "eldercare_reject_emergency_audit_mutation"();
CREATE TRIGGER "emergency_command_receipts_append_only"
BEFORE UPDATE OR DELETE ON "emergency_command_receipts"
FOR EACH ROW EXECUTE FUNCTION "eldercare_reject_emergency_audit_mutation"();
