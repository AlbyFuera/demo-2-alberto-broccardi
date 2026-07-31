import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { pianoMacro } from '../src/data/piano-macro.ts';
import { pianoAlimAB } from '../src/data/piano-alim-ab.ts';
import { pianoDeMarco } from '../src/data/piano-demarco.ts';
import { canGenerateWeek, checkPlanIntegrity, planMode } from '../src/core/plan.ts';
import type { NutritionPlan } from '../src/types.ts';

const messaggi = (plan: NutritionPlan) => checkPlanIntegrity(plan).map((i) => i.message);
const errori = (plan: NutritionPlan) =>
  checkPlanIntegrity(plan).filter((i) => i.severity === 'errore');

describe('classificazione dei piani', () => {
  it('riconosce i piani prescrittivi da quelli a macronutrienti', () => {
    assert.equal(planMode(pianoDeMarco), 'prescrittivo');
    assert.equal(planMode(pianoAlimAB), 'prescrittivo');
    assert.equal(planMode(pianoMacro), 'macro');
  });

  it('non prova a comporre una settimana da un piano senza alimenti', () => {
    assert.equal(canGenerateWeek(pianoDeMarco).ok, true);
    assert.equal(canGenerateWeek(pianoAlimAB).ok, true);

    const esito = canGenerateWeek(pianoMacro);
    assert.equal(esito.ok, false);
    // La motivazione deve dire PERCHÉ, non limitarsi a rifiutare.
    assert.match(esito.reason ?? '', /non elenca alimenti/);
    assert.match(esito.reason ?? '', /al posto del professionista/);
  });
});

describe('verifica di un piano a macronutrienti', () => {
  it('scopre che i macronutrienti non tornano con le calorie obiettivo', () => {
    // 137×4 + 323×4 + 90×9 = 2650, ma l'obiettivo dichiarato è 1800.
    assert.ok(
      messaggi(pianoMacro).some((m) => /sommano a 2650 kcal.*obiettivo giornaliero è 1800/.test(m)),
    );
  });

  it("segnala che l'obiettivo è matematicamente irraggiungibile", () => {
    // Proteine + carboidrati fanno già 1840 kcal: nessun margine, nemmeno a
    // grassi zero. È il caso in cui il paziente non può che fallire.
    assert.ok(
      messaggi(pianoMacro).some((m) => /irraggiungibile anche azzerando i grassi/.test(m)),
      'la contraddizione più grave deve essere detta esplicitamente',
    );
  });

  it('individua la causa probabile: macro rimasti al TDEE iniziale', () => {
    assert.ok(messaggi(pianoMacro).some((m) => /coincidono con il TDEE iniziale/.test(m)));
  });

  it('segnala la riga "Rest day" lasciata in bianco', () => {
    const issue = checkPlanIntegrity(pianoMacro).find((i) => /Rest day/.test(i.message));
    assert.ok(issue);
    // Una cella vuota è un dato mancante, non un errore di calcolo.
    assert.equal(issue.severity, 'avviso');
  });

  it('tratta i buchi come avvisi e le contraddizioni come errori', () => {
    const issues = checkPlanIntegrity(pianoMacro);
    assert.ok(issues.some((i) => i.severity === 'errore'));
    assert.ok(issues.some((i) => i.severity === 'avviso'));
  });
});

describe('controlli aritmetici', () => {
  const base = (): NutritionPlan => structuredClone(pianoMacro);

  it('accetta un piano a macro con i conti a posto', () => {
    const sano = base();
    // 1800 kcal: 137 g proteine (548) + 160 g carboidrati (640) + 68 g lipidi (612).
    sano.macro!.dayTypes = [
      {
        id: 'allenamento',
        label: 'Allenamento',
        macros: [
          { nutrient: 'proteine', grams: 137, kcal: 548, kcalPerGram: 4 },
          { nutrient: 'carboidrati', grams: 160, kcal: 640, kcalPerGram: 4 },
          { nutrient: 'lipidi', grams: 68, kcal: 612, kcalPerGram: 9 },
        ],
      },
    ];
    assert.deepEqual(errori(sano), []);
  });

  it('scopre le kcal di un macronutriente calcolate male', () => {
    const rotto = base();
    rotto.macro!.dayTypes[0].macros[0].kcal = 600; // 137 g × 4 = 548, non 600
    assert.ok(messaggi(rotto).some((m) => /137 g × 4 = 548 kcal, ma il piano ne dichiara 600/.test(m)));
  });

  it('scopre i grammi incoerenti con i g/kg dichiarati', () => {
    const rotto = base();
    rotto.macro!.dayTypes[0].macros[0].grams = 200; // 1,8 g/kg × 76 kg = 137
    assert.ok(messaggi(rotto).some((m) => /1\.8 g\/kg su 76 kg fa 137 g/.test(m)));
  });

  it('scopre un totale settimanale che non corrisponde ai giorni', () => {
    const rotto = base();
    rotto.macro!.weeklyKcal = 14000; // 1800 × 7 = 12600
    assert.ok(messaggi(rotto).some((m) => /somma dei giorni fa 12600 kcal.*14000/.test(m)));
  });

  it('scopre una suddivisione dei pasti che sfora già al minimo', () => {
    const rotto = base();
    rotto.macro!.mealSplit = [
      { id: 'p1', label: 'Pasto 1', kcalMin: 1000, note: '' },
      { id: 'p2', label: 'Pasto 2', kcalMin: 1000, note: '' },
    ];
    assert.ok(messaggi(rotto).some((m) => /parte da 2000 kcal minime, oltre l'obiettivo/.test(m)));
  });

  it('non inventa controlli quando il dato manca', () => {
    const senzaPeso = base();
    senzaPeso.macro!.bodyWeightKg = undefined;
    const msgs = messaggi(senzaPeso);
    assert.ok(msgs.some((m) => /Manca il peso corporeo/.test(m)));
    // Senza peso il confronto g/kg non va tentato a caso.
    assert.ok(!msgs.some((m) => /g\/kg su/.test(m)));
  });
});
