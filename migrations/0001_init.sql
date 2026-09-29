CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('nutrizionista', 'cliente')),
  -- Vuoto alla registrazione, si imposta dalle impostazioni.
  name          TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  iterations    INTEGER NOT NULL,
  -- Solo per i clienti.
  goal          TEXT,
  created_at    TEXT NOT NULL,
  last_login    TEXT
);

CREATE UNIQUE INDEX users_email ON users (email);
CREATE INDEX users_by_role ON users (role);

-- Si salva l'hash del token, mai il token.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
);

CREATE INDEX sessions_by_user ON sessions (user_id);
CREATE INDEX sessions_by_expiry ON sessions (expires_at);

CREATE TABLE links (
  id              TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nutritionist_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 'in-attesa' | 'attivo' | 'rifiutato'
  status          TEXT NOT NULL DEFAULT 'in-attesa',
  -- Messaggio che il cliente scrive quando manda la richiesta.
  message         TEXT,
  requested_at    TEXT NOT NULL,
  decided_at      TEXT
);

CREATE UNIQUE INDEX links_coppia ON links (client_id, nutritionist_id);
CREATE INDEX links_per_studio ON links (nutritionist_id, status);
CREATE INDEX links_per_cliente ON links (client_id, status);

CREATE TABLE diets (
  id              TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nutritionist_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  -- 'bozza' | 'pubblicata' | 'archiviata'
  status          TEXT NOT NULL DEFAULT 'bozza',
  -- JSON, vedi src/types.ts
  diet_json       TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  published_at    TEXT
);

CREATE INDEX diets_per_cliente ON diets (client_id, status);
CREATE INDEX diets_per_studio ON diets (nutritionist_id, updated_at DESC);

CREATE TABLE foods (
  nutritionist_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Nome normalizzato, chiave di ricerca.
  key             TEXT NOT NULL,
  -- Nome come scritto dal professionista.
  label           TEXT NOT NULL,
  protein         REAL NOT NULL,
  carbs           REAL NOT NULL,
  fat             REAL NOT NULL,
  -- 'g100' | 'pz'
  per             TEXT NOT NULL DEFAULT 'g100',
  updated_at      TEXT NOT NULL,
  PRIMARY KEY (nutritionist_id, key, per)
);

-- Variazioni del cliente, alimentano le notifiche.
CREATE TABLE variations (
  id              TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nutritionist_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  diet_id         TEXT NOT NULL,
  at              TEXT NOT NULL,

  day             INTEGER NOT NULL,
  meal_id         TEXT NOT NULL,
  meal_name       TEXT NOT NULL,
  -- Posizione dell'alimento nel pasto.
  item_index      INTEGER NOT NULL,

  from_label      TEXT NOT NULL,
  from_qty        TEXT NOT NULL,
  to_label        TEXT NOT NULL,
  to_qty          TEXT NOT NULL,

  -- 'proteine' | 'carboidrati' | 'grassi' | 'nessuno'
  basis           TEXT NOT NULL,
  kcal_delta      REAL NOT NULL,
  protein_delta   REAL NOT NULL,
  carbs_delta     REAL NOT NULL,
  fat_delta       REAL NOT NULL,
  -- JSON array degli avvisi del motore.
  warnings        TEXT NOT NULL DEFAULT '[]',

  -- 'nuova' | 'vista' | 'annullata'
  status          TEXT NOT NULL DEFAULT 'nuova',
  seen_at         TEXT,
  -- Nota del professionista quando annulla.
  note            TEXT
);

CREATE INDEX variations_feed ON variations (nutritionist_id, status, at DESC);
CREATE INDEX variations_per_cliente ON variations (client_id, at DESC);

CREATE TABLE questions (
  id              TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nutritionist_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at              TEXT NOT NULL,
  question        TEXT NOT NULL,
  reason          TEXT NOT NULL,
  -- 'aperta' | 'chiusa'
  status          TEXT NOT NULL DEFAULT 'aperta',
  answer          TEXT,
  answered_at     TEXT
);

CREATE INDEX questions_feed ON questions (nutritionist_id, status, at DESC);
CREATE INDEX questions_per_cliente ON questions (client_id, at DESC);
