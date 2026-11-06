CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE exam_families (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE, name text NOT NULL
);
CREATE TABLE exams (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), family_id uuid NOT NULL REFERENCES exam_families(id),
 slug text NOT NULL UNIQUE, name text NOT NULL, description text NOT NULL,
 launch_status text NOT NULL DEFAULT 'planned' CHECK (launch_status IN ('planned','live')),
 blueprint jsonb NOT NULL DEFAULT '{}', settings jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE sittings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), exam_id uuid NOT NULL REFERENCES exams(id),
 slug text NOT NULL, label text NOT NULL, year integer NOT NULL CHECK(year BETWEEN 1900 AND 2200),
 starts_on date, published boolean NOT NULL DEFAULT false, UNIQUE(exam_id,slug), UNIQUE(id,exam_id)
);
CREATE TABLE plans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), exam_id uuid NOT NULL REFERENCES exams(id),
 months integer NOT NULL CHECK(months IN (3,6,12)), price_cents integer NOT NULL CHECK(price_cents>0),
 stripe_price_id text UNIQUE, active boolean NOT NULL DEFAULT false, UNIQUE(exam_id,months)
);
CREATE TABLE app_users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), auth_id text NOT NULL UNIQUE,
 role text NOT NULL CHECK(role IN ('student','reviewer','content_manager','super_admin')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE questions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), exam_id uuid NOT NULL REFERENCES exams(id),
 status text NOT NULL DEFAULT 'raw' CHECK(status IN ('raw','ai_refined','in_review','approved','published','retired')),
 current_version_id uuid, UNIQUE(id,exam_id)
);
CREATE TABLE question_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), question_id uuid NOT NULL REFERENCES questions(id),
 version integer NOT NULL CHECK(version>0), stem text NOT NULL, options jsonb NOT NULL,
 correct_answers jsonb NOT NULL, explanation text NOT NULL, references_json jsonb NOT NULL DEFAULT '[]',
 confidence integer CHECK(confidence BETWEEN 0 AND 100), needs_expert boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(question_id,version), UNIQUE(id,question_id)
);
ALTER TABLE questions ADD CONSTRAINT current_version_owner FOREIGN KEY(current_version_id,id) REFERENCES question_versions(id,question_id);
CREATE TABLE question_sittings (
 question_id uuid NOT NULL, sitting_id uuid NOT NULL, exam_id uuid NOT NULL,
 source_count integer NOT NULL DEFAULT 1 CHECK(source_count>0),
 PRIMARY KEY(question_id,sitting_id),
 FOREIGN KEY(question_id,exam_id) REFERENCES questions(id,exam_id),
 FOREIGN KEY(sitting_id,exam_id) REFERENCES sittings(id,exam_id)
);
CREATE TABLE organisations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL);
CREATE TABLE entitlements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES app_users(id),
 exam_id uuid NOT NULL REFERENCES exams(id), organisation_id uuid REFERENCES organisations(id),
 source text NOT NULL CHECK(source IN ('subscription','trial','partner','complimentary')),
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, revoked_at timestamptz,
 CHECK(ends_at>starts_at)
);
CREATE INDEX entitlement_lookup ON entitlements(user_id,exam_id,ends_at);
CREATE TABLE audit_log (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL REFERENCES app_users(id),
 action text NOT NULL, entity_id uuid NOT NULL, before_json jsonb, after_json jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION prevent_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN RAISE EXCEPTION 'Audit records are append-only'; END;
$$;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
CREATE INDEX question_catalogue ON questions(exam_id,status);
