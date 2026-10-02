-- Scheda clinica del cliente: la scrive il professionista, il cliente non la vede.
CREATE TABLE client_profiles (
  client_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nutritionist_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 'AAAA-MM-GG'
  birth_date      TEXT,
  -- 'F' | 'M' | NULL
  sex             TEXT,
  height_cm       REAL,
  -- Testo libero, voci separate da virgole.
  allergies       TEXT NOT NULL DEFAULT '',
  conditions      TEXT NOT NULL DEFAULT '',
  medications     TEXT NOT NULL DEFAULT '',
  preferences     TEXT NOT NULL DEFAULT '',
  -- Prossimo controllo, 'AAAA-MM-GGTHH:MM'. Questo il cliente lo vede.
  next_visit      TEXT,
  updated_at      TEXT NOT NULL,
  PRIMARY KEY (client_id, nutritionist_id)
);

-- Peso e misure: una riga al giorno, la scrive il cliente o lo studio.
CREATE TABLE measurements (
  client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day       TEXT NOT NULL,
  weight    REAL,
  waist     REAL,
  hips      REAL,
  body_fat  REAL,
  -- Chi ha scritto per ultimo: 'cliente' | 'studio'
  author    TEXT NOT NULL CHECK (author IN ('cliente', 'studio')),
  at        TEXT NOT NULL,
  PRIMARY KEY (client_id, day)
);

-- Note private del professionista, una per visita o per pensiero.
CREATE TABLE notes (
  id              TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nutritionist_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at              TEXT NOT NULL,
  body            TEXT NOT NULL
);

CREATE INDEX notes_cliente ON notes (client_id, nutritionist_id, at DESC);

-- Acqua bevuta, in millilitri, un valore al giorno.
CREATE TABLE water (
  client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day       TEXT NOT NULL,
  ml        INTEGER NOT NULL,
  at        TEXT NOT NULL,
  PRIMARY KEY (client_id, day)
);
