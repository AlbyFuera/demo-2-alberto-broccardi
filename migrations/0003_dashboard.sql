-- La dashboard del cliente: passi, pasti fatti, e il PDF della dieta.

-- Passi camminati, un valore al giorno.
--
-- L'obiettivo lo fissa il nutrizionista (sta in `diets.diet_json`), il conteggio
-- lo scrive il cliente leggendolo dal telefono. Una pagina web non può leggere
-- Apple Salute — servirebbe un'app vera sugli store — e chiedere il numero è
-- meglio che mostrare un obiettivo su cui nessuno sa come sta andando.
CREATE TABLE steps (
  client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 'AAAA-MM-GG' nel fuso del cliente, non un timestamp: «i passi di martedì»
  -- è un fatto del giorno, non di un istante.
  day       TEXT NOT NULL,
  steps     INTEGER NOT NULL,
  at        TEXT NOT NULL,
  PRIMARY KEY (client_id, day)
);

-- I pasti che il cliente dichiara di aver fatto.
--
-- È la base dell'aderenza: senza una spunta non c'è modo di distinguere chi
-- segue la dieta da chi non apre l'applicazione. Una riga per pasto e per
-- giorno; l'assenza di riga significa «non ancora spuntato», non «saltato».
CREATE TABLE meal_log (
  client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day       TEXT NOT NULL,
  meal_id   TEXT NOT NULL,
  -- 'fatto' | 'saltato'. Chi salta lo dichiara: è un dato, non un buco.
  state     TEXT NOT NULL DEFAULT 'fatto',
  at        TEXT NOT NULL,
  PRIMARY KEY (client_id, day, meal_id)
);

CREATE INDEX meal_log_per_giorno ON meal_log (client_id, day);

-- Il PDF originale della dieta.
--
-- Sta in D1 e non in R2 perché R2 non è abilitato sull'account, e far dipendere
-- la consegna da un pannello da configurare a mano è peggio che tenere qualche
-- centinaio di kilobyte qui. Tabella separata e lettura solo esplicita: nessuna
-- query del prodotto se lo porta dietro per sbaglio.
--
-- Quando R2 sarà attivo, questa tabella diventa una chiave: si sostituisce
-- `content` con il nome dell'oggetto e cambia un file solo.
CREATE TABLE diet_files (
  diet_id    TEXT PRIMARY KEY REFERENCES diets(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  -- base64. Il limite di riga di D1 è 1 MB: chi carica di più se lo sente dire.
  content    TEXT NOT NULL,
  size       INTEGER NOT NULL,
  uploaded_at TEXT NOT NULL
);
