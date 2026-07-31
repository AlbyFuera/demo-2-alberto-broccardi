/**
 * I conti di una dieta scritta a mano.
 *
 * Il professionista scrive alimenti e grammature; questo modulo dice quanto
 * fanno. È l'unico posto in cui si sommano macronutrienti, e ogni totale porta
 * con sé la propria incertezza: quali alimenti non sono stati contati e perché.
 *
 * La distinzione tra i due modi di stare fuori da un conto è tutto il valore di
 * questo file:
 *
 *   MANCANTE  non si conosce la composizione        → il totale è incompleto
 *   LIBERA    il professionista ha scritto «q.b.»   → il totale è corretto così
 *
 * Confonderli farebbe apparire incompleta ogni dieta con delle verdure a
 * volontà, e il professionista smetterebbe di guardare l'avviso.
 */

import type { Alimento, Dieta, Giorno, Pasto, Totale, Valori } from '../types.ts';
import { NOMI_GIORNI, TOTALE_ZERO, sommaTotali, valoriDi } from '../types.ts';
import { macroDi, type Libreria } from './composizione.ts';

/* ------------------------------------------------------------------ */
/* Totali                                                              */
/* ------------------------------------------------------------------ */

export function totaleAlimento(alimento: Alimento, libreria?: Libreria): Totale {
  if (alimento.libera || alimento.quantita === null) {
    return { ...TOTALE_ZERO, libere: [alimento.nome] };
  }

  const calcolo = macroDi(alimento, libreria);
  if (!calcolo) return { ...TOTALE_ZERO, mancanti: [alimento.nome] };

  return {
    ...valoriDi(calcolo.macro),
    mancanti: [],
    libere: [],
    stimati: calcolo.composizione.fonte === 'tabella' ? [alimento.nome] : [],
  };
}

export const totalePasto = (pasto: Pasto, libreria?: Libreria): Totale =>
  pasto.alimenti.reduce((acc, a) => sommaTotali(acc, totaleAlimento(a, libreria)), TOTALE_ZERO);

export const totaleGiorno = (giorno: Giorno, libreria?: Libreria): Totale =>
  giorno.pasti.reduce((acc, p) => sommaTotali(acc, totalePasto(p, libreria)), TOTALE_ZERO);

/**
 * La media giornaliera, calcolata sui SOLI giorni in cui c'è qualcosa scritto.
 *
 * Dividere per sette una dieta compilata a metà darebbe un numero
 * rassicurante e falso — «1100 kcal al giorno» quando in realtà sono 2200 nei
 * tre giorni scritti e zero negli altri quattro.
 */
export function totaleSettimana(dieta: Dieta, libreria?: Libreria): {
  totale: Totale;
  media: Valori;
  giorniScritti: number;
} {
  const scritti = dieta.giorni.filter((g) => g.pasti.some((p) => p.alimenti.length > 0));
  const totale = scritti.reduce((acc, g) => sommaTotali(acc, totaleGiorno(g, libreria)), TOTALE_ZERO);
  const n = Math.max(scritti.length, 1);

  return {
    totale,
    media: {
      kcal: totale.kcal / n,
      proteine: totale.proteine / n,
      carboidrati: totale.carboidrati / n,
      grassi: totale.grassi / n,
    },
    giorniScritti: scritti.length,
  };
}

/* ------------------------------------------------------------------ */
/* Scostamento dagli obiettivi                                         */
/* ------------------------------------------------------------------ */

export interface Scostamento {
  /** null quando il professionista non ha dichiarato quell'obiettivo. */
  kcal: number | null;
  proteine: number | null;
  carboidrati: number | null;
  grassi: number | null;
  /** Il conto del giorno è incompleto: lo scostamento va letto come indicativo. */
  parziale: boolean;
}

/**
 * Di quanto un giorno si scosta dagli obiettivi.
 *
 * Positivo = sopra l'obiettivo. Restituisce `null` per gli obiettivi non
 * dichiarati invece di zero: «nessun obiettivo» e «obiettivo centrato» sono
 * cose diverse, e un grafico che le confonde mente.
 */
export function scostamento(dieta: Dieta, giorno: Giorno, libreria?: Libreria): Scostamento {
  const t = totaleGiorno(giorno, libreria);
  const o = dieta.obiettivi;
  const d = (attuale: number, obiettivo?: number) =>
    obiettivo === undefined || obiettivo === null ? null : attuale - obiettivo;

  return {
    kcal: d(t.kcal, o.kcal),
    proteine: d(t.proteine, o.proteine),
    carboidrati: d(t.carboidrati, o.carboidrati),
    grassi: d(t.grassi, o.grassi),
    parziale: t.mancanti.length > 0,
  };
}

/* ------------------------------------------------------------------ */
/* Navigazione                                                         */
/* ------------------------------------------------------------------ */

