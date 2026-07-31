# Pianificatore dieta

Il nutrizionista scrive la dieta a mano, giorno per giorno. Il software calcola i
valori nutrizionali, la mostra al cliente e gli risponde quando ha un problema —
senza mai decidere al posto di chi ha firmato.

Gira su Cloudflare: Workers + D1 + Workers AI. Nessuna chiave API da custodire.

## Come funziona, dall'inizio

1. **Ci si iscrive**, con sola email e password, scegliendo se si scrivono le
   diete o se se ne segue una. Il nome si mette dalle impostazioni.
2. **Il cliente aggiunge il suo nutrizionista** cercandolo per email e mandando
   una richiesta. Finché non viene accettata non vede niente, e il
   professionista non vede niente di lui oltre nome ed email.
3. **Il professionista accetta**, e da quel momento sono collegati.
4. **Scrive la dieta**, in due modi: a mano giorno per giorno, oppure
   **caricando il PDF** che già ha — lo strumento lo trascrive in una bozza che
   lui corregge. I valori nutrizionali si calcolano da soli. Finché è una bozza
   il cliente non la vede; quando la **pubblica**, la vede subito.
5. **Il cliente apre la sua dashboard**: cosa mangia oggi, quante calorie ha
   consumato, i passi, da quanti giorni di fila sta seguendo la dieta. Spunta i
   pasti che fa, e può **cambiare un pasto intero** prendendone uno di un altro
   giorno della sua dieta.
6. **Tocca un alimento e sceglie fra le sostituzioni previste** dal suo
   nutrizionista, con la porzione già calcolata. Se resta dentro l'elenco,
   **l'aderenza non scende**.
7. **All'assistente chiede qualsiasi cosa** e riceve una risposta, non un
   rimando: «posso bere un bicchiere di vino?», «ho saltato il pranzo, come sto
   messo?», «perché devo bere tanta acqua?». Il professionista può **spegnere
   l'assistente per un singolo cliente** e rispondergli di persona.
8. **Il nutrizionista vede l'aderenza accanto a ogni nome** e ogni sostituzione
   con la grammatura equivalente, marcata come prevista dal piano o come
   deviazione. Può **annullarla**: il piatto torna quello prescritto e il
   cliente legge il perché.

## La dashboard del cliente

Non è la chat. La chat risponde a una domanda, e una domanda non ce l'hai tutti
i giorni — la colazione sì.

| | Cosa dice |
|---|---|
| **Mangiato oggi** | calorie dei pasti spuntati, sull'obiettivo |
| **Pasti fatti** | quanti su quelli previsti, e quanti saltati |
| **Passi** | quelli segnati, sull'obiettivo del nutrizionista |
| **Giorni di fila** | la serie: giorni consecutivi con tutti i pasti fatti |
| **Stai seguendo la dieta** | l'aderenza sulla settimana, con il colore |

Tre regole scritte in `core/aderenza.ts` che rendono i numeri onesti:

- **la serie si conta da ieri se oggi non è ancora completo.** Senza, alle nove
  del mattino segnerebbe zero e risalirebbe ogni sera: il numero più
  demotivante da mostrare a chi sta facendo bene da due settimane;
- **un giorno senza nessuna spunta non è zero, è ignoto.** Chi non ha capito che
  deve spuntare non è uno che salta i pasti, e la differenza cambia la
  telefonata che il professionista gli farà;
- **chi rispetta il piano a sostituzione non perde niente.** Un pasto fatto
  scegliendo fra le alternative ammesse vale quanto quello prescritto: è
  esattamente ciò che gli è stato concesso di fare.

## Il cambio di un pasto intero

`core/cambiopasto.ts`. I pasti proposti vengono dagli **altri giorni della sua
stessa dieta**, con lo stesso nome e entro il 15% di scostamento calorico.

È questo che permette al cambio di avvenire **senza approvazione**: non si
concede niente di nuovo, si permette al cliente di mangiare giovedì quello che
avrebbe mangiato sabato. Un motore che inventasse pasti nuovi dovrebbe passare
dal professionista, perché starebbe scrivendo dieta.

## Il PDF

`worker/pdf.ts`. Due passaggi: `AI.toMarkdown` estrae il testo — è un
convertitore, non un modello — e un modello piccolo lo trascrive in righe piatte
(`GIORNO|PASTO|ORARIO|ALIMENTO|QUANTITA|UNITA`).

