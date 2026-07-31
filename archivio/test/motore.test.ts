import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { pianoDeMarco } from '../src/data/piano-demarco.ts';
import { generateWeek, signatureOf } from '../src/core/generator.ts';
import { validate } from '../src/core/validator.ts';
import { applySubstitution, substitutionsFor, swapProteins } from '../src/core/substitutions.ts';
import { buildShoppingList } from '../src/core/shopping.ts';
import { buildMealPrep } from '../src/core/mealprep.ts';
import { replan } from '../src/core/replan.ts';
import type { NutritionPlan, WeekPlan } from '../src/types.ts';

const plan: NutritionPlan = pianoDeMarco;

function week(seed = 1): WeekPlan {
  return generateWeek(plan, { seed }).week;
}

/** Modifica una copia della settimana, per fabbricare i casi non conformi. */
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
describe('generatore', () => {
  it('produce settimane conformi su 60 seed consecutivi', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const result = generateWeek(plan, { seed });
      assert.equal(
        result.validation.ok,
        true,
        `seed ${seed} non conforme:\n` +
          result.validation.errors.map((e) => `  - ${e.message}`).join('\n'),
      );
    }
  });

  it('è deterministico: stesso seed, stessa settimana', () => {
    const a = generateWeek(plan, { seed: 42 }).week;
    const b = generateWeek(plan, { seed: 42 }).week;
    assert.deepEqual(
      a.days.map((d) => d.meals.map((m) => m.signature)),
      b.days.map((d) => d.meals.map((m) => m.signature)),
    );
  });

  it('rispetta la colazione unica, i pranzi appaiati e le cene tutte diverse', () => {
    const w = week(7);

    const colazioni = new Set(
      w.days.map((d) => d.meals.find((m) => m.mealId === 'colazione')!.signature),
    );
    assert.equal(colazioni.size, 1, 'la colazione deve essere identica tutti i giorni');

    const pranzi = w.days.map((d) => d.meals.find((m) => m.mealId === 'pranzo')!.signature);
    assert.equal(pranzi[0], pranzi[1], 'lunedì e martedì devono avere lo stesso pranzo');
    assert.equal(pranzi[2], pranzi[3], 'mercoledì e giovedì devono avere lo stesso pranzo');
    assert.equal(pranzi[4], pranzi[5], 'venerdì e sabato devono avere lo stesso pranzo');
    assert.equal(new Set(pranzi).size, 4, 'i quattro pranzi devono essere diversi tra loro');

    const cene = w.days
      .map((d) => d.meals.find((m) => m.mealId === 'cena')!)
      .filter((m) => m.kind === 'plan')
      .map((m) => m.signature);
    assert.equal(new Set(cene).size, cene.length, 'le cene devono essere tutte diverse');
  });

  it('colloca esattamente un pasto libero, mai al pranzo della domenica', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const w = week(seed);
      const liberi = w.days.flatMap((d) =>
        d.meals.filter((m) => m.kind === 'free').map((m) => ({ day: d.index, meal: m.mealId })),
      );
      assert.equal(liberi.length, 1);
      assert.ok(
        !(liberi[0].day === 6 && liberi[0].meal === 'pranzo'),
        'il pranzo della domenica non può essere il pasto libero',
      );
    }
  });

  it('onora la posizione richiesta per il pasto libero', () => {
    const result = generateWeek(plan, { seed: 5, freeMeal: { day: 4, meal: 'cena' } });
    assert.equal(result.validation.ok, true);
    const meal = result.week.days[4].meals.find((m) => m.mealId === 'cena')!;
    assert.equal(meal.kind, 'free');
  });

  it('tiene conto dei pasti fuori casa senza rompere la settimana', () => {
    const result = generateWeek(plan, {
      seed: 9,
      external: [{ day: 3, meal: 'cena', note: 'Cena di lavoro' }],
    });
    assert.equal(result.validation.ok, true);
    assert.equal(result.week.days[3].meals.find((m) => m.mealId === 'cena')!.kind, 'external');
  });
});

