-- BILL-8: an optional 1-month plan alongside 3, 6 and 12 months.
ALTER TABLE plans DROP CONSTRAINT IF EXISTS plans_months_check;
ALTER TABLE plans ADD CONSTRAINT plans_months_check CHECK(months IN (1,3,6,12));
-- Referrals: every student can share a link; a friend's first payment can earn the referrer a personal code.
ALTER TABLE coupons DROP CONSTRAINT IF EXISTS coupons_purpose_check;
ALTER TABLE coupons ADD CONSTRAINT coupons_purpose_check CHECK(purpose IN ('campaign','win_back','trial_offer','referral'));
-- A referrer can earn one code per friend, so referral codes are exempt from the one-per-exam rule.
DROP INDEX IF EXISTS coupon_personal;
CREATE UNIQUE INDEX coupon_personal ON coupons(user_id,purpose,exam_ids) WHERE user_id IS NOT NULL AND purpose<>'referral';
CREATE TABLE referral_codes (
 user_id uuid PRIMARY KEY REFERENCES app_users(id),
 code text NOT NULL UNIQUE CHECK(code ~ '^[a-z0-9]{6,12}$'),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE referrals (
 referee_id uuid PRIMARY KEY REFERENCES app_users(id),
 referrer_id uuid NOT NULL REFERENCES app_users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 converted_at timestamptz,
 reward_coupon_id uuid REFERENCES coupons(id),
 CHECK(referee_id<>referrer_id)
);
CREATE INDEX referral_referrer ON referrals(referrer_id);
-- PART-2 white-label (R3): a partner's own name, logo and colour on its invite pages and portal.
ALTER TABLE organisations ADD COLUMN brand_name text CHECK(length(brand_name)<=80);
ALTER TABLE organisations ADD COLUMN brand_logo_url text CHECK(brand_logo_url ~ '^https://');
ALTER TABLE organisations ADD COLUMN brand_color text CHECK(brand_color ~ '^#[0-9a-fA-F]{6}$');
-- STU-14: the AI tutor answers questions about one question's approved explanation. Each request is logged for
-- the rate limit and cost; the student's text is kept for 30 days for abuse review.
CREATE TABLE tutor_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES app_users(id),
 question_id uuid NOT NULL REFERENCES questions(id),
 version_id uuid NOT NULL REFERENCES question_versions(id),
 prompt text NOT NULL CHECK(length(prompt)<=500),
 answer text,
 model text, cost_usd numeric(10,4),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tutor_user_time ON tutor_requests(user_id,created_at);
-- STU-15: moderated per-question discussion. A comment is visible only after a staff member approves it.
CREATE TABLE question_comments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 question_id uuid NOT NULL REFERENCES questions(id),
 user_id uuid NOT NULL REFERENCES app_users(id),
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 1500),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 moderated_by uuid REFERENCES app_users(id), moderated_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX question_comment_visible ON question_comments(question_id,created_at) WHERE status='approved';
CREATE INDEX question_comment_pending ON question_comments(created_at) WHERE status='pending';
