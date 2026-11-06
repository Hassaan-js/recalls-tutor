CREATE TABLE auth_users (
 id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE,
 email_verified boolean NOT NULL DEFAULT false, image text, two_factor_enabled boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);
CREATE TABLE auth_sessions (
 id text PRIMARY KEY, token text NOT NULL UNIQUE, user_id text NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
 ip_address text, user_agent text
);
CREATE INDEX auth_session_user ON auth_sessions(user_id);
CREATE TABLE auth_accounts (
 id text PRIMARY KEY, account_id text NOT NULL, provider_id text NOT NULL,
 user_id text NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
 access_token text, refresh_token text, id_token text, access_token_expires_at timestamptz, refresh_token_expires_at timestamptz,
 scope text, password text, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
 UNIQUE(provider_id,account_id)
);
CREATE INDEX auth_account_user ON auth_accounts(user_id);
CREATE TABLE auth_verifications (
 id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);
CREATE INDEX auth_verification_identifier ON auth_verifications(identifier);
CREATE TABLE auth_two_factors (
 id text PRIMARY KEY, user_id text NOT NULL UNIQUE REFERENCES auth_users(id) ON DELETE CASCADE,
 secret text NOT NULL, backup_codes text NOT NULL, verified boolean DEFAULT true,
 failed_verification_count integer DEFAULT 0, locked_until timestamptz
);
CREATE TABLE auth_rate_limits (id text PRIMARY KEY, key text NOT NULL UNIQUE, count integer NOT NULL, last_request bigint NOT NULL);
