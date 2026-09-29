import type { NutritionPlan, WeekPlan } from '../src/types.ts';
import { generateWeek } from '../src/core/generator.ts';
import { applySubstitution } from '../src/core/substitutions.ts';
import { mealTemplate } from '../src/core/plan.ts';
import type { FoodOption } from '../src/types.ts';

/** Una variazione già accettata, come sta in `week_state.overrides`. */
export interface Override {
  day: number;
  mealId: string;
  slotId: string;
  foodId: string;
  /** Le sostituzioni trascinate (l'altra metà di una combo). */
  also?: { slotId: string; foodId: string }[];
}

export interface StatoSettimana {
  planKey: string;
  seed: number;
  /** "5:cena" oppure null per lasciar scegliere al motore. */
  freeMeal: string | null;
  /** ["3:cena", "5:pranzo"] */
  external: string[];
  overrides: Override[];
}

export function statoIniziale(planKey: string): StatoSettimana {
  return { planKey, seed: 1, freeMeal: null, external: [], overrides: [] };
}

function parseDayMeal(token: string): { day: number; meal: string } | null {
  const [d, m] = token.split(':');
  const day = Number(d);
  if (!Number.isInteger(day) || day < 0 || day > 6 || !m) return null;
  return { day, meal: m };
}

function optionById(
  plan: NutritionPlan,
  day: number,
  mealId: string,
  slotId: string,
  foodId: string,
): FoodOption | null {
  const tpl = mealTemplate(plan, day, mealId);
  const dallosSlot = tpl?.slots.find((s) => s.id === slotId)?.options.find((o) => o.id === foodId);
  if (dallosSlot) return dallosSlot;

  for (const combo of tpl?.combos ?? []) {
    for (const part of combo.parts) {
      if (part.slotId !== slotId) continue;
      const trovato = part.options.find((o) => o.id === foodId);
      if (trovato) return trovato;
    }
  }
  return null;
}

export function componiSettimana(
  plan: NutritionPlan,
  stato: StatoSettimana,
): { week: WeekPlan; scartate: Override[] } {
  const libero = stato.freeMeal ? parseDayMeal(stato.freeMeal) : null;
  const fuori = stato.external
    .map(parseDayMeal)
    .filter((x): x is { day: number; meal: string } => x !== null);

  let week = generateWeek(plan, {
    seed: stato.seed,
    freeMeal: libero ?? 'auto',
    external: fuori.map((f) => ({ ...f, note: 'Pasto fuori casa' })),
  }).week;

  const scartate: Override[] = [];

  for (const ov of stato.overrides) {
    const food = optionById(plan, ov.day, ov.mealId, ov.slotId, ov.foodId);
    if (!food) {
      scartate.push(ov);
      continue;
    }

    const changes = [{ slotId: ov.slotId, food }];
    for (const extra of ov.also ?? []) {
      const altro = optionById(plan, ov.day, ov.mealId, extra.slotId, extra.foodId);
      if (altro) changes.push({ slotId: extra.slotId, food: altro });
    }
    week = applySubstitution(plan, week, ov.day, ov.mealId, changes);
  }

  return { week, scartate };
}

export function conVariazione(stato: StatoSettimana, ov: Override): StatoSettimana {
  const altri = stato.overrides.filter(
    (o) => !(o.day === ov.day && o.mealId === ov.mealId && o.slotId === ov.slotId),
  );
  return { ...stato, overrides: [...altri, ov] };
}

export function senzaVariazione(
  stato: StatoSettimana,
  day: number,
  mealId: string,
  slotId: string,
): StatoSettimana {
  return {
    ...stato,
    overrides: stato.overrides.filter(
      (o) => !(o.day === day && o.mealId === mealId && o.slotId === slotId),
    ),
  };
}
