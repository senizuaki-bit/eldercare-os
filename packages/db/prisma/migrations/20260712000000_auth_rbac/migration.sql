-- M01 identity, tenant authorization, opaque sessions, and append-only audit.
CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');
CREATE TYPE "FacilityStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'LOCKED', 'DISABLED');
CREATE TYPE "DataScopeKind" AS ENUM ('PLATFORM', 'ORGANIZATION', 'FACILITY', 'FLOOR', 'CARE_TEAM', 'ASSIGNED_ELDER', 'ACTIVE_SHIFT', 'LINKED_ELDER', 'OWN_RECORD');
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'ANONYMOUS', 'SYSTEM');
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'DENIED', 'FAILURE');

CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "organizations_slug_format_check" CHECK ("slug" ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$')
);

CREATE TABLE "facilities" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
    "status" "FacilityStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "facilities_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "facilities_code_not_blank_check" CHECK (length(btrim("code")) > 0)
);

CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "login_name" VARCHAR(96) NOT NULL,
    "normalized_login_name" VARCHAR(96) NOT NULL,
    "display_name" VARCHAR(128) NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "session_version" INTEGER NOT NULL DEFAULT 1,
    "access_version" INTEGER NOT NULL DEFAULT 1,
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "users_login_name_not_blank_check" CHECK (length(btrim("login_name")) > 0),
    CONSTRAINT "users_normalized_login_name_check" CHECK ("normalized_login_name" = lower(btrim("login_name"))),
    CONSTRAINT "users_versions_positive_check" CHECK ("session_version" > 0 AND "access_version" > 0)
);

CREATE TABLE "password_credentials" (
    "user_id" UUID NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "password_changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "password_credentials_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "password_credentials_failed_count_check" CHECK ("failed_login_count" >= 0),
    CONSTRAINT "password_credentials_hash_format_check" CHECK ("password_hash" ~ '^scrypt\$32768\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$')
);

CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "description" VARCHAR(512),
    "is_system" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "roles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "roles_code_format_check" CHECK ("code" ~ '^[A-Z][A-Z0-9_]*$')
);

CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "code" VARCHAR(128) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "description" VARCHAR(512),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "permissions_code_format_check" CHECK ("code" ~ '^[a-z][a-z0-9_.]*$')
);

CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id", "permission_id")
);

CREATE TABLE "user_roles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "active_from" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID,
    "revoked_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "user_roles_expiry_check" CHECK ("expires_at" IS NULL OR "expires_at" > "active_from"),
    CONSTRAINT "user_roles_revocation_check" CHECK ("revoked_at" IS NULL OR "revoked_at" >= "active_from")
);

