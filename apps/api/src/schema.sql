-- PostgreSQL persistence contract. Ciphertext/protocol material is always bytea.
CREATE TABLE users (username text PRIMARY KEY, identity_signing_public_key bytea NOT NULL, identity_dh_public_key bytea NOT NULL, key_version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE installations (username text PRIMARY KEY REFERENCES users(username), installation_id uuid NOT NULL, activated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE signed_prekeys (username text NOT NULL REFERENCES users(username), key_id integer NOT NULL, public_key bytea NOT NULL, signature bytea NOT NULL, active boolean NOT NULL DEFAULT true, PRIMARY KEY(username,key_id));
CREATE TABLE one_time_prekeys (username text NOT NULL REFERENCES users(username), key_id integer NOT NULL, public_key bytea NOT NULL, consumed_at timestamptz, PRIMARY KEY(username,key_id));
CREATE TABLE consumed_challenges (challenge_id uuid PRIMARY KEY, username text NOT NULL REFERENCES users(username), purpose text NOT NULL, expires_at timestamptz NOT NULL, consumed_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE direct_messages (id uuid PRIMARY KEY, sender text NOT NULL REFERENCES users(username), idempotency_id uuid NOT NULL, sent_at timestamptz NOT NULL, UNIQUE(sender,idempotency_id));
CREATE TABLE recipient_envelopes (message_id uuid NOT NULL REFERENCES direct_messages(id), recipient text NOT NULL REFERENCES users(username), recipient_key_version integer NOT NULL, ciphertext bytea NOT NULL, prekey_message boolean NOT NULL, PRIMARY KEY(message_id,recipient));
CREATE INDEX recipient_envelopes_cursor ON recipient_envelopes(recipient, message_id);
CREATE TABLE deletion_markers (username text NOT NULL REFERENCES users(username), conversation_id uuid NOT NULL, deleted_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(username,conversation_id));
