-- Schema iniziale.
--
-- Il database nasce vuoto. Chiunque può creare un account — professionista o
-- cliente — con la sola email e password; il nome si mette dalle impostazioni. Non c'è un codice di attivazione: la barriera
-- non è all'ingresso, è nel COLLEGAMENTO. Un cliente non vede niente finché un
-- professionista non lo accetta, e un professionista non vede nessuno finché
-- non accetta qualcuno.
--
-- Le diete sono conservate come JSON in `diets.days_json`. Non è pigrizia: una
-- dieta è un albero (giorni → pasti → alimenti) che il motore carica sempre
-- intero e non interroga mai a pezzi. Le colonne fuori dal JSON sono solo
-- quelle su cui si cerca o si filtra.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('nutrizionista', 'cliente')),
  -- Vuoto alla registrazione: si mette dalle impostazioni. Finché è vuoto
  -- l'interfaccia lo chiede, ma non impedisce di entrare.
  name          TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  iterations    INTEGER NOT NULL,
  -- Solo per i clienti: obiettivo dichiarato, note che il cliente scrive di sé.
  goal          TEXT,
  created_at    TEXT NOT NULL,
  last_login    TEXT
);

-- L'email identifica l'account nella schermata di accesso: deve essere unica a
-- prescindere dal ruolo, altrimenti «chi sei» non ha una risposta sola.
CREATE UNIQUE INDEX users_email ON users (email);
CREATE INDEX users_by_role ON users (role);

-- Sessioni. In tabella finisce l'HASH del token, non il token: chi legge il
-- database non può impersonare nessuno.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
);

CREATE INDEX sessions_by_user ON sessions (user_id);
CREATE INDEX sessions_by_expiry ON sessions (expires_at);

-- Il collegamento tra un cliente e il suo professionista.
--
-- Lo chiede il cliente, lo accetta il professionista. Finché è 'in-attesa' il
-- professionista NON vede nulla del cliente oltre nome ed email, e il cliente
-- non vede nulla di lui: un collegamento non accettato non dà accesso a niente.
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

-- Una richiesta sola per coppia: rimandarla aggiorna quella che c'è invece di
-- riempire il cruscotto del professionista con lo stesso nome dieci volte.
CREATE UNIQUE INDEX links_coppia ON links (client_id, nutritionist_id);
CREATE INDEX links_per_studio ON links (nutritionist_id, status);
CREATE INDEX links_per_cliente ON links (client_id, status);

-- La dieta, scritta a mano dal professionista giorno per giorno.
--
-- Un cliente ha UNA dieta pubblicata per volta. Le precedenti restano con
-- status 'archiviata': la storia di cosa ha seguito qualcuno non si cancella.
CREATE TABLE diets (
  id              TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nutritionist_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  -- 'bozza' | 'pubblicata' | 'archiviata'
  --
  -- La bozza NON è visibile al cliente. È la differenza che permette al
  -- professionista di scrivere il mercoledì senza che il cliente veda mezza
  -- settimana e la segua.
  status          TEXT NOT NULL DEFAULT 'bozza',
  -- JSON: { titolo, indicazioni[], obiettivi{}, giorni[] } — vedi src/types.ts
  diet_json       TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  published_at    TEXT
);

CREATE INDEX diets_per_cliente ON diets (client_id, status);
CREATE INDEX diets_per_studio ON diets (nutritionist_id, updated_at DESC);

-- La libreria di alimenti dello studio.
--
-- Quando il professionista scrive un alimento che la tabella interna non
-- conosce, l'interfaccia gli chiede i valori per 100 g e finiscono qui. Da quel
-- momento vincono sui valori interni per TUTTE le sue diete, e non glieli
-- richiede mai più. Sono i suoi numeri e se ne assume la responsabilità.
CREATE TABLE foods (
  nutritionist_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Nome normalizzato: minuscolo, senza accenti. È la chiave di ricerca.
  key             TEXT NOT NULL,
  -- Nome come lo ha scritto lui, che è quello che si mostra.
  label           TEXT NOT NULL,
  protein         REAL NOT NULL,
  carbs           REAL NOT NULL,
  fat             REAL NOT NULL,
  -- 'g100' | 'pz'
  per             TEXT NOT NULL DEFAULT 'g100',
  updated_at      TEXT NOT NULL,
  PRIMARY KEY (nutritionist_id, key, per)
);

-- Le variazioni del cliente: è questa tabella che alimenta le notifiche.
CREATE TABLE variations (
  id              TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nutritionist_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  diet_id         TEXT NOT NULL,
  at              TEXT NOT NULL,

  day             INTEGER NOT NULL,
  meal_id         TEXT NOT NULL,
  meal_name       TEXT NOT NULL,
  -- Posizione dell'alimento nel pasto: identifica cosa è stato cambiato.
  item_index      INTEGER NOT NULL,

  from_label      TEXT NOT NULL,
  from_qty        TEXT NOT NULL,
  to_label        TEXT NOT NULL,
  to_qty          TEXT NOT NULL,

  -- Su quale macronutriente è stato fatto il pareggio: 'proteine' | 'carboidrati'
  -- | 'grassi' | 'nessuno'. Serve al professionista per giudicare in tre secondi.
  basis           TEXT NOT NULL,
  kcal_delta      REAL NOT NULL,
  protein_delta   REAL NOT NULL,
  carbs_delta     REAL NOT NULL,
  fat_delta       REAL NOT NULL,
  -- JSON array degli avvisi che il motore ha prodotto sulla sostituzione.
  warnings        TEXT NOT NULL DEFAULT '[]',

  -- 'nuova' | 'vista' | 'annullata'
  status          TEXT NOT NULL DEFAULT 'nuova',
  seen_at         TEXT,
  -- Nota del professionista quando annulla.
  note            TEXT
);

CREATE INDEX variations_feed ON variations (nutritionist_id, status, at DESC);
CREATE INDEX variations_per_cliente ON variations (client_id, at DESC);

-- Domande che l'assistente non ha saputo risolvere DALLA DIETA.
-- È il canale che riporta il cliente al professionista invece di lasciarlo a un
-- modello che improvvisa.
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
