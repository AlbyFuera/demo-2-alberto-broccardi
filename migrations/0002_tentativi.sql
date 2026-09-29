CREATE TABLE attempts (
  key         TEXT PRIMARY KEY,
  count       INTEGER NOT NULL DEFAULT 0,
  -- Inizio della finestra corrente.
  window_from TEXT NOT NULL
);

CREATE INDEX attempts_by_window ON attempts (window_from);
