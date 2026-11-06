-- BILL-1: one Stripe Product per exam; a price change creates a new plan row and Stripe Price.
-- Old rows stay (inactive) so existing subscribers on the old Price still map to their plan.
ALTER TABLE exams ADD COLUMN stripe_product_id text UNIQUE;
ALTER TABLE plans DROP CONSTRAINT plans_exam_id_months_key;
CREATE UNIQUE INDEX plan_active_duration ON plans(exam_id,months) WHERE active;
ALTER TABLE plans ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE billing_customers (
 user_id uuid PRIMARY KEY REFERENCES app_users(id), stripe_customer_id text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);
-- Mirror of each Stripe subscription. Access is never read from here directly: it is written to entitlements.
CREATE TABLE subscriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES app_users(id), exam_id uuid NOT NULL REFERENCES exams(id),
 plan_id uuid NOT NULL REFERENCES plans(id), stripe_subscription_id text NOT NULL UNIQUE, stripe_customer_id text NOT NULL,
 status text NOT NULL, current_period_start timestamptz, current_period_end timestamptz, cancel_at_period_end boolean NOT NULL DEFAULT false,
 grace_until timestamptz, access_hold text CHECK(access_hold IN ('refunded','disputed')), entitlement_id uuid REFERENCES entitlements(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subscription_owner ON subscriptions(user_id,exam_id);
ALTER TABLE entitlements ADD COLUMN subscription_id uuid REFERENCES subscriptions(id);
-- BILL-4: every Stripe event id is recorded once; a repeat delivery is acknowledged without being processed again.
CREATE TABLE webhook_events (
 id text PRIMARY KEY, type text NOT NULL, object_id text, received_at timestamptz NOT NULL DEFAULT now(),
 processed_at timestamptz, attempts integer NOT NULL DEFAULT 0, error text
);
CREATE TABLE billing_alerts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL CHECK(kind IN ('dispute','reconciliation','webhook_failure')),
 subscription_id uuid REFERENCES subscriptions(id), details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
 resolved_at timestamptz, resolved_by uuid REFERENCES app_users(id), resolution text
);
