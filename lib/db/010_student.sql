-- STU-5: per-student question tools. Keyed by question, so a bookmark or note follows the question across sessions.
CREATE TABLE question_bookmarks (
 user_id uuid NOT NULL REFERENCES app_users(id), question_id uuid NOT NULL REFERENCES questions(id),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,question_id)
);
CREATE TABLE question_notes (
 user_id uuid NOT NULL REFERENCES app_users(id), question_id uuid NOT NULL REFERENCES questions(id),
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 2000), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,question_id)
);
-- "Report an error" goes to staff with the exact version the student saw.
CREATE TABLE question_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES app_users(id),
 question_id uuid NOT NULL REFERENCES questions(id), version_id uuid NOT NULL REFERENCES question_versions(id),
 reason text NOT NULL CHECK(reason IN ('wrong_answer','unclear','typo','outdated','other')),
 details text NOT NULL DEFAULT '' CHECK(length(details)<=2000),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','dismissed')),
 created_at timestamptz NOT NULL DEFAULT now(), resolved_by uuid REFERENCES app_users(id), resolved_at timestamptz
);
CREATE INDEX question_report_open ON question_reports(question_id) WHERE status='open';
CREATE UNIQUE INDEX question_report_once ON question_reports(user_id,question_id) WHERE status='open';
-- AUTH-2 profile. The exam date drives the countdown and the daily target the home screen's progress line (STU-6).
CREATE TABLE student_profiles (
 user_id uuid PRIMARY KEY REFERENCES app_users(id), country text NOT NULL DEFAULT '' CHECK(length(country)<=80),
 timezone text NOT NULL DEFAULT '' CHECK(length(timezone)<=64), exam_ids uuid[] NOT NULL DEFAULT '{}',
 exam_date date, daily_target integer CHECK(daily_target BETWEEN 1 AND 500), updated_at timestamptz NOT NULL DEFAULT now()
);
-- AUTH-3: a deleted account is anonymised in place; payment records stay for accounting.
ALTER TABLE app_users DROP CONSTRAINT app_users_status_check;
ALTER TABLE app_users ADD CONSTRAINT app_users_status_check CHECK(status IN ('active','suspended','deleted'));
ALTER TABLE app_users ADD COLUMN deleted_at timestamptz;
