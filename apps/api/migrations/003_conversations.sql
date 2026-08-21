CREATE TABLE conversations (
  id uuid PRIMARY KEY,
  created_by text NOT NULL REFERENCES users(username) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE conversation_participants (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE RESTRICT,
  username text NOT NULL REFERENCES users(username) ON DELETE RESTRICT,
  key_version integer NOT NULL CHECK (key_version > 0),
  ephemeral_public_key bytea NOT NULL CHECK (octet_length(ephemeral_public_key) = 32),
  key_nonce bytea NOT NULL CHECK (octet_length(key_nonce) = 12),
  wrapped_key bytea NOT NULL CHECK (octet_length(wrapped_key) > 16),
  PRIMARY KEY (conversation_id, username)
);
CREATE INDEX conversation_participants_username ON conversation_participants(username, conversation_id);

CREATE TABLE conversation_messages (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE RESTRICT,
  sender text NOT NULL REFERENCES users(username) ON DELETE RESTRICT,
  ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) > 16 AND octet_length(ciphertext) <= 16384),
  nonce bytea NOT NULL CHECK (octet_length(nonce) = 12),
  sent_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversation_messages_order ON conversation_messages(conversation_id, sent_at, id);
