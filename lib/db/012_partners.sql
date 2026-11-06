-- PART-2/3/4/6: partners (organisations) buy seats and hand them to their students in the Partner Portal or
-- through the /v1 API. A seat is one student's access to one exam for 3, 6 or 12 months, written as a 'partner'
-- entitlement, so the practice engine needs no change.
ALTER TABLE organisations
 ADD COLUMN slug text UNIQUE CHECK(slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
 ADD COLUMN status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','suspended')),
 ADD COLUMN billing text NOT NULL DEFAULT 'prepaid' CHECK(billing IN ('prepaid','postpaid')),
 -- Postpaid only: the most seats the partner may assign in one calendar month before it is invoiced.
 ADD COLUMN credit_limit_seats integer CHECK(credit_limit_seats>0),
 ADD COLUMN low_balance_at integer NOT NULL DEFAULT 5 CHECK(low_balance_at BETWEEN 0 AND 10000),
 ADD COLUMN contact_email text CHECK(length(contact_email)<=254),
 ADD COLUMN notes text NOT NULL DEFAULT '' CHECK(length(notes)<=1000),
 ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN approved_at timestamptz,
 ADD COLUMN suspended_at timestamptz;
ALTER TABLE organisations ADD CONSTRAINT organisation_name CHECK(length(name) BETWEEN 2 AND 120);
-- Partner admins are ordinary accounts linked to an organisation; they see nothing outside it.
CREATE TABLE organisation_members (
 organisation_id uuid NOT NULL REFERENCES organisations(id), user_id uuid NOT NULL REFERENCES app_users(id),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(organisation_id,user_id)
);
CREATE INDEX organisation_member_user ON organisation_members(user_id);
-- The exams and durations a partner may assign, with the agreed price per seat (set by a Super Admin).
CREATE TABLE partner_products (
 organisation_id uuid NOT NULL REFERENCES organisations(id), exam_id uuid NOT NULL REFERENCES exams(id),
 months integer NOT NULL CHECK(months IN (3,6,12)), seat_price_cents integer CHECK(seat_price_cents>=0),
 PRIMARY KEY(organisation_id,exam_id,months)
);
-- Prepaid seat packs. Unused seats roll over until the pack expires.
CREATE TABLE seat_packs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id uuid NOT NULL REFERENCES organisations(id),
 exam_id uuid NOT NULL REFERENCES exams(id), months integer NOT NULL CHECK(months IN (3,6,12)),
 seats integer NOT NULL CHECK(seats BETWEEN 1 AND 100000), price_cents integer CHECK(price_cents>=0),
 reference text NOT NULL DEFAULT '' CHECK(length(reference)<=200),
 purchased_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, created_by uuid NOT NULL REFERENCES app_users(id),
 CHECK(expires_at>purchased_at)
);
CREATE INDEX seat_pack_lookup ON seat_packs(organisation_id,exam_id,months,expires_at);
CREATE TABLE partner_invite_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id uuid NOT NULL REFERENCES organisations(id),
 exam_id uuid NOT NULL REFERENCES exams(id), months integer NOT NULL CHECK(months IN (3,6,12)),
 token_hash text NOT NULL UNIQUE, label text NOT NULL DEFAULT '' CHECK(length(label)<=120),
 cap integer NOT NULL CHECK(cap BETWEEN 1 AND 1000), expires_at timestamptz NOT NULL,
 created_by uuid NOT NULL REFERENCES app_users(id), created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz
);
-- One row per seat assignment. 'invited' waits for the student to sign in with that email; 'active' has an
-- entitlement. A seat goes back to the balance only when an enrolment is revoked before it is activated.
-- Sandbox enrolments use test seats, never create accounts, entitlements or emails, and never touch billing.
CREATE TABLE partner_enrollments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id uuid NOT NULL REFERENCES organisations(id),
 exam_id uuid NOT NULL REFERENCES exams(id), months integer NOT NULL CHECK(months IN (3,6,12)),
 email text NOT NULL CHECK(email=lower(email) AND length(email) BETWEEN 3 AND 254),
 sandbox boolean NOT NULL DEFAULT false,
 source text NOT NULL CHECK(source IN ('portal','csv','link','api')),
 external_ref text CHECK(length(external_ref)<=200),
 status text NOT NULL DEFAULT 'invited' CHECK(status IN ('invited','active','revoked')),
 user_id uuid REFERENCES app_users(id), entitlement_id uuid REFERENCES entitlements(id),
 seat_pack_id uuid REFERENCES seat_packs(id), link_id uuid REFERENCES partner_invite_links(id),
 created_by uuid REFERENCES app_users(id), created_at timestamptz NOT NULL DEFAULT now(),
 invite_sent_at timestamptz, activated_at timestamptz, ends_at timestamptz, revoked_at timestamptz,
 expiring_sent_at timestamptz, expired_sent_at timestamptz,
 CHECK(status<>'active' OR (activated_at IS NOT NULL AND ends_at IS NOT NULL)),
 CHECK(sandbox OR status<>'active' OR (user_id IS NOT NULL AND entitlement_id IS NOT NULL))
);
-- Extending an active enrolment uses one more seat of the chosen duration.
CREATE TABLE partner_extensions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), enrollment_id uuid NOT NULL REFERENCES partner_enrollments(id),
 months integer NOT NULL CHECK(months IN (3,6,12)), seat_pack_id uuid REFERENCES seat_packs(id),
 created_by uuid REFERENCES app_users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX partner_extension_pack ON partner_extensions(seat_pack_id);
