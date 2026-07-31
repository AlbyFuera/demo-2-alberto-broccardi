/**
 * Schema dati generico di un piano alimentare.
 *
 * Nessun campo è modellato su uno specifico nutrizionista: il piano di un
 * professionista è un DATO, non codice. Il motore lavora solo su questa forma.
 */

export type Unit = 'g' | 'ml' | 'pz';

/**
 * Etichette usate per verificare le frequenze settimanali/giornaliere.
 * Sono generiche: un altro professionista può usarne un sottoinsieme,
 * o aggiungerne di proprie senza toccare il motore.
 */
export type FoodTag = string;

export interface FoodOption {
  id: string;
  /** Nome come lo scrive il professionista. */
  label: string;
  qty: number;
  /** Estremo superiore, per le quantità espresse a intervallo (es. 125–150g). */
  qtyMax?: number;
  unit: Unit;
  /**
   * Quantità libera ("verdure o insalata", senza peso).
   * Il validatore non controlla il peso di questi alimenti.
   */
  freeQuantity?: boolean;
  /**
   * Grammi di nutriente per 100 g di alimento, per gli slot che esprimono
   * la porzione in nutriente anziché in peso ("50 g di carboidrati").
   *
   * ATTENZIONE: questi valori determinano quanto il paziente si mette nel
   * piatto. DEVONO essere confermati dal professionista, mai dedotti in
   * silenzio dal software.
   */
  nutrients?: Record<string, number>;
  /**
   * La quantità è stata fissata esplicitamente dal professionista e vince
   * sul calcolo (es. "se mangi patate americane 250 g").
   */
  fixedQty?: boolean;
  /** Etichette per il conteggio delle frequenze (es. 'pesce', 'legumi'). */
  tags?: FoodTag[];
  /** Categoria per aggregare la lista della spesa. */
  shoppingCategory: string;
  /**
   * Fattore di conversione porzione -> quantità da acquistare.
   * Es. legumi: 250g cotti si comprano come ~83g secchi -> 0.33.
   */
  purchaseFactor?: number;
  purchaseNote?: string;
  /** Come si prepara: guida il meal prep. */
  cook?: 'batch' | 'quick' | 'none';
  /** Giorni di conservazione una volta cotto/preparato. */
  keepsDays?: number;
  /** Alimenti mutuamente esclusivi nello stesso pasto. */
  conflictsWith?: string[];
  /**
   * Composizione dichiarata dal professionista, per 100 g/ml o per pezzo.
   *
   * Quando c'è, è questa a decidere il calcolo calorico: batte la tabella di
   * stima interna (`core/nutrition.ts`). È il modo in cui uno studio porta le
   * proprie tabelle di riferimento dentro lo strumento.
   */
  composition?: import('./core/nutrition.ts').FoodComposition;
}

/**
 * Quota di nutriente che lo slot deve fornire.
 *
 * Alcuni professionisti non prescrivono grammi di alimento ma grammi di
 * nutriente ("50 g di carboidrati per pasto"), lasciando al paziente la
 * conversione. È proprio la conversione che il software deve togliergli.
 */
export interface NutrientTarget {
  nutrient: string;
  qty: number;
  /** Scarto ammesso in grammi di nutriente, per gli arrotondamenti. */
  tolerance?: number;
}

/** Un gruppo del pasto: "scegli 1 fonte da questo elenco". */
export interface Slot {
  id: string;
  label: string;
  options: FoodOption[];
  /** Quante opzioni scegliere. Default 1. */
  choose?: number;
  optional?: boolean;
  /**
   * Se presente, la porzione non è il `qty` dell'alimento ma la quantità che
   * fornisce questa quota di nutriente.
   */
  target?: NutrientTarget;
}

/**
 * Regola di sostituzione che rimpiazza più slot insieme.
 * Es. "100g cereali + 100g legumi cotti" al posto di carbo+proteine.
 */
export interface ComboPart {
  slotId: string;
  /** Alternative ammesse per questa parte della combo. */
  options: FoodOption[];
}

export interface ComboRule {
  id: string;
  label: string;
  /** Slot che questa combo sostituisce. */
  replaces: string[];
  parts: ComboPart[];
}

export interface MealTemplate {
  /** Identificativo libero: un piano può avere 3 pasti o 6. */
  id: string;
  label: string;
  slots: Slot[];
  combos?: ComboRule[];
  /** Pasto facoltativo (es. un sesto pasto lasciato alla scelta del paziente). */
  optional?: boolean;
  /** Nota del professionista sulla collocazione ("metà mattina o prima di dormire"). */
  placementNote?: string;
}

/**
 * Variante di piano applicata a certi giorni.
 *
 * Alcuni professionisti danno due o più schemi alternati ("lun-gio A,
 * ven-sab B"): non sono due piani diversi, è un unico piano a più regimi.
 */
export interface PlanVariant {
  id: string;
  label: string;
  meals: MealTemplate[];
}

export interface FrequencyRule {
  tag: FoodTag;
  min?: number;
  max?: number;
  per: 'week' | 'day';
  label?: string;
}

/**
 * Preferenza non vincolante: influenza la scelta del generatore,
 * ma la sua violazione non invalida la settimana (produce un warning).
 */
export interface SoftPreference {
  id: string;
  description: string;
  kind: 'avoid' | 'prefer';
  /** Indici dei giorni (0 = lunedì). */
  days: number[];
  foodIds?: string[];
  tags?: FoodTag[];
  weight: number;
}

/**
 * La "forma" della settimana secondo il metodo del professionista.
 * È qui che vive lo stile: un altro nutrizionista avrà pattern diversi.
 */