Il formato piatto non è pigrizia: con il JSON annidato il modello sbagliava una
graffa su duemila caratteri e buttava via tutta la lettura. Una riga storta si
scarta e le altre restano.

Quello che ne esce è una **bozza**, e accanto c'è il testo che il software ha
letto davvero. Il PDF originale resta allegato e il cliente lo apre: se la
lettura ha sbagliato, la carta del suo nutrizionista è sempre lì.

## Il piano a sostituzione

`src/core/piano.ts`. È la cosa che il nutrizionista chiede da sempre e che sul
foglio non ci sta: **«a colazione la fonte proteica può essere lo yogurt greco,
i fiocchi di latte o due uova — scegli tu, basta che resti in questo elenco».**

Per ogni alimento della dieta il professionista può scrivere:

| | |
|---|---|
| **le alternative ammesse** | un elenco chiuso, e sono quelle |
| **come si chiama quel posto** | «fonte proteica»: è quello che legge il cliente |
| **su cosa si pareggia** | isocalorica, isoproteica, o il caratterizzante |

Le **grammature non gliele si chiede**: le calcola il motore secondo la base che
ha scelto. Ma il campo c'è, e quella singola alternativa che nella sua
esperienza va scritta diversamente — «uova: 2 pezzi», non «5,5» — può scriverla,
e quel numero non viene ricalcolato da nessuno.

Il cliente apre il suo pasto, tocca l'alimento e sceglie. Non chiede un
permesso: **fa quello che gli è stato concesso.**

### Se rispetta le sostituzioni, l'aderenza non scende

È la promessa che rende il piano utile, ed è scritta in `core/aderenza.ts`:

- pasto fatto scegliendo **dentro l'elenco** → vale come il pasto prescritto;
- pasto fatto con una sostituzione **fuori dall'elenco** → vale **metà**, e il
  cliente lo legge **prima** di scegliere, non dopo;
- **scambio di un pasto intero** con quello di un altro giorno → sempre dentro:
  quel pasto l'ha scritto il professionista, si sposta solo di giorno.

Il mezzo punto non è una punizione, è un'informazione: dice «segue, ma a modo
suo», che è diverso sia da «segue» sia da «non segue» e merita un numero diverso
da entrambi.

Il fatto che una scelta fosse ammessa viene **congelato nella riga di
variazione** (`variations.in_plan`) e non si ricalcola mai. Se il professionista
domani toglie un'alternativa, non deve far scendere all'indietro l'aderenza di
chi ieri aveva rispettato il piano di ieri.

### Isocalorica o isoproteica: due domande diverse

180 g di merluzzo portano 31 g di proteine e 128 kcal. Sostituirlo con del petto
di pollo dà **due porzioni diverse** a seconda di cosa si vuole tenere fermo:

```
isoproteica  →  135 g di pollo    stessi 31 g di proteine
isocalorica  →   85 g di pollo    stesse 128 kcal
```

Quale delle due sia quella giusta è una decisione clinica, e **la prende il
professionista** slot per slot. Il cliente può guardare l'altra lettura — serve
a capire cosa sta cambiando — ma **la porzione che si applica segue sempre la
regola scritta da lui**: senza questo vincolo, chi volesse mangiare di più
cercherebbe la base che gli dà la porzione più grande, e la dieta la
sceglierebbe il cliente.

Quando il pareggio chiesto non è possibile — una isoproteica verso il miele
chiederebbe undici chili di miele — il motore **ripiega sulle calorie e lo
scrive**. Una porzione che non sta in un piatto è peggio di nessuna risposta:
qualcuno potrebbe seguirla.

## Chi risponde al cliente: l'assistente o il professionista

Un interruttore per **ogni singolo cliente** (`links.auto_chat`), sulla scheda
di quel cliente e non nelle impostazioni dello studio: al cliente autonomo si
lascia l'assistente, a quello appena operato si vuole rispondere di persona, e
un interruttore unico costringerebbe a scegliere il comportamento sbagliato per
metà delle persone.

| | |
|---|---|
| **acceso** | risponde l'assistente, come sempre. Domande e risposte finiscono comunque nel filo, e il professionista le legge quando vuole |
| **spento** | nessuno risponde al posto suo: il messaggio resta lì e aspetta lui |

