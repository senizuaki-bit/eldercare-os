-- M03 rollback. This intentionally removes M03 domain data and leaves M00-M02 intact.
DROP TABLE IF EXISTS
  "ratings",
  "family_summaries",
  "service_completions",
  "work_order_arrivals",
  "work_order_transitions",
  "work_order_assignments",
  "work_orders",
  "need_links",
  "needs",
  "ai_analyses",
  "transcripts",
  "voice_submissions";

DROP FUNCTION IF EXISTS "m03_reject_immutable_mutation"();
DROP FUNCTION IF EXISTS "m03_validate_work_order_arrival_insert"();
DROP FUNCTION IF EXISTS "m03_validate_work_order_transition_insert"();
DROP FUNCTION IF EXISTS "m03_validate_work_order_update"();

DROP TYPE IF EXISTS "RatingActorType";
DROP TYPE IF EXISTS "FamilySummaryStatus";
DROP TYPE IF EXISTS "CompletionNoteSource";
DROP TYPE IF EXISTS "WorkOrderAssignmentStatus";
DROP TYPE IF EXISTS "WorkOrderStatus";
DROP TYPE IF EXISTS "NeedLinkKind";
DROP TYPE IF EXISTS "NeedStatus";
DROP TYPE IF EXISTS "NeedUrgency";
DROP TYPE IF EXISTS "NeedCategory";
DROP TYPE IF EXISTS "NeedSource";
DROP TYPE IF EXISTS "AIAnalysisStatus";
DROP TYPE IF EXISTS "TranscriptStatus";
DROP TYPE IF EXISTS "VoiceSubmissionStatus";
DROP TYPE IF EXISTS "VoiceSubmissionPurpose";