export interface StructureRules {
  /** Pasti identici in tutti i giorni (es. colazione unica). */
  fixedMeals: string[];
  /** Pasti che devono essere tutti diversi tra loro (es. cene). */
  allDifferentMeals: string[];
  /**
   * Gruppi di pasti che nello stesso giorno devono differire tra loro
   * (es. i due spuntini). Ogni gruppo è un elenco di meal id.
   */
  distinctWithinDay?: string[][];
  /**
   * Pattern di ripetizione: es. { meal: 'pranzo', pattern: [2,2,2,1] }
   * = tre coppie di giorni consecutivi + un giorno singolo.
   */
  repeatPatterns: { meal: string; pattern: number[] }[];
  /** Quanti pasti liberi a settimana. */
  freeMeals: number;
  /** Pasto sostituito di default dal pasto libero. */
  freeMealDefaultMeal: string;
  /** Coppie (pasto, giorno) vietate al pasto libero. */
  freeMealForbidden?: { meal?: string; days?: number[] }[];
  /** Slot proteico intercambiabile tra due pasti. */
  proteinSwap?: { between: [string, string]; slot: string };
  alcoholUnitsMax: number;
  waterLitersPerDay: number;
  waterLitersTrainingDay: number;
  softPreferences: SoftPreference[];
}

/* ------------------------------------------------------------------ */
/* Piani a obiettivi di macronutrienti                                 */
/*                                                                     */
/* Esiste una famiglia di piani che non prescrive alimenti ma quantità */
/* di macronutrienti. Non sono pianificabili nel senso di questo       */
/* motore — non c'è nulla da scegliere — ma sono verificabili, ed è    */
/* proprio lì che il software è utile: i conti di un piano a macro     */
/* devono tornare, e spesso non tornano.                               */
/* ------------------------------------------------------------------ */

export interface MacroTarget {
  nutrient: string;
  /** Grammi per kg di peso corporeo, se il piano lo esprime così. */
  gramsPerKg?: number;
  /** Grammi totali dichiarati dal professionista. */
  grams?: number;
  /** Kcal dichiarate dal professionista per questo macronutriente. */
  kcal?: number;
  /** Fattore di conversione (4 per proteine e carboidrati, 9 per i lipidi). */
  kcalPerGram: number;
}

/** Obiettivi per un tipo di giornata (allenamento, riposo, …). */
export interface DayTypeTargets {
  id: string;
  label: string;
  /** Giorni a cui si applica, se il piano lo specifica. */
  days?: number[];
  /** Kcal dichiarate per questo tipo di giornata. */
  kcal?: number;
  macros: MacroTarget[];
}

/** Indicazione discorsiva su un pasto, senza lista di alimenti. */
export interface MealSplitGuidance {
  id: string;
  label: string;
  kcalMin?: number;
  kcalMax?: number;
  /** Vincoli sui macro espressi dal professionista, in grammi. */
  macroGrams?: Record<string, { min?: number; max?: number; value?: number }>;
  /** Testo originale, riportato senza reinterpretazioni. */
  note: string;
}

export interface MacroPlan {
  bodyWeightKg?: number;
  durationWeeks?: number;
  tdeeStart?: number;
  tdeeEnd?: number;
  /** Kcal obiettivo per ciascuno dei 7 giorni. */
  dailyKcal?: (number | undefined)[];
  /** Totale settimanale dichiarato. */
  weeklyKcal?: number;
  dayTypes: DayTypeTargets[];
  mealSplit?: MealSplitGuidance[];
}

export interface Supplement {
  name: string;
  dose: string;
  when: string;
  brands?: string[];
}

export interface NutritionPlan {
  id: string;
  patient: { name: string; goal?: string; trainingDays?: number[] };
  professional: { id: string; name: string; register?: string };
  issuedAt: string;
  /** Nota vincolante sul modo di pesare (es. "a crudo e senza scarti"). */
  weighingNote: string;
  /** Pasti del piano, quando il regime è unico per tutta la settimana. */
  meals?: MealTemplate[];
  /** Regimi alternati. In alternativa a `meals`, insieme a `schedule`. */
  variants?: PlanVariant[];
  /** Variante applicata a ciascuno dei 7 giorni (indice 0 = lunedì). */
  schedule?: string[];
  /**
   * Obiettivi di macronutrienti, per i piani che non prescrivono alimenti.
   * Può coesistere con `meals`: un piano può dare sia le liste sia i target.
   */
  macro?: MacroPlan;
  frequencies: FrequencyRule[];
  structure: StructureRules;
  supplements: Supplement[];
  generalRules: string[];
}

/* ------------------------------------------------------------------ */
/* Settimana generata                                                  */
/* ------------------------------------------------------------------ */

export interface PlannedItem {
  slotId: string;
  food: FoodOption;
}

export type MealKind = 'plan' | 'free' | 'external';

export interface PlannedMeal {
  mealId: string;
  kind: MealKind;
  items: PlannedItem[];
  /** Firma per confrontare i pasti tra loro (pasti "diversi"/"uguali"). */
  signature: string;
  note?: string;
}

export interface PlannedDay {
  index: number;
  name: string;
  training: boolean;
  meals: PlannedMeal[];
}

export interface WeekPlan {
  planId: string;
  seed: number;
  days: PlannedDay[];
  alcoholUnits: number;
}

/* ------------------------------------------------------------------ */
/* Validazione                                                         */
/* ------------------------------------------------------------------ */

export interface Violation {
  rule: string;
  severity: 'error' | 'warning';
  message: string;
  where?: { day?: number; meal?: string; slot?: string };
}

export interface ValidationResult {
  ok: boolean;
  errors: Violation[];
  warnings: Violation[];
}

export const DAY_NAMES = [
  'Lunedì',
  'Martedì',
  'Mercoledì',
  'Giovedì',
  'Venerdì',
  'Sabato',
  'Domenica',
] as const;
