-- M00 infrastructure metadata only. No business-domain records are introduced.
CREATE TABLE "_system_metadata" (
    "key" VARCHAR(128) NOT NULL,
    "value" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "_system_metadata_pkey" PRIMARY KEY ("key")
);