/* ================================================================== */
describe('validatore', () => {
  it('rifiuta una quantità diversa da quella del piano', () => {
    const bad = tamper(week(), (w) => {
      const pranzo = w.days[0].meals.find((m) => m.mealId === 'pranzo')!;
      pranzo.items[0].food.qty = 500;
    });
    const result = validate(plan, bad);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.rule === 'alimento/quantita'));
  });

  it('rifiuta un alimento non previsto dal piano', () => {
    const bad = tamper(week(), (w) => {
      const cena = w.days[0].meals.find((m) => m.mealId === 'cena')!;
      cena.items[0].food = {
        id: 'inventato',
        label: 'pizza surgelata',
        qty: 300,
        unit: 'g',
        shoppingCategory: 'Dispensa',
      };
    });
    const result = validate(plan, bad);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.rule === 'alimento/non-ammesso'));
  });

  it('REGRESSIONE: rifiuta la mezza porzione della combo senza la sua coppia', () => {
    // 100g di cereali esistono nel piano SOLO insieme a 100g di legumi.
    // Da soli, al posto della porzione piena da 130g, sono una porzione monca.
    const bad = tamper(week(), (w) => {
      const pranzo = w.days[0].meals.find((m) => m.mealId === 'pranzo')!;
      const carbo = pranzo.items.find((it) => it.slotId === 'carbo')!;
      carbo.food = { ...carbo.food, id: 'combo-riso', label: 'riso', qty: 100 };
    });
    const result = validate(plan, bad);
    assert.equal(result.ok, false, 'la mezza porzione isolata deve essere rifiutata');
    assert.ok(result.errors.some((e) => e.rule === 'alimento/non-ammesso'));
  });

  it('rifiuta due cene identiche', () => {
    const bad = tamper(week(), (w) => {
      const source = w.days.find((d) =>
        d.meals.some((m) => m.mealId === 'cena' && m.kind === 'plan'),
      )!;
      const target = w.days.find(
        (d) =>
          d.index !== source.index &&
          d.meals.some((m) => m.mealId === 'cena' && m.kind === 'plan'),
      )!;
      const from = source.meals.find((m) => m.mealId === 'cena')!;
      const to = target.meals.find((m) => m.mealId === 'cena')!;
      to.items = structuredClone(from.items);
    });
    const result = validate(plan, bad);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.rule === 'struttura/tutti-diversi'));
  });

  it('rifiuta una coppia di pranzi spezzata', () => {
    const bad = tamper(week(), (w) => {
      const lun = w.days[0].meals.find((m) => m.mealId === 'pranzo')!;
      const mer = w.days[2].meals.find((m) => m.mealId === 'pranzo')!;
      lun.items = structuredClone(mer.items);
    });
    const result = validate(plan, bad);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.rule.startsWith('struttura/pattern')));
  });

  it('rifiuta una colazione diversa dalle altre', () => {
    const bad = tamper(week(), (w) => {
      const col = w.days[3].meals.find((m) => m.mealId === 'colazione')!;
      const tpl = plan.meals.find((m) => m.id === 'colazione')!;
      const slot = tpl.slots.find((s) => s.id === 'base')!;
      const other = slot.options.find((o) => o.id !== col.items[0].food.id)!;
      col.items[0] = { slotId: 'base', food: other };
    });
    const result = validate(plan, bad);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.rule === 'struttura/pasto-fisso'));
  });

  it('rifiuta due pasti liberi', () => {
    const bad = tamper(week(), (w) => {
      const cena = w.days[0].meals.find((m) => m.mealId === 'cena')!;
      cena.kind = 'free';
      cena.items = [];
      cena.signature = 'LIBERO#0#cena';
    });
    const result = validate(plan, bad);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.rule === 'pasto-libero/numero'));
  });

  it('rifiuta il superamento di una frequenza massima', () => {
    const bad = tamper(week(), (w) => {
      const tpl = plan.meals.find((m) => m.id === 'cena')!;
      const slot = tpl.slots.find((s) => s.id === 'proteine')!;
      const rosse = slot.options.filter((o) => o.tags?.includes('carne-rossa'));
      // Tre carni rosse in tre cene diverse: il piano ne ammette due.
      const target = w.days.filter((d) =>
        d.meals.some((m) => m.mealId === 'cena' && m.kind === 'plan'),
      );
      target.slice(0, 3).forEach((d, i) => {
        const cena = d.meals.find((m) => m.mealId === 'cena')!;
        const idx = cena.items.findIndex((it) => it.slotId === 'proteine');
        cena.items[idx] = { slotId: 'proteine', food: rosse[i % rosse.length] };
      });
    });
    const result = validate(plan, bad);
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((e) => e.rule === 'frequenza/massimo'),
      'tre carni rosse devono violare il massimo settimanale',
    );
  });

  it('rifiuta una settimana senza pesce', () => {
    const bad = tamper(week(), (w) => {
      const tpl = plan.meals.find((m) => m.id === 'cena')!;
      const slot = tpl.slots.find((s) => s.id === 'proteine')!;
      const neutro = slot.options.find((o) => o.id === 'ce-hamburger-veg')!;
      for (const day of w.days) {
        for (const meal of day.meals) {
          if (meal.kind !== 'plan') continue;
          const idx = meal.items.findIndex((it) => it.food.tags?.includes('pesce'));
          if (idx >= 0) meal.items[idx] = { slotId: meal.items[idx].slotId, food: neutro };
        }
      }
    });
    const result = validate(plan, bad);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.rule === 'frequenza/minimo'));
  });
});

