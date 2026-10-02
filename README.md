# Pianificatore dieta

Il nutrizionista scrive la dieta a mano, giorno per giorno. Il software calcola i
valori nutrizionali, la mostra al cliente e risponde alle sue domande. Le
decisioni cliniche restano al professionista che ha firmato la dieta.

Gira su Cloudflare: Workers, D1 e Workers AI. Non servono chiavi API.

## Flusso

1. Ci si iscrive con email e password, scegliendo il ruolo: professionista o
   cliente. Il nome si imposta dalle impostazioni.
2. Il cliente cerca il suo nutrizionista per email e gli manda una richiesta.
   Finché non viene accettata il cliente non vede niente e il professionista
   vede solo nome ed email.
3. Il professionista accetta e i due account risultano collegati.
4. Il professionista scrive la dieta a mano giorno per giorno, oppure carica il
   PDF che ha già: lo strumento lo trascrive in una bozza da correggere. I
   valori nutrizionali si calcolano in automatico. La bozza non è visibile al
   cliente; lo diventa appena viene pubblicata.
5. Il cliente ha una dashboard con i pasti di oggi, le calorie consumate,
   acqua, passi, peso e i giorni consecutivi di dieta seguita. Spunta i pasti
   fatti, usa il pasto libero se il nutrizionista lo concede e può scambiare un
   pasto intero con quello di un altro giorno della sua dieta.
6. Toccando un alimento sceglie tra le sostituzioni previste dal nutrizionista,
   con la porzione già calcolata. Se resta nell'elenco l'aderenza non scende.
7. Può fare domande all'assistente, per esempio "posso bere un bicchiere di
   vino?", "ho saltato il pranzo, come sto messo?", "perché devo bere tanta
   acqua?". Il professionista può spegnere l'assistente per un singolo cliente
   e rispondere di persona.
8. Il nutrizionista vede l'aderenza accanto a ogni nome e ogni sostituzione con
   la grammatura equivalente, segnata come prevista dal piano o come
   deviazione. Può annullarla: il piatto torna quello prescritto e il cliente
   vede la motivazione.
9. Per ogni cliente tiene una scheda clinica (dati personali, allergie,
   patologie, farmaci, preferenze, prossima visita), le misure nel tempo e
   note private. La home gli dice quali clienti guardare per primi.

## Dashboard del cliente

| | Contenuto |
|---|---|
| Mangiato oggi | calorie dei pasti spuntati rispetto al totale dei pasti di oggi, con i macro del giorno |
| Pasti | fatti su previsti, e quanti saltati |
| Acqua | un bicchiere (250 ml) in più o in meno, rispetto ai litri indicati nella dieta |
| Passi | passi segnati rispetto all'obiettivo del nutrizionista |
| Peso | ultima pesata, variazione e andamento; lo vede anche lo studio |
| Stai seguendo la dieta | aderenza degli ultimi 7 giorni, con colore |
| Giorni di fila | giorni consecutivi con tutti i pasti fatti |
| Pasti liberi | quanti ne restano questa settimana, se il nutrizionista ne concede |

Il riferimento del "Mangiato oggi" è la somma dei pasti scritti per oggi, non
l'obiettivo calorico dichiarato: se la dieta scritta fa 1600 kcal e l'obiettivo
dice 1900, il cliente non deve vedersi fermo all'84% dopo aver mangiato tutto.
La differenza la vede il professionista, nell'editor e alla pubblicazione.

L'aderenza si misura sempre su 7 giorni (`FINESTRA_ADERENZA`): stesso numero
nella dashboard del cliente, nell'elenco clienti e nella scheda. Nella scheda il
professionista può confrontarla con gli ultimi 30 giorni.

Regole di calcolo, in `core/aderenza.ts`:

- se oggi non è ancora completo, la serie si conta da ieri, altrimenti al
  mattino sarebbe sempre zero;
- un giorno senza spunte conta come dato mancante, non come zero;
- un pasto fatto scegliendo tra le alternative ammesse vale quanto quello
  prescritto;
