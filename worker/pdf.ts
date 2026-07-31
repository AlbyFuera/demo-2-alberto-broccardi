/**
 * Dal PDF del nutrizionista alla dieta strutturata.
 *
 * Due passaggi, entrambi su Workers AI e senza dipendenze da installare:
 *
 *   1. `AI.toMarkdown` converte il PDF in testo. Non è un modello linguistico,
 *      è un convertitore: legge il documento e restituisce quello che c'è
 *      scritto, senza interpretarlo.
 *   2. un modello legge quel testo e ne trascrive i pasti, una riga per alimento.
 *
 * IL PUNTO CHE CONTA, e che vale la pena leggere prima di toccare questo file:
 * quello che esce dal passo 2 è una PROPOSTA DI LETTURA, non una dieta. Il
 * professionista la vede nell'editor e la corregge dove il modello ha sbagliato.
 * Non c'è modo di saltare quel passaggio, ed è deliberato: un modello che legge
 * «150 g» dove c'era scritto «15 g» produce una dieta plausibile e sbagliata, e
 * nessuno se ne accorgerebbe più.
 *
 * Il PDF originale resta comunque scaricabile dal cliente. Se la lettura ha
 * sbagliato qualcosa, la carta del suo nutrizionista è sempre lì.
 *
 * ATTENZIONE, costa mezz'ora a chi non lo sa: WORKERS AI METTE IN CACHE le
 * risposte. Caricando due volte lo STESSO PDF si riceve la stessa risposta,
 * anche se nel frattempo il prompt è cambiato — durante lo sviluppo di questo
 * file sembrava che il modello ignorasse le istruzioni nuove, e invece stava
 * rispondendo la cache. Per provare una modifica al prompt serve un documento
 * diverso, non lo stesso.
 */

import type { Dieta, Giorno, Pasto, Unita } from '../src/types.ts';
import { dietaVuota } from '../src/types.ts';
import type { Env } from './types.ts';

/** Oltre questa dimensione il PDF non entra in una riga di D1. */
export const LIMITE_PDF = 700 * 1024;

/**
 * Il modello che trascrive il PDF.
 *
 * NON è quello che parla al cliente. Qui serve un modello VELOCE: la lettura
 * avviene dentro una richiesta HTTP, e il modello da 70 miliardi di parametri —
 * ottimo per scrivere una frase — impiegava troppo e faceva terminare il Worker
 * prima di rispondere. Trascrivere un elenco di alimenti è un lavoro meccanico,
 * e un modello più piccolo lo fa bene e in un paio di secondi.
 */
const MODELLO_LETTURA = '@cf/meta/llama-3.1-8b-instruct-fast';

export interface EsitoLettura {
  ok: boolean;
  /** Il testo estratto dal PDF, mostrato al professionista per il confronto. */
  testo?: string;
  /** I giorni ricavati, da confermare. */
  giorni?: Giorno[];
  /** Quello che la lettura non ha capito, da dire a voce alta. */
  avvisi: string[];
  motivo?: string;
}

/* ------------------------------------------------------------------ */
/* 1 · Dal PDF al testo                                                */
/* ------------------------------------------------------------------ */

