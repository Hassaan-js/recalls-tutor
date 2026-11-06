-- Sittings: month gives the diet; trial_pool marks older sittings whose questions form the free-trial pool.
ALTER TABLE sittings ADD COLUMN month integer CHECK(month BETWEEN 1 AND 12);
ALTER TABLE sittings ADD COLUMN trial_pool boolean NOT NULL DEFAULT false;
CREATE TABLE topics (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), exam_id uuid NOT NULL REFERENCES exams(id),
 parent_id uuid, name text NOT NULL, slug text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(exam_id,slug), UNIQUE(id,exam_id), FOREIGN KEY(parent_id,exam_id) REFERENCES topics(id,exam_id)
);
-- Taxonomy is question metadata, not content: retagging never creates a version or unpublishes.
ALTER TABLE questions ADD COLUMN topic_id uuid;
ALTER TABLE questions ADD COLUMN difficulty text CHECK(difficulty IN ('easy','medium','hard'));
ALTER TABLE questions ADD CONSTRAINT question_topic_exam FOREIGN KEY(topic_id,exam_id) REFERENCES topics(id,exam_id);
CREATE INDEX question_topic ON questions(exam_id,topic_id);
CREATE INDEX question_sitting_lookup ON question_sittings(sitting_id);
ALTER TABLE studio_jobs ADD COLUMN sitting_id uuid;
ALTER TABLE studio_jobs ADD CONSTRAINT studio_job_sitting FOREIGN KEY(sitting_id,exam_id) REFERENCES sittings(id,exam_id);
CREATE TABLE papers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), exam_id uuid NOT NULL REFERENCES exams(id),
 title text NOT NULL, sitting_id uuid, time_limit_minutes integer NOT NULL CHECK(time_limit_minutes BETWEEN 1 AND 600),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')), locked boolean NOT NULL DEFAULT false,
 created_by uuid NOT NULL REFERENCES app_users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,exam_id), FOREIGN KEY(sitting_id,exam_id) REFERENCES sittings(id,exam_id), CHECK(status='draft' OR locked)
);
CREATE TABLE paper_questions (
 paper_id uuid NOT NULL, exam_id uuid NOT NULL, position integer NOT NULL CHECK(position>0), question_id uuid NOT NULL,
 PRIMARY KEY(paper_id,position), UNIQUE(paper_id,question_id),
 FOREIGN KEY(paper_id,exam_id) REFERENCES papers(id,exam_id), FOREIGN KEY(question_id,exam_id) REFERENCES questions(id,exam_id)
);
ALTER TABLE practice_attempts ADD COLUMN paper_id uuid REFERENCES papers(id);
ALTER TABLE practice_attempts ADD COLUMN access text NOT NULL DEFAULT 'full' CHECK(access IN ('full','trial'));
ALTER TABLE practice_attempts ADD COLUMN filters jsonb NOT NULL DEFAULT '{}';
ALTER TABLE practice_attempts DROP CONSTRAINT practice_attempts_pool_check;
ALTER TABLE practice_attempts ADD CONSTRAINT practice_attempts_pool_check CHECK(pool IN ('all','unanswered','mistakes','paper'));
-- TRIAL-1: one trial per account per exam; the question cap is counted from answered trial items on the server.
CREATE TABLE trials (
 user_id uuid NOT NULL REFERENCES app_users(id), exam_id uuid NOT NULL REFERENCES exams(id),
 started_at timestamptz NOT NULL DEFAULT now(), ends_at timestamptz NOT NULL, question_limit integer NOT NULL CHECK(question_limit>0),
 mock_attempt_id uuid REFERENCES practice_attempts(id), PRIMARY KEY(user_id,exam_id), CHECK(ends_at>started_at)
);