CREATE TABLE "data_scopes" (
    "id" UUID NOT NULL,
    "user_role_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "kind" "DataScopeKind" NOT NULL,
    "scope_key" VARCHAR(192) NOT NULL,
    "facility_id" UUID,
    "resource_type" VARCHAR(64),
    "resource_id" VARCHAR(128),
    "valid_from" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_until" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "data_scopes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "data_scopes_validity_check" CHECK ("valid_until" IS NULL OR "valid_until" > "valid_from"),
    CONSTRAINT "data_scopes_identifiers_check" CHECK (
      "scope_key" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
      AND ("resource_type" IS NULL OR "resource_type" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$')
      AND ("resource_id" IS NULL OR "resource_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$')
    ),
    CONSTRAINT "data_scopes_shape_check" CHECK (
      ("kind" IN ('PLATFORM', 'ORGANIZATION', 'OWN_RECORD') AND "facility_id" IS NULL AND "resource_type" IS NULL AND "resource_id" IS NULL)
      OR ("kind" = 'FACILITY' AND "facility_id" IS NOT NULL AND "resource_type" IS NULL AND "resource_id" IS NULL)
      OR ("kind" = 'ACTIVE_SHIFT' AND "facility_id" IS NOT NULL AND "resource_type" IS NULL AND "resource_id" IS NULL AND "valid_until" IS NOT NULL)
      OR ("kind" IN ('FLOOR', 'CARE_TEAM', 'ASSIGNED_ELDER', 'LINKED_ELDER') AND "facility_id" IS NOT NULL AND "resource_type" IS NOT NULL AND "resource_id" IS NOT NULL)
    )
);

CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID,
    "token_hash" CHAR(64) NOT NULL,
    "csrf_token_hash" CHAR(64) NOT NULL,
    "session_version" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idle_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "absolute_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revoke_reason" VARCHAR(96),
    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "auth_sessions_hash_format_check" CHECK ("token_hash" ~ '^[0-9a-f]{64}$' AND "csrf_token_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "auth_sessions_expiry_check" CHECK ("idle_expires_at" <= "absolute_expires_at" AND "absolute_expires_at" > "created_at"),
    CONSTRAINT "auth_sessions_revocation_check" CHECK (("revoked_at" IS NULL AND "revoke_reason" IS NULL) OR ("revoked_at" IS NOT NULL AND "revoke_reason" IS NOT NULL)),
    CONSTRAINT "auth_sessions_version_positive_check" CHECK ("session_version" > 0)
);

CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "facility_id" UUID,
    "actor_user_id" UUID,
    "actor_type" "AuditActorType" NOT NULL,
    "action" VARCHAR(128) NOT NULL,
    "outcome" "AuditOutcome" NOT NULL,
    "resource_type" VARCHAR(64),
    "resource_id" VARCHAR(128),
    "reason_code" VARCHAR(96),
    "correlation_id" VARCHAR(128) NOT NULL,
    "safe_metadata" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "audit_events_actor_check" CHECK (("actor_type" = 'USER' AND "actor_user_id" IS NOT NULL) OR ("actor_type" <> 'USER' AND "actor_user_id" IS NULL)),
    CONSTRAINT "audit_events_identifiers_check" CHECK (
      "action" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
      AND ("resource_type" IS NULL OR "resource_type" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$')
      AND ("resource_id" IS NULL OR "resource_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$')
      AND ("reason_code" IS NULL OR "reason_code" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$')
    ),
    CONSTRAINT "audit_events_correlation_check" CHECK ("correlation_id" ~ '^[A-Za-z0-9._:-]{8,128}$'),
    CONSTRAINT "audit_events_metadata_check" CHECK (jsonb_typeof("safe_metadata") = 'object' AND octet_length("safe_metadata"::text) <= 8192)
);

CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");
CREATE INDEX "organizations_status_idx" ON "organizations"("status");
CREATE INDEX "facilities_organization_id_status_idx" ON "facilities"("organization_id", "status");
CREATE UNIQUE INDEX "facilities_organization_id_code_key" ON "facilities"("organization_id", "code");
CREATE UNIQUE INDEX "facilities_id_organization_id_key" ON "facilities"("id", "organization_id");
CREATE UNIQUE INDEX "users_normalized_login_name_key" ON "users"("normalized_login_name");
CREATE INDEX "users_status_idx" ON "users"("status");
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");
CREATE INDEX "user_roles_user_id_organization_id_revoked_at_expires_at_idx" ON "user_roles"("user_id", "organization_id", "revoked_at", "expires_at");
CREATE INDEX "user_roles_organization_id_role_id_revoked_at_idx" ON "user_roles"("organization_id", "role_id", "revoked_at");
CREATE UNIQUE INDEX "user_roles_id_organization_id_key" ON "user_roles"("id", "organization_id");
CREATE INDEX "data_scopes_organization_id_kind_facility_id_idx" ON "data_scopes"("organization_id", "kind", "facility_id");
CREATE INDEX "data_scopes_resource_type_resource_id_idx" ON "data_scopes"("resource_type", "resource_id");
CREATE UNIQUE INDEX "data_scopes_user_role_id_scope_key_key" ON "data_scopes"("user_role_id", "scope_key");
CREATE UNIQUE INDEX "auth_sessions_token_hash_key" ON "auth_sessions"("token_hash");
CREATE INDEX "auth_sessions_user_id_revoked_at_absolute_expires_at_idx" ON "auth_sessions"("user_id", "revoked_at", "absolute_expires_at");
CREATE INDEX "auth_sessions_organization_id_revoked_at_idle_expires_at_idx" ON "auth_sessions"("organization_id", "revoked_at", "idle_expires_at");
CREATE INDEX "auth_sessions_absolute_expires_at_idx" ON "auth_sessions"("absolute_expires_at");
CREATE INDEX "audit_events_organization_id_occurred_at_idx" ON "audit_events"("organization_id", "occurred_at" DESC);
CREATE INDEX "audit_events_actor_user_id_occurred_at_idx" ON "audit_events"("actor_user_id", "occurred_at" DESC);
CREATE INDEX "audit_events_resource_type_resource_id_occurred_at_idx" ON "audit_events"("resource_type", "resource_id", "occurred_at" DESC);
CREATE INDEX "audit_events_correlation_id_idx" ON "audit_events"("correlation_id");

ALTER TABLE "facilities" ADD CONSTRAINT "facilities_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "password_credentials" ADD CONSTRAINT "password_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_revoked_by_user_id_fkey" FOREIGN KEY ("revoked_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "data_scopes" ADD CONSTRAINT "data_scopes_user_role_id_organization_id_fkey" FOREIGN KEY ("user_role_id", "organization_id") REFERENCES "user_roles"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "data_scopes" ADD CONSTRAINT "data_scopes_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_facility_id_organization_id_fkey" FOREIGN KEY ("facility_id", "organization_id") REFERENCES "facilities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "prevent_audit_event_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events are append-only';
END;
$$;

CREATE TRIGGER "audit_events_append_only"
BEFORE UPDATE OR DELETE ON "audit_events"
FOR EACH ROW EXECUTE FUNCTION "prevent_audit_event_mutation"();

CREATE TRIGGER "audit_events_prevent_truncate"
BEFORE TRUNCATE ON "audit_events"
FOR EACH STATEMENT EXECUTE FUNCTION "prevent_audit_event_mutation"();
