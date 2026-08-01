/**
 * Lo schema della dieta.
 *
 * Una dieta è quello che il nutrizionista scrive: sette giorni, ogni giorno i
 * suoi pasti, ogni pasto i suoi alimenti con la grammatura. Niente di più.
 *
 * Il modello precedente descriveva un piano a MODELLI — pasti con slot e liste
 * di alternative, da cui un generatore componeva la settimana. Era corretto per
 * i piani scritti così, ma non è come lavora la maggior parte dei
 * professionisti: loro scrivono il lunedì, poi il martedì. Questo schema
 * descrive quello, e nient'altro.
 *
 * Le sostituzioni si risolvono per EQUIVALENZA NUTRIZIONALE CALCOLATA
 * (`core/equivalenza.ts`): il cliente nomina un alimento e il motore dice con
 * quanto si sostituisce. Sopra a quel calcolo, e solo se il professionista lo
 * vuole, c'è il PIANO A SOSTITUZIONE (`core/piano.ts`): l'elenco chiuso delle
 * alternative che lui ammette per un singolo alimento, con la loro grammatura
 * già pronta. Le due cose convivono e non si contraddicono —
 *
 *   dentro l'elenco   il cliente sceglie da solo, e l'aderenza non ne risente
 *   fuori dall'elenco il calcolo risponde lo stesso, ma è una deviazione
 *
 * — e in entrambi i casi chi ha l'ultima parola resta il professionista, che
 * riceve ogni variazione e può annullarla.
 */

/** Unità in cui si esprime una grammatura. */
export type Unita = 'g' | 'ml' | 'pz';

export const UNITA: Unita[] = ['g', 'ml', 'pz'];

/**
 * Su quale grandezza si pareggia una sostituzione.
 *
 *   auto        il macronutriente che caratterizza l'alimento che esce
 *   kcal        isocalorica: stesse calorie
 *   proteine    isoproteica: stessi grammi di proteine
 *   carboidrati · grassi  le altre due, per completezza
 *
 * `auto` è il comportamento storico e resta il predefinito. Le altre esistono
 * perché la scelta è clinica e non aritmetica: su un piano ipocalorico conta
 * pareggiare le calorie, su uno ipertrofico conta che le proteine restino
 * quelle — 180 g di merluzzo portano ~31 g di proteine, e la sostituzione
 * isoproteica è quella che ne porta 31, qualunque cosa faccia il totale.
 */
export type BaseSostituzione = 'auto' | 'kcal' | 'proteine' | 'carboidrati' | 'grassi';

export const BASI: BaseSostituzione[] = ['auto', 'kcal', 'proteine', 'carboidrati', 'grassi'];

/**
 * Una sostituzione che il professionista AMMETTE per un alimento.
 *
 * La quantità è facoltativa, ed è la differenza che conta: quando c'è, è lui che
 * l'ha scritta e non si tocca; quando manca, la calcola il motore pareggiando
 * secondo la base dello slot. Nessuno scrive a mano le grammature di sei
 * alternative per trenta alimenti, ma tutti vogliono poter correggere quella
 * singola che nella loro esperienza va scritta diversamente.
 */
export interface Alternativa {
  nome: string;
  /** Quantità fissata dal professionista; assente = la calcola il motore. */
  quantita?: number | null;
  unita?: Unita;
}

/** Un alimento nel piatto, così come lo scrive il professionista. */
export interface Alimento {
  /** Nome come lo scrive lui: è anche la chiave con cui si cerca la composizione. */
  nome: string;
  /** Quantità. Assente quando è "q.b." — una prescrizione, non un buco. */
  quantita: number | null;
  unita: Unita;
  /** «a volontà», «q.b.»: il conto non la include e lo dichiara. */
  libera?: boolean;
  /** Nota del professionista su questo alimento («a crudo», «sgocciolato»). */
  nota?: string;

  /* --- il piano a sostituzione: vedi core/piano.ts --- */

  /**
   * Le alternative ammesse al posto di questo alimento.
   *
   * È l'elenco chiuso che il professionista decide: «a colazione la fonte
   * proteica può essere questa, questa o questa». Assente o vuoto significa che
   * per quell'alimento non ha previsto sostituzioni — il cliente può comunque
   * chiederne una, ma sarà FUORI PIANO e come tale viene contata.
   */
  alternative?: Alternativa[];
  /**
   * Eccezione alla regola della dieta, per QUESTO alimento.
   *
   * Assente è il caso normale e significa «come dice la dieta»: la regola la
   * fissa il professionista una volta sola in `Dieta.base`, non trenta volte.
   * Qui si scrive solo quando quel singolo alimento va pareggiato in un altro
   * modo — la fonte proteica isoproteica dentro un piano per il resto
   * isocalorico.
   */
  base?: BaseSostituzione;
  /**
   * Come si chiama questo posto nel pasto: «fonte proteica», «carboidrato».
   *
   * Serve solo a come si legge — «scegli la tua fonte proteica» invece di
   * «scegli al posto del petto di pollo». Se manca, si deduce dal
   * macronutriente caratterizzante dell'alimento prescritto.
   */
  gruppo?: string;
}

