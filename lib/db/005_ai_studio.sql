CREATE TABLE studio_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), exam_id uuid NOT NULL REFERENCES exams(id),
 created_by uuid NOT NULL REFERENCES app_users(id), request_id uuid NOT NULL,
 source_label text NOT NULL, file_name text, sitting_hint text,
 -- Only the sanitised text is stored; raw uploads with personal identifiers are never persisted.
 source_text text NOT NULL, redactions integer NOT NULL DEFAULT 0,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','extracting','refining','deduping','ready','failed')),
 error text, draft_count integer NOT NULL DEFAULT 0, model text, cost_usd numeric(10,4),
 created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, finished_at timestamptz,
 UNIQUE(created_by,request_id)
);
CREATE INDEX studio_job_recent ON studio_jobs(created_at DESC);
ALTER TABLE recall_sources ADD COLUMN job_id uuid REFERENCES studio_jobs(id);
ALTER TABLE recall_sources ALTER COLUMN request_id DROP NOT NULL;
ALTER TABLE question_versions ADD COLUMN key_notes jsonb NOT NULL DEFAULT '[]';
ALTER TABLE question_versions ADD COLUMN ai_meta jsonb;
ALTER TABLE questions DROP CONSTRAINT questions_status_check;
ALTER TABLE questions ADD CONSTRAINT questions_status_check CHECK(status IN ('raw','ai_refined','in_review','approved','published','retired','rejected'));