Le risposte dell'assistente si registrano **anche quando l'automazione è
accesa**: è ciò che permette a chi la spegne a metà giornata di leggere cosa era
stato detto al suo cliente, invece di rispondere alla cieca.

Nel filo le tre voci non si confondono mai — il cliente, l'assistente, il
professionista con il suo nome. Far passare per proprie le parole di un modello
sarebbe la bugia più grave che questo prodotto possa dire.

## Le due decisioni architetturali che contano

### Le sostituzioni sono prima di tutto un calcolo

Il piano a sostituzione è **facoltativo**: nessuno lo scrive per tutti e trenta
gli alimenti di una settimana. Dove non c'è — ed è il caso di tutte le diete
scritte finora — la domanda «posso mettere X al posto di Y?» si risolve come si
è sempre risolta: `src/core/equivalenza.ts` **pareggia il macronutriente
caratterizzante** dell'alimento che esce:

```
100 g di pasta  →  95 g di riso      pareggiando i carboidrati (75 g)
150 g di pollo  →  205 g di merluzzo pareggiando le proteine (34 g)
```

Non le calorie. Pareggiare le kcal tra una fonte di carboidrati e una di grassi
dà un numero giusto e una dieta sbagliata: stesse calorie, macronutrienti
stravolti. Quando il pareggio sul caratterizzante è impossibile — pasta → pollo,
che di carboidrati non ne ha — si ripiega sulle calorie **e lo si dichiara**,
perché non è la sostituzione di un ingrediente ma un cambio di forma della
giornata.

Due limiti deliberati sulle proposte automatiche: solo alimenti della stessa
famiglia, e con una concentrazione confrontabile. Cento grammi di pasta portano
75 g di carboidrati e il latte ne ha 5 per 100 ml: il pareggio esiste, ed è un
litro e mezzo di latte. Una proposta assurda fa perdere fiducia anche in quelle
buone. Chi vuole comunque quella sostituzione la nomina, e il calcolo gliela
dà con i suoi avvisi.

### L'AI fa lingua, non decisioni

```
il MOTORE stabilisce i fatti  →  l'AI li dice con la voce del professionista
```

Mai il contrario. Il modello fa due cose: capisce la domanda meglio delle
espressioni regolari, e riformula la risposta. Ogni grammatura viene da
`equivalenza.ts`, ogni totale da `dieta.ts`. Il prompt di sistema gli vieta di
cambiare quantità, inventare valori nutrizionali o dare consigli propri — e in
particolare di dire al cliente **quanto mangiare** per recuperare un pasto
saltato: quella è una decisione clinica. Il software dice quanto manca, che è un
conto; a decidere è chi ha firmato la dieta.

Se il binding AI manca o la quota è esaurita, le risposte restano corrette: le
compone il codice. L'assistente peggiora di lingua, mai di contenuto.

E c'è un terzo caso, trovato in produzione e non prevedibile a tavolino: **il
modello può restituire un impasto di token senza segnalare alcun errore.** La
chiamata riesce, il testo arriva, ed è spazzatura — cirillico, ideogrammi,
frammenti di codice. `worker/plausibile.ts` la riconosce e la butta, e il cliente
vede la frase del motore, che era già pronta e corretta. Il caso reale che ha
fatto scrivere quel file è nei test come regressione.

## I valori nutrizionali

Il motore conosce ~130 alimenti comuni con valori **indicativi, dichiarati
tali**. Quando il professionista scrive un alimento che non conosce, l'editor
gliene chiede i valori per 100 g e li salva nella **libreria del suo studio**:
da quel momento vincono su quelli interni per tutte le sue diete, e non glieli
richiede mai più.

Non c'è una via in cui li proponga un modello. Un valore nutrizionale inventato
entra in una dieta clinica e ci resta, e nessuno saprebbe più da dove è arrivato.

Finché un alimento resta senza valori, i totali sono **dichiarati parziali** —
al professionista e al cliente. Un totale che nasconde ciò che non ha contato è
peggio di un totale assente: chi lo legge si fiderebbe.

Distinzione che vale tutto il modulo dei conti:

| | Cosa significa | Effetto sul totale |
|---|---|---|
| **q.b.** | il professionista non prescrive un peso | il totale è corretto così |
| **sconosciuto** | non si conosce la composizione | il totale è incompleto |

Confonderli farebbe apparire incompleta ogni dieta con delle verdure a volontà,
e il professionista smetterebbe di guardare l'avviso.

