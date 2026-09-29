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
5. Il cliente ha una dashboard con i pasti di oggi, le calorie consumate, i
   passi e i giorni consecutivi di dieta seguita. Spunta i pasti fatti e può
   scambiare un pasto intero con quello di un altro giorno della sua dieta.
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

## Dashboard del cliente

| | Contenuto |
|---|---|
| Mangiato oggi | calorie dei pasti spuntati rispetto all'obiettivo |
| Pasti fatti | fatti su previsti, e quanti saltati |
| Passi | passi segnati rispetto all'obiettivo del nutrizionista |
| Giorni di fila | giorni consecutivi con tutti i pasti fatti |
| Stai seguendo la dieta | aderenza settimanale, con colore |

Regole di calcolo, in `core/aderenza.ts`:

- se oggi non è ancora completo, la serie si conta da ieri, altrimenti al
  mattino sarebbe sempre zero;
- un giorno senza spunte conta come dato mancante, non come zero;
- un pasto fatto scegliendo tra le alternative ammesse vale quanto quello
  prescritto.

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

### Verifiche

```bash
npm test                 # 140 test sul motore
npm run tipi             # controllo dei tipi
scripts/collaudo.sh      # 127 controlli end-to-end, in locale
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
  api-cliente.ts         stato, dieta, piano a sostituzione, chat, messaggi
  api-studio.ts          cruscotto, collegamenti, editor, libreria alimenti,
                         interruttore dell'assistente e conversazione
  ai.ts                  Workers AI: comprensione e formulazione
  sovrapposizione.ts     applica le sostituzioni del cliente sopra la dieta
  nomi.ts                nome da mostrare quando manca
web/                     le quattro schermate, senza dipendenze esterne
  accedi · registrazione · studio · cliente · ui.css · comune.js
                         simboli tipografici, niente emoji
migrations/               schema D1
  0001_init.sql            utenti, collegamenti, diete, variazioni, domande
  0004_piano_e_messaggi.sql  flag "nel piano" sulle variazioni, interruttore
                             dell'assistente, filo dei messaggi

src/                     motore, indipendente da utenti e database
  types.ts               schema della dieta
  core/composizione.ts   valori per 100 g: libreria dello studio, poi tabella
  core/dieta.ts          totali, con indicazione dei dati mancanti
  core/equivalenza.ts    sostituzioni calcolate (isocalorica, isoproteica)
  core/piano.ts          sostituzioni ammesse dal professionista
  core/recupero.ts       pasto saltato: calcolo di quanto manca
  core/assistente.ts     interpretazione della domanda e risposte del motore
  core/spesa.ts          aggregato settimanale
test/                    140 test
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

140 test sul motore e 127 controlli end-to-end, eseguiti anche contro l'istanza
pubblicata.

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

### Da fare prima di aprire il servizio

- Recupero password: oggi chi la dimentica non può rientrare. Serve l'invio di
  email. È la mancanza più seria.
- Diario alimentare: il cliente può dichiarare un pasto saltato e avere i conti
  sul momento, ma non resta registrato.
- Tabella interna non validata da un nutrizionista: i valori sono stime
  dichiarate. Lo studio può sovrascriverli dalla sua libreria.

### Sostituito

Il sistema precedente (piani a modello con slot e alternative, generatore
deterministico della settimana, validatore di conformità, import da testo,
profilo di stile) è stato sostituito dalla dieta scritta a mano. Sta in
`archivio/`, non è collegato e non viene distribuito: si può eliminare.
