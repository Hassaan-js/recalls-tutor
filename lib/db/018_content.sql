-- SEO-2: free sample questions chosen by staff. A sample is public on purpose, so it is marked one question at a
-- time by a content manager; nothing else from the paid bank ever reaches public HTML (SEO-6).
ALTER TABLE questions ADD COLUMN public_sample boolean NOT NULL DEFAULT false;
ALTER TABLE questions ADD COLUMN sample_slug text;
ALTER TABLE questions ADD COLUMN sample_marked_by uuid REFERENCES app_users(id);
ALTER TABLE questions ADD COLUMN sample_marked_at timestamptz;
CREATE UNIQUE INDEX question_sample_slug ON questions(exam_id,sample_slug) WHERE sample_slug IS NOT NULL;
-- SEO-2: blog posts and guides, including "What came up in {exam} {sitting}" reports.
CREATE TABLE blog_posts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 slug text NOT NULL UNIQUE CHECK(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 kind text NOT NULL DEFAULT 'post' CHECK(kind IN ('post','guide','sitting_report')),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
 excerpt text NOT NULL DEFAULT '' CHECK(length(excerpt)<=300),
 body text NOT NULL DEFAULT '' CHECK(length(body)<=60000),
 exam_id uuid REFERENCES exams(id), sitting_id uuid REFERENCES sittings(id),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),
 author_id uuid REFERENCES app_users(id), published_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX blog_published ON blog_posts(published_at DESC) WHERE status='published';
