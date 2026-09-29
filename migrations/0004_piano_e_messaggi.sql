-- Sostituzione ammessa dal piano nel momento in cui è stata fatta.
ALTER TABLE variations ADD COLUMN in_plan INTEGER NOT NULL DEFAULT 0;

-- Automazione della chat, per singolo cliente.
ALTER TABLE links ADD COLUMN auto_chat INTEGER NOT NULL DEFAULT 1;

-- Conversazione fra cliente e studio.
CREATE TABLE messages (
  id              TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nutritionist_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at              TEXT NOT NULL,
  -- 'cliente' | 'studio' | 'assistente'
  author          TEXT NOT NULL CHECK (author IN ('cliente', 'studio', 'assistente')),
  body            TEXT NOT NULL,
  -- NULL = non ancora letto.
  read_at         TEXT
);

CREATE INDEX messages_filo ON messages (client_id, at);
CREATE INDEX messages_studio ON messages (nutritionist_id, at DESC);
