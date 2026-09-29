import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { pianoAlimAB } from '../src/data/piano-alim-ab.ts';
import { pianoDeMarco } from '../src/data/piano-demarco.ts';
import { generateWeek, signatureOf } from '../src/core/generator.ts';
import { checkPlanIntegrity, mealsForDay, resolvePortion } from '../src/core/plan.ts';
import { validate } from '../src/core/validator.ts';
import { substitutionsFor } from '../src/core/substitutions.ts';
import { buildShoppingList } from '../src/core/shopping.ts';
import type { NutritionPlan, WeekPlan } from '../src/types.ts';

const plan: NutritionPlan = pianoAlimAB;

function week(seed = 1, opts = {}): WeekPlan {
  return generateWeek(plan, { seed, ...opts }).week;
}

function tamper(base: WeekPlan, fn: (w: WeekPlan) => void): WeekPlan {
  const copy: WeekPlan = structuredClone(base);
  fn(copy);
  for (const day of copy.days) {
    for (const meal of day.meals) {
      if (meal.kind === 'plan') meal.signature = signatureOf(meal.items);
    }
  }
  return copy;
}

/* ================================================================== */
describe('integrità dei piani', () => {
  it('entrambi i piani di collaudo sono coerenti', () => {
    assert.deepEqual(checkPlanIntegrity(pianoDeMarco), []);
    assert.deepEqual(checkPlanIntegrity(pianoAlimAB), []);
  });

  it('segnala una fonte di carboidrati senza valore di composizione', () => {
    const rotto: NutritionPlan = structuredClone(plan);
    const slot = rotto.variants![0].meals[0].slots.find((s) => s.id === 'carbo')!;
    delete slot.options[0].nutrients;

    const problems = checkPlanIntegrity(rotto);
    assert.ok(problems.length >= 1);
    assert.ok(problems.every((p) => /non ha il valore di carboidrati/.test(p.message)));
  });

  it('segnala uno schedule che rimanda a un regime inesistente', () => {
    const rotto: NutritionPlan = structuredClone(plan);
    rotto.schedule = ['a', 'a', 'a', 'a', 'c', 'b', 'a'];
    assert.ok(checkPlanIntegrity(rotto).some((p) => /regime "c", che non esiste/.test(p.message)));
  });

  it('rifiuta la combinazione non supportata regimi + pattern di ripetizione', () => {
    const rotto: NutritionPlan = structuredClone(plan);
    rotto.structure.repeatPatterns = [{ meal: 'pasto-3', pattern: [2, 2, 2, 1] }];
    assert.ok(
      checkPlanIntegrity(rotto).some((p) => /non sono ancora combinabili/.test(p.message)),
      'una limitazione nota deve fallire a voce alta, non in silenzio',
    );
  });
});

/* ================================================================== */
describe('regimi alternati (Alim A / Alim B)', () => {
  it('produce settimane conformi su 40 seed consecutivi', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const result = generateWeek(plan, { seed });
      assert.equal(
        result.validation.ok,
        true,
        `seed ${seed}:\n` + result.validation.errors.map((e) => `  - ${e.message}`).join('\n'),
      );
    }
  });

  it('applica il regime giusto a ogni giorno', () => {
    const w = week(3);
    // Lun-Gio e Dom = Alim A.
    for (const d of [0, 1, 2, 3, 6]) {
      const ids = w.days[d].meals.map((m) => m.mealId).sort();
      assert.deepEqual(ids, ['pasto-1', 'pasto-2', 'pasto-3', 'pasto-4', 'pasto-5']);
    }
    // Ven-Sab = Alim B, dove il sesto pasto è previsto.
    for (const d of [4, 5]) {
      const ids = w.days[d].meals.map((m) => m.mealId).sort();
      assert.deepEqual(ids, [
        'pasto-1',
        'pasto-2',
        'pasto-3',
        'pasto-4',
        'pasto-5',
        'pasto-6',
      ]);
    }
  });

  it('usa le quantità proteiche del regime del giorno', () => {
    const w = week(3);
    // Alim A: 150 ml di albume al pasto 1. Alim B: 250 ml.
    const albumeA = w.days[0].meals.find((m) => m.mealId === 'pasto-1')!.items.find(
      (i) => i.slotId === 'proteine',
    )!;
    const albumeB = w.days[4].meals.find((m) => m.mealId === 'pasto-1')!.items.find(
      (i) => i.slotId === 'proteine',
    )!;
    assert.equal(albumeA.food.qty, 150);
    assert.equal(albumeB.food.qty, 250);
  });

  it('rifiuta gli alimenti di un regime dentro un giorno dell\'altro', () => {
    const bad = tamper(week(3), (w) => {
      const venerdi = w.days[4].meals.find((m) => m.mealId === 'pasto-6')!;
      w.days[0].meals.push(structuredClone(venerdi));
    });
    const result = validate(plan, bad);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.rule === 'alimento/non-ammesso'));
  });

  it('rifiuta un pasto che il piano non prevede affatto', () => {
    const bad = tamper(week(3), (w) => {
      const copia = structuredClone(w.days[0].meals[0]);
      copia.mealId = 'pasto-99';
      w.days[0].meals.push(copia);
    });
    const result = validate(plan, bad);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.rule === 'pasto/sconosciuto'));
  });

  it('rifiuta un pasto obbligatorio mancante', () => {
    const bad = tamper(week(3), (w) => {
      w.days[4].meals = w.days[4].meals.filter((m) => m.mealId !== 'pasto-6');
    });
    const result = validate(plan, bad);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.rule === 'pasto/mancante'));
  });
});

