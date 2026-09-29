import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pianoDeMarco } from '../src/data/piano-demarco.ts';
import { pianoAlimAB } from '../src/data/piano-alim-ab.ts';
import { generateWeek } from '../src/core/generator.ts';
import { validate } from '../src/core/validator.ts';
import { allMealTemplates } from '../src/core/plan.ts';
import {
  compositionOf,
  dayEnergy,
  energyDelta,
  foodEnergy,
  kcalOf,
  weekEnergy,
} from '../src/core/nutrition.ts';
import {
  alternativeOrdinate,
  applicaVariazione,
  verificaSostituto,
} from '../src/core/variazioni.ts';
import type { FoodOption } from '../src/types.ts';

const PIANI = [
  ['demarco', pianoDeMarco],
  ['alim-ab', pianoAlimAB],
] as const;

/* ------------------------------------------------------------------ */
/* Composizione                                                        */
/* ------------------------------------------------------------------ */

test('kcal derivate dai macronutrienti con i fattori 4/4/9', () => {
  assert.equal(kcalOf({ protein: 10, carbs: 20, fat: 5 }), 40 + 80 + 45);
});

test('la porzione scala la composizione: 130 g di pasta non sono 100 g', () => {
  const pasta: FoodOption = {
    id: 'x',
    label: 'pasta',
    qty: 130,
    unit: 'g',
    shoppingCategory: 'dispensa',
  };
  const e = foodEnergy(pasta);
  const c = compositionOf(pasta)!;
  assert.equal(Math.round(e.carbs), Math.round(c.carbs * 1.3));
  assert.ok(e.kcal > 400 && e.kcal < 500, `kcal fuori scala: ${e.kcal}`);
});

test('la chiave più lunga vince: "pane integrale" non è "pane"', () => {
  const base = { id: 'x', qty: 100, unit: 'g' as const, shoppingCategory: 'forno' };
  const pane = compositionOf({ ...base, label: 'pane' })!;
  const integrale = compositionOf({ ...base, label: 'pane integrale' })!;
  assert.notEqual(pane.carbs, integrale.carbs);
});

test('i valori dichiarati nel piano battono la stima interna', () => {
  const dichiarato: FoodOption = {
    id: 'x',
    label: 'riso',
    qty: 100,
    unit: 'g',
    shoppingCategory: 'dispensa',
    nutrients: { carboidrati: 12 },
  };
  assert.equal(compositionOf(dichiarato)!.carbs, 12);
});

test('composizione del professionista: vince su tutto e resta confermata', () => {
  const food: FoodOption = {
    id: 'x',
    label: 'alimento mai visto',
    qty: 100,
    unit: 'g',
    shoppingCategory: 'altro',
    composition: {
      protein: 1,
      carbs: 2,
      fat: 3,
      per: 'g100',
      source: 'tabelle dello studio',
      confirmed: true,
    },
  };
  const e = foodEnergy(food);
  assert.equal(e.kcal, kcalOf({ protein: 1, carbs: 2, fat: 3 }));
  assert.deepEqual(e.estimated, [], 'un dato confermato non va segnalato come stima');
});

test('alimento ignoto: dichiarato, non stimato a zero', () => {
  const e = foodEnergy({
    id: 'x',
    label: 'zzz alimento inesistente',
    qty: 100,
    unit: 'g',
    shoppingCategory: 'altro',
  });
  assert.equal(e.kcal, 0);
  assert.deepEqual(e.unknown, ['zzz alimento inesistente']);
});

test('quantità libera: esclusa dal conto e dichiarata tale, non ignota', () => {
  const e = foodEnergy({
    id: 'x',
    label: 'verdure',
    qty: 0,
    unit: 'g',
    freeQuantity: true,
    shoppingCategory: 'ortofrutta',
  });
  assert.deepEqual(e.unknown, []);
  assert.deepEqual(e.free, ['verdure']);
});

/* ------------------------------------------------------------------ */
/* Copertura sui piani reali                                           */
/* ------------------------------------------------------------------ */

