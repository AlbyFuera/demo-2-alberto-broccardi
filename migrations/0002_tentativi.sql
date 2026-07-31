-- Limitazione dei tentativi.
--
-- Prima c'era solo un ritardo fisso di 400 ms su ogni tentativo fallito: rende
-- il tempo di risposta indipendente dall'esistenza dell'email — che serve — ma
-- non impedisce a nessuno di provare mille password. Quattrocento millisecondi
-- per tentativo sono duecentomila tentativi al giorno su una connessione sola.
--
-- Perché una tabella e non KV: il prodotto ha già D1 e non ha KV, e aggiungere
-- un secondo archivio per contare i tentativi significherebbe un binding in più
-- da configurare al deploy e un altro posto dove le cose possono mancare. La
-- scrittura in più per tentativo di accesso è un costo accettabile: gli accessi
-- sono pochi e i tentativi falliti devono costare.

CREATE TABLE attempts (
  -- 'email:mario@x.it' oppure 'ip:203.0.113.7'. Due chiavi distinte perché
  -- proteggono da due cose diverse: la prima un singolo account preso di mira,
  -- la seconda qualcuno che prova una password su mille indirizzi.
  key         TEXT PRIMARY KEY,
  count       INTEGER NOT NULL DEFAULT 0,
  -- Inizio della finestra corrente. Passata la finestra, il conteggio riparte.
  window_from TEXT NOT NULL
);

CREATE INDEX attempts_by_window ON attempts (window_from);
