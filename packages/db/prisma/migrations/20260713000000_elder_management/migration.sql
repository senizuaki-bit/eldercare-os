CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- CreateEnum
CREATE TYPE "FacilityStructureStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "BedOperationalStatus" AS ENUM ('ACTIVE', 'OUT_OF_SERVICE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ElderRecordStatus" AS ENUM ('ACTIVE', 'DISCHARGED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AdmissionStatus" AS ENUM ('ADMITTED', 'DISCHARGED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ElderStayStatus" AS ENUM ('PLANNED', 'ACTIVE', 'DISCHARGED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CareLevelStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "FamilyRelationshipType" AS ENUM ('SPOUSE', 'CHILD', 'SIBLING', 'GUARDIAN', 'OTHER');

-- CreateEnum
CREATE TYPE "RelationshipVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REVOKED');

-- CreateEnum
CREATE TYPE "BaselineSource" AS ENUM ('ELDER_STATED', 'STAFF_CONFIRMED', 'INFERRED');

-- CreateEnum
CREATE TYPE "PersonalBaselineDomain" AS ENUM ('ROUTINE', 'COMMUNICATION', 'MOBILITY', 'SOCIAL', 'SLEEP', 'DIET', 'EMOTIONAL_EXPRESSION', 'OTHER');

-- CreateEnum
CREATE TYPE "ConsentPurpose" AS ENUM ('VOICE_CAPTURE', 'TRANSCRIPTION_AI_ANALYSIS', 'EMOTION_TREND', 'ELDER_LOCATION', 'CAREGIVER_SHIFT_LOCATION', 'FAMILY_SHARING', 'AI_MEMORY', 'CONTENT_PERSONALIZATION', 'COMMERCIAL_RECOMMENDATION', 'FAMILY_PAYMENT', 'PRODUCT_IMPROVEMENT_TRAINING');

-- CreateEnum
CREATE TYPE "ConsentDecision" AS ENUM ('GRANTED', 'DECLINED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ConsentAuthority" AS ENUM ('ELDER', 'AUTHORIZED_REPRESENTATIVE', 'LEGAL_BASIS');

-- CreateEnum
CREATE TYPE "PreferredTextScale" AS ENUM ('STANDARD', 'LARGE', 'EXTRA_LARGE');

-- CreateEnum
CREATE TYPE "PreferredInputMode" AS ENUM ('TOUCH', 'VOICE', 'HUMAN_ASSISTED');

-- CreateEnum
CREATE TYPE "SpeakingPace" AS ENUM ('SLOW', 'STANDARD');

-- CreateEnum
CREATE TYPE "CommunicationChannel" AS ENUM ('VOICE', 'TEXT', 'IN_PERSON');

-- CreateEnum
CREATE TYPE "StaffStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TeamStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TeamMembershipRole" AS ENUM ('MEMBER', 'LEAD');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ShiftAssignmentStatus" AS ENUM ('ASSIGNED', 'ACCEPTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ShiftScopeKind" AS ENUM ('FACILITY', 'FLOOR', 'ZONE');

-- CreateEnum
CREATE TYPE "ElderCareAssignmentRole" AS ENUM ('PRIMARY', 'SUPPORT');

-- CreateEnum
CREATE TYPE "TimelineVisibility" AS ENUM ('INTERNAL', 'ELDER_VISIBLE', 'FAMILY_ELIGIBLE');

-- CreateEnum
CREATE TYPE "FamilyShareableField" AS ENUM ('PREFERRED_NAME', 'CURRENT_RESIDENCE', 'CARE_LEVEL', 'ACCESSIBILITY_SUMMARY', 'COMMUNICATION_PREFERENCE', 'PERSONAL_BASELINE_SUMMARY', 'CONSENT_SUMMARY', 'TIMELINE_SUMMARY');

-- CreateEnum
CREATE TYPE "EventActorType" AS ENUM ('USER', 'SYSTEM', 'DEVICE', 'AGENT');

-- CreateEnum
CREATE TYPE "EventPrivacyClass" AS ENUM ('OPERATIONS', 'SENSITIVE', 'HIGHLY_SENSITIVE');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PUBLISHED', 'FAILED');

-- CreateTable
CREATE TABLE "buildings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "status" "FacilityStructureStatus" NOT NULL DEFAULT 'ACTIVE',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "buildings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "floors" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "building_id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "level_number" INTEGER NOT NULL,
    "status" "FacilityStructureStatus" NOT NULL DEFAULT 'ACTIVE',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "floors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zones" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "floor_id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "status" "FacilityStructureStatus" NOT NULL DEFAULT 'ACTIVE',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "floor_id" UUID NOT NULL,
    "zone_id" UUID,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "status" "FacilityStructureStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "beds" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "label" VARCHAR(160) NOT NULL,
    "operational_status" "BedOperationalStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "beds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care_levels" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "rank" INTEGER NOT NULL,
    "description" VARCHAR(1000),
    "status" "CareLevelStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "care_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "elders" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "portal_user_id" UUID,
    "record_number" VARCHAR(64) NOT NULL,
    "display_name" VARCHAR(160) NOT NULL,
    "preferred_name" VARCHAR(80),
    "birth_date" DATE,
    "current_care_level_id" UUID,
    "status" "ElderRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "elders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admission_records" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "elder_id" UUID NOT NULL,
    "admission_number" VARCHAR(64) NOT NULL,
    "status" "AdmissionStatus" NOT NULL DEFAULT 'ADMITTED',
    "admitted_at" TIMESTAMPTZ(3) NOT NULL,
    "discharged_at" TIMESTAMPTZ(3),
    "admission_reason_code" VARCHAR(64),
    "discharge_reason_code" VARCHAR(64),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "admission_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "elder_stays" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "admission_record_id" UUID,
    "elder_id" UUID NOT NULL,
    "bed_id" UUID NOT NULL,
    "previous_stay_id" UUID,
    "status" "ElderStayStatus" NOT NULL DEFAULT 'PLANNED',
    "admitted_at" TIMESTAMPTZ(3) NOT NULL,
    "discharged_at" TIMESTAMPTZ(3),
    "admission_reason_code" VARCHAR(64),
    "discharge_reason_code" VARCHAR(64),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "elder_stays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_relationships" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "elder_id" UUID NOT NULL,
    "family_user_id" UUID NOT NULL,
    "relationship_kind" "FamilyRelationshipType" NOT NULL,
    "relationship_label" VARCHAR(80),
    "status" "RelationshipVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "active_from" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active_until" TIMESTAMPTZ(3),
    "verified_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "verified_by_user_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "family_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_contacts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "elder_id" UUID NOT NULL,
    "family_relationship_id" UUID,
    "display_name" VARCHAR(160) NOT NULL,
    "relationship_label" VARCHAR(80) NOT NULL,
    "contact_value" VARCHAR(160) NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "emergency_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accessibility_profiles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "elder_id" UUID NOT NULL,
    "preferred_text_scale" "PreferredTextScale" NOT NULL DEFAULT 'STANDARD',
    "high_contrast" BOOLEAN NOT NULL DEFAULT false,
    "reduced_motion" BOOLEAN NOT NULL DEFAULT false,
    "hearing_support" BOOLEAN NOT NULL DEFAULT false,
    "vision_support" BOOLEAN NOT NULL DEFAULT false,
    "mobility_support" BOOLEAN NOT NULL DEFAULT false,
    "preferred_input_mode" "PreferredInputMode" NOT NULL DEFAULT 'TOUCH',
    "human_handoff_preferred" BOOLEAN NOT NULL DEFAULT false,
    "notes" VARCHAR(2000),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "accessibility_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_preferences" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "elder_id" UUID NOT NULL,
    "preferred_language" VARCHAR(35) NOT NULL DEFAULT 'zh-CN',
    "speaking_pace" "SpeakingPace" NOT NULL DEFAULT 'STANDARD',
    "repeat_key_information" BOOLEAN NOT NULL DEFAULT false,
    "preferred_channel" "CommunicationChannel" NOT NULL DEFAULT 'IN_PERSON',
    "quiet_hours_start" TIME(0),
    "quiet_hours_end" TIME(0),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "communication_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personal_baselines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "elder_id" UUID NOT NULL,
    "baseline_key" VARCHAR(64) NOT NULL,
    "domain" "PersonalBaselineDomain" NOT NULL,
    "value" VARCHAR(2000) NOT NULL,
    "source_kind" "BaselineSource" NOT NULL,
    "source_user_id" UUID,
    "confirmed_by_staff_profile_id" UUID,
    "inference_method" VARCHAR(160),
    "confidence" DOUBLE PRECISION,
    "observed_at" TIMESTAMPTZ(3) NOT NULL,
    "valid_from" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "superseded_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "personal_baselines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_records" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "elder_id" UUID NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL,
    "decision" "ConsentDecision" NOT NULL,
    "authority" "ConsentAuthority" NOT NULL,
    "consent_version" INTEGER NOT NULL,
    "effective_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3),
    "superseded_at" TIMESTAMPTZ(3),
    "reason_code" VARCHAR(64),
    "recorded_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sharing_preferences" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "elder_id" UUID NOT NULL,
    "family_relationship_id" UUID NOT NULL,
    "consent_record_id" UUID,
    "field" "FamilyShareableField" NOT NULL,
    "allowed" BOOLEAN NOT NULL,
    "valid_from" TIMESTAMPTZ(3) NOT NULL,
    "valid_until" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sharing_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_profiles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "employee_code" VARCHAR(64) NOT NULL,
    "display_name" VARCHAR(160) NOT NULL,
    "job_title" VARCHAR(120) NOT NULL,
    "status" "StaffStatus" NOT NULL DEFAULT 'ACTIVE',
    "hired_at" DATE,
    "ended_at" DATE,
    "primary_team_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "staff_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" VARCHAR(1000),
    "status" "TeamStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_memberships" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "staff_profile_id" UUID NOT NULL,
    "role" "TeamMembershipRole" NOT NULL DEFAULT 'MEMBER',
    "active_from" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active_until" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "team_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "team_id" UUID,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "ShiftStatus" NOT NULL DEFAULT 'SCHEDULED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_assignments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "shift_id" UUID NOT NULL,
    "staff_profile_id" UUID NOT NULL,
    "status" "ShiftAssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shift_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_assignment_scopes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "shift_assignment_id" UUID NOT NULL,
    "kind" "ShiftScopeKind" NOT NULL,
    "floor_id" UUID,
    "zone_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shift_assignment_scopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "elder_care_assignments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "shift_assignment_id" UUID NOT NULL,
    "elder_id" UUID NOT NULL,
    "role" "ElderCareAssignmentRole" NOT NULL DEFAULT 'PRIMARY',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "elder_care_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "elder_timeline_entries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "elder_id" UUID NOT NULL,
    "event_type" VARCHAR(64) NOT NULL,
    "source_resource_type" VARCHAR(64) NOT NULL,
    "source_resource_id" VARCHAR(128) NOT NULL,
    "visibility" "TimelineVisibility" NOT NULL,
    "safe_summary_code" VARCHAR(64) NOT NULL,
    "safe_metadata" JSONB NOT NULL DEFAULT '{}',
    "actor_user_id" UUID,
    "correlation_id" VARCHAR(128) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "elder_timeline_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "event_id" VARCHAR(26) NOT NULL,
    "event_type" VARCHAR(128) NOT NULL,
    "schema_version" VARCHAR(16) NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID,
    "aggregate_type" VARCHAR(64) NOT NULL,
    "aggregate_id" VARCHAR(128) NOT NULL,
    "aggregate_version" INTEGER NOT NULL,
    "actor_type" "EventActorType" NOT NULL,
    "actor_id" VARCHAR(128) NOT NULL,
    "correlation_id" VARCHAR(128) NOT NULL,
    "causation_id" VARCHAR(26),
    "idempotency_key" VARCHAR(192) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "privacy_class" "EventPrivacyClass" NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(3),
    "last_error_code" VARCHAR(96),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("event_id")
);

-- CreateIndex
CREATE INDEX "buildings_organization_id_facility_id_status_sort_order_idx" ON "buildings"("organization_id", "facility_id", "status", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "buildings_facility_id_code_key" ON "buildings"("facility_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "buildings_id_organization_id_facility_id_key" ON "buildings"("id", "organization_id", "facility_id");

-- CreateIndex
CREATE INDEX "floors_organization_id_facility_id_status_sort_order_idx" ON "floors"("organization_id", "facility_id", "status", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "floors_building_id_code_key" ON "floors"("building_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "floors_building_id_level_number_key" ON "floors"("building_id", "level_number");

-- CreateIndex
CREATE UNIQUE INDEX "floors_id_organization_id_facility_id_key" ON "floors"("id", "organization_id", "facility_id");

-- CreateIndex
CREATE INDEX "zones_organization_id_facility_id_status_sort_order_idx" ON "zones"("organization_id", "facility_id", "status", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "zones_floor_id_code_key" ON "zones"("floor_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "zones_id_organization_id_facility_id_floor_id_key" ON "zones"("id", "organization_id", "facility_id", "floor_id");

-- CreateIndex
CREATE INDEX "rooms_organization_id_facility_id_zone_id_status_idx" ON "rooms"("organization_id", "facility_id", "zone_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_floor_id_code_key" ON "rooms"("floor_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_id_organization_id_facility_id_key" ON "rooms"("id", "organization_id", "facility_id");

-- CreateIndex
CREATE INDEX "beds_organization_id_facility_id_operational_status_idx" ON "beds"("organization_id", "facility_id", "operational_status");

-- CreateIndex
CREATE UNIQUE INDEX "beds_room_id_code_key" ON "beds"("room_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "beds_id_organization_id_facility_id_key" ON "beds"("id", "organization_id", "facility_id");

-- CreateIndex
CREATE INDEX "care_levels_organization_id_facility_id_status_idx" ON "care_levels"("organization_id", "facility_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "care_levels_facility_id_code_key" ON "care_levels"("facility_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "care_levels_facility_id_rank_key" ON "care_levels"("facility_id", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "care_levels_id_organization_id_facility_id_key" ON "care_levels"("id", "organization_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "elders_portal_user_id_key" ON "elders"("portal_user_id");

-- CreateIndex
CREATE INDEX "elders_organization_id_facility_id_status_idx" ON "elders"("organization_id", "facility_id", "status");

-- CreateIndex
CREATE INDEX "elders_display_name_idx" ON "elders"("display_name");

-- CreateIndex
CREATE UNIQUE INDEX "elders_facility_id_record_number_key" ON "elders"("facility_id", "record_number");

-- CreateIndex
CREATE UNIQUE INDEX "elders_id_organization_id_facility_id_key" ON "elders"("id", "organization_id", "facility_id");

-- CreateIndex
CREATE INDEX "admission_records_organization_id_facility_id_status_idx" ON "admission_records"("organization_id", "facility_id", "status");

-- CreateIndex
CREATE INDEX "admission_records_elder_id_admitted_at_idx" ON "admission_records"("elder_id", "admitted_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "admission_records_facility_id_admission_number_key" ON "admission_records"("facility_id", "admission_number");

-- CreateIndex
CREATE UNIQUE INDEX "admission_records_id_elder_id_organization_id_facility_id_key" ON "admission_records"("id", "elder_id", "organization_id", "facility_id");

-- CreateIndex
CREATE INDEX "elder_stays_bed_id_admitted_at_discharged_at_idx" ON "elder_stays"("bed_id", "admitted_at", "discharged_at");

-- CreateIndex
CREATE INDEX "elder_stays_elder_id_admitted_at_discharged_at_idx" ON "elder_stays"("elder_id", "admitted_at", "discharged_at");

-- CreateIndex
CREATE INDEX "elder_stays_admission_record_id_admitted_at_idx" ON "elder_stays"("admission_record_id", "admitted_at");

-- CreateIndex
CREATE UNIQUE INDEX "elder_stays_id_elder_id_organization_id_facility_id_key" ON "elder_stays"("id", "elder_id", "organization_id", "facility_id");

-- CreateIndex
CREATE INDEX "family_relationships_family_user_id_status_active_until_idx" ON "family_relationships"("family_user_id", "status", "active_until");

-- CreateIndex
CREATE INDEX "family_relationships_organization_id_facility_id_status_idx" ON "family_relationships"("organization_id", "facility_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "family_relationships_elder_id_family_user_id_key" ON "family_relationships"("elder_id", "family_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "family_relationships_id_elder_id_organization_id_facility_i_key" ON "family_relationships"("id", "elder_id", "organization_id", "facility_id");

-- CreateIndex
CREATE INDEX "emergency_contacts_organization_id_facility_id_elder_id_act_idx" ON "emergency_contacts"("organization_id", "facility_id", "elder_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_contacts_elder_id_priority_key" ON "emergency_contacts"("elder_id", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "accessibility_profiles_elder_id_key" ON "accessibility_profiles"("elder_id");

-- CreateIndex
CREATE INDEX "accessibility_profiles_organization_id_facility_id_idx" ON "accessibility_profiles"("organization_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "accessibility_profiles_elder_id_organization_id_facility_id_key" ON "accessibility_profiles"("elder_id", "organization_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "communication_preferences_elder_id_key" ON "communication_preferences"("elder_id");

-- CreateIndex
CREATE INDEX "communication_preferences_organization_id_facility_id_idx" ON "communication_preferences"("organization_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "communication_preferences_elder_id_organization_id_facility_key" ON "communication_preferences"("elder_id", "organization_id", "facility_id");

-- CreateIndex
CREATE INDEX "personal_baselines_elder_id_domain_baseline_key_superseded__idx" ON "personal_baselines"("elder_id", "domain", "baseline_key", "superseded_at");

-- CreateIndex
CREATE INDEX "personal_baselines_organization_id_facility_id_source_kind_idx" ON "personal_baselines"("organization_id", "facility_id", "source_kind");

-- CreateIndex
CREATE INDEX "consent_records_organization_id_facility_id_purpose_decisio_idx" ON "consent_records"("organization_id", "facility_id", "purpose", "decision");

-- CreateIndex
CREATE UNIQUE INDEX "consent_records_elder_id_purpose_consent_version_key" ON "consent_records"("elder_id", "purpose", "consent_version");

-- CreateIndex
CREATE UNIQUE INDEX "consent_records_id_elder_id_organization_id_facility_id_key" ON "consent_records"("id", "elder_id", "organization_id", "facility_id");

-- CreateIndex
CREATE INDEX "sharing_preferences_elder_id_family_relationship_id_valid_u_idx" ON "sharing_preferences"("elder_id", "family_relationship_id", "valid_until");

-- CreateIndex
CREATE INDEX "sharing_preferences_organization_id_facility_id_field_idx" ON "sharing_preferences"("organization_id", "facility_id", "field");

-- CreateIndex
CREATE UNIQUE INDEX "sharing_preferences_family_relationship_id_field_version_key" ON "sharing_preferences"("family_relationship_id", "field", "version");

-- CreateIndex
CREATE INDEX "staff_profiles_organization_id_facility_id_status_idx" ON "staff_profiles"("organization_id", "facility_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "staff_profiles_facility_id_employee_code_key" ON "staff_profiles"("facility_id", "employee_code");

-- CreateIndex
CREATE UNIQUE INDEX "staff_profiles_facility_id_user_id_key" ON "staff_profiles"("facility_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_profiles_id_organization_id_facility_id_key" ON "staff_profiles"("id", "organization_id", "facility_id");

-- CreateIndex
CREATE INDEX "teams_organization_id_facility_id_status_idx" ON "teams"("organization_id", "facility_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "teams_facility_id_code_key" ON "teams"("facility_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "teams_id_organization_id_facility_id_key" ON "teams"("id", "organization_id", "facility_id");

-- CreateIndex
CREATE INDEX "team_memberships_team_id_active_until_idx" ON "team_memberships"("team_id", "active_until");

-- CreateIndex
CREATE INDEX "team_memberships_staff_profile_id_active_until_idx" ON "team_memberships"("staff_profile_id", "active_until");

-- CreateIndex
CREATE INDEX "shifts_organization_id_facility_id_starts_at_ends_at_idx" ON "shifts"("organization_id", "facility_id", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "shifts_team_id_starts_at_idx" ON "shifts"("team_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "shifts_facility_id_code_key" ON "shifts"("facility_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "shifts_id_organization_id_facility_id_key" ON "shifts"("id", "organization_id", "facility_id");

-- CreateIndex
CREATE INDEX "shift_assignments_staff_profile_id_status_idx" ON "shift_assignments"("staff_profile_id", "status");

-- CreateIndex
CREATE INDEX "shift_assignments_organization_id_facility_id_status_idx" ON "shift_assignments"("organization_id", "facility_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "shift_assignments_shift_id_staff_profile_id_key" ON "shift_assignments"("shift_id", "staff_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "shift_assignments_id_organization_id_facility_id_key" ON "shift_assignments"("id", "organization_id", "facility_id");

-- CreateIndex
CREATE INDEX "shift_assignment_scopes_shift_assignment_id_kind_idx" ON "shift_assignment_scopes"("shift_assignment_id", "kind");

-- CreateIndex
CREATE INDEX "shift_assignment_scopes_organization_id_facility_id_floor_i_idx" ON "shift_assignment_scopes"("organization_id", "facility_id", "floor_id", "zone_id");

-- CreateIndex
CREATE INDEX "elder_care_assignments_elder_id_role_idx" ON "elder_care_assignments"("elder_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "elder_care_assignments_shift_assignment_id_elder_id_key" ON "elder_care_assignments"("shift_assignment_id", "elder_id");

-- CreateIndex
CREATE INDEX "elder_timeline_entries_elder_id_occurred_at_idx" ON "elder_timeline_entries"("elder_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "elder_timeline_entries_organization_id_facility_id_event_ty_idx" ON "elder_timeline_entries"("organization_id", "facility_id", "event_type", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "elder_timeline_entries_correlation_id_idx" ON "elder_timeline_entries"("correlation_id");

-- CreateIndex
CREATE INDEX "outbox_events_status_available_at_idx" ON "outbox_events"("status", "available_at");

-- CreateIndex
CREATE INDEX "outbox_events_aggregate_type_aggregate_id_aggregate_version_idx" ON "outbox_events"("aggregate_type", "aggregate_id", "aggregate_version");

-- CreateIndex
CREATE INDEX "outbox_events_correlation_id_idx" ON "outbox_events"("correlation_id");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_organization_id_event_type_idempotency_key_key" ON "outbox_events"("organization_id", "event_type", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "data_scopes_id_organization_id_facility_id_key" ON "data_scopes"("id", "organization_id", "facility_id");

-- AddForeignKey
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floors" ADD CONSTRAINT "floors_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floors" ADD CONSTRAINT "floors_building_id_organization_id_facility_id_fkey" FOREIGN KEY ("building_id", "organization_id", "facility_id") REFERENCES "buildings"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zones" ADD CONSTRAINT "zones_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zones" ADD CONSTRAINT "zones_floor_id_organization_id_facility_id_fkey" FOREIGN KEY ("floor_id", "organization_id", "facility_id") REFERENCES "floors"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_floor_id_organization_id_facility_id_fkey" FOREIGN KEY ("floor_id", "organization_id", "facility_id") REFERENCES "floors"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_zone_id_organization_id_facility_id_floor_id_fkey" FOREIGN KEY ("zone_id", "organization_id", "facility_id", "floor_id") REFERENCES "zones"("id", "organization_id", "facility_id", "floor_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beds" ADD CONSTRAINT "beds_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beds" ADD CONSTRAINT "beds_room_id_organization_id_facility_id_fkey" FOREIGN KEY ("room_id", "organization_id", "facility_id") REFERENCES "rooms"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_levels" ADD CONSTRAINT "care_levels_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "elders" ADD CONSTRAINT "elders_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "elders" ADD CONSTRAINT "elders_portal_user_id_fkey" FOREIGN KEY ("portal_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "elders" ADD CONSTRAINT "elders_current_care_level_id_organization_id_facility_id_fkey" FOREIGN KEY ("current_care_level_id", "organization_id", "facility_id") REFERENCES "care_levels"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_records" ADD CONSTRAINT "admission_records_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_records" ADD CONSTRAINT "admission_records_elder_id_organization_id_facility_id_fkey" FOREIGN KEY ("elder_id", "organization_id", "facility_id") REFERENCES "elders"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "elder_stays" ADD CONSTRAINT "elder_stays_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "elder_stays" ADD CONSTRAINT "elder_stays_admission_record_id_elder_id_organization_id_f_fkey" FOREIGN KEY ("admission_record_id", "elder_id", "organization_id", "facility_id") REFERENCES "admission_records"("id", "elder_id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "elder_stays" ADD CONSTRAINT "elder_stays_elder_id_organization_id_facility_id_fkey" FOREIGN KEY ("elder_id", "organization_id", "facility_id") REFERENCES "elders"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "elder_stays" ADD CONSTRAINT "elder_stays_bed_id_organization_id_facility_id_fkey" FOREIGN KEY ("bed_id", "organization_id", "facility_id") REFERENCES "beds"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "elder_stays" ADD CONSTRAINT "elder_stays_previous_stay_id_elder_id_organization_id_faci_fkey" FOREIGN KEY ("previous_stay_id", "elder_id", "organization_id", "facility_id") REFERENCES "elder_stays"("id", "elder_id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_relationships" ADD CONSTRAINT "family_relationships_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_relationships" ADD CONSTRAINT "family_relationships_elder_id_organization_id_facility_id_fkey" FOREIGN KEY ("elder_id", "organization_id", "facility_id") REFERENCES "elders"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_relationships" ADD CONSTRAINT "family_relationships_family_user_id_fkey" FOREIGN KEY ("family_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_relationships" ADD CONSTRAINT "family_relationships_verified_by_user_id_fkey" FOREIGN KEY ("verified_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_contacts" ADD CONSTRAINT "emergency_contacts_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_contacts" ADD CONSTRAINT "emergency_contacts_elder_id_organization_id_facility_id_fkey" FOREIGN KEY ("elder_id", "organization_id", "facility_id") REFERENCES "elders"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_contacts" ADD CONSTRAINT "emergency_contacts_family_relationship_id_elder_id_organiz_fkey" FOREIGN KEY ("family_relationship_id", "elder_id", "organization_id", "facility_id") REFERENCES "family_relationships"("id", "elder_id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accessibility_profiles" ADD CONSTRAINT "accessibility_profiles_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accessibility_profiles" ADD CONSTRAINT "accessibility_profiles_elder_id_organization_id_facility_i_fkey" FOREIGN KEY ("elder_id", "organization_id", "facility_id") REFERENCES "elders"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_preferences" ADD CONSTRAINT "communication_preferences_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_preferences" ADD CONSTRAINT "communication_preferences_elder_id_organization_id_facilit_fkey" FOREIGN KEY ("elder_id", "organization_id", "facility_id") REFERENCES "elders"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_baselines" ADD CONSTRAINT "personal_baselines_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_baselines" ADD CONSTRAINT "personal_baselines_elder_id_organization_id_facility_id_fkey" FOREIGN KEY ("elder_id", "organization_id", "facility_id") REFERENCES "elders"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_baselines" ADD CONSTRAINT "personal_baselines_source_user_id_fkey" FOREIGN KEY ("source_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_baselines" ADD CONSTRAINT "personal_baselines_confirmed_by_staff_profile_id_organizat_fkey" FOREIGN KEY ("confirmed_by_staff_profile_id", "organization_id", "facility_id") REFERENCES "staff_profiles"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_elder_id_organization_id_facility_id_fkey" FOREIGN KEY ("elder_id", "organization_id", "facility_id") REFERENCES "elders"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sharing_preferences" ADD CONSTRAINT "sharing_preferences_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sharing_preferences" ADD CONSTRAINT "sharing_preferences_family_relationship_id_elder_id_organi_fkey" FOREIGN KEY ("family_relationship_id", "elder_id", "organization_id", "facility_id") REFERENCES "family_relationships"("id", "elder_id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sharing_preferences" ADD CONSTRAINT "sharing_preferences_consent_record_id_elder_id_organizatio_fkey" FOREIGN KEY ("consent_record_id", "elder_id", "organization_id", "facility_id") REFERENCES "consent_records"("id", "elder_id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_primary_team_id_organization_id_facility_id_fkey" FOREIGN KEY ("primary_team_id", "organization_id", "facility_id") REFERENCES "teams"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_team_id_organization_id_facility_id_fkey" FOREIGN KEY ("team_id", "organization_id", "facility_id") REFERENCES "teams"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_staff_profile_id_organization_id_facility_fkey" FOREIGN KEY ("staff_profile_id", "organization_id", "facility_id") REFERENCES "staff_profiles"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_team_id_organization_id_facility_id_fkey" FOREIGN KEY ("team_id", "organization_id", "facility_id") REFERENCES "teams"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_shift_id_organization_id_facility_id_fkey" FOREIGN KEY ("shift_id", "organization_id", "facility_id") REFERENCES "shifts"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_staff_profile_id_organization_id_facilit_fkey" FOREIGN KEY ("staff_profile_id", "organization_id", "facility_id") REFERENCES "staff_profiles"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_assignment_scopes" ADD CONSTRAINT "shift_assignment_scopes_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_assignment_scopes" ADD CONSTRAINT "shift_assignment_scopes_shift_assignment_id_organization_i_fkey" FOREIGN KEY ("shift_assignment_id", "organization_id", "facility_id") REFERENCES "shift_assignments"("id", "organization_id", "facility_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_assignment_scopes" ADD CONSTRAINT "shift_assignment_scopes_floor_id_organization_id_facility__fkey" FOREIGN KEY ("floor_id", "organization_id", "facility_id") REFERENCES "floors"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_assignment_scopes" ADD CONSTRAINT "shift_assignment_scopes_zone_id_organization_id_facility_i_fkey" FOREIGN KEY ("zone_id", "organization_id", "facility_id", "floor_id") REFERENCES "zones"("id", "organization_id", "facility_id", "floor_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "elder_care_assignments" ADD CONSTRAINT "elder_care_assignments_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "elder_care_assignments" ADD CONSTRAINT "elder_care_assignments_shift_assignment_id_organization_id_fkey" FOREIGN KEY ("shift_assignment_id", "organization_id", "facility_id") REFERENCES "shift_assignments"("id", "organization_id", "facility_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "elder_care_assignments" ADD CONSTRAINT "elder_care_assignments_elder_id_organization_id_facility_i_fkey" FOREIGN KEY ("elder_id", "organization_id", "facility_id") REFERENCES "elders"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "elder_timeline_entries" ADD CONSTRAINT "elder_timeline_entries_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "elder_timeline_entries" ADD CONSTRAINT "elder_timeline_entries_elder_id_organization_id_facility_i_fkey" FOREIGN KEY ("elder_id", "organization_id", "facility_id") REFERENCES "elders"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "elder_timeline_entries" ADD CONSTRAINT "elder_timeline_entries_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain checks that Prisma cannot express.
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_values_check"
  CHECK ("sort_order" >= 0 AND "version" >= 1);
ALTER TABLE "floors" ADD CONSTRAINT "floors_values_check"
  CHECK ("level_number" BETWEEN -20 AND 300 AND "sort_order" >= 0 AND "version" >= 1);
ALTER TABLE "zones" ADD CONSTRAINT "zones_values_check"
  CHECK ("sort_order" >= 0 AND "version" >= 1);
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_values_check" CHECK ("version" >= 1);
ALTER TABLE "beds" ADD CONSTRAINT "beds_values_check" CHECK ("version" >= 1);
ALTER TABLE "care_levels" ADD CONSTRAINT "care_levels_values_check"
  CHECK ("rank" BETWEEN 0 AND 100 AND "version" >= 1);
ALTER TABLE "elders" ADD CONSTRAINT "elders_values_check" CHECK ("version" >= 1);

ALTER TABLE "admission_records" ADD CONSTRAINT "admission_records_values_check"
  CHECK (
    "version" >= 1
    AND ("discharged_at" IS NULL OR "discharged_at" > "admitted_at")
    AND ("status" <> 'ADMITTED' OR ("discharged_at" IS NULL AND "discharge_reason_code" IS NULL))
    AND ("status" <> 'DISCHARGED' OR "discharged_at" IS NOT NULL)
  );
ALTER TABLE "elder_stays" ADD CONSTRAINT "elder_stays_values_check"
  CHECK (
    "version" >= 1
    AND ("previous_stay_id" IS NULL OR "previous_stay_id" <> "id")
    AND ("discharged_at" IS NULL OR "discharged_at" > "admitted_at")
    AND ("status" NOT IN ('PLANNED', 'ACTIVE') OR ("discharged_at" IS NULL AND "discharge_reason_code" IS NULL))
    AND ("status" <> 'DISCHARGED' OR "discharged_at" IS NOT NULL)
  );

ALTER TABLE "family_relationships" ADD CONSTRAINT "family_relationships_values_check"
  CHECK (
    "version" >= 1
    AND ("active_until" IS NULL OR "active_until" > "active_from")
    AND ("relationship_kind" <> 'OTHER' OR NULLIF(BTRIM("relationship_label"), '') IS NOT NULL)
    AND ("status" <> 'VERIFIED' OR "verified_at" IS NOT NULL)
    AND ("status" <> 'REVOKED' OR "revoked_at" IS NOT NULL)
  );
ALTER TABLE "emergency_contacts" ADD CONSTRAINT "emergency_contacts_values_check"
  CHECK (
    "version" >= 1
    AND "priority" BETWEEN 1 AND 20
    AND CHAR_LENGTH(BTRIM("contact_value")) >= 3
    AND (NOT "is_primary" OR "active")
  );
ALTER TABLE "accessibility_profiles" ADD CONSTRAINT "accessibility_profiles_values_check"
  CHECK ("version" >= 1);
ALTER TABLE "communication_preferences" ADD CONSTRAINT "communication_preferences_values_check"
  CHECK (
    "version" >= 1
    AND (("quiet_hours_start" IS NULL AND "quiet_hours_end" IS NULL)
      OR ("quiet_hours_start" IS NOT NULL AND "quiet_hours_end" IS NOT NULL))
  );
ALTER TABLE "personal_baselines" ADD CONSTRAINT "personal_baselines_values_check"
  CHECK (
    "version" >= 1
    AND ("superseded_at" IS NULL OR "superseded_at" > "valid_from")
    AND (
      ("source_kind" = 'ELDER_STATED'
        AND "source_user_id" IS NOT NULL
        AND "confirmed_by_staff_profile_id" IS NULL
        AND "inference_method" IS NULL
        AND "confidence" IS NULL)
      OR ("source_kind" = 'STAFF_CONFIRMED'
        AND "confirmed_by_staff_profile_id" IS NOT NULL
        AND "inference_method" IS NULL
        AND "confidence" IS NULL)
      OR ("source_kind" = 'INFERRED'
        AND "inference_method" IS NOT NULL
        AND "confidence" BETWEEN 0 AND 1)
    )
  );
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_values_check"
  CHECK (
    "consent_version" >= 1
    AND ("expires_at" IS NULL OR "expires_at" > "effective_at")
    AND ("superseded_at" IS NULL OR "superseded_at" > "effective_at")
  );
ALTER TABLE "sharing_preferences" ADD CONSTRAINT "sharing_preferences_values_check"
  CHECK (
    "version" >= 1
    AND ("valid_until" IS NULL OR "valid_until" > "valid_from")
    AND (NOT "allowed" OR "consent_record_id" IS NOT NULL)
  );

ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_values_check"
  CHECK ("version" >= 1 AND ("hired_at" IS NULL OR "ended_at" IS NULL OR "ended_at" >= "hired_at"));
ALTER TABLE "teams" ADD CONSTRAINT "teams_values_check" CHECK ("version" >= 1);
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_values_check"
  CHECK ("version" >= 1 AND ("active_until" IS NULL OR "active_until" > "active_from"));
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_values_check"
  CHECK ("version" >= 1 AND "ends_at" > "starts_at");
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_values_check"
  CHECK ("version" >= 1);
ALTER TABLE "shift_assignment_scopes" ADD CONSTRAINT "shift_assignment_scopes_values_check"
  CHECK (
    ("kind" = 'FACILITY' AND "floor_id" IS NULL AND "zone_id" IS NULL)
    OR ("kind" = 'FLOOR' AND "floor_id" IS NOT NULL AND "zone_id" IS NULL)
    OR ("kind" = 'ZONE' AND "floor_id" IS NOT NULL AND "zone_id" IS NOT NULL)
  );
ALTER TABLE "elder_care_assignments" ADD CONSTRAINT "elder_care_assignments_values_check"
  CHECK ("version" >= 1);
ALTER TABLE "elder_timeline_entries" ADD CONSTRAINT "elder_timeline_entries_values_check"
  CHECK (jsonb_typeof("safe_metadata") = 'object');
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_values_check"
  CHECK (
    "event_id" ~ '^[0-9A-HJKMNP-TV-Z]{26}$'
    AND ("causation_id" IS NULL OR "causation_id" ~ '^[0-9A-HJKMNP-TV-Z]{26}$')
    AND "aggregate_version" >= 1
    AND "attempts" >= 0
    AND jsonb_typeof("payload") = 'object'
    AND ("status" <> 'PUBLISHED' OR "published_at" IS NOT NULL)
  );

-- Current-value uniqueness preserves history while preventing ambiguous reads.
CREATE UNIQUE INDEX "admission_records_one_open_per_elder_key"
  ON "admission_records"("elder_id") WHERE "status" = 'ADMITTED';
CREATE UNIQUE INDEX "elder_stays_one_open_per_bed_key"
  ON "elder_stays"("bed_id") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "elder_stays_one_open_per_elder_key"
  ON "elder_stays"("elder_id") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "emergency_contacts_one_active_primary_key"
  ON "emergency_contacts"("elder_id") WHERE "is_primary" AND "active";
CREATE UNIQUE INDEX "personal_baselines_current_key"
  ON "personal_baselines"("elder_id", "domain", "baseline_key") WHERE "superseded_at" IS NULL;
CREATE UNIQUE INDEX "consent_records_current_purpose_key"
  ON "consent_records"("elder_id", "purpose") WHERE "superseded_at" IS NULL;
CREATE UNIQUE INDEX "sharing_preferences_current_field_key"
  ON "sharing_preferences"("family_relationship_id", "field") WHERE "valid_until" IS NULL;
CREATE UNIQUE INDEX "team_memberships_current_member_key"
  ON "team_memberships"("team_id", "staff_profile_id") WHERE "active_until" IS NULL;
CREATE UNIQUE INDEX "shift_assignment_scopes_one_facility_key"
  ON "shift_assignment_scopes"("shift_assignment_id") WHERE "kind" = 'FACILITY';
CREATE UNIQUE INDEX "shift_assignment_scopes_floor_key"
  ON "shift_assignment_scopes"("shift_assignment_id", "floor_id") WHERE "kind" = 'FLOOR';
CREATE UNIQUE INDEX "shift_assignment_scopes_zone_key"
  ON "shift_assignment_scopes"("shift_assignment_id", "zone_id") WHERE "kind" = 'ZONE';

-- Occupancy intervals are enforced for actual (non-cancelled/non-planned) stays.
ALTER TABLE "elder_stays" ADD CONSTRAINT "elder_stays_bed_time_no_overlap"
  EXCLUDE USING gist (
    "bed_id" WITH =,
    tstzrange("admitted_at", COALESCE("discharged_at", 'infinity'::timestamptz), '[)') WITH &&
  ) WHERE ("status" IN ('ACTIVE', 'DISCHARGED'))
  DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "elder_stays" ADD CONSTRAINT "elder_stays_elder_time_no_overlap"
  EXCLUDE USING gist (
    "elder_id" WITH =,
    tstzrange("admitted_at", COALESCE("discharged_at", 'infinity'::timestamptz), '[)') WITH &&
  ) WHERE ("status" IN ('ACTIVE', 'DISCHARGED'))
  DEFERRABLE INITIALLY IMMEDIATE;