export const giornoDi = (dieta: Dieta, indice: number): Giorno | undefined =>
  dieta.giorni.find((g) => g.indice === indice);

export const pastoDi = (dieta: Dieta, indice: number, pastoId: string): Pasto | undefined =>
  giornoDi(dieta, indice)?.pasti.find((p) => p.id === pastoId);

export interface Posizione {
  giorno: number;
  pastoId: string;
  /** Posizione dell'alimento dentro il pasto. */
  indice: number;
}

export function alimentoIn(dieta: Dieta, pos: Posizione): Alimento | undefined {
  return pastoDi(dieta, pos.giorno, pos.pastoId)?.alimenti[pos.indice];
}

/**
 * Dove sta un alimento nominato, cercando prima nel giorno indicato.
 *
 * Preferire il giorno corrente non è un dettaglio: «posso cambiare il pollo?»
 * significa quasi sempre quello di oggi, e trovare per primo quello di giovedì
 * porta a proporre una sostituzione su un pasto a cui il cliente non pensava.
 */
export function trovaAlimento(
  dieta: Dieta,
  nome: string,
  giornoPreferito: number,
  pastoId?: string,
): Posizione | null {
  const cerca = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const bersaglio = cerca(nome);
  if (!bersaglio) return null;

  const ordine = [
    giornoPreferito,
    ...dieta.giorni.map((g) => g.indice).filter((i) => i !== giornoPreferito),
  ];

  // Due passate: prima le corrispondenze esatte su tutti i giorni, poi quelle
  // parziali. Senza, «riso» in un giorno lontano vincerebbe su «riso integrale»
  // nel giorno di oggi.
  for (const esatta of [true, false]) {
    for (const indice of ordine) {
      const giorno = giornoDi(dieta, indice);
      for (const pasto of giorno?.pasti ?? []) {
        if (pastoId && pasto.id !== pastoId) continue;
        for (let i = 0; i < pasto.alimenti.length; i++) {
          const n = cerca(pasto.alimenti[i].nome);
          if (esatta ? n === bersaglio : n.includes(bersaglio) || bersaglio.includes(n)) {
            return { giorno: indice, pastoId: pasto.id, indice: i };
          }
        }
      }
    }
  }
  return null;
}

/** Tutti i nomi di alimento che compaiono nella dieta, senza ripetizioni. */
export function alimentiDellaDieta(dieta: Dieta): string[] {
  const visti = new Set<string>();
  for (const giorno of dieta.giorni) {
    for (const pasto of giorno.pasti) {
      for (const a of pasto.alimenti) visti.add(a.nome);
    }
  }
  return [...visti];
}

/** I nomi di pasto usati nella dieta, per capire di quale parla il cliente. */
export function nomiDeiPasti(dieta: Dieta): { id: string; nome: string; giorno: number }[] {
  return dieta.giorni.flatMap((g) =>
    g.pasti.map((p) => ({ id: p.id, nome: p.nome, giorno: g.indice })),
  );
}

/* ------------------------------------------------------------------ */
/* Presentazione                                                       */
/* ------------------------------------------------------------------ */

export function scriviQuantita(a: Alimento): string {
  if (a.libera || a.quantita === null) return 'q.b.';
  const n = Math.round(a.quantita * 10) / 10;
  return a.unita === 'pz' ? `${n} pz` : `${n}${a.unita}`;
}

export const scriviAlimento = (a: Alimento): string => `${a.nome} ${scriviQuantita(a)}`;

export const nomeGiorno = (indice: number): string => NOMI_GIORNI[indice] ?? '—';

/** Vuota davvero: nessun alimento in nessun giorno. Non basta avere dei pasti. */
export const dietaVuotaDavvero = (dieta: Dieta): boolean =>
  !dieta.giorni.some((g) => g.pasti.some((p) => p.alimenti.length > 0));

/**
 * Gli alimenti di cui manca la composizione, con dove compaiono.
 *
 * È l'elenco che l'editor mostra al professionista perché li completi: finché
 * non lo fa, i totali della dieta restano incompleti e lui lo vede scritto.
 */
export function alimentiDaCompletare(
  dieta: Dieta,
  libreria?: Libreria,
): { nome: string; unita: string; dove: string[] }[] {
  const per = new Map<string, { nome: string; unita: string; dove: string[] }>();

  for (const giorno of dieta.giorni) {
    for (const pasto of giorno.pasti) {
      for (const a of pasto.alimenti) {
        if (a.libera || a.quantita === null) continue;
        if (macroDi(a, libreria)) continue;

        const chiave = `${a.nome.toLowerCase()}|${a.unita}`;
        const voce = per.get(chiave) ?? { nome: a.nome, unita: a.unita, dove: [] };
        voce.dove.push(`${nomeGiorno(giorno.indice)} · ${pasto.nome}`);
        per.set(chiave, voce);
      }
    }
  }
  return [...per.values()];
}