- il pasto libero vale come fatto, ma solo quanti ne concede la dieta
  (`obiettivi.pastiLiberi`, a settimana): oltre, il server lo rifiuta.

## Settimana del cliente

Tre viste: il piano dei sette giorni, il diario delle ultime due settimane
(`core/diario.ts`: pasti fatti e saltati, passi, acqua, peso) e la lista della
spesa raggruppata per reparto, da spuntare mentre si compra. Le spunte della
spesa restano solo nel browser del cliente. La dieta si può stampare o salvare
in PDF dal browser.

## Scheda clinica, misure e note

Ogni cliente ha nella scheda dello studio sei sezioni: panoramica, dieta,
misure, scheda, note, messaggi.

| | |
|---|---|
| scheda | nascita, sesso, altezza, allergie e intolleranze, patologie, farmaci, preferenze, prossima visita. Età e BMI si calcolano |
| misure | peso, vita, fianchi, massa grassa; una riga al giorno, la scrive lo studio o il cliente (solo il peso) |
| note | appunti privati di visita |

Il cliente vede solo la prossima visita. Il resto è dello studio.

Le allergie si scrivono a testo libero ("lattosio, frutta a guscio").
`core/allergeni.ts` espande le voci note negli alimenti che le contengono e
cerca le altre così come sono scritte. Servono a due cose: l'editor segna in
rosso gli alimenti da controllare, e le sostituzioni calcolate proposte al
cliente escludono quelli a rischio. Le alternative scritte dal professionista
restano, con un avviso.

## Home dello studio

In alto: clienti seguiti, aderenza media, quanti chiedono attenzione, visite
dei prossimi 7 giorni. Sotto, l'elenco "da seguire", ordinato per urgenza:
messaggi da leggere, domande girate dall'assistente, dieta mancante o in bozza,
nessuna spunta da 3 giorni o più, aderenza bassa, sostituzioni nuove, visita in
arrivo. Accanto, richieste di collegamento e sostituzioni recenti.

Una nuova dieta può partire vuota, da un PDF o da qualsiasi dieta già scritta
dallo studio, anche di un altro cliente.

## Cambio di un pasto intero

`core/cambiopasto.ts`. I pasti proposti vengono dagli altri giorni della stessa
dieta, con lo stesso nome e uno scostamento calorico entro il 15%.

Per questo il cambio non richiede approvazione: il cliente sposta di giorno un
pasto che il professionista ha già scritto. Generare pasti nuovi richiederebbe
invece il suo intervento.

## Import del PDF

`worker/pdf.ts`. Due passaggi: `AI.toMarkdown` (un convertitore, non un
modello) estrae il testo, poi un modello piccolo lo trascrive in righe piatte
`GIORNO|PASTO|ORARIO|ALIMENTO|QUANTITA|UNITA`.

Si usano righe piatte perché con il JSON annidato bastava una graffa sbagliata
per perdere tutta la lettura. Una riga malformata si scarta e le altre restano.

Il risultato è una bozza, mostrata accanto al testo effettivamente letto. Il
PDF originale resta allegato e il cliente può aprirlo.

## Piano a sostituzione

`src/core/piano.ts`. Permette al nutrizionista di indicare, per esempio, che a
colazione la fonte proteica può essere yogurt greco, fiocchi di latte o due
uova, a scelta del cliente.

Per ogni alimento della dieta il professionista può indicare:

| | |
|---|---|
| alternative ammesse | elenco chiuso |
| nome della voce | es. "fonte proteica", è ciò che legge il cliente |
| base di pareggio | solo come eccezione; di default vale quella della dieta |

Le grammature le calcola il motore in base alla regola scelta. Il campo resta
comunque modificabile: una quantità scritta a mano (es. "uova: 2 pezzi" invece
di "5,5") non viene ricalcolata.

Il cliente apre il pasto, tocca l'alimento e sceglie, senza chiedere permesso.

### Effetto sull'aderenza

