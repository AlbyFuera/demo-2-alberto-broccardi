import type { FoodOption, PlannedDay, PlannedMeal, WeekPlan } from '../types.ts';

/** Grammi di macronutriente per 100 g/ml, oppure per pezzo. */
export interface FoodComposition {
  protein: number;
  carbs: number;
  fat: number;
  /** Base di riferimento dei valori: 100 g/ml oppure un pezzo. */
  per: 'g100' | 'pz';
  /** Da dove viene il dato. */
  source: string;
  confirmed: boolean;
}

export const KCAL_PER_GRAM = { protein: 4, carbs: 4, fat: 9 } as const;

export function kcalOf(macros: { protein: number; carbs: number; fat: number }): number {
  return (
    macros.protein * KCAL_PER_GRAM.protein +
    macros.carbs * KCAL_PER_GRAM.carbs +
    macros.fat * KCAL_PER_GRAM.fat
  );
}

const SOURCE = 'stima interna, non validata';

/** [proteine, carboidrati, grassi] per 100 g/ml. Valori stimati, da confermare. */
const PER_100: Record<string, [number, number, number]> = {
  /* cereali e derivati, a crudo */
  pasta: [13, 75, 1.5],
  'pasta integrale': [13, 67, 2.5],
  riso: [7, 80, 0.6],
  'riso integrale': [7.5, 74, 2.2],
  'riso basmati': [8, 78, 0.9],
  'riso venere': [8.5, 75, 2.5],
  farro: [15, 67, 2.5],
  orzo: [10.5, 71, 1.5],
  quinoa: [14, 64, 6],
  'cous cous': [12, 72, 1.5],
  'farina di avena': [13, 60, 7],
  'avena in fiocchi': [13, 60, 7],
  'cereali da colazione': [8, 78, 4],

  /* pane, gallette, sostituti */
  pane: [8.5, 58, 1],
  'pane bianco': [8.5, 58, 1],
  'pane integrale': [9, 49, 1.5],
  'pane azzimo': [10, 75, 1],
  piadina: [8, 50, 10],
  gallette: [8, 81, 2.8],
  'gallette di riso': [8, 81, 2.8],
  'gallette di farro': [10, 78, 2],
  'fette wasa': [10, 63, 1.7],
  'fette wasa integrali': [10, 63, 1.7],
  'fette biscottate': [11, 73, 6],
  crackers: [10, 70, 10],
  pavesini: [9, 76, 5],

  /* tuberi e derivati */
  patate: [2, 17, 0.1],
  'patate americane': [1.6, 20, 0.1],
  'gnocchi di patate': [4, 33, 0.5],
  polenta: [2, 20, 0.4], // già pronta, non farina

  /* carne */
  pollo: [23, 0, 1.5],
  'petto di pollo': [23, 0, 1.5],
  tacchino: [24, 0, 1],
  'petto di tacchino': [24, 0, 1],
  'fesa di tacchino': [19, 1, 2],
  'prosciutto cotto': [20, 1, 6],
  'prosciutto crudo': [26, 0, 11],
  bresaola: [32, 0.4, 2.6],
  lonza: [20, 0.5, 3],
  bistecca: [21, 0, 6],
  'macinato magro': [21, 0, 5],
  'macinato di vitello': [20, 0, 3],
  vitello: [20, 0, 2.5],
  equino: [21, 0, 2],
  'hamburger di manzo': [20, 0, 12],
  'tartare di manzo magro': [21, 0, 4],
  'filetto di maiale': [21, 0, 4],

  /* pesce */
  merluzzo: [17, 0, 0.7],
  nasello: [17, 0, 1.5],
  platessa: [16.5, 0, 1.5],
  sogliola: [16, 0, 1.5],
  pangasio: [15, 0, 3],
  halibut: [19, 0, 2],
  branzino: [18, 0, 2.5],
  orata: [20, 0, 3],
  trota: [19, 0, 3],
  salmone: [20, 0, 12],
  'salmone affumicato': [22, 0, 9],
  sgombro: [19, 0, 11],
  'pesce spada': [20, 0, 4],
  tonno: [22, 0, 4],
  'tonno al naturale': [24, 0, 1],
  "tonno sott'olio sgocciolato": [25, 0, 8],
  gamberi: [18, 0, 1],
  calamari: [13, 1, 1.5],
  seppie: [14, 1, 1.5],
  polpo: [16, 1, 1],

  /* uova e latticini */
  albume: [11, 0.7, 0.2],
  'mozzarella light': [19, 1.5, 11],
  ricotta: [8.8, 3.5, 10.9],
  'fiocchi di latte': [12, 3, 4],
  'stracchino light': [14, 2, 14],
  grana: [33, 0, 28],
  emmental: [28, 0, 31],
  pecorino: [26, 0, 33],
  scamorza: [25, 1, 21],
  yogurt: [6, 5, 2],
  'yogurt (tradizionale/greco/skyr/kefir)': [6, 5, 2],
  'latte scremato o parz. scremato': [3.4, 5, 1.5],
  'bevanda vegetale': [1, 3, 1.5],
  'budino o mousse proteica': [10, 5, 2],

  /* legumi e fonti vegetali, cotti dove indicato */
  'ceci cotti': [7, 17, 2.5],
  'fagioli cotti': [7, 15, 0.5],
  'fagioli neri cotti': [8, 16, 0.5],
  'lenticchie cotte': [7, 16, 0.4],
  piselli: [5.5, 10, 0.5],
  tofu: [8, 1.5, 4.8],
  tempeh: [19, 9, 11],
  seitan: [24, 4, 2],
  'hamburger vegetale': [17, 6, 9],

  /* verdura */
  asparagi: [3, 2, 0.2],
  broccoli: [3, 3, 0.4],
  carote: [1, 8, 0.2],
  cavolfiore: [2.5, 2.5, 0.3],
  fagiolini: [2, 3, 0.2],
  finocchi: [1.2, 1, 0.2],
  'insalata mista': [1.5, 2, 0.2],
  melanzane: [1.1, 2.6, 0.2],
  peperoni: [1, 4.2, 0.3],
  pomodorini: [1.2, 3.5, 0.2],
  rucola: [2.6, 2, 0.7],
  spinaci: [3, 2, 0.4],
  zucca: [1.1, 3.5, 0.1],
  zucchine: [1.3, 1.4, 0.1],
  'minestra di verdure': [1.5, 5, 1],
  'passato di verdure': [1.5, 5, 1],
  'vellutata di verdure': [1.5, 6, 2],

  /* grassi */
  'olio extravergine': [0, 0, 100],
  burro: [0.8, 0.6, 83],
  avocado: [2, 1.8, 15],
  'frutta secca': [18, 8, 55],
  mandorle: [22, 4.5, 55],
  noci: [15, 3.5, 65],
  'crema di frutta secca': [20, 10, 52],

  /* zuccheri e dolci */
  miele: [0.3, 80, 0],
  marmellata: [0.5, 60, 0],
  "sciroppo d'acero": [0, 67, 0],
  "sciroppo d'agave": [0, 76, 0],
  'cioccolato fondente': [7, 30, 42],
  'cioccolato fondente 70%': [8, 30, 42],
  'crema proteica': [20, 15, 25],
  'succo di frutta': [0.5, 11, 0],
  'barretta proteica o a zona': [30, 40, 12],

  /* frutta */
  'frutta fresca': [0.8, 12, 0.3],
  banana: [1.2, 23, 0.3],

  /* integratori proteici */
  'proteine in polvere': [80, 5, 3],
  'proteine isolate': [88, 2, 1],
  'proteine idrolizzate': [85, 2, 1],
};

