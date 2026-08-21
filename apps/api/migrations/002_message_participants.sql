-- Retain the intended recipient on the message itself. This makes sender copies
-- queryable as conversations while keeping each viewer's ciphertext separate.
ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS recipient text REFERENCES users(username) ON DELETE RESTRICT;

UPDATE direct_messages AS message
SET recipient = envelope.recipient
FROM (
  SELECT DISTINCT ON (message_id) message_id, recipient
  FROM recipient_envelopes
  ORDER BY message_id, received_at
) AS envelope
WHERE message.id = envelope.message_id
  AND message.recipient IS NULL;

ALTER TABLE direct_messages ALTER COLUMN recipient SET NOT NULL;
CREATE INDEX IF NOT EXISTS direct_messages_sender_recipient_sent_at
  ON direct_messages(sender, recipient, sent_at, id);
