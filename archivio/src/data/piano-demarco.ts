import type { FoodOption, MealTemplate, NutritionPlan } from '../types.ts';

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
/* Verdure: condivise tra pranzo e cena                                */
/* ------------------------------------------------------------------ */

const VERDURE: FoodOption[] = [
  ['verdura-insalata', 'insalata mista'],
  ['verdura-zucchine', 'zucchine'],
  ['verdura-broccoli', 'broccoli'],
  ['verdura-spinaci', 'spinaci'],
  ['verdura-fagiolini', 'fagiolini'],
  ['verdura-carote', 'carote'],
  ['verdura-pomodorini', 'pomodorini'],
  ['verdura-asparagi', 'asparagi'],
  ['verdura-melanzane', 'melanzane'],
  ['verdura-peperoni', 'peperoni'],
  ['verdura-cavolfiore', 'cavolfiore'],
  ['verdura-finocchi', 'finocchi'],
  ['verdura-zucca', 'zucca'],
  ['verdura-rucola', 'rucola'],
].map(([id, label]) =>
  f(id, label, 200, 'g', 'Verdura', { cook: 'quick', keepsDays: 3 }),
);

const MINESTRE: FoodOption[] = [
  f('verdura-minestra', 'minestra di verdure', 300, 'ml', 'Verdura', {
    cook: 'batch',
    keepsDays: 3,
  }),
  f('verdura-passato', 'passato di verdure', 300, 'ml', 'Verdura', {
    cook: 'batch',
    keepsDays: 3,
  }),
  f('verdura-vellutata', 'vellutata di verdure', 300, 'ml', 'Verdura', {
    cook: 'batch',
    keepsDays: 3,
  }),
];

const GRASSI_CONDIMENTO: FoodOption[] = [
  f('grasso-evo', 'olio extravergine d\'oliva', 10, 'g', 'Dispensa', { cook: 'none' }),
  f('grasso-burro', 'burro', 10, 'g', 'Latticini', { cook: 'none' }),
  f('grasso-frutta-secca', 'frutta secca', 15, 'g', 'Frutta secca', { cook: 'none' }),
  f('grasso-avocado', 'avocado', 50, 'g', 'Frutta e verdura', { cook: 'none' }),
];

/* ------------------------------------------------------------------ */
/* Carboidrati: condivisi tra pranzo e cena                            */
/* ------------------------------------------------------------------ */

const CARBO_PRINCIPALI: FoodOption[] = [
  f('carbo-riso', 'riso', 130, 'g', 'Cereali e derivati', { cook: 'batch', keepsDays: 3 }),
  f('carbo-riso-integrale', 'riso integrale', 130, 'g', 'Cereali e derivati', {
    tags: ['cereale-integrale'],
    cook: 'batch',
    keepsDays: 3,
  }),
  f('carbo-pasta', 'pasta', 130, 'g', 'Cereali e derivati', {
    tags: ['pasta'],
    cook: 'quick',
    keepsDays: 1,
  }),
  f('carbo-pasta-integrale', 'pasta integrale', 130, 'g', 'Cereali e derivati', {
    tags: ['pasta', 'cereale-integrale'],
    cook: 'quick',
    keepsDays: 1,
  }),
  f('carbo-cous-cous', 'cous cous', 130, 'g', 'Cereali e derivati', {
    cook: 'quick',
    keepsDays: 3,
  }),
  f('carbo-quinoa', 'quinoa', 130, 'g', 'Cereali e derivati', {
    tags: ['cereale-integrale'],
    cook: 'batch',
    keepsDays: 3,
  }),
  f('carbo-farro', 'farro', 130, 'g', 'Cereali e derivati', {
    tags: ['cereale-integrale'],
    cook: 'batch',
    keepsDays: 3,
  }),
  f('carbo-orzo', 'orzo', 130, 'g', 'Cereali e derivati', {
    tags: ['cereale-integrale'],
    cook: 'batch',
    keepsDays: 3,
  }),
  f('carbo-piadina', 'piadina', 130, 'g', 'Cereali e derivati', { cook: 'quick' }),
  f('carbo-pane', 'pane', 130, 'g', 'Cereali e derivati', { cook: 'none' }),
  f('carbo-pane-integrale', 'pane integrale', 130, 'g', 'Cereali e derivati', {
    tags: ['cereale-integrale'],
    cook: 'none',
  }),
  f('carbo-patate', 'patate', 450, 'g', 'Frutta e verdura', { cook: 'batch', keepsDays: 3 }),
  f('carbo-polenta', 'polenta', 450, 'g', 'Cereali e derivati', { cook: 'batch', keepsDays: 3 }),
  f('carbo-gnocchi', 'gnocchi di patate', 350, 'g', 'Cereali e derivati', { cook: 'quick' }),
];

