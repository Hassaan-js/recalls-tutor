CREATE TABLE practice_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES app_users(id),
 exam_id uuid NOT NULL REFERENCES exams(id), mode text NOT NULL CHECK(mode IN ('revision','exam')),
 pool text NOT NULL CHECK(pool IN ('all','unanswered','mistakes')), request_id uuid NOT NULL,
 started_at timestamptz NOT NULL DEFAULT now(), deadline_at timestamptz, submitted_at timestamptz,
 UNIQUE(user_id,request_id), CHECK((mode='exam')=(deadline_at IS NOT NULL))
);
CREATE INDEX practice_attempt_owner ON practice_attempts(user_id,started_at DESC);
-- Each item pins the version delivered at start so later edits never change what was answered.
CREATE TABLE practice_items (
 attempt_id uuid NOT NULL REFERENCES practice_attempts(id), position integer NOT NULL CHECK(position>0),
 question_id uuid NOT NULL, version_id uuid NOT NULL, selected integer CHECK(selected BETWEEN 0 AND 4),
 correct boolean, confidence text CHECK(confidence IN ('sure','unsure','guess')),
 flagged boolean NOT NULL DEFAULT false, time_ms integer CHECK(time_ms>=0), answered_at timestamptz,
 PRIMARY KEY(attempt_id,position), UNIQUE(attempt_id,question_id),
 FOREIGN KEY(version_id,question_id) REFERENCES question_versions(id,question_id)
);
CREATE INDEX practice_item_version ON practice_items(version_id) WHERE selected IS NOT NULL;