const PER_PIECE: Record<string, [number, number, number]> = {
  uova: [6.5, 0.4, 5.5], // un uovo medio, ~55 g edibili
  tuorlo: [2.7, 0.3, 4.5],
  mela: [0.5, 19, 0.3], // un frutto medio, ~150 g
  sottiletta: [3.5, 1, 4.5],
  'budino proteico': [20, 10, 4],
  'burro di arachidi': [3.8, 1.5, 7.5], // un cucchiaio, ~15 g
  // Voce composita del piano: due uova più 150 ml di albume.
  '2 uova + 150ml albume': [29.5, 1.8, 11.3],
};

/* Ricerca della composizione */

const NORM = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9%+/().'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Chiavi ordinate dalla più lunga: "pane integrale" prima di "pane". */
const KEYS_100 = Object.keys(PER_100).sort((a, b) => b.length - a.length);
const KEYS_PZ = Object.keys(PER_PIECE).sort((a, b) => b.length - a.length);

function lookup(
  label: string,
  table: Record<string, [number, number, number]>,
  keys: string[],
  per: 'g100' | 'pz',
): FoodComposition | null {
  const norm = NORM(label);

  // Prima la corrispondenza esatta.
  const exact = table[norm] ?? table[label];
  if (exact) {
    return { protein: exact[0], carbs: exact[1], fat: exact[2], per, source: SOURCE, confirmed: false };
  }

  for (const key of keys) {
    if (norm.includes(NORM(key))) {
      const v = table[key];
      return { protein: v[0], carbs: v[1], fat: v[2], per, source: SOURCE, confirmed: false };
    }
  }
  return null;
}

