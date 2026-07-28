-- CreateEnum
CREATE TYPE "VoiceSubmissionPurpose" AS ENUM ('ELDER_REQUEST', 'WORK_ORDER_COMPLETION');

-- CreateEnum
CREATE TYPE "VoiceSubmissionStatus" AS ENUM ('UPLOAD_PENDING', 'UPLOADED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TranscriptStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "AIAnalysisStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "NeedSource" AS ENUM ('VOICE', 'MANUAL');

-- CreateEnum
CREATE TYPE "NeedCategory" AS ENUM ('DAILY_LIVING', 'HEALTH_CONCERN', 'EMERGENCY_CONCERN', 'EMOTIONAL_SUPPORT', 'FACILITY_SUPPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "NeedUrgency" AS ENUM ('ROUTINE', 'PRIORITY', 'IMMEDIATE_REVIEW');

-- CreateEnum
CREATE TYPE "NeedStatus" AS ENUM ('DRAFT', 'REVIEW_REQUIRED', 'CONFIRMED', 'REJECTED', 'FULFILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NeedLinkKind" AS ENUM ('SPLIT_SIBLING', 'RELATED', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('NEW', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkOrderAssignmentStatus" AS ENUM ('OFFERED', 'CLAIMED', 'RELEASED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CompletionNoteSource" AS ENUM ('TEXT', 'VOICE');

-- CreateEnum
CREATE TYPE "FamilySummaryStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'REVOKED');

-- CreateEnum
CREATE TYPE "RatingActorType" AS ENUM ('ELDER', 'FAMILY');

-- CreateTable
CREATE TABLE "voice_submissions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "elder_id" UUID NOT NULL,
    "work_order_id" UUID,
    "submitted_by_user_id" UUID NOT NULL,
    "purpose" "VoiceSubmissionPurpose" NOT NULL,
    "status" "VoiceSubmissionStatus" NOT NULL DEFAULT 'UPLOAD_PENDING',
    "bucket" VARCHAR(63) NOT NULL,
    "object_key" VARCHAR(512) NOT NULL,
    "upload_object_key" VARCHAR(512),
    "upload_authorized_until" TIMESTAMPTZ(3),
    "seal_candidate_object_key" VARCHAR(512),
    "seal_candidate_source_etag" VARCHAR(128),
    "seal_lease_token" UUID,
    "seal_lease_until" TIMESTAMPTZ(3),
    "mime_type" VARCHAR(96) NOT NULL,
    "declared_size_bytes" INTEGER NOT NULL,
    "actual_size_bytes" INTEGER,
    "checksum_sha256" CHAR(64),
    "fixture_key" VARCHAR(64),
    "failure_code" VARCHAR(64),
    "uploaded_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "retention_until" TIMESTAMPTZ(3) NOT NULL,
    "object_deletion_pending_at" TIMESTAMPTZ(3),
    "object_deleted_at" TIMESTAMPTZ(3),
    "idempotency_key" VARCHAR(128) NOT NULL,
    "correlation_id" VARCHAR(128) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "voice_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcripts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "elder_id" UUID NOT NULL,
    "voice_submission_id" UUID NOT NULL,
    "status" "TranscriptStatus" NOT NULL DEFAULT 'PENDING',
    "text" TEXT,
    "confidence" DOUBLE PRECISION,
    "duration_ms" INTEGER,
    "provider" VARCHAR(64) NOT NULL,
    "model" VARCHAR(96) NOT NULL,
    "provider_version" VARCHAR(64) NOT NULL,
    "failure_code" VARCHAR(64),
    "retention_until" TIMESTAMPTZ(3) NOT NULL,
    "content_deleted_at" TIMESTAMPTZ(3),
    "correlation_id" VARCHAR(128) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "transcripts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_analyses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "elder_id" UUID NOT NULL,
    "transcript_id" UUID NOT NULL,
    "status" "AIAnalysisStatus" NOT NULL DEFAULT 'PENDING',
    "output" JSONB,
    "confidence" DOUBLE PRECISION,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "provider" VARCHAR(64) NOT NULL,
    "model" VARCHAR(96) NOT NULL,
    "prompt_version" VARCHAR(64) NOT NULL,
    "schema_version" VARCHAR(64) NOT NULL,
    "failure_code" VARCHAR(64),
    "retention_until" TIMESTAMPTZ(3) NOT NULL,
    "content_deleted_at" TIMESTAMPTZ(3),
    "correlation_id" VARCHAR(128) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "ai_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "needs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "elder_id" UUID NOT NULL,
    "voice_submission_id" UUID,
    "ai_analysis_id" UUID,
    "source" "NeedSource" NOT NULL,
    "summary" VARCHAR(1000) NOT NULL,
    "category" "NeedCategory" NOT NULL,
    "urgency_suggestion" "NeedUrgency" NOT NULL,
    "priority" "NeedUrgency" NOT NULL,
    "requires_human_review" BOOLEAN NOT NULL DEFAULT false,
    "safety_rule_codes" JSONB NOT NULL DEFAULT '[]',
    "status" "NeedStatus" NOT NULL DEFAULT 'DRAFT',
    "reviewed_by_user_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "review_reason_code" VARCHAR(64),
    "idempotency_key" VARCHAR(128) NOT NULL,
    "correlation_id" VARCHAR(128) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "needs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "need_links" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "source_need_id" UUID NOT NULL,
    "target_need_id" UUID NOT NULL,
    "kind" "NeedLinkKind" NOT NULL,
    "correlation_id" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "need_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_orders" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "elder_id" UUID NOT NULL,
    "primary_need_id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "summary" VARCHAR(1000) NOT NULL,
    "priority" "NeedUrgency" NOT NULL,
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'NEW',
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "arrived_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "verified_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "correlation_id" VARCHAR(128) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_assignments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "target_team_id" UUID,
    "assignee_staff_profile_id" UUID,
    "shift_assignment_id" UUID,
    "status" "WorkOrderAssignmentStatus" NOT NULL DEFAULT 'OFFERED',
    "assigned_by_user_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" TIMESTAMPTZ(3),
    "released_at" TIMESTAMPTZ(3),
    "reason_code" VARCHAR(64) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "work_order_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_transitions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "from_status" "WorkOrderStatus",
    "to_status" "WorkOrderStatus" NOT NULL,
    "from_version" INTEGER NOT NULL,
    "to_version" INTEGER NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "reason_code" VARCHAR(64) NOT NULL,
    "correlation_id" VARCHAR(128) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_arrivals" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "from_version" INTEGER NOT NULL,
    "to_version" INTEGER NOT NULL,
    "reason_code" VARCHAR(64) NOT NULL,
    "arrived_at" TIMESTAMPTZ(3) NOT NULL,
    "correlation_id" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_arrivals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_completions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "elder_id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "submitted_by_staff_profile_id" UUID NOT NULL,
    "note_source" "CompletionNoteSource" NOT NULL,
    "note_text" TEXT,
    "voice_submission_id" UUID,
    "confirmed_at" TIMESTAMPTZ(3) NOT NULL,
    "completion_checklist" JSONB NOT NULL DEFAULT '{"schemaVersion":1,"required":false,"riskReasons":[],"expectedCodes":[],"confirmations":[]}'::jsonb,
    "checklist_confirmed_at" TIMESTAMPTZ(3),
    "correlation_id" VARCHAR(128) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "service_completions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_summaries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "elder_id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "status" "FamilySummaryStatus" NOT NULL DEFAULT 'DRAFT',
    "title" VARCHAR(160) NOT NULL,
    "summary" VARCHAR(1000) NOT NULL,
    "service_completed_at" TIMESTAMPTZ(3) NOT NULL,
    "published_at" TIMESTAMPTZ(3),
    "published_by_user_id" UUID,
    "correlation_id" VARCHAR(128) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "family_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ratings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "elder_id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "rater_user_id" UUID NOT NULL,
    "actor_type" "RatingActorType" NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" VARCHAR(1000),
    "requires_follow_up" BOOLEAN NOT NULL DEFAULT false,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "correlation_id" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ratings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "voice_submissions_elder_id_created_at_idx" ON "voice_submissions"("elder_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "voice_submissions_organization_id_facility_id_status_create_idx" ON "voice_submissions"("organization_id", "facility_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "voice_submissions_work_order_id_idx" ON "voice_submissions"("work_order_id");

-- CreateIndex
CREATE INDEX "voice_submissions_correlation_id_idx" ON "voice_submissions"("correlation_id");

-- CreateIndex
CREATE UNIQUE INDEX "voice_submissions_organization_id_idempotency_key_key" ON "voice_submissions"("organization_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "voice_submissions_organization_id_bucket_object_key_key" ON "voice_submissions"("organization_id", "bucket", "object_key");

-- CreateIndex
CREATE UNIQUE INDEX "voice_submissions_organization_id_bucket_upload_object_key_key" ON "voice_submissions"("organization_id", "bucket", "upload_object_key");

-- CreateIndex
CREATE UNIQUE INDEX "voice_submissions_organization_id_bucket_seal_candidate_key" ON "voice_submissions"("organization_id", "bucket", "seal_candidate_object_key");

-- CreateIndex
CREATE INDEX "voice_submissions_upload_authorized_until_upload_object_key_idx" ON "voice_submissions"("upload_authorized_until", "upload_object_key");

-- CreateIndex
CREATE INDEX "voice_submissions_seal_lease_until_seal_candidate_object_key_idx" ON "voice_submissions"("seal_lease_until", "seal_candidate_object_key");

-- CreateIndex
CREATE INDEX "voice_submissions_object_deletion_pending_at_object_deleted_at_idx" ON "voice_submissions"("object_deletion_pending_at", "object_deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "voice_submissions_id_organization_id_facility_id_key" ON "voice_submissions"("id", "organization_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "voice_submissions_id_elder_id_organization_id_facility_id_key" ON "voice_submissions"("id", "elder_id", "organization_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "transcripts_voice_submission_id_key" ON "transcripts"("voice_submission_id");

-- CreateIndex
CREATE INDEX "transcripts_organization_id_facility_id_status_created_at_idx" ON "transcripts"("organization_id", "facility_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "transcripts_elder_id_created_at_idx" ON "transcripts"("elder_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "transcripts_correlation_id_idx" ON "transcripts"("correlation_id");

-- CreateIndex
CREATE UNIQUE INDEX "transcripts_id_elder_id_organization_id_facility_id_key" ON "transcripts"("id", "elder_id", "organization_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "transcripts_voice_submission_id_elder_id_organization_id_fa_key" ON "transcripts"("voice_submission_id", "elder_id", "organization_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_analyses_transcript_id_key" ON "ai_analyses"("transcript_id");

-- CreateIndex
CREATE INDEX "ai_analyses_organization_id_facility_id_status_created_at_idx" ON "ai_analyses"("organization_id", "facility_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "ai_analyses_elder_id_created_at_idx" ON "ai_analyses"("elder_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ai_analyses_correlation_id_idx" ON "ai_analyses"("correlation_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_analyses_id_elder_id_organization_id_facility_id_key" ON "ai_analyses"("id", "elder_id", "organization_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_analyses_transcript_id_elder_id_organization_id_facility_key" ON "ai_analyses"("transcript_id", "elder_id", "organization_id", "facility_id");

-- CreateIndex
CREATE INDEX "needs_organization_id_facility_id_status_priority_created_a_idx" ON "needs"("organization_id", "facility_id", "status", "priority", "created_at");

-- CreateIndex
CREATE INDEX "needs_elder_id_created_at_idx" ON "needs"("elder_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "needs_requires_human_review_status_created_at_idx" ON "needs"("requires_human_review", "status", "created_at");

-- CreateIndex
CREATE INDEX "needs_correlation_id_idx" ON "needs"("correlation_id");

-- CreateIndex
CREATE UNIQUE INDEX "needs_organization_id_idempotency_key_key" ON "needs"("organization_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "needs_id_organization_id_facility_id_key" ON "needs"("id", "organization_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "needs_id_elder_id_organization_id_facility_id_key" ON "needs"("id", "elder_id", "organization_id", "facility_id");

-- CreateIndex
CREATE INDEX "need_links_organization_id_facility_id_kind_idx" ON "need_links"("organization_id", "facility_id", "kind");

-- CreateIndex
CREATE INDEX "need_links_target_need_id_idx" ON "need_links"("target_need_id");

-- CreateIndex
CREATE INDEX "need_links_correlation_id_idx" ON "need_links"("correlation_id");

-- CreateIndex
CREATE UNIQUE INDEX "need_links_source_need_id_target_need_id_kind_key" ON "need_links"("source_need_id", "target_need_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_primary_need_id_key" ON "work_orders"("primary_need_id");

-- CreateIndex
CREATE INDEX "work_orders_organization_id_facility_id_status_priority_due_idx" ON "work_orders"("organization_id", "facility_id", "status", "priority", "due_at");

-- CreateIndex
CREATE INDEX "work_orders_elder_id_created_at_idx" ON "work_orders"("elder_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "work_orders_correlation_id_idx" ON "work_orders"("correlation_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_facility_id_code_key" ON "work_orders"("facility_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_organization_id_idempotency_key_key" ON "work_orders"("organization_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_primary_need_id_elder_id_organization_id_facili_key" ON "work_orders"("primary_need_id", "elder_id", "organization_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_id_organization_id_facility_id_key" ON "work_orders"("id", "organization_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_id_elder_id_organization_id_facility_id_key" ON "work_orders"("id", "elder_id", "organization_id", "facility_id");

-- CreateIndex
CREATE INDEX "work_order_assignments_work_order_id_status_idx" ON "work_order_assignments"("work_order_id", "status");

-- CreateIndex
CREATE INDEX "work_order_assignments_target_team_id_status_idx" ON "work_order_assignments"("target_team_id", "status");

-- CreateIndex
CREATE INDEX "work_order_assignments_assignee_staff_profile_id_status_idx" ON "work_order_assignments"("assignee_staff_profile_id", "status");

-- CreateIndex
CREATE INDEX "work_order_assignments_shift_assignment_id_idx" ON "work_order_assignments"("shift_assignment_id");

-- CreateIndex
CREATE INDEX "work_order_assignments_organization_id_facility_id_status_a_idx" ON "work_order_assignments"("organization_id", "facility_id", "status", "assigned_at");

-- CreateIndex
CREATE UNIQUE INDEX "work_order_assignments_id_organization_id_facility_id_key" ON "work_order_assignments"("id", "organization_id", "facility_id");

-- CreateIndex
CREATE INDEX "work_order_transitions_organization_id_facility_id_occurred_idx" ON "work_order_transitions"("organization_id", "facility_id", "occurred_at");

-- CreateIndex
CREATE INDEX "work_order_transitions_correlation_id_idx" ON "work_order_transitions"("correlation_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_order_transitions_work_order_id_to_version_key" ON "work_order_transitions"("work_order_id", "to_version");

-- CreateIndex
CREATE INDEX "work_order_arrivals_organization_id_facility_id_arrived_at_idx" ON "work_order_arrivals"("organization_id", "facility_id", "arrived_at");

-- CreateIndex
CREATE INDEX "work_order_arrivals_correlation_id_idx" ON "work_order_arrivals"("correlation_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_order_arrivals_work_order_id_to_version_key" ON "work_order_arrivals"("work_order_id", "to_version");

-- CreateIndex
CREATE UNIQUE INDEX "service_completions_work_order_id_key" ON "service_completions"("work_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_completions_voice_submission_id_key" ON "service_completions"("voice_submission_id");

-- CreateIndex
CREATE INDEX "service_completions_elder_id_confirmed_at_idx" ON "service_completions"("elder_id", "confirmed_at" DESC);

-- CreateIndex
CREATE INDEX "service_completions_correlation_id_idx" ON "service_completions"("correlation_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_completions_id_organization_id_facility_id_key" ON "service_completions"("id", "organization_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_completions_work_order_id_elder_id_organization_id__key" ON "service_completions"("work_order_id", "elder_id", "organization_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_completions_voice_submission_id_elder_id_organizati_key" ON "service_completions"("voice_submission_id", "elder_id", "organization_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "family_summaries_work_order_id_key" ON "family_summaries"("work_order_id");

-- CreateIndex
CREATE INDEX "family_summaries_elder_id_status_published_at_idx" ON "family_summaries"("elder_id", "status", "published_at" DESC);

-- CreateIndex
CREATE INDEX "family_summaries_organization_id_facility_id_status_idx" ON "family_summaries"("organization_id", "facility_id", "status");

-- CreateIndex
CREATE INDEX "family_summaries_correlation_id_idx" ON "family_summaries"("correlation_id");

-- CreateIndex
CREATE UNIQUE INDEX "family_summaries_id_organization_id_facility_id_key" ON "family_summaries"("id", "organization_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "family_summaries_work_order_id_elder_id_organization_id_fac_key" ON "family_summaries"("work_order_id", "elder_id", "organization_id", "facility_id");

-- CreateIndex
CREATE INDEX "ratings_elder_id_created_at_idx" ON "ratings"("elder_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ratings_organization_id_facility_id_score_idx" ON "ratings"("organization_id", "facility_id", "score");

-- CreateIndex
CREATE INDEX "ratings_correlation_id_idx" ON "ratings"("correlation_id");

-- CreateIndex
CREATE UNIQUE INDEX "ratings_organization_id_idempotency_key_key" ON "ratings"("organization_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "ratings_work_order_id_rater_user_id_key" ON "ratings"("work_order_id", "rater_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ratings_id_organization_id_facility_id_key" ON "ratings"("id", "organization_id", "facility_id");

-- AddForeignKey
ALTER TABLE "voice_submissions" ADD CONSTRAINT "voice_submissions_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_submissions" ADD CONSTRAINT "voice_submissions_elder_id_organization_id_facility_id_fkey" FOREIGN KEY ("elder_id", "organization_id", "facility_id") REFERENCES "elders"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_submissions" ADD CONSTRAINT "voice_submissions_submitted_by_user_id_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_submissions" ADD CONSTRAINT "voice_submissions_work_order_id_elder_id_organization_id_f_fkey" FOREIGN KEY ("work_order_id", "elder_id", "organization_id", "facility_id") REFERENCES "work_orders"("id", "elder_id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_elder_id_organization_id_facility_id_fkey" FOREIGN KEY ("elder_id", "organization_id", "facility_id") REFERENCES "elders"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_voice_submission_id_elder_id_organization_id_f_fkey" FOREIGN KEY ("voice_submission_id", "elder_id", "organization_id", "facility_id") REFERENCES "voice_submissions"("id", "elder_id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_elder_id_organization_id_facility_id_fkey" FOREIGN KEY ("elder_id", "organization_id", "facility_id") REFERENCES "elders"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_transcript_id_elder_id_organization_id_facilit_fkey" FOREIGN KEY ("transcript_id", "elder_id", "organization_id", "facility_id") REFERENCES "transcripts"("id", "elder_id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs" ADD CONSTRAINT "needs_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs" ADD CONSTRAINT "needs_elder_id_organization_id_facility_id_fkey" FOREIGN KEY ("elder_id", "organization_id", "facility_id") REFERENCES "elders"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs" ADD CONSTRAINT "needs_voice_submission_id_elder_id_organization_id_facilit_fkey" FOREIGN KEY ("voice_submission_id", "elder_id", "organization_id", "facility_id") REFERENCES "voice_submissions"("id", "elder_id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs" ADD CONSTRAINT "needs_ai_analysis_id_elder_id_organization_id_facility_id_fkey" FOREIGN KEY ("ai_analysis_id", "elder_id", "organization_id", "facility_id") REFERENCES "ai_analyses"("id", "elder_id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "needs" ADD CONSTRAINT "needs_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "need_links" ADD CONSTRAINT "need_links_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "need_links" ADD CONSTRAINT "need_links_source_need_id_organization_id_facility_id_fkey" FOREIGN KEY ("source_need_id", "organization_id", "facility_id") REFERENCES "needs"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "need_links" ADD CONSTRAINT "need_links_target_need_id_organization_id_facility_id_fkey" FOREIGN KEY ("target_need_id", "organization_id", "facility_id") REFERENCES "needs"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_elder_id_organization_id_facility_id_fkey" FOREIGN KEY ("elder_id", "organization_id", "facility_id") REFERENCES "elders"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_primary_need_id_elder_id_organization_id_facil_fkey" FOREIGN KEY ("primary_need_id", "elder_id", "organization_id", "facility_id") REFERENCES "needs"("id", "elder_id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_assignments" ADD CONSTRAINT "work_order_assignments_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_assignments" ADD CONSTRAINT "work_order_assignments_work_order_id_organization_id_facil_fkey" FOREIGN KEY ("work_order_id", "organization_id", "facility_id") REFERENCES "work_orders"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_assignments" ADD CONSTRAINT "work_order_assignments_target_team_id_organization_id_faci_fkey" FOREIGN KEY ("target_team_id", "organization_id", "facility_id") REFERENCES "teams"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_assignments" ADD CONSTRAINT "work_order_assignments_assignee_staff_profile_id_organizat_fkey" FOREIGN KEY ("assignee_staff_profile_id", "organization_id", "facility_id") REFERENCES "staff_profiles"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_assignments" ADD CONSTRAINT "work_order_assignments_shift_assignment_id_organization_id_fkey" FOREIGN KEY ("shift_assignment_id", "organization_id", "facility_id") REFERENCES "shift_assignments"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_assignments" ADD CONSTRAINT "work_order_assignments_assigned_by_user_id_fkey" FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_transitions" ADD CONSTRAINT "work_order_transitions_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_transitions" ADD CONSTRAINT "work_order_transitions_work_order_id_organization_id_facil_fkey" FOREIGN KEY ("work_order_id", "organization_id", "facility_id") REFERENCES "work_orders"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_transitions" ADD CONSTRAINT "work_order_transitions_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_arrivals" ADD CONSTRAINT "work_order_arrivals_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_arrivals" ADD CONSTRAINT "work_order_arrivals_work_order_id_organization_id_facility_fkey" FOREIGN KEY ("work_order_id", "organization_id", "facility_id") REFERENCES "work_orders"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_arrivals" ADD CONSTRAINT "work_order_arrivals_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_completions" ADD CONSTRAINT "service_completions_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_completions" ADD CONSTRAINT "service_completions_elder_id_organization_id_facility_id_fkey" FOREIGN KEY ("elder_id", "organization_id", "facility_id") REFERENCES "elders"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_completions" ADD CONSTRAINT "service_completions_work_order_id_elder_id_organization_id_fkey" FOREIGN KEY ("work_order_id", "elder_id", "organization_id", "facility_id") REFERENCES "work_orders"("id", "elder_id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_completions" ADD CONSTRAINT "service_completions_submitted_by_staff_profile_id_organiza_fkey" FOREIGN KEY ("submitted_by_staff_profile_id", "organization_id", "facility_id") REFERENCES "staff_profiles"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_completions" ADD CONSTRAINT "service_completions_voice_submission_id_elder_id_organizat_fkey" FOREIGN KEY ("voice_submission_id", "elder_id", "organization_id", "facility_id") REFERENCES "voice_submissions"("id", "elder_id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_summaries" ADD CONSTRAINT "family_summaries_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_summaries" ADD CONSTRAINT "family_summaries_elder_id_organization_id_facility_id_fkey" FOREIGN KEY ("elder_id", "organization_id", "facility_id") REFERENCES "elders"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_summaries" ADD CONSTRAINT "family_summaries_work_order_id_elder_id_organization_id_fa_fkey" FOREIGN KEY ("work_order_id", "elder_id", "organization_id", "facility_id") REFERENCES "work_orders"("id", "elder_id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_summaries" ADD CONSTRAINT "family_summaries_published_by_user_id_fkey" FOREIGN KEY ("published_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_elder_id_organization_id_facility_id_fkey" FOREIGN KEY ("elder_id", "organization_id", "facility_id") REFERENCES "elders"("id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_work_order_id_elder_id_organization_id_facility_id_fkey" FOREIGN KEY ("work_order_id", "elder_id", "organization_id", "facility_id") REFERENCES "work_orders"("id", "elder_id", "organization_id", "facility_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_rater_user_id_fkey" FOREIGN KEY ("rater_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- M03 domain invariants not expressible in the Prisma schema.
ALTER TABLE "voice_submissions" ADD CONSTRAINT "voice_submissions_values_check"
  CHECK (
    "version" >= 1
    AND "declared_size_bytes" BETWEEN 1 AND 10485760
    AND ("actual_size_bytes" IS NULL OR "actual_size_bytes" BETWEEN 1 AND 10485760)
    AND "mime_type" IN ('audio/webm', 'audio/wav', 'audio/mpeg', 'audio/mp4')
    AND (
      ("purpose" = 'ELDER_REQUEST' AND "work_order_id" IS NULL)
      OR ("purpose" = 'WORK_ORDER_COMPLETION' AND "work_order_id" IS NOT NULL)
    )
    AND ("status" <> 'FAILED' OR "failure_code" IS NOT NULL)
    AND ("status" NOT IN ('UPLOADED', 'PROCESSING', 'COMPLETED') OR "uploaded_at" IS NOT NULL)
    AND ("status" <> 'COMPLETED' OR "completed_at" IS NOT NULL)
    AND (
      ("seal_candidate_object_key" IS NULL AND "seal_candidate_source_etag" IS NULL AND "seal_lease_token" IS NULL AND "seal_lease_until" IS NULL)
      OR ("seal_candidate_object_key" IS NOT NULL AND "seal_candidate_source_etag" IS NOT NULL AND "seal_lease_token" IS NOT NULL AND "seal_lease_until" IS NOT NULL)
    )
    AND "retention_until" > "created_at"
  );

ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_values_check"
  CHECK (
    "version" >= 1
    AND ("confidence" IS NULL OR "confidence" BETWEEN 0 AND 1)
    AND ("duration_ms" IS NULL OR "duration_ms" >= 0)
    AND (
      "status" <> 'COMPLETED'
      OR (
        "completed_at" IS NOT NULL
        AND (
          ("text" IS NOT NULL AND length("text") > 0 AND "content_deleted_at" IS NULL)
          OR ("text" IS NULL AND "content_deleted_at" IS NOT NULL)
        )
      )
    )
    AND ("status" <> 'FAILED' OR "failure_code" IS NOT NULL)
    AND "retention_until" > "created_at"
  );

ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_values_check"
  CHECK (
    "version" >= 1
    AND ("confidence" IS NULL OR "confidence" BETWEEN 0 AND 1)
    AND jsonb_typeof("evidence") = 'array'
    AND (
      "status" <> 'COMPLETED'
      OR (
        "completed_at" IS NOT NULL
        AND (
          ("output" IS NOT NULL AND "content_deleted_at" IS NULL)
          OR (
            "output" IS NULL
            AND "content_deleted_at" IS NOT NULL
            AND jsonb_array_length("evidence") = 0
          )
        )
      )
    )
    AND ("status" <> 'FAILED' OR "failure_code" IS NOT NULL)
    AND "retention_until" > "created_at"
  );

ALTER TABLE "needs" ADD CONSTRAINT "needs_values_check"
  CHECK (
    "version" >= 1
    AND length(btrim("summary")) > 0
    AND jsonb_typeof("safety_rule_codes") = 'array'
    AND ("source" <> 'VOICE' OR "voice_submission_id" IS NOT NULL)
    AND ("status" NOT IN ('CONFIRMED', 'REJECTED') OR ("reviewed_at" IS NOT NULL AND "reviewed_by_user_id" IS NOT NULL AND "review_reason_code" IS NOT NULL))
  );

ALTER TABLE "need_links" ADD CONSTRAINT "need_links_distinct_needs_check"
  CHECK ("source_need_id" <> "target_need_id");

ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_values_check"
  CHECK (
    "version" >= 1
    AND "due_at" >= "created_at"
    AND ("status" <> 'ACCEPTED' OR "accepted_at" IS NOT NULL)
    AND ("status" <> 'IN_PROGRESS' OR "started_at" IS NOT NULL)
    AND ("status" <> 'COMPLETED' OR "completed_at" IS NOT NULL)
    AND ("status" <> 'VERIFIED' OR "verified_at" IS NOT NULL)
    AND ("status" <> 'CLOSED' OR "closed_at" IS NOT NULL)
    AND ("status" <> 'CANCELLED' OR "cancelled_at" IS NOT NULL)
  );

ALTER TABLE "work_order_assignments" ADD CONSTRAINT "work_order_assignments_values_check"
  CHECK (
    "version" >= 1
    AND ("target_team_id" IS NOT NULL OR "assignee_staff_profile_id" IS NOT NULL)
    AND ("status" <> 'CLAIMED' OR ("assignee_staff_profile_id" IS NOT NULL AND "claimed_at" IS NOT NULL))
    AND ("status" NOT IN ('RELEASED', 'CANCELLED') OR "released_at" IS NOT NULL)
  );

ALTER TABLE "work_order_transitions" ADD CONSTRAINT "work_order_transitions_values_check"
  CHECK (
    "from_version" >= 0
    AND "to_version" = "from_version" + 1
    AND (
      ("from_status" IS NULL AND "to_status" = 'NEW' AND "from_version" = 0 AND "to_version" = 1)
      OR ("from_status" = 'NEW' AND "to_status" IN ('ASSIGNED', 'CANCELLED'))
      OR ("from_status" = 'ASSIGNED' AND "to_status" IN ('ACCEPTED', 'CANCELLED'))
      OR ("from_status" = 'ACCEPTED' AND "to_status" IN ('IN_PROGRESS', 'CANCELLED'))
      OR ("from_status" = 'IN_PROGRESS' AND "to_status" IN ('COMPLETED', 'CANCELLED'))
      OR ("from_status" = 'COMPLETED' AND "to_status" = 'VERIFIED')
      OR ("from_status" = 'VERIFIED' AND "to_status" = 'CLOSED')
    )
  );

ALTER TABLE "work_order_arrivals" ADD CONSTRAINT "work_order_arrivals_values_check"
  CHECK ("from_version" >= 1 AND "to_version" = "from_version" + 1);

ALTER TABLE "service_completions" ADD CONSTRAINT "service_completions_values_check"
  CHECK (
    "version" >= 1
    AND (
      ("note_source" = 'TEXT' AND "note_text" IS NOT NULL AND length(btrim("note_text")) > 0 AND "voice_submission_id" IS NULL)
      OR ("note_source" = 'VOICE' AND "voice_submission_id" IS NOT NULL)
    )
    AND jsonb_typeof("completion_checklist") = 'object'
    AND "completion_checklist"->>'schemaVersion' = '1'
    AND jsonb_typeof("completion_checklist"->'required') = 'boolean'
    AND jsonb_typeof("completion_checklist"->'riskReasons') = 'array'
    AND jsonb_typeof("completion_checklist"->'expectedCodes') = 'array'
    AND jsonb_typeof("completion_checklist"->'confirmations') = 'array'
    AND (
      (
        "completion_checklist"->'required' = 'false'::jsonb
        AND "checklist_confirmed_at" IS NULL
        AND "completion_checklist"->'riskReasons' = '[]'::jsonb
        AND "completion_checklist"->'expectedCodes' = '[]'::jsonb
        AND "completion_checklist"->'confirmations' = '[]'::jsonb
      )
      OR (
        "completion_checklist"->'required' = 'true'::jsonb
        AND "checklist_confirmed_at" IS NOT NULL
        AND jsonb_array_length("completion_checklist"->'riskReasons') BETWEEN 1 AND 5
        AND "completion_checklist"->'expectedCodes' =
          '["RECIPIENT_STATE_CONFIRMED","SERVICE_RESULT_CONFIRMED","FOLLOW_UP_RISK_REVIEWED"]'::jsonb
        AND jsonb_array_length("completion_checklist"->'confirmations') = 3
        AND "completion_checklist"#>>'{confirmations,0,code}' = 'RECIPIENT_STATE_CONFIRMED'
        AND "completion_checklist"#>'{confirmations,0,confirmed}' = 'true'::jsonb
        AND jsonb_typeof("completion_checklist"#>'{confirmations,0,confirmedAt}') = 'string'
        AND "completion_checklist"#>>'{confirmations,1,code}' = 'SERVICE_RESULT_CONFIRMED'
        AND "completion_checklist"#>'{confirmations,1,confirmed}' = 'true'::jsonb
        AND jsonb_typeof("completion_checklist"#>'{confirmations,1,confirmedAt}') = 'string'
        AND "completion_checklist"#>>'{confirmations,2,code}' = 'FOLLOW_UP_RISK_REVIEWED'
        AND "completion_checklist"#>'{confirmations,2,confirmed}' = 'true'::jsonb
        AND jsonb_typeof("completion_checklist"#>'{confirmations,2,confirmedAt}') = 'string'
      )
    )
  );

ALTER TABLE "family_summaries" ADD CONSTRAINT "family_summaries_values_check"
  CHECK (
    "version" >= 1
    AND length(btrim("title")) > 0
    AND length(btrim("summary")) > 0
    AND ("status" <> 'PUBLISHED' OR ("published_at" IS NOT NULL AND "published_by_user_id" IS NOT NULL))
  );

ALTER TABLE "ratings" ADD CONSTRAINT "ratings_values_check"
  CHECK ("score" BETWEEN 1 AND 5);

CREATE UNIQUE INDEX "work_order_assignments_one_active_key"
  ON "work_order_assignments"("work_order_id")
  WHERE "status" IN ('OFFERED', 'CLAIMED');

CREATE OR REPLACE FUNCTION "m03_validate_work_order_update"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('eldercare.seed_mode', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'WORK_ORDER_VERSION_MUST_INCREMENT';
  END IF;

  IF NEW."status" <> OLD."status" AND NOT (
    (OLD."status" = 'NEW' AND NEW."status" IN ('ASSIGNED', 'CANCELLED'))
    OR (OLD."status" = 'ASSIGNED' AND NEW."status" IN ('ACCEPTED', 'CANCELLED'))
    OR (OLD."status" = 'ACCEPTED' AND NEW."status" IN ('IN_PROGRESS', 'CANCELLED'))
    OR (OLD."status" = 'IN_PROGRESS' AND NEW."status" IN ('COMPLETED', 'CANCELLED'))
    OR (OLD."status" = 'COMPLETED' AND NEW."status" = 'VERIFIED')
    OR (OLD."status" = 'VERIFIED' AND NEW."status" = 'CLOSED')
  ) THEN
    RAISE EXCEPTION 'WORK_ORDER_STATE_TRANSITION_INVALID';
  END IF;

  IF NEW."arrived_at" IS DISTINCT FROM OLD."arrived_at" AND NOT (
    OLD."status" = 'ACCEPTED'
    AND NEW."status" = 'ACCEPTED'
    AND OLD."arrived_at" IS NULL
    AND NEW."arrived_at" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'WORK_ORDER_ARRIVAL_INVALID';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "work_orders_validate_update"
BEFORE UPDATE ON "work_orders"
FOR EACH ROW EXECUTE FUNCTION "m03_validate_work_order_update"();

CREATE OR REPLACE FUNCTION "m03_validate_work_order_transition_insert"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('eldercare.seed_mode', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "work_orders"
    WHERE "id" = NEW."work_order_id"
      AND "organization_id" = NEW."organization_id"
      AND "facility_id" = NEW."facility_id"
      AND "status" = NEW."to_status"
      AND "version" = NEW."to_version"
  ) THEN
    RAISE EXCEPTION 'WORK_ORDER_TRANSITION_SNAPSHOT_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "work_order_transitions_validate_insert"
BEFORE INSERT ON "work_order_transitions"
FOR EACH ROW EXECUTE FUNCTION "m03_validate_work_order_transition_insert"();

CREATE OR REPLACE FUNCTION "m03_validate_work_order_arrival_insert"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('eldercare.seed_mode', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "work_orders"
    WHERE "id" = NEW."work_order_id"
      AND "organization_id" = NEW."organization_id"
      AND "facility_id" = NEW."facility_id"
      AND "status" = 'ACCEPTED'
      AND "version" = NEW."to_version"
      AND "arrived_at" = NEW."arrived_at"
  ) THEN
    RAISE EXCEPTION 'WORK_ORDER_ARRIVAL_SNAPSHOT_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "work_order_arrivals_validate_insert"
BEFORE INSERT ON "work_order_arrivals"
FOR EACH ROW EXECUTE FUNCTION "m03_validate_work_order_arrival_insert"();

CREATE OR REPLACE FUNCTION "m03_reject_immutable_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('eldercare.seed_mode', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'M03_IMMUTABLE_RECORD';
END;
$$;

CREATE TRIGGER "work_order_transitions_immutable"
BEFORE UPDATE OR DELETE ON "work_order_transitions"
FOR EACH ROW EXECUTE FUNCTION "m03_reject_immutable_mutation"();

CREATE TRIGGER "work_order_arrivals_immutable"
BEFORE UPDATE OR DELETE ON "work_order_arrivals"
FOR EACH ROW EXECUTE FUNCTION "m03_reject_immutable_mutation"();