In `core/aderenza.ts`:

- pasto fatto con una scelta dentro l'elenco: vale come il pasto prescritto;
- pasto fatto con una sostituzione fuori elenco: vale metà, e il cliente lo
  vede prima di scegliere;
- scambio di un pasto intero con quello di un altro giorno: sempre dentro,
  perché il pasto l'ha scritto il professionista.

Il mezzo punto serve a distinguere chi segue la dieta a modo suo da chi la
segue e da chi non la segue.

Il fatto che una scelta fosse ammessa viene salvato nella riga di variazione
(`variations.in_plan`) e non viene più ricalcolato. Se il professionista toglie
un'alternativa, l'aderenza dei giorni passati non cambia.

### Isocalorica o isoproteica

180 g di merluzzo portano 31 g di proteine e 128 kcal. Sostituito con petto di
pollo, la porzione cambia a seconda di cosa si pareggia:

```
isoproteica  →  135 g di pollo    stessi 31 g di proteine
isocalorica  →   85 g di pollo    stesse 128 kcal
```

La scelta è clinica e la fa il professionista una volta, in testa alla dieta:

> Le sostituzioni si pareggiano: isocalorica · isoproteica · isoglucidica ·
> isolipidica · sul macronutriente principale

La regola vale per tutto il piano (es. un piano ipocalorico sulle calorie, uno
ipertrofico sulle proteine). Sul singolo alimento si può fare un'eccezione, per
esempio una fonte proteica isoproteica in un piano isocalorico; il valore
predefinito del campo è "come dice la dieta".

Il cliente non sceglie la regola: la vede indicata sotto le porzioni. La base
non viene più inviata dal browser, quindi il cliente non può forzarla per
ottenere porzioni più grandi.

Ordine di risoluzione in `core/piano.ts`: eccezione sull'alimento, poi regola
della dieta, poi `auto`.

Se il pareggio richiesto non è realistico (un'isoproteica verso il miele
richiederebbe undici chili di miele) il motore ripiega sulle calorie e lo
segnala.

## Assistente o risposta del professionista

Ogni cliente ha un interruttore (`links.auto_chat`) nella sua scheda, non nelle
impostazioni dello studio, così il professionista può decidere cliente per
cliente.

| | |
|---|---|
| acceso | risponde l'assistente. Domande e risposte restano nel filo e il professionista può leggerle |
| spento | nessuna risposta automatica: il messaggio aspetta il professionista |

Le risposte dell'assistente vengono registrate anche con l'automazione accesa,
così chi la spegne vede cosa è già stato detto al cliente.

Nel filo le tre voci sono sempre distinte: cliente, assistente e professionista
con il suo nome.

## Scelte architetturali

### Sostituzioni calcolate

Il piano a sostituzione è facoltativo. Dove non c'è (finora in tutte le diete)
la sostituzione "X al posto di Y" la calcola `src/core/equivalenza.ts`
pareggiando il macronutriente caratterizzante dell'alimento sostituito:

```
100 g di pasta  →  95 g di riso      pareggiando i carboidrati (75 g)
150 g di pollo  →  205 g di merluzzo pareggiando le proteine (34 g)
```

Pareggiare le calorie tra una fonte di carboidrati e una di grassi
stravolgerebbe i macronutrienti. Se il pareggio sul caratterizzante è
impossibile (pasta → pollo, che non ha carboidrati) si ripiega sulle calorie e
lo si segnala.

Le proposte automatiche hanno due limiti: solo alimenti della stessa famiglia e
con concentrazione confrontabile. 100 g di pasta portano 75 g di carboidrati, il
latte 5 per 100 ml: il pareggio darebbe un litro e mezzo di latte. Una
sostituzione richiesta esplicitamente viene comunque calcolata, con gli avvisi.

### Ruolo dell'AI

```
il motore stabilisce i fatti  →  l'AI li riformula con la voce del professionista
```