/* ================================================================== */
describe('porzioni espresse in nutriente', () => {
  it('calcola il peso dalla quota di carboidrati', () => {
    const basmati = plan.variants![0].meals[0].slots
      .find((s) => s.id === 'carbo')!
      .options.find((o) => o.id === 'carb-riso-basmati')!;

    assert.equal(resolvePortion(basmati, { nutrient: 'carboidrati', qty: 50 }).qty, 64);
    assert.equal(resolvePortion(basmati, { nutrient: 'carboidrati', qty: 70 }).qty, 90);
  });

  it('rispetta la quantità fissata dal professionista', () => {
    const patate = plan.variants![0].meals[0].slots
      .find((s) => s.id === 'carbo')!
      .options.find((o) => o.id === 'carb-patate-americane')!;

    const portion = resolvePortion(patate, { nutrient: 'carboidrati', qty: 50 });
    assert.equal(portion.qty, 250);
    assert.equal(portion.derived, false);
  });

  it('la settimana generata porta le porzioni calcolate, non quelle di riferimento', () => {
    const w = week(3);
    for (const day of w.days) {
      for (const meal of day.meals) {
        if (meal.kind !== 'plan') continue;
        const carbo = meal.items.find((i) => i.slotId === 'carbo');
        if (!carbo) continue;
        const quota = day.index === 4 || day.index === 5 ? 70 : 50;
        const atteso = resolvePortion(carbo.food, { nutrient: 'carboidrati', qty: quota }).qty;
        assert.equal(
          carbo.food.qty,
          atteso,
          `${day.name} · ${meal.mealId}: "${carbo.food.label}" dovrebbe pesare ${atteso}g`,
        );
      }
    }
  });

  it('rifiuta la porzione di un altro regime', () => {
    const bad = tamper(week(3), (w) => {
      // Lunedì è Alim A: 50 g di carboidrati.
      const pasto = w.days[0].meals.find((m) => m.mealId === 'pasto-1')!;
      const carbo = pasto.items.find((i) => i.slotId === 'carbo')!;
      const quotaSbagliata = resolvePortion(carbo.food, { nutrient: 'carboidrati', qty: 70 });
      carbo.food = { ...carbo.food, qty: quotaSbagliata.qty };
    });
    const result = validate(plan, bad);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.rule === 'alimento/quantita'));
  });

  it('le sostituzioni mostrano il peso ricalcolato, non quello di riferimento', () => {
    // Lunedì = Alim A, quota 50 g di carboidrati.
    const options = substitutionsFor(plan, week(3), 0, 'pasto-3', 'carbo');
    assert.ok(options.length > 0);

    for (const o of options) {
      const atteso = resolvePortion(o.food, { nutrient: 'carboidrati', qty: 50 });
      assert.equal(
        o.quantity,
        `${atteso.qty}${o.food.unit}`,
        `"${o.food.label}" mostrato come ${o.quantity} invece di ${atteso.qty}${o.food.unit}`,
      );
      assert.notEqual(o.quantity, '100g', 'non deve comparire il peso di riferimento');
    }

    // Venerdì = Alim B, quota 70 g.
    const venerdi = substitutionsFor(plan, week(3), 4, 'pasto-3', 'carbo');
    for (const o of venerdi) {
      const atteso = resolvePortion(o.food, { nutrient: 'carboidrati', qty: 70 });
      assert.equal(o.quantity, `${atteso.qty}${o.food.unit}`);
    }
  });
});