/** Parte cereale della sostituzione "cereali + legumi". */
const CARBO_COMBO: FoodOption[] = [
  f('combo-riso', 'riso', 100, 'g', 'Cereali e derivati', { cook: 'batch', keepsDays: 3 }),
  f('combo-riso-integrale', 'riso integrale', 100, 'g', 'Cereali e derivati', {
    tags: ['cereale-integrale'],
    cook: 'batch',
    keepsDays: 3,
  }),
  f('combo-pasta', 'pasta', 100, 'g', 'Cereali e derivati', {
    tags: ['pasta'],
    cook: 'quick',
    keepsDays: 1,
  }),
  f('combo-cous-cous', 'cous cous', 100, 'g', 'Cereali e derivati', {
    cook: 'quick',
    keepsDays: 3,
  }),
  f('combo-farro', 'farro', 100, 'g', 'Cereali e derivati', {
    tags: ['cereale-integrale'],
    cook: 'batch',
    keepsDays: 3,
  }),
];

const LEGUMI_COMBO: FoodOption[] = [
  ['combo-ceci', 'ceci cotti'],
  ['combo-fagioli', 'fagioli cotti'],
  ['combo-lenticchie', 'lenticchie cotte'],
  ['combo-piselli', 'piselli'],
].map(([id, label]) =>
  f(id, label, 100, 'g', 'Legumi', {
    tags: ['legumi'],
    cook: 'batch',
    keepsDays: 4,
    purchaseFactor: 1 / 3,
    purchaseNote: 'quantità a secco (50g secchi = 150g cotti)',
  }),
);

const LEGUMI_PIENI: FoodOption[] = [
  ['legumi-ceci', 'ceci cotti'],
  ['legumi-fagioli', 'fagioli cotti'],
  ['legumi-lenticchie', 'lenticchie cotte'],
  ['legumi-fagioli-neri', 'fagioli neri cotti'],
  ['legumi-piselli', 'piselli'],
].map(([id, label]) =>
  f(id, label, 250, 'g', 'Legumi', {
    tags: ['legumi'],
    cook: 'batch',
    keepsDays: 4,
    purchaseFactor: 1 / 3,
    purchaseNote: 'quantità a secco (50g secchi = 150g cotti)',
  }),
);

/* ------------------------------------------------------------------ */
/* che i due spuntini della giornata sono uguali.                       */
/* ------------------------------------------------------------------ */

const SPUNTINO_BASE: FoodOption[] = [
  f('sp-banana', 'banana', 100, 'g', 'Frutta e verdura', { tags: ['frutta'], cook: 'none' }),
  f('sp-frutta', 'frutta fresca', 200, 'g', 'Frutta e verdura', {
    tags: ['frutta'],
    cook: 'none',
  }),
  f('sp-yogurt', 'yogurt', 125, 'g', 'Latticini', { qtyMax: 150, cook: 'none' }),
  f('sp-crackers', 'crackers', 30, 'g', 'Cereali e derivati', { cook: 'none' }),
  f('sp-gallette', 'gallette', 30, 'g', 'Cereali e derivati', { cook: 'none' }),
  f('sp-fette-bisc', 'fette biscottate', 30, 'g', 'Cereali e derivati', { cook: 'none' }),
  f('sp-wasa', 'fette wasa', 30, 'g', 'Cereali e derivati', {
    tags: ['cereale-integrale'],
    cook: 'none',
  }),
  f('sp-pavesini', 'pavesini', 30, 'g', 'Cereali e derivati', { cook: 'none' }),
  f('sp-pane', 'pane', 50, 'g', 'Cereali e derivati', { cook: 'none' }),
];