/* ================================================================== */
describe('sostituzioni', () => {
  it('propone solo alternative che tengono in piedi la settimana', () => {
    const w = week(3);
    const options = substitutionsFor(plan, w, 0, 'pranzo', 'carbo');
    assert.ok(options.length > 0);
    for (const o of options.filter((x) => x.allowed)) {
      const draft = applySubstitution(plan, w, 0, 'pranzo', [
        { slotId: 'carbo', food: o.food },
        ...(o.alsoChanges ?? []),
      ]);
      assert.equal(
        validate(plan, draft).ok,
        true,
        `"${o.label}" è dichiarata ammessa ma rompe la settimana`,
      );
    }
  });

  it('le mezze porzioni sono proposte solo in coppia', () => {
    const options = substitutionsFor(plan, week(3), 0, 'pranzo', 'carbo');
    const mezze = options.filter((o) => o.food.id.startsWith('combo-'));
    assert.ok(mezze.length > 0, 'le combo devono comparire tra le alternative');
    for (const o of mezze) {
      assert.ok(
        o.alsoChanges && o.alsoChanges.length > 0,
        `"${o.label}" è mezza porzione ma è proposta da sola`,
      );
    }
  });

  it('avverte che i pranzi appaiati cambiano insieme', () => {
    const options = substitutionsFor(plan, week(3), 0, 'pranzo', 'carbo');
    assert.deepEqual(options[0].affectsDays, [0, 1]);
  });

  it('nega la sostituzione che sforerebbe una frequenza massima', () => {
    const cene = week(3)
      .days.filter((d) => d.meals.find((m) => m.mealId === 'cena')!.kind === 'plan')
      .map((d) => d.index);

    // Porto la settimana al limite usando le sostituzioni ammesse dal motore:
    // due cene con carne rossa, che è il massimo previsto dal piano.
    let saturata = week(3);
    let messe = 0;
    for (const day of cene) {
      if (messe === 2) break;
      const rossa = substitutionsFor(plan, saturata, day, 'cena', 'proteine').find(
        (o) => o.allowed && o.food.tags?.includes('carne-rossa'),
      );
      if (!rossa) continue;
      saturata = applySubstitution(plan, saturata, day, 'cena', [
        { slotId: 'proteine', food: rossa.food },
        ...(rossa.alsoChanges ?? []),
      ]);
      messe++;
    }
    assert.equal(messe, 2, 'il piano deve permettere due carni rosse');
    assert.equal(validate(plan, saturata).ok, true, 'la settimana satura resta conforme');

    // La terza deve essere rifiutata. Scelgo una cena la cui proteina non sia
    // né carne rossa né legumi: così l'unico vincolo in gioco è il massimale.
    const terza = cene.find((d) => {
      const tags =
        saturata.days[d].meals
          .find((m) => m.mealId === 'cena')!
          .items.find((it) => it.slotId === 'proteine')?.food.tags ?? [];
      return !tags.includes('carne-rossa') && !tags.includes('legumi');
    })!;
    assert.ok(terza !== undefined, 'serve una cena neutra per isolare il vincolo');

    const rosse = substitutionsFor(plan, saturata, terza, 'cena', 'proteine').filter((o) =>
      o.food.tags?.includes('carne-rossa'),
    );
    assert.ok(rosse.length > 0, 'le carni rosse devono comunque comparire in elenco');
    for (const o of rosse) {
      assert.equal(o.allowed, false, `"${o.label}" sarebbe la terza carne rossa`);
      assert.match(o.reason ?? '', /limite|massimo/i);
    }
  });

  it("l'inversione proteine pranzo/cena produce una settimana valida o nulla", () => {
    const w = week(11);
    for (let d = 0; d < 7; d++) {
      const swapped = swapProteins(plan, w, d);
      if (swapped) assert.equal(validate(plan, swapped.week).ok, true);
    }
  });
});