Il modello serve a capire la domanda meglio delle espressioni regolari e a
riformulare la risposta. Le grammature vengono da `equivalenza.ts`, i totali da
`dieta.ts`. Il prompt di sistema vieta di cambiare quantità, inventare valori
nutrizionali, dare consigli propri e in particolare dire quanto mangiare per
recuperare un pasto saltato. Il software indica solo quanto manca.

Se il binding AI manca o la quota è esaurita, le risposte le compone il codice:
cambia la forma, non il contenuto.

In produzione è emerso un altro caso: il modello può restituire testo senza
senso (cirillico, ideogrammi, frammenti di codice) senza segnalare errori.
`worker/plausibile.ts` lo riconosce e lo scarta, e il cliente riceve la risposta
del motore. Il caso reale è nei test come regressione.

## Valori nutrizionali

Il motore conosce circa 130 alimenti comuni, con valori indicativi dichiarati
come tali. Se il professionista usa un alimento sconosciuto, l'editor chiede i
valori per 100 g e li salva nella libreria dello studio. Da lì in poi hanno la
precedenza su quelli interni in tutte le sue diete.

I valori non vengono mai proposti da un modello.

Finché un alimento non ha valori, i totali vengono segnalati come parziali, sia
al professionista sia al cliente.

| | Significato | Effetto sul totale |
|---|---|---|
| q.b. | il professionista non prescrive un peso | totale corretto |
| sconosciuto | composizione non nota | totale incompleto |

Vanno tenuti distinti, altrimenti ogni dieta con verdure a volontà risulterebbe
incompleta.

## Grafica

Un solo foglio di stile, `web/app.css`, per tutte le pagine. Font di sistema
(SF Pro su Apple, Segoe UI su Windows), una scala tipografica corta, colori
definiti come variabili con la variante scura che segue il sistema. Sul
telefono la navigazione è una barra in basso; da 900 px diventa una barra
laterale. I fogli che salgono dal basso sul telefono diventano finestre al
centro su schermi larghi. Le icone sono SVG lineari in `web/grafica.js`, che
contiene anche anelli, grafici e la pagina di stampa.

### Navigazione

| | Barra laterale (da 900 px) | Barra in basso (telefono) |
|---|---|---|
| studio | Studio: Home, Clienti, Messaggi, Agenda · Lavoro: Sostituzioni, Diete, Alimenti · Profilo | Home, Clienti, Messaggi, Altro (le altre voci) |
| cliente | Oggi, Piano, Progressi, Messaggi, Profilo | le stesse cinque |

Il cliente trova in Oggi i pasti, l'acqua e i passi; in Piano la settimana, le
indicazioni e la spesa; in Progressi aderenza, peso, passi, acqua, diario e i
suoi cambi. Un cliente aperto da Messaggi, Agenda, Sostituzioni o Diete torna
lì con il pulsante indietro.

## Schermata del cliente su telefono

La schermata del cliente è pensata prima di tutto per il telefono. È verificata
a 320, 375 e 667 px e in orizzontale:

- campi di testo a 16 px sui telefoni, perché sotto quella dimensione iOS
  ingrandisce la pagina al tocco;
- bersagli di tocco intorno ai 44 px;
- nessuno scorrimento orizzontale della pagina: testi lunghi e tabelle vanno a
  capo o scorrono nel loro contenitore.

I simboli sono tipografici. Niente emoji, perché cambiano aspetto tra sistemi e
a volte non vengono mostrate.

## Deploy

```bash
npm install

npx wrangler login
npm run db:crea          # → copia il database_id in wrangler.jsonc
npm run db:remoto        # applica lo schema
npm run deploy
```

Il database parte vuoto, senza dati di esempio. Il primo account si crea da
`/registrazione`.

### In locale

```bash
npm install
npm run db:locale
npm run dev              # → http://localhost:8787
```

### Demo in locale con account pronti

```bash
cp .dev.vars.example .dev.vars          # attiva la pagina di scelta account
npx wrangler dev --local --port 8787    # --local: senza AI, non chiede il login Cloudflare
python3 scripts/dati-demo-locali.py     # in un altro terminale, una volta sola
```

