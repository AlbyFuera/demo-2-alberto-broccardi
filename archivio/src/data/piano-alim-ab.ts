import type { FoodOption, MealTemplate, NutritionPlan, Slot } from '../types.ts';

type Extra = Partial<Omit<FoodOption, 'id' | 'label' | 'qty' | 'unit'>>;

const f = (
  id: string,
  label: string,
  qty: number,
  unit: FoodOption['unit'],
  shoppingCategory: string,
  extra: Extra = {},
): FoodOption => ({ id, label, qty, unit, shoppingCategory, ...extra });

/* ------------------------------------------------------------------ */
/* Fonti di carboidrati                                                */
/*                                                                     */
/* `qty` è irrilevante: la porzione vera la calcola il motore dalla    */
/* quota di nutriente dello slot. `nutrients.carboidrati` è il valore  */
/* ------------------------------------------------------------------ */

const carb = (
  id: string,
  label: string,
  carboidrati: number,
  extra: Extra = {},
): FoodOption =>
  f(id, label, 100, 'g', 'Cereali e derivati', {
    nutrients: { carboidrati },
    cook: 'none',
    ...extra,
  });

const FONTI_CARBO: FoodOption[] = [
  carb('carb-pane-azzimo', 'pane azzimo', 75),
  carb('carb-riso-basmati', 'riso basmati', 78, { cook: 'batch', keepsDays: 3 }),
  carb('carb-riso-venere', 'riso venere', 75, { cook: 'batch', keepsDays: 3 }),
  carb('carb-cous-cous', 'cous cous', 72, { cook: 'quick', keepsDays: 3 }),
  carb('carb-gallette-farro', 'gallette di farro', 78),
  carb('carb-gallette-riso', 'gallette di riso', 81),
  carb('carb-wasa', 'fette wasa integrali', 63),
  carb('carb-avena-fiocchi', 'avena in fiocchi', 60),
  carb('carb-avena-farina', 'farina di avena', 60),
];

/** Quantità fissata dal professionista: vince sul calcolo. */
const PATATE_AMERICANE = f('carb-patate-americane', 'patate americane', 250, 'g', 'Frutta e verdura', {
  fixedQty: true,
  cook: 'batch',
  keepsDays: 3,
});

const slotCarbo = (grammi: number, conPatate: boolean): Slot => ({
  id: 'carbo',
  label: 'Carboidrati',
  target: { nutrient: 'carboidrati', qty: grammi, tolerance: 2 },
  options: conPatate ? [...FONTI_CARBO, PATATE_AMERICANE] : FONTI_CARBO,
});

/* ------------------------------------------------------------------ */
/* Elementi ricorrenti                                                 */
/* ------------------------------------------------------------------ */

const VERDURE: Slot = {
  id: 'verdura',
  label: 'Verdure',
  options: [
    f('verdure', 'verdure', 0, 'g', 'Verdura', { freeQuantity: true, cook: 'quick' }),
    f('insalata', 'insalata', 0, 'g', 'Verdura', { freeQuantity: true, cook: 'none' }),
  ],
};

const olio = (grammi: number): Slot => ({
  id: 'grassi',
  label: 'Grassi',
  options: [
    f(`evo-${grammi}`, 'olio extravergine di oliva', grammi, 'g', 'Dispensa', { cook: 'none' }),
  ],
});

const FRUTTA_SECCA: Slot = {
  id: 'frutta-secca',
  label: 'Frutta secca',
  options: [
    f('noci', 'noci', 15, 'g', 'Frutta secca', { cook: 'none' }),
    f('mandorle', 'mandorle', 15, 'g', 'Frutta secca', { cook: 'none' }),
  ],
};

const MELA: Slot = {
  id: 'frutta',
  label: 'Frutta',
  options: [f('mela', 'mela', 1, 'pz', 'Frutta e verdura', { tags: ['frutta'], cook: 'none' })],
};