## La schermata del cliente è pensata per il telefono

Non è una versione ridotta di quella grande: è il caso normale. Il cliente apre
l'applicazione in piedi, davanti al frigorifero, con una mano.

Tre cose che di solito si sbagliano, qui misurate a 320, 375 e 667 px e in
orizzontale:

- **niente ingrandimento involontario.** Sotto i 16 px iOS ingrandisce la pagina
  a ogni tocco su un campo di testo, e non torna più indietro da sola. Sui
  telefoni i campi sono a 16 px esatti;
- **bersagli da pollice**, intorno ai 44 px. Toccare un alimento è *il* gesto del
  prodotto: una pillola alta 30 px si sbaglia una volta su tre;
- **niente scorrimento orizzontale, mai.** Nomi di alimenti lunghi, tabelle,
  righe di numeri: vanno a capo o scorrono dentro il loro contenitore, non
  spingono la pagina di lato.

L'insieme dei simboli è tipografico e chiuso — l'elenco completo sta in testa a
`web/ui.css`. Nessuna emoji: un'emoji la disegna il sistema operativo, cambia
forma tra un telefono e un computer, arriva a colori in un'interfaccia che ha un
accento solo, e a volte non arriva affatto.

## Metterlo in linea

```bash
npm install

npx wrangler login
npm run db:crea          # → copia il database_id in wrangler.jsonc
npm run db:remoto        # applica lo schema
npm run deploy
```

Il database nasce vuoto: nessun dato di esempio. Il primo account si crea da
`/registrazione`.

### In locale

```bash
npm install
npm run db:locale
npm run dev              # → http://localhost:8787
```

### Verifiche

```bash
npm test                 # 136 test sul motore
npm run tipi             # controllo dei tipi
./collaudo.sh            # 123 controlli end-to-end, in locale
B=https://…workers.dev ./collaudo.sh     # gli stessi, contro l'istanza vera
./strumenti-demo.sh      # crea due account con una settimana di dati
```

## Limitazione dei tentativi

`worker/limite.ts` conta i tentativi falliti su due chiavi distinte, perché
proteggono da due attacchi diversi: **per email** (un account preso di mira,
provato con mille password: otto tentativi ogni quindici minuti) e **per
indirizzo di rete** (una password comune provata su mille indirizzi: sessanta).

Il conteggio sta in D1 e non in KV — il prodotto ha già D1 e aggiungere un
secondo archivio significherebbe un binding in più da configurare al deploy.
Il controllo avviene **prima** della verifica della password, perché verificarla
costa 600.000 iterazioni di PBKDF2 e chi prova a raffica non deve poter
comprare tutto quel lavoro a ogni tentativo. Un accesso riuscito azzera il
conteggio.

Il compromesso, dichiarato: chi conosce l'email di qualcuno può bloccarlo per
quindici minuti sbagliando otto volte. La finestra si richiude da sé e il
messaggio dice quanto aspettare — ma senza recupero password quel quarto d'ora
va saputo.

## Due cose che il collaudo locale NON può trovare

Entrambe sono uscite solo pubblicando, e sono il motivo per cui vale la pena
pubblicare prima di averne bisogno:

1. **WebCrypto nei Worker rifiuta PBKDF2 oltre le 100.000 iterazioni.** In
   locale passava, in produzione no: registrazione, accesso e cambio password
   erano tutti rotti. Ora le iterazioni si concatenano a giri da 100.000 per
   arrivare alle 600.000 effettive.
2. **D1 in remoto può servire una lettura vecchia di un istante** subito dopo una
   scrittura. Non è un difetto da correggere, è una caratteristica da conoscere:
   nell'uso vero fra due azioni passano secondi, non millisecondi.

## Struttura

