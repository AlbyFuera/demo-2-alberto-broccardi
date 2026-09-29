export type Unit = 'g' | 'ml' | 'pz';

export type FoodTag = string;

export interface FoodOption {
  id: string;
  /** Nome come lo scrive il professionista. */
  label: string;
  qty: number;
  /** Estremo superiore, per le quantità espresse a intervallo (es. 125–150g). */
  qtyMax?: number;
  unit: Unit;
  freeQuantity?: boolean;
  nutrients?: Record<string, number>;
  fixedQty?: boolean;
  /** Etichette per il conteggio delle frequenze (es. 'pesce', 'legumi'). */
  tags?: FoodTag[];
  /** Categoria per aggregare la lista della spesa. */
  shoppingCategory: string;
  purchaseFactor?: number;
  purchaseNote?: string;
  /** Come si prepara: guida il meal prep. */
  cook?: 'batch' | 'quick' | 'none';
  /** Giorni di conservazione una volta cotto/preparato. */
  keepsDays?: number;
  /** Alimenti mutuamente esclusivi nello stesso pasto. */
  conflictsWith?: string[];
  composition?: import('./core/nutrition.ts').FoodComposition;
}

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
  target?: NutrientTarget;
}

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
  optional?: boolean;
  placementNote?: string;
}

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

export interface StructureRules {
  /** Pasti identici in tutti i giorni (es. colazione unica). */
  fixedMeals: string[];
  /** Pasti che devono essere tutti diversi tra loro (es. cene). */
  allDifferentMeals: string[];
  distinctWithinDay?: string[][];
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
/* di macronutrienti. Non sono pianificabili nel senso di questo       */
/* devono tornare, e spesso non tornano.                               */
/* ------------------------------------------------------------------ */

export interface MacroTarget {
  nutrient: string;
  gramsPerKg?: number;
  /** Grammi totali dichiarati dal professionista. */
  grams?: number;
  /** Kcal dichiarate dal professionista per questo macronutriente. */
  kcal?: number;
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
  weighingNote: string;
  meals?: MealTemplate[];
  /** Regimi alternati. In alternativa a `meals`, insieme a `schedule`. */
  variants?: PlanVariant[];
  /** Variante applicata a ciascuno dei 7 giorni (indice 0 = lunedì). */
  schedule?: string[];
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