const proteine = (options: FoodOption[]): Slot => ({
  id: 'proteine',
  label: 'Proteine',
  options,
});

const POLLO_120 = f('pollo-120', 'pollo', 120, 'g', 'Carne', { cook: 'batch', keepsDays: 3 });
const LONZA_120 = f('lonza-120', 'lonza', 120, 'g', 'Carne', { cook: 'quick', keepsDays: 2 });
const MERLUZZO_200 = f('merluzzo-200', 'merluzzo', 200, 'g', 'Pesce', {
  tags: ['pesce'],
  cook: 'quick',
  keepsDays: 1,
});
const PLATESSA_200 = f('platessa-200', 'platessa', 200, 'g', 'Pesce', {
  tags: ['pesce'],
  cook: 'quick',
  keepsDays: 1,
});

/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */

const A_CARBO = () => slotCarbo(50, true);

const ALIM_A: MealTemplate[] = [
  {
    id: 'pasto-1',
    label: 'Pasto 1',
    slots: [
      A_CARBO(),
      proteine([f('albume-150', 'albume', 150, 'ml', 'Uova', { cook: 'quick' })]),
      { id: 'tuorlo', label: 'Tuorlo', options: [f('tuorlo-1', 'tuorlo', 1, 'pz', 'Uova', { cook: 'quick' })] },
    ],
  },
  {
    id: 'pasto-2',
    label: 'Pasto 2',
    slots: [
      A_CARBO(),
      proteine([
        f('tacchino-100', 'tacchino', 100, 'g', 'Carne', { cook: 'batch', keepsDays: 3 }),
        f('tonno-160', 'tonno al naturale', 160, 'g', 'Pesce', { tags: ['pesce'], cook: 'none' }),
      ]),
      FRUTTA_SECCA,
    ],
  },
  {
    id: 'pasto-3',
    label: 'Pasto 3',
    slots: [
      A_CARBO(),
      proteine([POLLO_120, LONZA_120, MERLUZZO_200, PLATESSA_200]),
      VERDURE,
      olio(15),
    ],
  },
  {
    id: 'pasto-4',
    label: 'Pasto 4',
    slots: [
      A_CARBO(),
      proteine([
        f('pollo-100', 'pollo', 100, 'g', 'Carne', { cook: 'batch', keepsDays: 3 }),
        f('albume-150-b', 'albume', 150, 'ml', 'Uova', { cook: 'quick' }),
      ]),
      MELA,
    ],
  },
  {
    id: 'pasto-5',
    label: 'Pasto 5',
    slots: [
      A_CARBO(),
      proteine([
        f('tacchino-120', 'tacchino', 120, 'g', 'Carne', { cook: 'batch', keepsDays: 3 }),
        LONZA_120,
        POLLO_120,
        f('equino-120', 'equino', 120, 'g', 'Carne', {
          tags: ['equino'],
          cook: 'quick',
          keepsDays: 1,
        }),
      ]),
      olio(15),
      VERDURE,
    ],
  },
  {
    id: 'pasto-6',
    label: 'Pasto 6 (facoltativo)',
    optional: true,
    placementNote:
      'Come secondo spuntino di mattina o di pomeriggio, oppure prima di andare a letto. Senza carboidrati.',
    slots: [
      proteine([
        f('prot-iso', 'proteine isolate', 20, 'g', 'Integratori', { cook: 'none' }),
        f('prot-idro', 'proteine idrolizzate', 20, 'g', 'Integratori', { cook: 'none' }),
      ]),
      {
        id: 'grassi',
        label: 'Grassi',
        options: [
          f('burro-arachidi', 'burro di arachidi (1 cucchiaio)', 1, 'pz', 'Dispensa', {
            cook: 'none',
          }),
        ],
      },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */

const B_CARBO = () => slotCarbo(70, false);

const ALIM_B: MealTemplate[] = [
  {
    id: 'pasto-1',
    label: 'Pasto 1',
    slots: [
      B_CARBO(),
      proteine([f('albume-250', 'albume', 250, 'ml', 'Uova', { cook: 'quick' })]),
      { id: 'tuorlo', label: 'Tuorlo', options: [f('tuorlo-1', 'tuorlo', 1, 'pz', 'Uova', { cook: 'quick' })] },
    ],
  },
  {
    id: 'pasto-2',
    label: 'Pasto 2',
    slots: [
      B_CARBO(),
      proteine([
        POLLO_120,
        f('bresaola-80', 'bresaola', 80, 'g', 'Salumi', { tags: ['affettato'], cook: 'none' }),
      ]),
      MELA,
    ],
  },
  {
    id: 'pasto-3',
    label: 'Pasto 3',
    slots: [
      B_CARBO(),
      proteine([POLLO_120, LONZA_120, MERLUZZO_200, PLATESSA_200]),
      VERDURE,
      olio(10),
    ],
  },
  {
    id: 'pasto-4',
    label: 'Pasto 4',
    slots: [
      B_CARBO(),
      proteine([
        f('albume-150-b', 'albume', 150, 'ml', 'Uova', { cook: 'quick' }),
        f('tacchino-100', 'tacchino', 100, 'g', 'Carne', { cook: 'batch', keepsDays: 3 }),
      ]),
      FRUTTA_SECCA,
    ],
  },
  {
    id: 'pasto-5',
    label: 'Pasto 5',
    slots: [
      B_CARBO(),
      proteine([
        f('macinato-vitello-120', 'macinato di vitello', 120, 'g', 'Carne', {
          cook: 'quick',
          keepsDays: 1,
        }),
        LONZA_120,
        POLLO_120,
        MERLUZZO_200,
        PLATESSA_200,
      ]),
      olio(10),
      VERDURE,
    ],
  },
  {
    id: 'pasto-6',
    label: 'Pasto 6',
    placementNote: 'Senza carboidrati.',
    slots: [
      proteine([f('budino-proteico', 'budino proteico', 1, 'pz', 'Latticini', { cook: 'none' })]),
      {
        id: 'grassi',
        label: 'Grassi',
        options: [
          f('cioccolato-70', 'cioccolato fondente 70%', 15, 'g', 'Dispensa', { cook: 'none' }),
        ],
      },
    ],
  },
];

/* ------------------------------------------------------------------ */

export const pianoAlimAB: NutritionPlan = {
  id: 'alim-ab',
  patient: { name: 'Paziente Alim A/B' },
  professional: { id: 'alim', name: 'Nutrizionista (schema Alim A/B)' },
  issuedAt: '2026-07-29',
  weighingNote:
    'Le quote di carboidrati sono espresse in grammi di nutriente: la quantità di alimento è calcolata di conseguenza.',

  variants: [
    { id: 'a', label: 'Alim A', meals: ALIM_A },
    { id: 'b', label: 'Alim B', meals: ALIM_B },
  ],
  // Lun-Gio e Dom: Alim A. Ven-Sab: Alim B.
  schedule: ['a', 'a', 'a', 'a', 'b', 'b', 'a'],

  generalRules: [
    'Acqua 3/4 litri al giorno.',
    'Sale iodato, il giusto.',
    '1 pasto libero a settimana, la domenica.',
    'Il sesto pasto di Alim A è facoltativo e non prevede carboidrati: può essere collocato come secondo spuntino di mattina o di pomeriggio, oppure prima di andare a letto.',
  ],

  supplements: [],

  frequencies: [{ tag: 'equino', max: 2, per: 'week', label: 'Equino' }],

  structure: {
    fixedMeals: [],
    allDifferentMeals: [],
    repeatPatterns: [],
    freeMeals: 1,
    freeMealDefaultMeal: 'pasto-5',
    freeMealForbidden: [{ days: [0, 1, 2, 3, 4, 5] }],
    alcoholUnitsMax: 0,
    waterLitersPerDay: 3,
    waterLitersTrainingDay: 4,
    softPreferences: [],
  },
};
