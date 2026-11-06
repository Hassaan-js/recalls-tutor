-- AIS-12 and ADM-6: proposed edits to existing questions, from new evidence or a student's error report.
-- A proposal never changes a question by itself: a content manager accepts it (optionally edited) or dismisses it.
CREATE TABLE question_proposals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 question_id uuid NOT NULL REFERENCES questions(id),
 base_version_id uuid NOT NULL REFERENCES question_versions(id),
 source text NOT NULL CHECK(source IN ('error_report','new_evidence')),
 report_id uuid REFERENCES question_reports(id),
 job_id uuid REFERENCES studio_jobs(id),
 stem text NOT NULL, options jsonb NOT NULL, correct_answers jsonb NOT NULL, explanation text NOT NULL,
 references_json jsonb NOT NULL DEFAULT '[]', key_notes jsonb NOT NULL DEFAULT '[]',
 rationale text NOT NULL DEFAULT '', changes jsonb NOT NULL DEFAULT '[]', confidence integer CHECK(confidence BETWEEN 0 AND 100),
 model text, cost_usd numeric(10,4),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','dismissed')),
 decided_by uuid REFERENCES app_users(id), decided_at timestamptz, applied_version_id uuid REFERENCES question_versions(id),
 created_by uuid REFERENCES app_users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX question_proposal_pending ON question_proposals(question_id) WHERE status='pending';
CREATE UNIQUE INDEX question_proposal_report ON question_proposals(report_id) WHERE report_id IS NOT NULL AND status='pending';
-- AIS-14: a sitting mentioned by an upload that the catalogue does not have yet. An admin confirms or dismisses it.
CREATE TABLE sitting_proposals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 exam_id uuid NOT NULL REFERENCES exams(id),
 year integer NOT NULL CHECK(year BETWEEN 1990 AND 2200), month integer NOT NULL CHECK(month BETWEEN 1 AND 12),
 label text NOT NULL, mention text NOT NULL, job_id uuid REFERENCES studio_jobs(id),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','dismissed')),
 sitting_id uuid REFERENCES sittings(id), decided_by uuid REFERENCES app_users(id), decided_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sitting_proposal_once ON sitting_proposals(exam_id,year,month) WHERE status='pending';
-- AIS-13: the cost of each AI refinement is kept with the version it produced.
ALTER TABLE question_versions ADD COLUMN IF NOT EXISTS ai_cost_usd numeric(10,4);
