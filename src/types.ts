/** Unità in cui si esprime una grammatura. */
export type Unita = 'g' | 'ml' | 'pz';

export const UNITA: Unita[] = ['g', 'ml', 'pz'];

/** auto = macronutriente caratterizzante dell'alimento che esce. */
export type BaseSostituzione = 'auto' | 'kcal' | 'proteine' | 'carboidrati' | 'grassi';

export const BASI: BaseSostituzione[] = ['auto', 'kcal', 'proteine', 'carboidrati', 'grassi'];

export interface Alternativa {
  nome: string;
  /** Quantità fissata dal professionista; assente = la calcola il motore. */
  quantita?: number | null;
  unita?: Unita;
}

/** Un alimento nel piatto, così come lo scrive il professionista. */
export interface Alimento {
  /** Usato anche come chiave per la composizione. */
  nome: string;
  /** Assente quando è q.b. */
  quantita: number | null;
  unita: Unita;
  /** A volontà o q.b.: esclusa dal conto. */
  libera?: boolean;
  /** Nota del professionista su questo alimento. */
  nota?: string;

  /** Alternative ammesse dal professionista; vuoto = nessuna. */
  alternative?: Alternativa[];
  /** Deroga alla base della dieta; assente = come la dieta. */
  base?: BaseSostituzione;
  /** Se manca si deduce dal macronutriente caratterizzante. */
  gruppo?: string;
}

export interface Pasto {
  /** Id stabile, referenziato dalle variazioni. */
  id: string;
  nome: string;
  /** Orario indicativo. */
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
  /** Passi al giorno. */
  passi?: number;
}

export interface Dieta {
  id: string;
  titolo: string;
  /** Indicazioni generali del professionista. */
  indicazioni: string[];
  obiettivi: Obiettivi;
  giorni: Giorno[];

  /** Base delle sostituzioni per tutta la dieta; predefinita 'auto'. */
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

/** Dieta vuota: sette giorni, nessun pasto. */
export function dietaVuota(id: string, titolo: string): Dieta {
  return {
    id,
    titolo,
    indicazioni: [],
    obiettivi: {},
    giorni: [0, 1, 2, 3, 4, 5, 6].map((indice) => ({ indice, pasti: [] })),
  };
}

export interface Macro {
  proteine: number;
  carboidrati: number;
  grassi: number;
}

export interface Valori extends Macro {
  kcal: number;
}

/** Le kcal si calcolano dai macronutrienti (4/4/9). */
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

export interface Totale extends Valori {
  /** Alimenti senza composizione nota, esclusi dal conto. */
  mancanti: string[];
  /** Alimenti q.b., senza peso. */
  libere: string[];
  /** Alimenti contati con la tabella interna. */
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

/** Completo se nessun alimento è fuori dal conto. */
export const totaleCompleto = (t: Totale): boolean => t.mancanti.length === 0;