for (const [nome, piano] of PIANI) {
  test(`copertura: ogni alimento di "${nome}" ha una composizione`, () => {
    const mancanti = new Set<string>();

    for (const tpl of allMealTemplates(piano)) {
      const tutti = [
        ...tpl.slots.flatMap((s) => s.options),
        ...(tpl.combos ?? []).flatMap((c) => c.parts.flatMap((p) => p.options)),
      ];
      for (const food of tutti) {
        if (food.freeQuantity) continue;
        if (!compositionOf(food)) mancanti.add(`${food.label} (${food.id})`);
      }
    }

    assert.deepEqual(
      [...mancanti],
      [],
      `alimenti senza composizione: il delta calorico sarebbe parziale`,
    );
  });

  test(`una giornata di "${nome}" ha calorie plausibili`, () => {
    const { week } = generateWeek(piano, { seed: 4 });
    for (const day of week.days) {
      const e = dayEnergy(day);
      if (e.unknown.length > 0) continue; // giorno con pasto libero o fuori casa
      assert.ok(
        e.kcal > 1000 && e.kcal < 4500,
        `${nome} · giorno ${day.index}: ${Math.round(e.kcal)} kcal fuori da ogni range plausibile`,
      );
    }
  });
}

test('la settimana somma i giorni', () => {
  const { week } = generateWeek(pianoDeMarco, { seed: 7 });
  const somma = week.days.reduce((acc, d) => acc + dayEnergy(d).kcal, 0);
  assert.ok(Math.abs(weekEnergy(week).kcal - somma) < 0.01);
});

/* ------------------------------------------------------------------ */
/* Delta                                                               */
/* ------------------------------------------------------------------ */

test('il delta è parziale se manca una composizione, e lo dichiara', () => {
  const noto = foodEnergy({ id: 'a', label: 'riso', qty: 100, unit: 'g', shoppingCategory: 'd' });
  const ignoto = foodEnergy({
    id: 'b',
    label: 'zzz ignoto',
    qty: 100,
    unit: 'g',
    shoppingCategory: 'd',
  });
  assert.equal(energyDelta(noto, ignoto).coverage, 'parziale');
  assert.equal(energyDelta(noto, noto).coverage, 'completa');
});

/* ------------------------------------------------------------------ */
/* Variazioni                                                          */
/* ------------------------------------------------------------------ */

test('le alternative sono ordinate: prima le ammesse, poi per scostamento minore', () => {
  const { week } = generateWeek(pianoDeMarco, { seed: 3 });
  const v = alternativeOrdinate(pianoDeMarco, week, 0, 'pranzo', 'carbo');

  assert.ok(v.alternative.length > 0, 'nessuna alternativa: il test non prova nulla');
  assert.ok(v.attuale, 'manca l’alimento attuale');

  const ammesse = v.alternative.filter((a) => a.ammessa);
  const primaNonAmmessa = v.alternative.findIndex((a) => !a.ammessa);
  if (primaNonAmmessa >= 0) {
    assert.ok(
      v.alternative.slice(primaNonAmmessa).every((a) => !a.ammessa),
      'le non ammesse devono stare tutte in coda',
    );
  }
  for (let i = 1; i < ammesse.length; i++) {
    assert.ok(
      Math.abs(ammesse[i - 1].delta.kcal) <= Math.abs(ammesse[i].delta.kcal),
      'ordine per scostamento calorico non rispettato',
    );
  }
});

test('sostituire con lo stesso peso di un alimento simile sposta poco', () => {
  const { week } = generateWeek(pianoDeMarco, { seed: 3 });
  const v = alternativeOrdinate(pianoDeMarco, week, 0, 'pranzo', 'carbo');
  const migliore = v.alternative.find((a) => a.ammessa)!;
  assert.ok(
    Math.abs(migliore.delta.kcal) < 400,
    `la migliore alternativa sposta ${migliore.delta.kcal} kcal: troppo`,
  );
});

