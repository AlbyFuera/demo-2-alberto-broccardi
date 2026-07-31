/**
 * Livello AI — Workers AI.
 *
 * Perché Workers AI e non una chiave di un fornitore esterno: gira dentro lo
 * stesso Worker, non richiede nessuna chiave da custodire, e il piano gratuito
 * di Cloudflare include un'allocazione giornaliera che copre l'uso di uno
 * studio. Zero credenziali significa anche zero credenziali da far scadere il
 * giorno della dimostrazione.
 *
 * Il modello fa due cose, entrambe di LINGUA:
 *
 *  1. capisce la domanda del cliente meglio delle espressioni regolari;
 *  2. dice la risposta del motore con la voce del professionista.
 *
 * Quello che NON fa, e che il prompt di sistema gli vieta: cambiare grammature,
 * concedere sostituzioni, inventare valori nutrizionali, dare consigli propri.
 * Ogni numero arriva da `equivalenza.ts` e da `dieta.ts`. Il modello riformula,
 * non rivede.
 *
 * Se il binding manca, la quota è esaurita o la rete cade, `null` fa ricadere
 * tutto sul motore: le stesse risposte, scritte dal codice. L'assistente
 * peggiora di lingua, mai di contenuto.
 */

import type { Domanda, Risposta } from '../src/core/assistente.ts';
import type { Equivalenza } from '../src/core/equivalenza.ts';
import { scriviQuantita } from '../src/core/dieta.ts';
import { plausibile } from './plausibile.ts';
import type { Env } from './types.ts';

const MODELLO_PREDEFINITO = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

export interface StatoAi {
  attivo: boolean;
  motivo?: string;
  modello?: string;
}

export function stato(env: Env): StatoAi {
  if (!env.AI) {
    return {
      attivo: false,
      motivo:
        'L’assistente in linguaggio naturale non è collegato a questo ambiente. Le risposte ' +
        'restano corrette: le compone il motore, in italiano ma senza riformulazione.',
    };
  }
  return { attivo: true, modello: env.MODELLO_AI ?? MODELLO_PREDEFINITO };
}

/**
 * Una chiamata al modello, con tutti gli errori che ricadono su `null`.
 *
 * `null` non è un caso eccezionale: è il normale funzionamento quando il
 * modello non c'è, la quota è finita, la rete cade — o la frase che torna non è
 * una frase. Chi chiama ha sempre pronta la versione del motore.
 */
