CREATE TABLE recall_sources (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), question_id uuid NOT NULL UNIQUE REFERENCES questions(id),
 source_text text NOT NULL, source_label text NOT NULL, created_by uuid NOT NULL REFERENCES app_users(id),
 request_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(created_by,request_id)
);
CREATE FUNCTION prevent_version_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN RAISE EXCEPTION 'Question versions are immutable'; END;
$$;
CREATE TRIGGER version_append_only BEFORE UPDATE OR DELETE ON question_versions FOR EACH ROW EXECUTE FUNCTION prevent_version_mutation();
