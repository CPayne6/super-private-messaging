-- SPM PostgreSQL persistence contract (v1).
-- This schema contains public keys and opaque protocol bytes only; plaintext and vault bytes
-- are deliberately absent. Apply with PostgreSQL 16+ (gen_random_uuid requires pgcrypto).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  username text PRIMARY KEY CHECK (username ~ '^[a-z][a-z0-9_]{2,31}$'),
  identity_signing_public_key bytea NOT NULL CHECK (octet_length(identity_signing_public_key) = 32),
  identity_dh_public_key bytea NOT NULL CHECK (octet_length(identity_dh_public_key) = 32),
  key_version integer NOT NULL DEFAULT 1 CHECK (key_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz
);

-- One live installation per identity. Replacing this row invalidates copied/stale vaults.
CREATE TABLE installations (
  username text PRIMARY KEY REFERENCES users(username) ON DELETE RESTRICT,
  installation_id uuid NOT NULL UNIQUE,
  activated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE signed_prekeys (
  username text NOT NULL REFERENCES users(username) ON DELETE RESTRICT,
  key_version integer NOT NULL CHECK (key_version > 0),
  key_id integer NOT NULL CHECK (key_id >= 0),
  public_key bytea NOT NULL CHECK (octet_length(public_key) = 32),
  signature bytea NOT NULL CHECK (octet_length(signature) = 64),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  PRIMARY KEY (username, key_version, key_id)
);
CREATE UNIQUE INDEX signed_prekeys_one_active_per_version
  ON signed_prekeys (username, key_version) WHERE active;

CREATE TABLE one_time_prekeys (
  username text NOT NULL REFERENCES users(username) ON DELETE RESTRICT,
  key_version integer NOT NULL CHECK (key_version > 0),
  key_id integer NOT NULL CHECK (key_id >= 0),
  public_key bytea NOT NULL CHECK (octet_length(public_key) = 32),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (username, key_version, key_id)
);
CREATE INDEX one_time_prekeys_available
  ON one_time_prekeys (username, key_version, key_id) WHERE consumed_at IS NULL;

-- Issue challenges outside this schema and insert at issuance. Consumption must be a single
-- conditional UPDATE: WHERE consumed_at IS NULL AND expires_at > now().
CREATE TABLE consumed_challenges (
  challenge_id uuid PRIMARY KEY,
  username text NOT NULL REFERENCES users(username) ON DELETE RESTRICT,
  purpose text NOT NULL CHECK (purpose IN ('private-http', 'socket-connect', 'socket-send')),
  route text NOT NULL CHECK (length(route) BETWEEN 1 AND 256),
  method text NOT NULL CHECK (method ~ '^[A-Z]+$'),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE INDEX consumed_challenges_unconsumed_expiry ON consumed_challenges (expires_at) WHERE consumed_at IS NULL;

-- Conversation UUID is a deterministic opaque client identifier; never derive it from message plaintext.
CREATE TABLE direct_messages (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL,
  sender text NOT NULL REFERENCES users(username) ON DELETE RESTRICT,
  sender_key_version integer NOT NULL CHECK (sender_key_version > 0),
  idempotency_id uuid NOT NULL,
  sent_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sender, idempotency_id)
);
CREATE INDEX direct_messages_conversation_cursor ON direct_messages (conversation_id, id);

-- Partition recipient envelopes by received_at before production scale. The initial default
-- partition preserves a simple local install while allowing monthly partitions to be attached.
CREATE TABLE recipient_envelopes (
  message_id uuid NOT NULL,
  recipient text NOT NULL REFERENCES users(username) ON DELETE RESTRICT,
  recipient_key_version integer NOT NULL CHECK (recipient_key_version > 0),
  ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) > 0 AND octet_length(ciphertext) <= 16384),
  prekey_message boolean NOT NULL,
  delivery_state text NOT NULL DEFAULT 'queued' CHECK (delivery_state IN ('queued', 'delivered')),
  delivered_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, recipient, received_at),
  FOREIGN KEY (message_id) REFERENCES direct_messages(id) ON DELETE RESTRICT
) PARTITION BY RANGE (received_at);
CREATE TABLE recipient_envelopes_default PARTITION OF recipient_envelopes DEFAULT;
CREATE INDEX recipient_envelopes_recipient_cursor ON recipient_envelopes (recipient, received_at DESC, message_id DESC);

-- A deletion only hides envelopes addressed to the requesting user. Retain the marker so a
-- delayed envelope cannot reappear after the user deletes the conversation.
CREATE TABLE deletion_markers (
  username text NOT NULL REFERENCES users(username) ON DELETE RESTRICT,
  conversation_id uuid NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (username, conversation_id)
);
CREATE INDEX deletion_markers_gc ON deletion_markers (deleted_at);

-- Repository transaction requirements:
-- * activation: INSERT ... ON CONFLICT (username) DO UPDATE SET installation_id = EXCLUDED.installation_id;
-- * OPK allocation: SELECT ... FOR UPDATE SKIP LOCKED, then set consumed_at in the same transaction.
-- * append: insert direct_messages, then recipient_envelopes; on (sender,idempotency_id) conflict return its id.
-- * listing: join recipient_envelopes to direct_messages and left join deletion_markers; exclude rows received_at <= deleted_at.