async function chiedi(
  env: Env,
  system: string,
  user: string,
  opzioni: { maxTokens: number; temperatura: number },
): Promise<string | null> {
  if (!env.AI) return null;

  try {
    const risposta = (await env.AI.run(env.MODELLO_AI ?? MODELLO_PREDEFINITO, {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: opzioni.maxTokens,
      temperature: opzioni.temperatura,
    } as never)) as { response?: string } | string;

    const testo = typeof risposta === 'string' ? risposta : risposta?.response;
    return testo?.trim() || null;
  } catch {
    // Quota esaurita, modello non disponibile, rete: il motore basta.
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* 1. Comprensione della domanda                                       */
/* ------------------------------------------------------------------ */

const SYSTEM_INTENTO = `Classifichi le domande di un cliente sulla sua dieta.

Rispondi SOLO con un oggetto JSON, senza testo attorno, con questa forma:
{"tipo":"...","giorno":<0-6 o null>,"pastoId":"<id o null>","alimento":"<nome o null>","alimentoNuovo":"<nome o null>"}

Valori ammessi per "tipo":
- "saluto"        saluti e convenevoli
- "adesso"        cosa mangiare ora / prossimo pasto
- "giorno"        cosa prevede un giorno o un pasto specifico
- "sostituzione"  vuole cambiare un alimento con un altro
- "saltato"       ha saltato un pasto, chiede come recuperare
- "valori"        calorie, proteine, carboidrati, grassi
- "indicazioni"   acqua, alcol, integratori, regole generali
- "spesa"         lista della spesa
- "ignoto"        tutto il resto

"giorno": 0 = lunedì … 6 = domenica. null se non indicato.
"pastoId": SOLO uno degli id che ti vengono forniti. null se non indicato.
"alimento": l'alimento che vuole TOGLIERE dal piatto. null se non nominato.
"alimentoNuovo": l'alimento che vuole METTERCI. Riportalo SEMPRE, anche se non
compare tra i pasti che ti ho dato: serve proprio a segnalare che non c'è.

Esempi:
"posso mettere il riso invece della pasta?"   -> alimento: "pasta", alimentoNuovo: "riso"
"posso mangiare una pizza al posto del pollo?" -> alimento: "pollo", alimentoNuovo: "pizza"
"vorrei cambiare il pollo di stasera"          -> alimento: "pollo", alimentoNuovo: null
"ho saltato il pranzo, come recupero?"         -> tipo: "saltato"`;

/**
 * Estrae il primo oggetto JSON dal testo del modello.
 *
 * I modelli piccoli premettono volentieri «Ecco il JSON:» e chiudono con un
 * blocco markdown. Cercare le graffe è più robusto che sperare in un output
 * pulito, e un fallimento qui costa solo il ritorno alle espressioni regolari.
 */
function primoJson(testo: string): any | null {
  const senzaFence = testo.replace(/```(?:json)?/g, '');
  const inizio = senzaFence.indexOf('{');
  const fine = senzaFence.lastIndexOf('}');
  if (inizio < 0 || fine <= inizio) return null;

  try {
    return JSON.parse(senzaFence.slice(inizio, fine + 1));
  } catch {
    return null;
  }
}

const TIPI_AMMESSI = new Set([
  'saluto',
  'adesso',
  'giorno',
  'sostituzione',
  'saltato',
  'valori',
  'indicazioni',
  'spesa',
  'ignoto',
]);

export async function interpreta(
  env: Env,
  testo: string,
  pasti: { id: string; nome: string }[],
  oggi: number,
): Promise<Domanda | null> {
  const risposta = await chiedi(
    env,
    SYSTEM_INTENTO,
    `Oggi è il giorno ${oggi} (0 = lunedì).\n` +
      `Pasti di oggi: ${pasti.map((m) => `${m.id} ("${m.nome}")`).join(', ') || 'nessuno'}\n\n` +
      `Domanda del cliente: ${testo}`,
    { maxTokens: 256, temperatura: 0 },
  );
  if (!risposta) return null;

  const letto = primoJson(risposta);
  if (!letto || !TIPI_AMMESSI.has(letto.tipo)) return null;

  // Il modello può inventare un id di pasto: si accetta solo se esiste.
  const pastoId = pasti.some((m) => m.id === letto.pastoId) ? letto.pastoId : undefined;
  const giorno =
    Number.isInteger(letto.giorno) && letto.giorno >= 0 && letto.giorno <= 6
      ? letto.giorno
      : undefined;

  const stringa = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

  return {
    tipo: letto.tipo,
    giorno,
    pastoId,
    alimento: stringa(letto.alimento),
    alimentoNuovo: stringa(letto.alimentoNuovo),
    testo,
  };
}

/* ------------------------------------------------------------------ */
/* 2. Voce del professionista                                          */
/* ------------------------------------------------------------------ */

const SYSTEM_VOCE = `Sei l'assistente che parla al cliente per conto del suo nutrizionista.

REGOLA ASSOLUTA — non ammette eccezioni:
Puoi usare SOLO i fatti che ti vengono forniti. Non aggiungere alimenti, non
cambiare grammature, non concedere sostituzioni che i fatti non dichiarano
calcolate, non dare consigli nutrizionali tuoi, non citare linee guida
generali. Se un'informazione non è nei fatti, dì che non la sai e che la
domanda verrà girata allo studio. Non sei un nutrizionista: riferisci quello
che ha stabilito il professionista e quello che ha calcolato il motore.

Non dire MAI al cliente quanto deve mangiare per recuperare un pasto saltato,
nemmeno se te lo chiede: quella è una decisione del suo nutrizionista. Puoi
dirgli quanto gli manca — è un conto, non un consiglio.

Come scrivere:
- In italiano, dando del tu, con tono pratico e cordiale.
- Breve: due o tre frasi. È una chat, non un referto.
- Attribuisci le decisioni al professionista ("il tuo nutrizionista ha scritto…",
  "nella tua dieta…"), non a te stesso.
- Riporta grammature e calorie ESATTAMENTE come te le trovi scritte.
- Se un conto è dichiarato parziale, dillo: non presentarlo come esatto.
- Niente elenchi puntati: le liste le mostra già l'interfaccia sotto il messaggio.
- Niente emoji, niente "spero di esserti utile".`;

/** I fatti stabiliti dal motore, appiattiti per il modello. */
function fattiDa(risposta: Pick<Risposta, 'risposta' | 'schede' | 'citazioni'>): string[] {
  const fatti = [
    'Risposta stabilita dal motore (è la verità, riformulala senza cambiarla):',
    risposta.risposta,
  ];

  for (const scheda of risposta.schede) {
    if (scheda.righe?.length) {
      fatti.push(
        `${scheda.titolo}: ${scheda.righe.map((r) => `${r.nome} ${r.quantita}`).join(', ')}`,
      );
    }
    if (scheda.testo?.length) fatti.push(`${scheda.titolo}: ${scheda.testo.join(' · ')}`);
  }

  if (risposta.citazioni.length > 0) {
    fatti.push(`Da tenere presente:\n- ${risposta.citazioni.join('\n- ')}`);
  }
  return fatti;
}

export async function parlaConLaVoce(
  env: Env,
  risposta: Pick<Risposta, 'risposta' | 'schede' | 'citazioni'>,
  nomeProfessionista: string,
  domanda: string,
): Promise<string | null> {
  if (!risposta.risposta) return null;

  const voce = await chiedi(
    env,
    `${SYSTEM_VOCE}\n\nIl nutrizionista di questo cliente si chiama ${nomeProfessionista}.`,
    `Il cliente ha chiesto: "${domanda}"\n\n--- FATTI ---\n${fattiDa(risposta).join('\n')}`,
    { maxTokens: 400, temperatura: 0.3 },
  );

  return accettabile(voce, risposta.risposta);
}

/**
 * Il filtro finale: una riformulazione implausibile si butta.
 *
 * È l'ultima riga di difesa dell'architettura, e serve perché un modello
 * quantizzato può restituire un impasto di token senza segnalare alcun errore.
 * Il motore ha già la frase giusta: nel dubbio vince la sua.
 */
function accettabile(voce: string | null, attesa: string): string | null {
  if (!voce) return null;

  const v = plausibile(voce, attesa);
  if (v.ok) return voce;

  // Va nei log, non addosso al cliente: lui riceve la frase del motore, che è
  // corretta, e non sa che c'è stato un problema.
  console.warn('risposta del modello scartata:', v.motivo, '|', voce.slice(0, 120));
  return null;
}

/* ------------------------------------------------------------------ */
/* 3. La risposta su una sostituzione                                  */
/* ------------------------------------------------------------------ */

/**
 * Racconta l'esito di un'equivalenza.
 *
 * I fatti sono già decisi: la grammatura la calcola `equivalenza.ts`
 * pareggiando il macronutriente caratterizzante, il delta pure. Al modello
 * resta di scriverlo in due frasi. È la richiesta più frequente del cliente e
 * quella in cui la differenza tra «esatto» e «comprensibile» si sente di più.
 */
export async function raccontaEquivalenza(
  env: Env,
  e: Equivalenza,
  nomeProfessionista: string,
  domanda: string,
): Promise<string | null> {
  const fatti: string[] = [
    `Nel piatto c'è: ${e.esce.nome} ${scriviQuantita(e.esce)}.`,
    `Il cliente vorrebbe metterci: ${e.nomeEntra}.`,
  ];

  if (e.esito === 'calcolata' && e.entra && e.delta) {
    fatti.push(
      `ESITO: si può calcolare l'equivalenza.`,
      `Quantità giusta: ${e.entra.nome} ${scriviQuantita(e.entra)}, ${e.spiegazione}.`,
      `Scostamento della giornata: ${e.delta.kcal >= 0 ? '+' : ''}${Math.round(e.delta.kcal)} kcal, ` +
        `proteine ${e.delta.proteine >= 0 ? '+' : ''}${Math.round(e.delta.proteine)} g, ` +
        `carboidrati ${e.delta.carboidrati >= 0 ? '+' : ''}${Math.round(e.delta.carboidrati)} g, ` +
        `grassi ${e.delta.grassi >= 0 ? '+' : ''}${Math.round(e.delta.grassi)} g.`,
      `La modifica viene comunque segnalata a ${nomeProfessionista}, che può annullarla.`,
      ...e.avvisi.map((a) => `AVVISO DA RIPORTARE: ${a}`),
    );
  } else {
    fatti.push(
      `ESITO: NON calcolabile.`,
      `Motivo: ${e.motivo ?? 'composizione non nota'}.`,
      `Non è una decisione che possa prendere l'assistente: la richiesta è stata girata a ${nomeProfessionista}.`,
    );
  }

  const voce = await chiedi(
    env,
    `${SYSTEM_VOCE}\n\nIl nutrizionista di questo cliente si chiama ${nomeProfessionista}.`,
    `Il cliente ha chiesto: "${domanda}"\n\n--- FATTI ---\n${fatti.join('\n')}`,
    { maxTokens: 400, temperatura: 0.3 },
  );

  return accettabile(voce, fatti.join(' '));
}

/* ------------------------------------------------------------------ */
/* 4. Risposta libera, con la voce del nutrizionista                    */
/* ------------------------------------------------------------------ */

/**
 * Quando il motore non ha una risposta, risponde il modello.
 *
 * È un cambio di confine deciso dal committente, e va scritto qui perché chi
 * legge il codice lo sappia: prima una domanda che il motore non sapeva
 * risolvere veniva GIRATA al professionista. Adesso risponde l'assistente, e
 * quella risposta non passa da nessun umano.
 *
 * Quello che resta, e che non è negoziabile nemmeno così:
 *
 *  · i NUMERI della dieta continuano ad arrivare dal motore. Il modello può
 *    parlare di nutrizione in generale, non può dire al cliente che la sua
 *    dieta prevede una cosa che non prevede;
 *  · sintomi, farmaci e malattie NON si trattano. Non è un rifiuto del
 *    software: è quello che un nutrizionista risponderebbe davvero, perché una
 *    diagnosi non si fa per iscritto senza vedere la persona.
 */
const SYSTEM_LIBERO = `Sei l'assistente nutrizionale di un cliente, e parli con la voce del suo
nutrizionista. Rispondi a QUALSIASI domanda sul cibo, sull'alimentazione,
sull'attività fisica e sulle abitudini, come risponderebbe un buon
professionista in studio: con competenza, in modo pratico e senza giri di parole.

COSA SAI:
Ti vengono forniti i dati della dieta che il suo nutrizionista ha scritto —
pasti, grammature, calorie, obiettivi. Quelli sono FATTI: usali e non
contraddirli. Se il cliente chiede cosa prevede la sua dieta, la risposta è nei
fatti e non altrove.

COSA PUOI FARE, e devi farlo davvero:
RISPONDI ALLA DOMANDA. Non limitarti a dire che il nutrizionista non ha
scritto niente su quell'argomento — quello il cliente lo sa già, e una risposta
così è come non aver risposto. Se ti chiede del vino, digli cosa comporta un
bicchiere di vino in una giornata come la sua. Se ti chiede perché deve bere
acqua, spiegaglielo. Se è al ristorante, digli cosa ordinare.

Puoi spiegare, dare consigli di alimentazione, parlare di idratazione, di sonno,
di come gestire la fame, di come leggere un'etichetta, di un alimento che nella
dieta non c'è. Usa i dati della sua dieta per calare la risposta sul suo caso,
non per scansare la domanda.

COSA NON FAI, MAI:
- non cambi le grammature che il nutrizionista ha scritto e non inventi pasti
  che nella dieta non ci sono;
- se il cliente parla di sintomi, dolori, farmaci, esami o di una malattia, non
  fai ipotesi e non dai indicazioni: gli dici di parlarne direttamente con il
  suo nutrizionista o col medico. È quello che farebbe un professionista serio,
  non una scusa per non rispondere;
- non consigli digiuni, diete drastiche o integratori a chi non li ha in dieta.

COME SCRIVI:
In italiano, dando del tu, tre o quattro frasi. Concreto. Se dai un numero, dì
da dove viene. Niente elenchi puntati, niente emoji, niente «spero di esserti
utile».`;

/**
 * Risponde a una domanda qualunque, coi dati della dieta sotto mano.
 *
 * `fatti` è quello che il motore sa: la giornata del cliente, gli obiettivi, le
 * indicazioni del professionista. Serve a tenere la risposta ancorata alla sua
 * dieta invece che alla nutrizione in generale.
 */
export async function rispondiLibero(
  env: Env,
  domanda: string,
  fatti: string[],
  nomeProfessionista: string,
): Promise<string | null> {
  const voce = await chiedi(
    env,
    `${SYSTEM_LIBERO}\n\nIl nutrizionista di questo cliente si chiama ${nomeProfessionista}.`,
    `--- LA SUA DIETA ---\n${fatti.join('\n')}\n\n--- DOMANDA ---\n${domanda}`,
    { maxTokens: 500, temperatura: 0.4 },
  );

  // Stesso filtro delle altre risposte: un impasto di token non si mostra.
  return accettabile(voce, domanda);
}