const SPUNTINO_AGGIUNTA: FoodOption[] = [
  f('sp-frutta-secca', 'frutta secca', 30, 'g', 'Frutta secca', { cook: 'none' }),
  f('sp-crema-fs', 'crema di frutta secca', 30, 'g', 'Dispensa', { cook: 'none' }),
  f('sp-fesa', 'fesa di tacchino', 60, 'g', 'Salumi', { tags: ['affettato'], cook: 'none' }),
  f('sp-bresaola', 'bresaola', 60, 'g', 'Salumi', { tags: ['affettato'], cook: 'none' }),
  f('sp-crudo', 'prosciutto crudo', 60, 'g', 'Salumi', { tags: ['affettato'], cook: 'none' }),
  f('sp-cotto', 'prosciutto cotto', 60, 'g', 'Salumi', { tags: ['affettato'], cook: 'none' }),
];

const SPUNTINO_BARRETTA = f(
  'sp-barretta',
  'barretta proteica o a zona',
  50,
  'g',
  'Integratori',
  { cook: 'none' },
);

/** I due spuntini condividono struttura e alimenti: cambia solo l'orario. */
const spuntino = (id: string, label: string): MealTemplate => ({
  id,
  label,
  slots: [
    { id: 'base', label: 'Base', options: SPUNTINO_BASE },
    { id: 'aggiunta', label: 'Aggiunta', optional: true, options: SPUNTINO_AGGIUNTA },
  ],
  combos: [
    {
      id: `${id}-barretta`,
      label: 'Barretta proteica / a zona',
      replaces: ['base', 'aggiunta'],
      parts: [{ slotId: 'base', options: [SPUNTINO_BARRETTA] }],
    },
  ],
});

/* ------------------------------------------------------------------ */
/* Il piano                                                            */
/* ------------------------------------------------------------------ */

