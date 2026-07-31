-- Il piano a sostituzione e la conversazione con lo studio.
--
-- Tre cose, e nessuna di loro tocca le diete già scritte: chi non usa il piano
-- a sostituzione continua a lavorare esattamente come prima.

-- 1. La sostituzione era fra quelle che il professionista aveva ammesso?
--
-- È il campo da cui dipende l'aderenza. Sta sulla riga di variazione e non si
-- ricalcola dopo: il piano può cambiare — il professionista riscrive la dieta e
-- toglie un'alternativa — e quello che conta è se la scelta era ammessa NEL
-- MOMENTO in cui il cliente l'ha fatta. Ricalcolarla a posteriori significherebbe
-- far scendere l'aderenza di qualcuno per una modifica fatta da un altro.
--
-- Il valore predefinito è 0 e va letto come «non risulta dentro un piano»: le
-- variazioni scritte prima di oggi non ne avevano uno da rispettare.
ALTER TABLE variations ADD COLUMN in_plan INTEGER NOT NULL DEFAULT 0;

-- 2. L'automazione della chat, cliente per cliente.
--
-- Sta su `links` e non su `users` perché è una decisione che il professionista
-- prende sul singolo rapporto: al cliente autonomo lascia rispondere
-- l'assistente, a quello appena operato vuole rispondere di persona. Un
-- interruttore unico per tutto lo studio lo costringerebbe a scegliere il
-- peggiore dei due comportamenti per metà dei suoi clienti.
--
-- Acceso di partenza: è quello che il prodotto fa oggi, e un aggiornamento non
-- deve cambiare il comportamento di nessuno senza che l'abbia chiesto.
ALTER TABLE links ADD COLUMN auto_chat INTEGER NOT NULL DEFAULT 1;

-- 3. La conversazione fra cliente e studio.
--
-- Le `questions` restano quello che sono: le domande che il motore non ha
-- saputo risolvere, con una risposta sola e uno stato aperta/chiusa. Questa
-- tabella è un'altra cosa — un filo di messaggi in ordine di tempo, che
-- continua — e le due non si sovrappongono: la prima è un ticket, la seconda è
-- una conversazione.
--
-- I messaggi dell'assistente ci finiscono dentro anche quando l'automazione è
-- accesa. È il motivo per cui la tabella vale la pena: il professionista che
-- spegne l'automazione a metà giornata deve poter leggere cosa era stato detto
-- al suo cliente prima, o si ritroverebbe a rispondere alla cieca.
CREATE TABLE messages (
  id              TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nutritionist_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at              TEXT NOT NULL,
  -- 'cliente' | 'studio' | 'assistente'. Tre e non due: il cliente deve poter
  -- distinguere una risposta del suo nutrizionista da una dell'assistente, e
  -- confonderle sarebbe la bugia più grave che questo prodotto possa dire.
  author          TEXT NOT NULL CHECK (author IN ('cliente', 'studio', 'assistente')),
  body            TEXT NOT NULL,
  -- Quando l'altra parte l'ha letto. NULL = non ancora letto, ed è ciò che
  -- alimenta il pallino delle novità.
  read_at         TEXT
);

CREATE INDEX messages_filo ON messages (client_id, at);
CREATE INDEX messages_studio ON messages (nutritionist_id, at DESC);