```
worker/                  IL PRODOTTO — Cloudflare Worker
  index.ts               routing e ruoli: il controllo sta DAVANTI agli asset
  auth.ts                password (PBKDF2), sessioni, cookie
  db.ts                  tutto il SQL, sempre filtrato sul proprietario
  api-cliente.ts         stato, dieta, piano a sostituzione, chat, messaggi
  api-studio.ts          cruscotto, collegamenti, editor, libreria alimenti,
                         interruttore dell'assistente e conversazione
  ai.ts                  Workers AI: comprensione e voce, mai decisione
  sovrapposizione.ts     le sostituzioni del cliente sopra la dieta, che resta
  nomi.ts                il nome da mostrare quando il nome non c'è ancora
web/                     LE QUATTRO SCHERMATE — nessuna dipendenza esterna
  accedi · registrazione · studio · cliente · ui.css · comune.js
                         un insieme di simboli tipografici, nessuna emoji:
                         l'elenco completo è in testa a ui.css
migrations/               schema D1
  0001_init.sql            utenti, collegamenti, diete, variazioni, domande
  0004_piano_e_messaggi.sql  la sostituzione era nel piano, l'interruttore
                             dell'assistente, il filo dei messaggi

src/                     IL MOTORE — non sa che esistono utenti o database
  types.ts               lo schema della dieta, e nient'altro
  core/composizione.ts   valori per 100 g: libreria dello studio, poi tabella
  core/dieta.ts          i conti, con dichiarata la loro incertezza
  core/equivalenza.ts    le sostituzioni calcolate (isocalorica, isoproteica)
  core/piano.ts          le sostituzioni AMMESSE: l'elenco chiuso del professionista
  core/recupero.ts       «ho saltato un pasto»: i conti, non la decisione
  core/assistente.ts     interpretazione della domanda e risposte del motore
  core/spesa.ts          la settimana aggregata
test/                    136 test
archivio/                il sistema precedente, non collegato a nulla
```

Il motore in `src/` non importa nulla da `worker/`: è il confine che lo tiene
portabile e testabile senza un database. Il traffico va in una direzione sola.

### Il pezzo su cui si regge la responsabilità

`worker/sovrapposizione.ts` — **la dieta non si tocca**. Quando il cliente
sostituisce il riso con le patate, il professionista deve poter continuare a
vedere che lui aveva scritto riso. La sostituzione non modifica il documento:
vive nella riga di variazione e viene applicata al momento della lettura.

Non c'è una tabella apposta: le sostituzioni attive **sono** le righe di
`variations` non annullate. Una fonte di verità sola, con due conseguenze che
vengono gratis — il veto del professionista funziona da sé (mette la riga ad
`annullata` e il piatto torna quello prescritto), e non possono esistere una
sostituzione di cui lo studio non sa nulla né una notifica senza il piatto
corrispondente.

## Stato e limiti dichiarati

**Fatto e verificato.** 136 test sul motore e 123 controlli end-to-end, questi
ultimi eseguiti **contro l'istanza pubblicata**, non solo in locale. Il giro
completo: iscrizione dei due ruoli → il cliente cerca lo studio e manda
la richiesta → il professionista accetta → scrive e pubblica una settimana → il
cliente la vede con i valori calcolati → sostituisce un alimento per equivalenza
→ la variazione arriva al professionista → lui la annulla e il piatto torna
quello prescritto.

Il giro delle funzioni nuove, anch'esso coperto: il professionista scrive le
sostituzioni ammesse su un alimento e sceglie la base → il cliente le vede con
le porzioni già calcolate → sceglierne una non gli tocca l'aderenza, sceglierne
una fuori elenco sì e glielo si dice prima → la porzione scritta a mano resta
quella → il professionista spegne l'assistente per quel cliente → il messaggio
successivo aspetta lui, che risponde di persona → riacceso, l'assistente torna
a rispondere.

Le prove end-to-end sono state eseguite **anche contro l'istanza pubblicata**,
dopo aver applicato la migrazione `0004`: 123 su 123.

**Non fatto — e va detto prima di aprire il servizio.**

- **Recupero password.** Se qualcuno la dimentica, non c'è modo di rientrare:
  serve l'invio di email. È la mancanza più seria che resta.
- **Registro di quello che il cliente mangia davvero.** Oggi il cliente dichiara
  un pasto saltato e ottiene i conti sul momento, ma niente resta scritto. Un
  diario alimentare è la cosa più utile da aggiungere dopo.
- **I valori della tabella interna non sono validati da un nutrizionista.** Sono
  stime plausibili e lo dicono. Uno studio che vuole numeri propri li sovrascrive
  dalla sua libreria, alimento per alimento.

**Sostituito.** Il sistema precedente — piani a modello con slot e alternative,
generatore deterministico della settimana, validatore di conformità, import da
testo, profilo di stile — è stato rimpiazzato dalla dieta scritta a mano. Sta in
`archivio/`, non è collegato a nulla e non viene distribuito: si può eliminare
senza conseguenze.