export interface Pasto {
  /** Stabile per tutta la vita della dieta: le variazioni ci puntano. */
  id: string;
  /** "Colazione", "Spuntino", "Pranzo": lo decide il professionista. */
  nome: string;
  /** Orario indicativo, se lo vuole indicare. */
  orario?: string;
  alimenti: Alimento[];
  nota?: string;
}

export interface Giorno {
  /** 0 = lunedì … 6 = domenica. */
  indice: number;
  pasti: Pasto[];
  /** Giorno di allenamento: cambia il fabbisogno e la nota sull'acqua. */
  allenamento?: boolean;
  nota?: string;
}

/** Obiettivi giornalieri, se il professionista li dichiara. */
export interface Obiettivi {
  kcal?: number;
  proteine?: number;
  carboidrati?: number;
  grassi?: number;
  /** Litri d'acqua al giorno. */
  acqua?: number;
  /**
   * Passi al giorno.
   *
   * Sta fra gli obiettivi della dieta e non fra i dati dell'utente perché lo
   * fissa il nutrizionista insieme a tutto il resto: il movimento fa parte di
   * quello che prescrive, non è un'impostazione dell'applicazione.
   */
  passi?: number;
}

export interface Dieta {
  id: string;
  titolo: string;
  /** Indicazioni generali: come pesare, alcol, integratori, cosa fare se… */
  indicazioni: string[];
  obiettivi: Obiettivi;
  giorni: Giorno[];

  /**
   * Come si pareggiano le sostituzioni in TUTTA la dieta. Predefinita: 'auto'.
   *
   * È una decisione clinica e sta qui perché è del piano, non del singolo
   * piatto: un piano ipocalorico si tiene sulle calorie, uno ipertrofico sulle
   * proteine, e quella scelta vale per ogni sostituzione che il cliente farà.
   * Il professionista la scrive una volta; `Alimento.base` esiste solo per le
   * eccezioni.
   *
   * Il cliente NON la sceglie e non la può cambiare: guardando può leggere
   * quale regola è in vigore, ma le porzioni che finiscono nel suo piatto
   * seguono sempre questa. Vedi `core/piano.ts`.
   */
  base?: BaseSostituzione;
}

export const NOMI_GIORNI = [
  'Lunedì',
  'Martedì',
  'Mercoledì',
  'Giovedì',
  'Venerdì',
  'Sabato',
  'Domenica',
] as const;

/** Una dieta vuota: sette giorni, nessun pasto. Il punto di partenza dell'editor. */
export function dietaVuota(id: string, titolo: string): Dieta {
  return {
    id,
    titolo,
    indicazioni: [],
    obiettivi: {},
    giorni: [0, 1, 2, 3, 4, 5, 6].map((indice) => ({ indice, pasti: [] })),
  };
}

/* ------------------------------------------------------------------ */
/* Macronutrienti                                                      */
/* ------------------------------------------------------------------ */

export interface Macro {
  proteine: number;
  carboidrati: number;
  grassi: number;
}

export interface Valori extends Macro {
  kcal: number;
}

/**
 * Le kcal si DERIVANO dai macronutrienti (4/4/9) invece di essere un quarto
 * numero indipendente. Un quarto numero può contraddire i primi tre; una
 * formula non può.
 */
export const KCAL_PER_GRAMMO = { proteine: 4, carboidrati: 4, grassi: 9 } as const;

export function kcalDi(m: Macro): number {
  return (
    m.proteine * KCAL_PER_GRAMMO.proteine +
    m.carboidrati * KCAL_PER_GRAMMO.carboidrati +
    m.grassi * KCAL_PER_GRAMMO.grassi
  );
}

export const valoriDi = (m: Macro): Valori => ({ ...m, kcal: kcalDi(m) });

export const ZERO: Valori = { kcal: 0, proteine: 0, carboidrati: 0, grassi: 0 };

export function somma(a: Valori, b: Valori): Valori {
  return {
    kcal: a.kcal + b.kcal,
    proteine: a.proteine + b.proteine,
    carboidrati: a.carboidrati + b.carboidrati,
    grassi: a.grassi + b.grassi,
  };
}

/**
 * Un totale con dichiarata la sua incertezza.
 *
 * `mancanti` è la parte che conta: sono gli alimenti di cui non si conosce la
 * composizione. Un totale che li nasconde è peggio di un totale assente, perché
 * il professionista si fiderebbe di un numero senza fondamento.
 */
export interface Totale extends Valori {
  /** Alimenti senza composizione nota, esclusi dal conto. */
  mancanti: string[];
  /** Alimenti «q.b.», volutamente senza peso: non sono un errore. */
  libere: string[];
  /** Alimenti contati con una stima interna, non con valori del professionista. */
  stimati: string[];
}

export const TOTALE_ZERO: Totale = { ...ZERO, mancanti: [], libere: [], stimati: [] };

export function sommaTotali(a: Totale, b: Totale): Totale {
  return {
    ...somma(a, b),
    mancanti: [...a.mancanti, ...b.mancanti],
    libere: [...a.libere, ...b.libere],
    stimati: [...a.stimati, ...b.stimati],
  };
}

/** Il totale è completo solo se nessun alimento è rimasto fuori dal conto. */
export const totaleCompleto = (t: Totale): boolean => t.mancanti.length === 0;
