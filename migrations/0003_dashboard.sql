-- Passi camminati, un valore al giorno.
CREATE TABLE steps (
  client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 'AAAA-MM-GG' nel fuso del cliente.
  day       TEXT NOT NULL,
  steps     INTEGER NOT NULL,
  at        TEXT NOT NULL,
  PRIMARY KEY (client_id, day)
);

-- Pasti spuntati dal cliente.
CREATE TABLE meal_log (
  client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day       TEXT NOT NULL,
  meal_id   TEXT NOT NULL,
  -- 'fatto' | 'saltato'
  state     TEXT NOT NULL DEFAULT 'fatto',
  at        TEXT NOT NULL,
  PRIMARY KEY (client_id, day, meal_id)
);

CREATE INDEX meal_log_per_giorno ON meal_log (client_id, day);

-- PDF originale della dieta.
CREATE TABLE diet_files (
  diet_id    TEXT PRIMARY KEY REFERENCES diets(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  -- base64. Limite di riga D1: 1 MB.
  content    TEXT NOT NULL,
  size       INTEGER NOT NULL,
  uploaded_at TEXT NOT NULL
);