/* ================================================================== */
describe('ripianificazione', () => {
  it('non tocca i giorni già consumati e resta conforme', () => {
    const base = week(4);
    const result = replan(plan, base, {
      fromDay: 3,
      events: [{ type: 'fuori', day: 3, meal: 'cena', note: 'Cena fuori' }],
    });

    assert.equal(result.validation.ok, true, 'la settimana ripianificata deve restare conforme');
    for (const d of [0, 1, 2]) {
      assert.deepEqual(
        result.week.days[d].meals.map((m) => m.signature),
        base.days[d].meals.map((m) => m.signature),
        `il giorno ${d} è già stato consumato e non va modificato`,
      );
    }
    assert.equal(result.week.days[3].meals.find((m) => m.mealId === 'cena')!.kind, 'external');
  });

  it('mantiene il pasto libero se è già stato consumato', () => {
    const base = generateWeek(plan, { seed: 4, freeMeal: { day: 1, meal: 'cena' } }).week;
    const result = replan(plan, base, { fromDay: 4 });
    assert.equal(result.validation.ok, true);
    assert.equal(result.week.days[1].meals.find((m) => m.mealId === 'cena')!.kind, 'free');
  });

  it('cambia il minimo indispensabile: chi ha già fatto la spesa non trova un menù nuovo', () => {
    for (const seed of [2, 4, 6, 9]) {
      const base = week(seed);
      const result = replan(plan, base, {
        fromDay: 2,
        events: [{ type: 'fuori', day: 3, meal: 'cena', note: 'Cena fuori' }],
      });
      assert.equal(result.validation.ok, true);

      const giorniToccati = new Set(
        result.week.days
          .filter((d) =>
            d.meals.some((m, i) => m.signature !== base.days[d.index].meals[i].signature),
          )
          .map((d) => d.index),
      );
      // Restano 5 giorni modificabili: toccarne più di 3 significa aver
      // ricomposto la settimana invece di adattarla.
      assert.ok(
        giorniToccati.size <= 3,
        `seed ${seed}: toccati ${giorniToccati.size} giorni per una sola cena fuori`,
      );
      assert.ok(giorniToccati.has(3), 'il giorno della cena fuori deve cambiare');
    }
  });

  it('elenca i cambiamenti in modo leggibile', () => {
    const base = week(6);
    const result = replan(plan, base, {
      fromDay: 2,
      events: [{ type: 'fuori', day: 4, meal: 'cena' }],
    });
    assert.ok(result.changes.length > 0);
    assert.ok(result.changes.every((c) => c.includes('→')));
  });
});

/* ================================================================== */
describe('lista della spesa e meal prep', () => {
  it('non mette in lista i pasti liberi o fuori casa', () => {
    const result = generateWeek(plan, {
      seed: 8,
      external: [{ day: 2, meal: 'pranzo', note: 'Pranzo di lavoro' }],
    });
    const list = buildShoppingList(plan, result.week);
    assert.equal(list.skippedMeals, 2, 'un pasto libero + un pasto fuori');
    assert.ok(list.categories.length > 0);
  });

  it('indica la quantità da acquistare per i legumi secchi', () => {
    const w = week(3);
    const list = buildShoppingList(plan, w);
    const legumi = list.categories.find((c) => c.name === 'Legumi');
    assert.ok(legumi, 'la settimana deve contenere legumi almeno due volte');
    for (const line of legumi.lines) {
      assert.ok(line.purchaseQty !== undefined && line.purchaseQty < line.totalQty);
      assert.match(line.purchaseNote ?? '', /secco/i);
    }
  });

  it('non pianifica cotture che superano i giorni di conservazione', () => {
    const w = week(3);
    const prep = buildMealPrep(plan, w);
    for (const session of prep.sessions) {
      for (const batch of session.batches) {
        const span = Math.max(...batch.coversDays) - Math.min(...batch.coversDays);
        assert.ok(span <= 4, `${batch.label} coprirebbe ${span + 1} giorni`);
      }
    }
  });
});
