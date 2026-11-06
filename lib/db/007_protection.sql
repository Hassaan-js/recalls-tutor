-- PROT-5 / ADM-3: a suspended account cannot sign in, practise or use the Studio.
ALTER TABLE app_users ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended'));
ALTER TABLE app_users ADD COLUMN suspended_at timestamptz;
ALTER TABLE app_users ADD COLUMN suspended_reason text;
-- PROT-2: every question body delivered to a student is logged so hourly budgets and scraping can be measured.
CREATE TABLE question_views (
 user_id uuid NOT NULL REFERENCES app_users(id), question_id uuid NOT NULL REFERENCES questions(id),
 attempt_id uuid NOT NULL REFERENCES practice_attempts(id), viewed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX question_view_recent ON question_views(user_id,viewed_at DESC);
CREATE TABLE security_alerts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES app_users(id),
 kind text NOT NULL CHECK(kind IN ('hourly_limit','burst')), details jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz, resolved_by uuid REFERENCES app_users(id), resolution text
);
CREATE INDEX security_alert_open ON security_alerts(created_at DESC) WHERE resolved_at IS NULL;
CREATE TABLE app_settings (
 key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES app_users(id)
);
