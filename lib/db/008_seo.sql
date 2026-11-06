-- SEO-1: public URLs are /{family}/{exam seo slug}/{sitting slug}, e.g. /mrcog/part-1-recalls/september-2026.
ALTER TABLE exams ADD COLUMN seo_slug text;
UPDATE exams e SET seo_slug=regexp_replace(e.slug,'^'||f.slug||'-','')||'-recalls' FROM exam_families f WHERE f.id=e.family_id;
CREATE UNIQUE INDEX exam_seo_slug ON exams(family_id,seo_slug);
-- SEO-4: editable title, description and H1 per public path; blank fields fall back to database-driven defaults.
CREATE TABLE page_meta (
 path text PRIMARY KEY CHECK(path ~ '^/[a-z0-9/-]*$'), title text, description text, h1 text,
 updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES app_users(id)
);
-- Policy and company pages are edited by staff, not hard-coded.
CREATE TABLE site_pages (
 slug text PRIMARY KEY CHECK(slug IN ('about','contact','terms','privacy','refund-policy')), title text NOT NULL, body text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES app_users(id)
);
CREATE TABLE faqs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), exam_id uuid REFERENCES exams(id), question text NOT NULL, answer text NOT NULL,
 sort integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
);
-- SEO-4 301 redirect manager.
CREATE TABLE redirects (
 from_path text PRIMARY KEY CHECK(from_path ~ '^/[a-z0-9/-]+$'), to_path text NOT NULL CHECK(to_path ~ '^/[a-z0-9/#?=&-]*$'),
 created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES app_users(id)
);
