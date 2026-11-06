-- BILL-6: coupons and promotion codes, managed here and created in Stripe. Each row is one Stripe coupon
-- with one promotion code. Personal codes (win-back, trial offer) are single-use and tied to one account.
CREATE TABLE coupons (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 code text NOT NULL CHECK(code ~ '^[A-Z0-9-]{3,40}$'),
 name text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('percent','amount')),
 percent_off numeric(5,2),
 amount_off_cents integer,
 duration text NOT NULL CHECK(duration IN ('once','repeating','forever')),
 duration_months integer CHECK(duration_months BETWEEN 1 AND 36),
 exam_ids uuid[] NOT NULL DEFAULT '{}',
 max_redemptions integer CHECK(max_redemptions>0),
 expires_at timestamptz,
 first_time_only boolean NOT NULL DEFAULT false,
 purpose text NOT NULL DEFAULT 'campaign' CHECK(purpose IN ('campaign','win_back','trial_offer')),
 user_id uuid REFERENCES app_users(id),
 stripe_coupon_id text UNIQUE,
 stripe_promotion_code_id text UNIQUE,
 active boolean NOT NULL DEFAULT true,
 created_by uuid REFERENCES app_users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 deactivated_at timestamptz,
 CHECK((kind='percent' AND percent_off>0 AND percent_off<=100 AND amount_off_cents IS NULL) OR (kind='amount' AND amount_off_cents>0 AND percent_off IS NULL)),
 CHECK((duration='repeating')=(duration_months IS NOT NULL)),
 CHECK((purpose='campaign')=(user_id IS NULL))
);
CREATE UNIQUE INDEX coupon_code ON coupons(code);
-- One personal offer of each kind per account and exam.
CREATE UNIQUE INDEX coupon_personal ON coupons(user_id,purpose,exam_ids) WHERE user_id IS NOT NULL;

-- Revenue ledger, written from paid invoices. Amounts are what Stripe charged, in cents.
CREATE TABLE billing_payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 stripe_invoice_id text NOT NULL UNIQUE,
 stripe_charge_id text,
 subscription_id uuid REFERENCES subscriptions(id),
 user_id uuid REFERENCES app_users(id),
 exam_id uuid REFERENCES exams(id),
 plan_id uuid REFERENCES plans(id),
 sitting_id uuid REFERENCES sittings(id),
 kind text NOT NULL CHECK(kind IN ('new','renewal','other')),
 amount_cents integer NOT NULL,
 discount_cents integer NOT NULL DEFAULT 0,
 currency text NOT NULL DEFAULT 'usd',
 coupon_id uuid REFERENCES coupons(id),
 paid_at timestamptz NOT NULL
);
CREATE INDEX payment_paid_at ON billing_payments(paid_at);
CREATE INDEX payment_charge ON billing_payments(stripe_charge_id);
-- Refunds (total refunded per charge) and disputes (one row per dispute).
CREATE TABLE billing_adjustments (
 id text PRIMARY KEY,
 kind text NOT NULL CHECK(kind IN ('refund','dispute')),
 stripe_charge_id text NOT NULL,
 payment_id uuid REFERENCES billing_payments(id),
 amount_cents integer NOT NULL,
 status text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX adjustment_created ON billing_adjustments(created_at);

-- BILL-7 / TRIAL-2: lifecycle emails are sent once per subscription period or trial.
CREATE TABLE lifecycle_emails (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 kind text NOT NULL,
 user_id uuid NOT NULL REFERENCES app_users(id),
 ref text NOT NULL,
 coupon_id uuid REFERENCES coupons(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 sent_at timestamptz,
 attempts integer NOT NULL DEFAULT 0,
 last_error text,
 UNIQUE(kind,ref)
);
CREATE INDEX lifecycle_unsent ON lifecycle_emails(created_at) WHERE sent_at IS NULL;
ALTER TABLE student_profiles ADD COLUMN IF NOT EXISTS marketing_emails boolean NOT NULL DEFAULT true;