test('«posso mettere X?» — ammesso, non ammesso, fuori piano', () => {
  const { week } = generateWeek(pianoDeMarco, { seed: 3 });
  const v = alternativeOrdinate(pianoDeMarco, week, 0, 'pranzo', 'carbo');
  const ammessa = v.alternative.find((a) => a.ammessa)!;

  const ok = verificaSostituto(pianoDeMarco, week, 0, 'pranzo', 'carbo', ammessa.nome);
  assert.equal(ok.esito, 'ammesso');
  assert.ok(ok.trovata);

  const fuori = verificaSostituto(
    pianoDeMarco,
    week,
    0,
    'pranzo',
    'carbo',
    'gelato al pistacchio',
  );
  assert.equal(fuori.esito, 'fuori-piano');
  assert.ok(fuori.ripiego.length > 0, 'un rifiuto senza alternative è inutile al cliente');
});

test('applicare una variazione ammessa dà una settimana ancora conforme', () => {
  const { week } = generateWeek(pianoDeMarco, { seed: 3 });
  const v = alternativeOrdinate(pianoDeMarco, week, 0, 'pranzo', 'carbo');
  const scelta = v.alternative.find((a) => a.ammessa)!;

  const esito = applicaVariazione(pianoDeMarco, week, 0, 'pranzo', 'carbo', scelta.foodId);
  assert.ok(esito.ok, esito.errore);
  assert.ok(validate(pianoDeMarco, esito.week).ok, 'settimana non conforme dopo la variazione');

  const r = esito.registro!;
  assert.equal(r.aNome, scelta.nome);
  assert.equal(r.kcalDelta, r.kcalDopo - r.kcalPrima);
  assert.ok(r.giorniToccati.includes(0));
});

test('REGRESSIONE: una variazione non ammessa non viene applicata', () => {
  const { week } = generateWeek(pianoDeMarco, { seed: 3 });
  const v = alternativeOrdinate(pianoDeMarco, week, 0, 'pranzo', 'carbo');
  const vietata = v.alternative.find((a) => !a.ammessa);
  if (!vietata) return;

  const esito = applicaVariazione(pianoDeMarco, week, 0, 'pranzo', 'carbo', vietata.foodId);
  assert.equal(esito.ok, false);
  assert.equal(esito.registro, null);
  assert.deepEqual(esito.week, week, 'la settimana non deve cambiare');
});

test('un id inventato non passa', () => {
  const { week } = generateWeek(pianoDeMarco, { seed: 3 });
  const esito = applicaVariazione(pianoDeMarco, week, 0, 'pranzo', 'carbo', 'non-esiste');
  assert.equal(esito.ok, false);
  assert.match(esito.errore ?? '', /non è tra le alternative/);
});

test('i giorni appaiati cambiano insieme, e il registro lo dice', () => {
  const { week } = generateWeek(pianoDeMarco, { seed: 3 });
  const v = alternativeOrdinate(pianoDeMarco, week, 0, 'pranzo', 'carbo');
  const scelta = v.alternative.find((a) => a.ammessa)!;
  const esito = applicaVariazione(pianoDeMarco, week, 0, 'pranzo', 'carbo', scelta.foodId);

  for (const d of esito.registro!.giorniToccati) {
    const meal = esito.week.days[d].meals.find((m) => m.mealId === 'pranzo');
    if (meal?.kind !== 'plan') continue;
    assert.equal(
      meal.items.find((i) => i.slotId === 'carbo')?.food.id,
      scelta.foodId,
      `il giorno appaiato ${d} non è stato aggiornato`,
    );
  }
});

test('piano a quote di nutriente: la variazione ricalcola il peso, non lo copia', () => {
  const { week } = generateWeek(pianoAlimAB, { seed: 2 });
  const giorno = 0;
  const meal = week.days[giorno].meals.find((m) => m.kind === 'plan' && m.items.length > 0);
  assert.ok(meal, 'nessun pasto da cui partire');

  const slotId = meal!.items[0].slotId;
  const v = alternativeOrdinate(pianoAlimAB, week, giorno, meal!.mealId, slotId);
  const ammesse = v.alternative.filter((a) => a.ammessa);
  assert.ok(ammesse.length > 0, 'nessuna alternativa ammessa nel piano a quote');

  const quantita = new Set(ammesse.map((a) => a.quantita));
  assert.ok(quantita.size > 1, `tutte le porzioni identiche: ${[...quantita].join(', ')}`);
});