export const pianoDeMarco: NutritionPlan = {
  id: 'demarco-2026-02',
  patient: {
    name: 'Luca De Marco',
    goal: 'Aumento di massa muscolare',
    trainingDays: [0, 2, 4],
  },
  professional: {
    id: 'digiusto',
    name: 'dott. Giovanni Di Giusto',
    register: 'Albo Biologi n. Tri A3252',
  },
  issuedAt: '2026-02-18',
  weighingNote: 'Tutte le quantità sono a crudo e senza scarti.',

  generalRules: [
    'Il piano comprende 1 pasto libero settimanale.',
    'Alcol: max 2 unità alcoliche/settimana (1 unità = 1 calice di vino, 1 birra 330ml o 1 superalcolico 40ml).',
    'Bere almeno 2 L di acqua al giorno, 2,5 L nei giorni di allenamento.',
    "L'olio assegnato va usato sia per condire che per cucinare.",
    'Tè, caffè, tisane e infusi non zuccherati a piacere.',
    'È possibile invertire le fonti proteiche del pranzo con quelle della cena.',
    'Condimenti verdure: aceto, balsamico, limone, sale moderato, senape (1 cucchiaino), spezie.',
    'Condimenti pasta: salsa di pomodoro (~100g) e verdure; pesto ~30g o ragù ~60g riducendo o togliendo l\'olio. Evitare sughi pronti e panna.',
  ],

  supplements: [
    {
      name: 'Creatina monoidrato',
      dose: '5 g',
      when: 'a colazione',
      brands: ['Bulk', 'Named 100% Creatine Creapure', '+Watt Creatina Extra Gold'],
    },
  ],

  meals: [
    {
      id: 'colazione',
      label: 'Colazione',
      slots: [
        {
          id: 'base',
          label: 'Base',
          options: [
            f('col-cereali', 'cereali da colazione', 100, 'g', 'Cereali e derivati', {
              cook: 'none',
            }),
            f('col-avena', 'farina di avena', 100, 'g', 'Cereali e derivati', {
              tags: ['cereale-integrale'],
              cook: 'none',
            }),
            f('col-pane-bianco', 'pane bianco', 100, 'g', 'Cereali e derivati', { cook: 'none' }),
            f('col-pane-integrale', 'pane integrale', 100, 'g', 'Cereali e derivati', {
              tags: ['cereale-integrale'],
              cook: 'none',
            }),
            f('col-gallette', 'gallette', 100, 'g', 'Cereali e derivati', { cook: 'none' }),
            f('col-fette-biscottate', 'fette biscottate', 100, 'g', 'Cereali e derivati', {
              cook: 'none',
            }),
            f('col-wasa', 'fette wasa', 100, 'g', 'Cereali e derivati', {
              tags: ['cereale-integrale'],
              cook: 'none',
            }),
          ],
        },
        {
          id: 'zuccheri',
          label: 'Zuccheri / frutta',
          options: [
            f('col-banana', 'banana', 100, 'g', 'Frutta e verdura', {
              tags: ['frutta'],
              cook: 'none',
            }),
            f('col-frutta', 'frutta fresca', 200, 'g', 'Frutta e verdura', {
              tags: ['frutta'],
              cook: 'none',
            }),
            f('col-marmellata', 'marmellata', 40, 'g', 'Dispensa', { cook: 'none' }),
            f('col-miele', 'miele', 30, 'g', 'Dispensa', { cook: 'none' }),
            f('col-agave', "sciroppo d'agave", 30, 'g', 'Dispensa', { cook: 'none' }),
            f('col-acero', "sciroppo d'acero", 30, 'g', 'Dispensa', { cook: 'none' }),
            f('col-succo', 'succo di frutta', 200, 'ml', 'Dispensa', { cook: 'none' }),
          ],
        },
        {
          id: 'proteine',
          label: 'Proteine',
          options: [
            f('col-yogurt', 'yogurt (tradizionale/greco/skyr/kefir)', 125, 'g', 'Latticini', {
              qtyMax: 150,
              cook: 'none',
            }),
            f('col-budino-prot', 'budino o mousse proteica', 170, 'g', 'Latticini', {
              qtyMax: 200,
              cook: 'none',
            }),
            f('col-uova', 'uova', 2, 'pz', 'Uova', { cook: 'quick' }),
            f('col-albume', 'albume', 200, 'ml', 'Uova', { cook: 'quick' }),
            // Da confermare: salmone affumicato conteggiato come pesce.
            f('col-salmone-aff', 'salmone affumicato', 60, 'g', 'Pesce', {
              tags: ['pesce'],
              cook: 'none',
            }),
            f('col-fesa', 'fesa di tacchino', 80, 'g', 'Salumi', {
              tags: ['affettato'],
              cook: 'none',
            }),
            f('col-cotto', 'prosciutto cotto', 80, 'g', 'Salumi', {
              tags: ['affettato'],
              cook: 'none',
            }),
            f('col-proteine-polvere', 'proteine in polvere', 30, 'g', 'Integratori', {
              cook: 'none',
            }),
          ],
        },
        {
          id: 'grassi',
          label: 'Grassi',
          options: [
            f('col-frutta-secca', 'frutta secca', 20, 'g', 'Frutta secca', { cook: 'none' }),
            f('col-crema-fs', 'crema di frutta secca', 20, 'g', 'Dispensa', { cook: 'none' }),
            f('col-crema-prot', 'crema proteica', 20, 'g', 'Integratori', { cook: 'none' }),
            f('col-cioccolato', 'cioccolato fondente', 20, 'g', 'Dispensa', { cook: 'none' }),
            f('col-avocado', 'avocado', 80, 'g', 'Frutta e verdura', { cook: 'none' }),
            f('col-sottiletta', 'sottiletta', 1, 'pz', 'Latticini', { cook: 'none' }),
            f('col-grana', 'grana', 20, 'g', 'Latticini', { cook: 'none' }),
          ],
        },
        {
          id: 'liquido',
          label: 'Facoltativo',
          optional: true,
          options: [
            f('col-latte', 'latte scremato o parz. scremato', 200, 'ml', 'Latticini', {
              cook: 'none',
            }),
            f('col-veg', 'bevanda vegetale', 200, 'ml', 'Latticini', { cook: 'none' }),
          ],
        },
      ],
    },

    spuntino('spuntino-mattina', 'Spuntino mattina'),

    {
      id: 'pranzo',
      label: 'Pranzo',
      slots: [
        { id: 'carbo', label: 'Carboidrati', options: CARBO_PRINCIPALI },
        {
          id: 'proteine',
          label: 'Proteine',
          options: [
            f('pr-pollo', 'petto di pollo', 200, 'g', 'Carne', { cook: 'batch', keepsDays: 3 }),
            f('pr-tacchino', 'petto di tacchino', 200, 'g', 'Carne', {
              cook: 'batch',
              keepsDays: 3,
            }),
            // Da confermare: vitello conteggiato come carne rossa.
            f('pr-vitello', 'vitello', 200, 'g', 'Carne', {
              tags: ['carne-rossa'],
              cook: 'quick',
              keepsDays: 2,
            }),
            f('pr-maiale', 'filetto di maiale', 200, 'g', 'Carne', { cook: 'quick', keepsDays: 2 }),
            f('pr-fesa', 'fesa di tacchino', 140, 'g', 'Salumi', {
              tags: ['affettato'],
              cook: 'none',
            }),
            f('pr-cotto', 'prosciutto cotto', 140, 'g', 'Salumi', {
              tags: ['affettato'],
              cook: 'none',
            }),
            f('pr-bresaola', 'bresaola', 100, 'g', 'Salumi', {
              tags: ['affettato'],
              cook: 'none',
            }),
            f('pr-crudo', 'prosciutto crudo', 100, 'g', 'Salumi', {
              tags: ['affettato'],
              cook: 'none',
            }),
            ...[
              ['pr-merluzzo', 'merluzzo'],
              ['pr-platessa', 'platessa'],
              ['pr-halibut', 'halibut'],
              ['pr-nasello', 'nasello'],
              ['pr-pangasio', 'pangasio'],
              ['pr-sogliola', 'sogliola'],
              ['pr-calamari', 'calamari'],
              ['pr-seppie', 'seppie'],
              ['pr-gamberi', 'gamberi'],
              ['pr-polpo', 'polpo'],
            ].map(([id, label]) =>
              f(id, label, 250, 'g', 'Pesce', { tags: ['pesce'], cook: 'quick', keepsDays: 1 }),
            ),
            f('pr-mozzarella', 'mozzarella light', 125, 'g', 'Latticini', { cook: 'none' }),
            f('pr-stracchino', 'stracchino light', 125, 'g', 'Latticini', { cook: 'none' }),
            f('pr-ricotta', 'ricotta', 150, 'g', 'Latticini', { cook: 'none' }),
            f('pr-fiocchi', 'fiocchi di latte', 150, 'g', 'Latticini', { cook: 'none' }),
            f('pr-tofu', 'tofu', 200, 'g', 'Vegetali', { cook: 'quick', keepsDays: 3 }),
            f('pr-tempeh', 'tempeh', 100, 'g', 'Vegetali', { cook: 'quick', keepsDays: 3 }),
            ...LEGUMI_PIENI,
          ],
        },
        { id: 'verdura', label: 'Verdura', options: [...VERDURE, ...MINESTRE] },
        { id: 'grassi', label: 'Grassi', options: GRASSI_CONDIMENTO },
      ],
      combos: [
        {
          id: 'pranzo-cereali-legumi',
          label: 'Cereali + legumi (sostituisce carbo e proteine)',
          replaces: ['carbo', 'proteine'],
          parts: [
            { slotId: 'carbo', options: CARBO_COMBO },
            { slotId: 'proteine', options: LEGUMI_COMBO },
          ],
        },
      ],
    },

    spuntino('spuntino-pomeriggio', 'Spuntino pomeriggio'),

    {
      id: 'cena',
      label: 'Cena',
      slots: [
        { id: 'carbo', label: 'Carboidrati', options: CARBO_PRINCIPALI },
        {
          id: 'proteine',
          label: 'Proteine',
          options: [
            f('ce-uova', '2 uova + 150ml albume', 1, 'pz', 'Uova', { cook: 'quick' }),
            f('ce-hamburger-veg', 'hamburger vegetale', 150, 'g', 'Vegetali', { cook: 'quick' }),
            f('ce-seitan', 'seitan', 150, 'g', 'Vegetali', { cook: 'quick' }),
            ...[
              ['ce-hamburger', 'hamburger di manzo'],
              ['ce-bistecca', 'bistecca'],
              ['ce-macinato', 'macinato magro'],
              ['ce-tartare', 'tartare di manzo magro'],
            ].map(([id, label]) =>
              f(id, label, 150, 'g', 'Carne', {
                tags: ['carne-rossa'],
                cook: 'quick',
                keepsDays: 1,
              }),
            ),
            ...[
              ['ce-salmone', 'salmone'],
              ['ce-orata', 'orata'],
              ['ce-spada', 'pesce spada'],
              ['ce-branzino', 'branzino'],
              ['ce-tonno-fresco', 'tonno'],
              ['ce-sgombro', 'sgombro'],
            ].map(([id, label]) =>
              f(id, label, 150, 'g', 'Pesce', { tags: ['pesce'], cook: 'quick', keepsDays: 1 }),
            ),
            f('ce-tonno-olio', 'tonno sott\'olio sgocciolato', 100, 'g', 'Pesce', {
              tags: ['pesce'],
              cook: 'none',
            }),
            f('ce-trota', 'trota', 150, 'g', 'Pesce', { tags: ['pesce'], cook: 'quick' }),
            f('ce-salmone-aff', 'salmone affumicato', 150, 'g', 'Pesce', {
              tags: ['pesce'],
              cook: 'none',
            }),
            // Da confermare: contano come formaggi grassi (max 2/settimana).
            ...[
              ['ce-grana', 'grana'],
              ['ce-scamorza', 'scamorza'],
              ['ce-emmental', 'emmental'],
              ['ce-pecorino', 'pecorino'],
            ].map(([id, label]) =>
              f(id, label, 80, 'g', 'Latticini', { tags: ['formaggio-grasso'], cook: 'none' }),
            ),
            ...LEGUMI_PIENI,
          ],
        },
        { id: 'verdura', label: 'Verdura', options: [...VERDURE, ...MINESTRE] },
        { id: 'grassi', label: 'Grassi', options: GRASSI_CONDIMENTO },
      ],
      combos: [
        {
          id: 'cena-cereali-legumi',
          label: 'Cereali + legumi (sostituisce carbo e proteine)',
          replaces: ['carbo', 'proteine'],
          parts: [
            { slotId: 'carbo', options: CARBO_COMBO },
            { slotId: 'proteine', options: LEGUMI_COMBO },
          ],
        },
      ],
    },
  ],

  frequencies: [
    { tag: 'pesce', min: 2, per: 'week', label: 'Pesce' },
    { tag: 'legumi', min: 2, per: 'week', label: 'Legumi' },
    { tag: 'cereale-integrale', min: 1, per: 'day', label: 'Cereali integrali' },
    { tag: 'frutta', min: 1, per: 'day', label: 'Frutta' },
    { tag: 'affettato', max: 2, per: 'week', label: 'Affettato' },
    { tag: 'carne-rossa', max: 2, per: 'week', label: 'Carne rossa' },
    { tag: 'formaggio-grasso', max: 2, per: 'week', label: 'Formaggi grassi' },
  ],

  structure: {
    fixedMeals: ['colazione'],
    allDifferentMeals: ['cena'],
    distinctWithinDay: [['spuntino-mattina', 'spuntino-pomeriggio']],
    repeatPatterns: [{ meal: 'pranzo', pattern: [2, 2, 2, 1] }],
    freeMeals: 1,
    freeMealDefaultMeal: 'cena',
    freeMealForbidden: [{ meal: 'pranzo', days: [6] }],
    proteinSwap: { between: ['pranzo', 'cena'], slot: 'proteine' },
    alcoholUnitsMax: 2,
    waterLitersPerDay: 2,
    waterLitersTrainingDay: 2.5,
    softPreferences: [
      {
        id: 'pasta-feriale',
        description: 'Nei giorni feriali limitare la pasta a pranzo',
        kind: 'avoid',
        days: [0, 1, 2, 3, 4, 5],
        tags: ['pasta'],
        weight: 4,
      },
      {
        id: 'pasta-domenica',
        description: 'La pasta preferibilmente la domenica',
        kind: 'prefer',
        days: [6],
        tags: ['pasta'],
        weight: 3,
      },
    ],
  },
};