CREATE INDEX partner_enrollment_org ON partner_enrollments(organisation_id,sandbox,created_at DESC);
CREATE INDEX partner_enrollment_claim ON partner_enrollments(email) WHERE status='invited' AND NOT sandbox;
CREATE INDEX partner_enrollment_pack ON partner_enrollments(seat_pack_id);
CREATE INDEX partner_enrollment_ends ON partner_enrollments(ends_at) WHERE status='active';
-- Students choose whether a partner may see their progress (PART-3 cohort reports, GET /enrollments/{id}/progress).
CREATE TABLE partner_consents (
 user_id uuid NOT NULL REFERENCES app_users(id), organisation_id uuid NOT NULL REFERENCES organisations(id),
 granted_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz, PRIMARY KEY(user_id,organisation_id)
);
-- API keys: 32 random bytes, stored only as a SHA-256 hash and shown once. A rotated key keeps working for
-- 24 hours (expires_at) so the partner can deploy the new one. A Super Admin can suspend a key instantly.
CREATE TABLE api_keys (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id uuid NOT NULL REFERENCES organisations(id),
 mode text NOT NULL CHECK(mode IN ('live','test')), label text NOT NULL DEFAULT '' CHECK(length(label)<=80),
 prefix text NOT NULL, secret_hash text NOT NULL UNIQUE, ip_allow text[] NOT NULL DEFAULT '{}',
 created_by uuid NOT NULL REFERENCES app_users(id), created_at timestamptz NOT NULL DEFAULT now(),
 last_used_at timestamptz, expires_at timestamptz, revoked_at timestamptz, suspended_at timestamptz
);
CREATE INDEX api_key_org ON api_keys(organisation_id);
-- Every write carries an Idempotency-Key. The first response is stored for 24 hours and replayed on retry, so a
-- retried course purchase never uses a second seat.
CREATE TABLE api_idempotency (
 organisation_id uuid NOT NULL REFERENCES organisations(id), mode text NOT NULL, key text NOT NULL,
 request_hash text NOT NULL, status integer NOT NULL, response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organisation_id,mode,key)
);
-- The request log shown in the portal; it also drives the per-key rate limit.
CREATE TABLE api_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id uuid REFERENCES organisations(id), key_id uuid REFERENCES api_keys(id),
 mode text, method text NOT NULL, path text NOT NULL, status integer NOT NULL, ip text,
 idempotency_key text, replayed boolean NOT NULL DEFAULT false, duration_ms integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_request_key ON api_requests(key_id,created_at DESC);
CREATE INDEX api_request_org ON api_requests(organisation_id,created_at DESC);
-- Outbound webhooks, signed with HMAC-SHA256 and retried with backoff.
CREATE TABLE webhook_endpoints (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id uuid NOT NULL REFERENCES organisations(id),
 mode text NOT NULL CHECK(mode IN ('live','test')), url text NOT NULL CHECK(url LIKE 'https://%' AND length(url)<=500),
 secret text NOT NULL, events text[] NOT NULL, created_by uuid NOT NULL REFERENCES app_users(id),
 created_at timestamptz NOT NULL DEFAULT now(), disabled_at timestamptz
);
CREATE TABLE webhook_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), endpoint_id uuid NOT NULL REFERENCES webhook_endpoints(id),
 event text NOT NULL, payload jsonb NOT NULL, attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz DEFAULT now(), delivered_at timestamptz, last_status integer, last_error text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webhook_due ON webhook_deliveries(next_attempt_at) WHERE delivered_at IS NULL AND next_attempt_at IS NOT NULL;
CREATE INDEX webhook_endpoint_recent ON webhook_deliveries(endpoint_id,created_at DESC);
-- Low-balance and expiring-pack alerts are sent once per pack and threshold crossing.
ALTER TABLE seat_packs ADD COLUMN expiring_sent_at timestamptz;
CREATE TABLE partner_alerts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id uuid NOT NULL REFERENCES organisations(id),
 kind text NOT NULL CHECK(kind IN ('low_balance','pack_expiring')), exam_id uuid REFERENCES exams(id), months integer,
 message text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), emailed_at timestamptz, dismissed_at timestamptz
);
CREATE INDEX partner_alert_open ON partner_alerts(organisation_id) WHERE dismissed_at IS NULL;