/* ================================================================== */
describe('quantità libere e pasti facoltativi', () => {
  it('non inventa un peso per le verdure', () => {
    const w = week(3);
    const verdura = w.days[0].meals
      .find((m) => m.mealId === 'pasto-3')!
      .items.find((i) => i.slotId === 'verdura')!;
    assert.equal(verdura.food.freeQuantity, true);

    // Anche cambiandone il "peso" la settimana resta conforme: non è prescritto.
    const modificata = tamper(w, (x) => {
      const v = x.days[0].meals
        .find((m) => m.mealId === 'pasto-3')!
        .items.find((i) => i.slotId === 'verdura')!;
      v.food = { ...v.food, qty: 999 };
    });
    assert.equal(validate(plan, modificata).ok, true);
  });

  it('la lista della spesa non somma pesi inventati', () => {
    const list = buildShoppingList(plan, week(3));
    const verdura = list.categories
      .find((c) => c.name === 'Verdura')!
      .lines.find((l) => l.label === 'verdure' || l.label === 'insalata')!;
    assert.equal(verdura.freeQuantity, true);
    assert.ok(verdura.occurrences > 0);
  });

  it('il sesto pasto di Alim A compare solo se richiesto', () => {
    const senza = week(3);
    assert.ok(!senza.days[0].meals.some((m) => m.mealId === 'pasto-6'));

    const con = week(3, { includeOptional: ['pasto-6'] });
    assert.ok(
      con.days[0].meals.some((m) => m.mealId === 'pasto-6'),
      'richiesto esplicitamente, il pasto facoltativo deve esserci',
    );
    assert.equal(validate(plan, con).ok, true);
  });
});

/* ================================================================== */
describe('vincoli di questo piano', () => {
  it('colloca il pasto libero solo di domenica', () => {
    for (let seed = 1; seed <= 15; seed++) {
      const liberi = week(seed).days.flatMap((d) =>
        d.meals.filter((m) => m.kind === 'free').map(() => d.index),
      );
      assert.deepEqual(liberi, [6], `seed ${seed}`);
    }
  });

  it("non supera le due volte a settimana per l'equino", () => {
    for (let seed = 1; seed <= 15; seed++) {
      const equino = week(seed).days.flatMap((d) =>
        d.meals.filter((m) => m.items.some((i) => i.food.tags?.includes('equino'))),
      ).length;
      assert.ok(equino <= 2, `seed ${seed}: equino ${equino} volte`);
    }
  });

  it('le alternative proposte sono quelle del regime di quel giorno', () => {
    const w = week(3);

    const venerdi = substitutionsFor(plan, w, 4, 'pasto-5', 'proteine');
    assert.ok(venerdi.length > 0);
    assert.ok(
      !venerdi.some((o) => o.food.id === 'equino-120'),
      "l'equino non è previsto in Alim B",
    );

    const lunedi = substitutionsFor(plan, w, 0, 'pasto-5', 'proteine');
    assert.ok(lunedi.length > 0);
    assert.ok(
      !lunedi.some((o) => o.food.id === 'macinato-vitello-120'),
      'il macinato di vitello non è previsto in Alim A',
    );

    const ammessiInB = new Set(
      mealsForDay(plan, 4)
        .find((m) => m.id === 'pasto-5')!
        .slots.find((s) => s.id === 'proteine')!
        .options.map((o) => o.id),
    );
    for (const o of venerdi) assert.ok(ammessiInB.has(o.food.id), `${o.food.id} non è di Alim B`);
  });
});