export async function testoDelPdf(
  env: Env,
  nome: string,
  dati: ArrayBuffer,
): Promise<string | null> {
  if (!env.AI) return null;

  try {
    const esito = await (env.AI as any).toMarkdown([
      { name: nome, blob: new Blob([dati], { type: 'application/pdf' }) },
    ]);

    const primo = Array.isArray(esito) ? esito[0] : esito;
    const testo = typeof primo?.data === 'string' ? primo.data : null;
    return testo?.trim() || null;
  } catch {
    // Convertitore non disponibile, PDF illeggibile, quota: si dirà al
    // professionista che deve scrivere la dieta a mano, non si tirerà a indovinare.
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* 2 · Dal testo ai pasti                                              */
/* ------------------------------------------------------------------ */

/**
 * Si chiede al modello UNA RIGA per alimento, non un JSON annidato.
 *
 * Prima era JSON, e il modello lo sbagliava in un modo istruttivo: produceva
 * `},"nome":"Pranzo"` invece di `},{"nome":"Pranzo"` — una graffa mancante su
 * duemila caratteri, e tutta la lettura da buttare.
 *
 * Un formato piatto non ha annidamento da sbagliare. Se una riga esce storta si
 * scarta quella riga e le altre restano buone, mentre una parentesi fuori posto
 * annulla l'intero documento. Per un lavoro di trascrizione conta più questo che
 * l'eleganza del formato.
 */
const SYSTEM_LETTURA = `Trascrivi una dieta scritta da un nutrizionista.

Rispondi SOLO con delle righe, una per alimento, in questo formato esatto:

GIORNO|PASTO|ORARIO|ALIMENTO|QUANTITA|UNITA

- GIORNO: un numero. 0=lunedì 1=martedì 2=mercoledì 3=giovedì 4=venerdì 5=sabato 6=domenica
- PASTO: come lo chiama il documento (Colazione, Pranzo, Spuntino, Cena…)
- ORARIO: se il documento lo indica, altrimenti lascia vuoto
- ALIMENTO: il nome come è scritto
- QUANTITA: solo il numero. Se il documento non lo dà (a volontà, q.b.), lascia vuoto
- UNITA: g, ml oppure pz. Se la quantità è vuota, lascia vuoto anche questa

Esempio:
0|Colazione|08:00|fette biscottate|40|g
0|Colazione|08:00|marmellata|30|g
0|Pranzo|13:00|zucchine||
1|Cena|20:00|orata|170|g

TRASCRIVI, NON INTERPRETARE. Non aggiungere alimenti che non ci sono, non
completare quantità che il documento non dà, non correggere quello che ti sembra
sbagliato.

Se la dieta è uguale tutti i giorni, ripeti le righe per tutti e sette i giorni.
Se il documento indica solo alcuni giorni, scrivi solo quelli.

Alla fine, se qualcosa non ti è chiaro, aggiungi righe che cominciano con «!»
seguite dalla spiegazione in italiano. Nient'altro: nessuna introduzione, nessun
commento, nessun blocco di codice.`;

const UNITA_AMMESSE = new Set(['g', 'ml', 'pz']);

/**
 * Dalle righe del modello ai giorni. Niente entra senza passare da qui.
 *
 * Una riga che non torna si SCARTA e si dichiara: meglio sei pasti letti bene e
 * un avviso su una riga saltata, che sette pasti di cui uno inventato.
 */
function daRighe(
  risposta: string,
  nuovoId: () => string,
): { giorni: Giorno[]; avvisi: string[] } {
  const perGiorno = new Map<number, Map<string, Pasto>>();
  const avvisi: string[] = [];
  let scartate = 0;

  for (const riga of risposta.split(/\r?\n/)) {
    const r = riga.trim();
    if (!r || r.startsWith('```')) continue;

    if (r.startsWith('!')) {
      const nota = r.slice(1).trim().slice(0, 300);
      if (nota) avvisi.push(nota);
      continue;
    }

    const campi = r.split('|').map((c) => c.trim());
    if (campi.length < 4) {
      scartate++;
      continue;
    }

    const [giornoTesto, nomePasto, orario, nomeAlimento, quantitaTesto, unitaTesto] = campi;

    const giorno = Number(giornoTesto);
    if (!Number.isInteger(giorno) || giorno < 0 || giorno > 6) {
      scartate++;
      continue;
    }
    if (!nomeAlimento || nomeAlimento.length < 2) {
      scartate++;
      continue;
    }

    const q = Number(String(quantitaTesto ?? '').replace(',', '.'));
    const conQuantita = Number.isFinite(q) && q > 0;
    const unita = (UNITA_AMMESSE.has(unitaTesto ?? '') ? unitaTesto : 'g') as Unita;

    const pasti = perGiorno.get(giorno) ?? new Map<string, Pasto>();
    const chiave = (nomePasto || 'Pasto').toLowerCase();

    const pasto: Pasto = pasti.get(chiave) ?? {
      // Gli id li fa il server, sempre: ci puntano le spunte e le variazioni.
      id: nuovoId(),
      nome: (nomePasto || 'Pasto').slice(0, 40),
      orario: orario ? orario.slice(0, 10) : undefined,
      alimenti: [],
    };

    if (pasto.alimenti.length < 30) {
      pasto.alimenti.push({
        nome: nomeAlimento.slice(0, 80),
        quantita: conQuantita ? q : null,
        unita,
        libera: !conQuantita,
      });
    }

    pasti.set(chiave, pasto);
    perGiorno.set(giorno, pasti);
  }

  if (scartate > 0) {
    avvisi.push(
      `${scartate} righe della lettura non erano interpretabili e sono state scartate: ` +
        `confrontala con il testo del PDF qui sotto.`,
    );
  }

  const giorni: Giorno[] = [...perGiorno.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([indice, pasti]) => ({ indice, pasti: [...pasti.values()] }));

  return { giorni, avvisi };
}

/**
 * Legge il PDF e restituisce i giorni da far confermare.
 *
 * Ogni fallimento è dichiarato e non silenzioso: se la lettura non riesce, il
 * professionista lo sa e scrive la dieta a mano — che è come funzionava prima e
 * funziona ancora.
 */
export async function leggiPdf(
  env: Env,
  nome: string,
  dati: ArrayBuffer,
  nuovoId: () => string,
): Promise<EsitoLettura> {
  const testo = await testoDelPdf(env, nome, dati);
  if (!testo) {
    return {
      ok: false,
      avvisi: [],
      motivo:
        'Non sono riuscito a leggere il testo di questo PDF. Se è la scansione di un ' +
        'foglio scritto a mano, va inserita a mano anche qui.',
    };
  }

  if (!env.AI) return { ok: false, avvisi: [], motivo: 'Lettura automatica non disponibile.' };

  // Via l'intestazione che il convertitore mette davanti: versione del PDF, data
  // di creazione, produttore. Non c'entra nulla con la dieta e occupa il
  // contesto del modello con roba che lo distrae.
  const soloContenuto = testo.includes('## Contents')
    ? testo.slice(testo.indexOf('## Contents') + '## Contents'.length)
    : testo;

  /*
   * UNA SOLA chiamata, e con l'ingresso tagliato.
   *
   * Un secondo tentativo c'era e faceva più danni del problema che risolveva:
   * due generazioni dentro la stessa richiesta superavano il tempo massimo di un
   * Worker, che veniva terminato — e il professionista si ritrovava un errore
   * interno invece di una bozza. Meglio una lettura che a volte non riesce, con
   * il testo estratto pronto da incollare.
   */
  let risposta: string | null = null;
  try {
    const esito = (await env.AI.run(MODELLO_LETTURA, {
      messages: [
        { role: 'system', content: SYSTEM_LETTURA },
        { role: 'user', content: `Ecco la dieta:\n\n${soloContenuto.slice(0, 6000)}` },
      ],
      max_tokens: 1800,
      temperature: 0,
    } as never)) as { response?: string } | string;
    risposta = typeof esito === 'string' ? esito : (esito?.response ?? null);
  } catch (e) {
    console.error('lettura del PDF fallita:', e instanceof Error ? e.message : e);
  }

  const letto = risposta ? daRighe(risposta, nuovoId) : null;

  if (!letto || letto.giorni.length === 0) {
    if (risposta) console.warn('lettura non interpretabile:', risposta.slice(0, 400));
    return {
      ok: false,
      testo,
      avvisi: letto?.avvisi ?? [],
      motivo:
        'Ho letto il testo del PDF ma non sono riuscito a ricavarne i pasti. ' +
        'Il testo estratto è qui sotto: puoi ricopiarlo nell’editor.',
    };
  }

  const senzaQuantita = letto.giorni
    .flatMap((g) => g.pasti.flatMap((p) => p.alimenti))
    .filter((a) => a.quantita === null).length;

  return {
    ok: true,
    testo,
    giorni: letto.giorni,
    avvisi: [
      'Questa è una LETTURA del PDF, non la dieta: controllala riga per riga prima di pubblicarla.',
      ...letto.avvisi,
      ...(senzaQuantita > 0
        ? [
            `${senzaQuantita} alimenti sono senza quantità: nel PDF non c'era, o non l'ho letta. ` +
              `Completali, oppure lasciali come «q.b.» se il piano non prescrive un peso.`,
          ]
        : []),
    ],
  };
}

/** Una dieta nuova a partire dalla lettura di un PDF. */
export function dietaDaLettura(id: string, titolo: string, esito: EsitoLettura): Dieta {
  const dieta = dietaVuota(id, titolo);
  if (!esito.giorni) return dieta;

  dieta.giorni = dieta.giorni.map(
    (vuoto) => esito.giorni!.find((g) => g.indice === vuoto.indice) ?? vuoto,
  );
  return dieta;
}
