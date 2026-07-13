-- Explicit M01 rollback. This removes only M01 data and leaves M00 metadata intact.
DROP TRIGGER IF EXISTS "audit_events_prevent_truncate" ON "audit_events";
DROP TRIGGER IF EXISTS "audit_events_append_only" ON "audit_events";
DROP FUNCTION IF EXISTS "prevent_audit_event_mutation"();

DROP TABLE IF EXISTS "audit_events";
DROP TABLE IF EXISTS "auth_sessions";
DROP TABLE IF EXISTS "data_scopes";
DROP TABLE IF EXISTS "user_roles";
DROP TABLE IF EXISTS "role_permissions";
DROP TABLE IF EXISTS "password_credentials";
DROP TABLE IF EXISTS "permissions";
DROP TABLE IF EXISTS "roles";
DROP TABLE IF EXISTS "users";
DROP TABLE IF EXISTS "facilities";
DROP TABLE IF EXISTS "organizations";

DROP TYPE IF EXISTS "AuditOutcome";
DROP TYPE IF EXISTS "AuditActorType";
DROP TYPE IF EXISTS "DataScopeKind";
DROP TYPE IF EXISTS "UserStatus";
DROP TYPE IF EXISTS "FacilityStatus";
DROP TYPE IF EXISTS "OrganizationStatus";

UPDATE "_system_metadata"
SET
  "value" = '{"schemaVersion":"1.0","containsBusinessFixtures":false}'::jsonb,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "key" = 'foundation.seed';