export function compositionOf(food: FoodOption): FoodComposition | null {
  // 1. Composizione dichiarata dal professionista.
  if (food.composition) return food.composition;

  // 2. Tabella interna, per pezzo o per 100 g secondo l'unità dell'alimento.
  const fromTable =
    food.unit === 'pz'
      ? lookup(food.label, PER_PIECE, KEYS_PZ, 'pz')
      : lookup(food.label, PER_100, KEYS_100, 'g100');
  if (!fromTable) return null;

  if (food.nutrients && fromTable.per === 'g100') {
    const carbs = food.nutrients['carboidrati'] ?? food.nutrients['carbs'];
    const protein = food.nutrients['proteine'] ?? food.nutrients['protein'];
    const fat = food.nutrients['grassi'] ?? food.nutrients['fat'];
    return {
      ...fromTable,
      carbs: carbs ?? fromTable.carbs,
      protein: protein ?? fromTable.protein,
      fat: fat ?? fromTable.fat,
      source: carbs ?? protein ?? fat ? 'valori dichiarati nel piano, integrati con stima' : fromTable.source,
    };
  }
  return fromTable;
}

/* Energia di un alimento, un pasto, un giorno, una settimana */

export interface Energy {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  /** Alimenti di cui non si conosce la composizione: il conto è parziale. */
  unknown: string[];
  /** Alimenti senza peso ("q.b."), esclusi dal conto. */
  free: string[];
  /** Alimenti la cui composizione è una stima non confermata. */
  estimated: string[];
}

const ZERO = (): Energy => ({
  kcal: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  unknown: [],
  free: [],
  estimated: [],
});

function add(a: Energy, b: Energy): Energy {
  return {
    kcal: a.kcal + b.kcal,
    protein: a.protein + b.protein,
    carbs: a.carbs + b.carbs,
    fat: a.fat + b.fat,
    unknown: [...new Set([...a.unknown, ...b.unknown])],
    free: [...new Set([...a.free, ...b.free])],
    estimated: [...new Set([...a.estimated, ...b.estimated])],
  };
}

export function foodEnergy(food: FoodOption): Energy {
  const out = ZERO();

  if (food.freeQuantity) {
    out.free.push(food.label);
    return out;
  }

  const comp = compositionOf(food);
  if (!comp) {
    out.unknown.push(food.label);
    return out;
  }
  if (!comp.confirmed) out.estimated.push(food.label);

  const factor = comp.per === 'pz' ? food.qty : food.qty / 100;
  out.protein = comp.protein * factor;
  out.carbs = comp.carbs * factor;
  out.fat = comp.fat * factor;
  out.kcal = kcalOf(out);
  return out;
}

export function mealEnergy(meal: PlannedMeal): Energy {
  if (meal.kind !== 'plan') {
    const out = ZERO();
    out.unknown.push(meal.kind === 'free' ? 'pasto libero' : (meal.note ?? 'pasto fuori casa'));
    return out;
  }
  return meal.items.reduce((acc, item) => add(acc, foodEnergy(item.food)), ZERO());
}

export function dayEnergy(day: PlannedDay): Energy {
  return day.meals.reduce((acc, meal) => add(acc, mealEnergy(meal)), ZERO());
}

export function weekEnergy(week: WeekPlan): Energy {
  return week.days.reduce((acc, day) => add(acc, dayEnergy(day)), ZERO());
}

/* Scostamento */

export interface EnergyDelta {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  coverage: 'completa' | 'parziale';
  /** Cosa manca, per poterlo dire a schermo. */
  unknown: string[];
  before: Energy;
  after: Energy;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function energyDelta(before: Energy, after: Energy): EnergyDelta {
  const unknown = [...new Set([...before.unknown, ...after.unknown])];
  return {
    kcal: Math.round(after.kcal - before.kcal),
    protein: r1(after.protein - before.protein),
    carbs: r1(after.carbs - before.carbs),
    fat: r1(after.fat - before.fat),
    coverage: unknown.length === 0 ? 'completa' : 'parziale',
    unknown,
    before,
    after,
  };
}

/** Frase pronta per la notifica al professionista. */
export function describeDelta(delta: EnergyDelta): string {
  const segno = delta.kcal > 0 ? '+' : '';
  const base =
    delta.kcal === 0
      ? 'giornata invariata nelle calorie'
      : `${segno}${delta.kcal} kcal sulla giornata`;
  const macro = `P ${delta.protein >= 0 ? '+' : ''}${delta.protein} · C ${
    delta.carbs >= 0 ? '+' : ''
  }${delta.carbs} · G ${delta.fat >= 0 ? '+' : ''}${delta.fat}`;

  return delta.coverage === 'completa'
    ? `${base} (${macro})`
    : `${base} (${macro}) — conto parziale: manca la composizione di ${delta.unknown.join(', ')}`;
}