Poi `http://localhost:8787`: si sceglie con chi entrare, senza password.
Quattro account con una settimana di dati:

| Ruolo | Email | Password |
|---|---|---|
| Nutrizionista | anna.nutrizionista@gmail.com | nutrizionista |
| Nutrizionista | andrea.nutrizionista@gmail.com | nutrizionista |
| Cliente (di Anna) | luca.cliente@gmail.com | cliente123 |
| Cliente (di Andrea) | luisa.cliente@gmail.com | cliente123 |

Anna segue anche altri clienti, ognuno in una situazione diversa, per vedere
la home "da seguire" piena: Giulia (costante, visita domani), Marco (non segna
da giorni, ha scritto un messaggio), Gaia (intollerante al lattosio, dieta in
bozza), Alessandro (appena collegato, senza dieta), Francesco (sportivo, una
sostituzione nuova) e Giulio (richiesta in attesa). Non sono nella pagina di
scelta: si entra da `/accedi` con la loro email e la password `cliente123`.

Esistono solo nel database locale (`.wrangler/`). La pagina di scelta si attiva
solo con `ACCOUNT_DEMO` in `.dev.vars` e su `localhost`: online non esiste.
Per avere due account aperti insieme, il secondo in una finestra in incognito.

### Verifiche

```bash
npm test                 # 156 test sul motore
npm run tipi             # controllo dei tipi
scripts/collaudo.sh      # 167 controlli end-to-end, in locale
B=https://…workers.dev scripts/collaudo.sh    # gli stessi, contro l'istanza vera
PW_N=… PW_C=… scripts/strumenti-demo.sh # crea due account con una settimana di dati
```

## Limitazione dei tentativi

`worker/limite.ts` conta i tentativi di accesso falliti su due chiavi:

- per email (un account attaccato con molte password): 8 tentativi ogni 15
  minuti;
- per indirizzo di rete (una password comune provata su molti account): 60.

Il conteggio sta in D1 e non in KV, per non aggiungere un secondo binding da
configurare. Il controllo avviene prima della verifica della password, che costa
600.000 iterazioni di PBKDF2. Un accesso riuscito azzera il conteggio.

Limite noto: chi conosce l'email di qualcuno può bloccarne l'accesso per 15
minuti sbagliando 8 volte. La finestra scade da sola e il messaggio indica
quanto aspettare, ma finché non c'è il recupero password va tenuto presente.

## Problemi visti solo in produzione

1. WebCrypto nei Worker rifiuta PBKDF2 oltre 100.000 iterazioni. In locale
   funzionava, in produzione registrazione, accesso e cambio password erano
   rotti. Ora le iterazioni si fanno a blocchi da 100.000 fino a 600.000.
2. D1 in remoto può restituire un dato vecchio subito dopo una scrittura. Non è
   un bug da correggere: nell'uso reale tra due azioni passano secondi.

Per questo conviene pubblicare e collaudare l'istanza vera prima che serva.

## Struttura

