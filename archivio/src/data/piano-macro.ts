/**
 * Terzo piano di collaudo — impostazione a macronutrienti.
 *
 * Famiglia diversa dalle prime due: NON prescrive alimenti. Fissa calorie e
 * grammi di macronutrienti e lascia al paziente la scelta del cibo.
 * Conseguenza diretta: il motore non può comporre una settimana, perché non
 * c'è nulla fra cui scegliere. Può però verificare che i conti tornino — ed è
 * esattamente lì che questo piano si rivela interessante.
 *
 * Le celle lasciate in bianco nel documento originale sono `undefined` qui,
 * non zero e non valori inventati: un dato mancante è un'informazione.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DA CONFERMARE DAL PROFESSIONISTA:
 *
 *  1. CONTRADDIZIONE PRINCIPALE. I macronutrienti sommano a 2.650 kcal, ma
 *     l'obiettivo giornaliero dichiarato è 1.800. Coincidono esattamente con
 *     il TDEE iniziale: sembrano non ricalcolati dopo il deficit.
 *  2. RIGA "REST DAY" vuota, benché il piano distingua i giorni di allenamento.
 *  3. PESO CORPOREO non indicato nel documento. Qui è dedotto dai rapporti
 *     g/kg (137/1,8 · 323/4,25 · 90/1,2 → ~76 kg) SOLO per poter verificare i
 *     conti: va confermato, non è un dato del piano.
 *  4. "se cena 600/70 kcal": quasi certamente 600/700, ma è una correzione che
 *     spetta a chi ha scritto il piano, non al software.
 *  5. TDEE finale, deficit medio, surplus/deficit totale e variazione di peso
 *     sono in bianco.
 */

import type { NutritionPlan } from '../types.ts';

/**
 * Peso DEDOTTO, non dichiarato. Serve solo a rendere verificabili i g/kg.
 * Se il professionista lo smentisce, cadono i controlli che lo usano — non i
 * dati del piano.
 */
const PESO_DEDOTTO_KG = 76;

export const pianoMacro: NutritionPlan = {
  id: 'macro-6-settimane',
  patient: { name: 'Paziente (piano a macronutrienti)' },
  professional: { id: 'ignoto', name: 'Professionista non indicato nel documento' },
  issuedAt: '2026-07-29',
  weighingNote:
    'Piano espresso in calorie e grammi di macronutrienti: gli alimenti sono a scelta del paziente.',

  macro: {
    bodyWeightKg: PESO_DEDOTTO_KG,
    durationWeeks: 6,
    tdeeStart: 2650,
    tdeeEnd: undefined, // in bianco nel documento
    dailyKcal: [1800, 1800, 1800, 1800, 1800, 1800, 1800],
    weeklyKcal: 12600,

    dayTypes: [
      {
        id: 'allenamento',
        label: 'Allenamento',
        macros: [
          { nutrient: 'proteine', gramsPerKg: 1.8, grams: 137, kcal: 548, kcalPerGram: 4 },
          { nutrient: 'carboidrati', gramsPerKg: 4.25, grams: 323, kcal: 1292, kcalPerGram: 4 },
          { nutrient: 'lipidi', gramsPerKg: 1.2, grams: 90, kcal: 810, kcalPerGram: 9 },
        ],
      },
      {
        id: 'riposo',
        label: 'Rest day',
        // Riga presente nel documento ma non compilata.
        macros: [],
      },
    ],

    mealSplit: [
      {
        id: 'pasto-1',
        label: 'Pasto 1',
        kcalMin: 600,
        kcalMax: 700,
        macroGrams: { carboidrati: { max: 50 } },
        note: '50 g di carbo o meno (meglio se integrali o da frutta), resto grassi e prevalentemente proteine.',
      },
      {
        id: 'pasto-2',
        label: 'Pasto 2 (pre workout)',
        kcalMin: 400,
        kcalMax: 500,
        macroGrams: {
          carboidrati: { value: 100 },
          lipidi: { value: 10 },
          proteine: { value: 10 },
        },
        note: 'Se mangiato circa un\'ora prima dell\'allenamento.',
      },
      {
        id: 'pasto-3',
        label: 'Pasto 3 (post workout)',
        // "600/70 kcal" nel documento: letto come 600–700 se è la cena,
        // ~200 se è uno spuntino. DA CONFERMARE.
        kcalMin: 200,
        kcalMax: 700,
        note: 'Se cena 600/700 kcal, se spuntino 200 circa. Prediligi carboidrati semplici e proteine.',
      },
      {
        id: 'pasto-4',
        label: 'Pasto 4',
        note: 'Il restante: dipende se spuntino o più sostanzioso. Pasto per chiudere il bilancio giornaliero.',
      },
    ],
  },

  generalRules: [
    'Durata: 6 settimane.',
    'Creatina pre o post workout con una dose importante di carboidrati, anche semplici (caramelle, frutta, fette biscottate).',
    'L\'importante è raggiungere il fabbisogno proteico.',
  ],

  supplements: [{ name: 'Creatina', dose: 'non indicata', when: 'pre o post workout' }],

  // Nessun alimento: non c'è nulla da vincolare né da comporre.
  frequencies: [],
  structure: {
    fixedMeals: [],
    allDifferentMeals: [],
    repeatPatterns: [],
    freeMeals: 0,
    freeMealDefaultMeal: '',
    alcoholUnitsMax: 0,
    waterLitersPerDay: 0,
    waterLitersTrainingDay: 0,
    softPreferences: [],
  },
};