```
worker/                  Cloudflare Worker
  index.ts               routing e ruoli, controllo prima degli asset
  auth.ts                password (PBKDF2), sessioni, cookie
  db.ts                  tutto il SQL, sempre filtrato sul proprietario
  api-cliente.ts         stato, dieta, piano a sostituzione, chat, messaggi,
                         acqua, peso, diario
  api-studio.ts          cruscotto, collegamenti, editor, libreria alimenti,
                         interruttore dell'assistente e conversazione,
                         scheda clinica, misure, note, modelli
  ai.ts                  Workers AI: comprensione e formulazione
  sovrapposizione.ts     applica le sostituzioni del cliente sopra la dieta
  nomi.ts                nome da mostrare quando manca
web/                     le quattro schermate, senza dipendenze esterne
  accedi · registrazione · studio · cliente · comune.js
  app.css                l'unico foglio di stile, chiaro e scuro
  grafica.js             icone SVG, avatar, anelli, grafici, fogli, stampa
migrations/               schema D1
  0001_init.sql            utenti, collegamenti, diete, variazioni, domande
  0004_piano_e_messaggi.sql  flag "nel piano" sulle variazioni, interruttore
                             dell'assistente, filo dei messaggi
  0005_cartella.sql          scheda clinica, misure, note dello studio, acqua

src/                     motore, indipendente da utenti e database
  types.ts               schema della dieta
  core/composizione.ts   valori per 100 g: libreria dello studio, poi tabella
  core/dieta.ts          totali, con indicazione dei dati mancanti
  core/equivalenza.ts    sostituzioni calcolate (isocalorica, isoproteica)
  core/piano.ts          sostituzioni ammesse dal professionista
  core/recupero.ts       pasto saltato: calcolo di quanto manca
  core/assistente.ts     interpretazione della domanda e risposte del motore
  core/spesa.ts          aggregato settimanale, per reparto
  core/allergeni.ts      allergie scritte a testo libero → alimenti a rischio
  core/diario.ts         gli ultimi giorni, giorno per giorno
test/                    156 test
scripts/                 collaudo end-to-end e account demo
archivio/                sistema precedente, non collegato
```

`src/` non importa nulla da `worker/`, così il motore resta testabile senza
database.

### Sovrapposizione delle sostituzioni

`worker/sovrapposizione.ts`. La dieta non viene mai modificata dalle
sostituzioni del cliente: se il cliente cambia il riso con le patate, il
professionista continua a vedere che aveva prescritto riso. La sostituzione sta
nella riga di variazione e viene applicata in lettura.

Non esiste una tabella dedicata: le sostituzioni attive sono le righe di
`variations` non annullate. Di conseguenza il veto del professionista consiste
nel mettere la riga ad `annullata`, e non possono esistere sostituzioni o
notifiche disallineate.

## Stato

### Fatto

156 test sul motore e 167 controlli end-to-end in locale.

Percorso base coperto: iscrizione dei due ruoli, richiesta del cliente allo
studio, accettazione, scrittura e pubblicazione di una settimana, visualizzazione
con i valori calcolati, sostituzione per equivalenza, notifica al professionista,
annullamento e ritorno al piatto prescritto.

Funzioni più recenti coperte: regola di pareggio della dieta e sostituzioni
ammesse su un alimento; alimenti senza eccezione che seguono la regola del piano
e quello con eccezione la sua; porzioni già calcolate lato cliente; richiesta di
un'altra base senza effetto né in lettura né in applicazione; aderenza invariata
per scelte in elenco e ridotta (con avviso preventivo) per quelle fuori; porzione
scritta a mano non ricalcolata; assistente spento per un cliente con risposta
del professionista; assistente riacceso che torna a rispondere.

Contro l'istanza pubblicata, dopo la migrazione `0004`: 123 controlli su 123.
In locale il database è quello di `.wrangler/` e lo schema si aggiorna con
`npm run db:locale`. Solo se si pubblica su Cloudflare la migrazione `0005` va
applicata anche al database remoto (`npm run db:remoto`).

### Da fare prima di aprire il servizio

- Recupero password: oggi chi la dimentica non può rientrare. Serve l'invio di
  email. È la mancanza più seria.
- Diario alimentare libero: il diario mostra pasti fatti e saltati, acqua, passi
  e peso, ma il cliente non può ancora scrivere cosa ha mangiato fuori piano.
- Promemoria e notifiche sul telefono: servono un service worker e le chiavi
  per le notifiche push.
- Tabella interna non validata da un nutrizionista: i valori sono stime
  dichiarate. Lo studio può sovrascriverli dalla sua libreria.

### Sostituito

Il sistema precedente (piani a modello con slot e alternative, generatore
deterministico della settimana, validatore di conformità, import da testo,
profilo di stile) è stato sostituito dalla dieta scritta a mano. Sta in
`archivio/`, non è collegato e non viene distribuito: si può eliminare.
