import type { NutritionPlan, WeekPlan } from '../types.ts';
import { DAY_NAMES } from '../types.ts';
import type { ExternalMeal, GenerateResult } from './generator.ts';
import { generateWeek } from './generator.ts';
import { allMealTemplates, mealLabel } from './plan.ts';

export interface WeekEvent {
  type: 'fuori' | 'libero';
  day: number;
  meal: string;
  note?: string;
}

export interface ReplanOptions {
  /** Primo giorno ancora modificabile: i precedenti sono già stati consumati. */
  fromDay: number;
  events?: WeekEvent[];
  seed?: number;
}

export interface ReplanResult extends GenerateResult {
  keptDays: number[];
  changes: string[];
}

export function replan(
  plan: NutritionPlan,
  week: WeekPlan,
  opts: ReplanOptions,
): ReplanResult {
  const keptDays = Array.from({ length: Math.max(0, opts.fromDay) }, (_, i) => i);
  const events = opts.events ?? [];

  const external: ExternalMeal[] = [];
  for (const d of keptDays) {
    for (const meal of week.days[d].meals) {
      if (meal.kind === 'external') {
        external.push({ day: d, meal: meal.mealId, note: meal.note });
      }
    }
  }
  for (const ev of events) {
    if (ev.type === 'fuori') external.push({ day: ev.day, meal: ev.meal, note: ev.note });
  }

  /* Posizione del pasto libero: se è già stato consumato resta dov'è. */
  let freeMeal: { day: number; meal: string } | undefined;
  const eventFree = events.find((e) => e.type === 'libero');
  const consumedFree = week.days
    .filter((d) => keptDays.includes(d.index))
    .flatMap((d) => d.meals.filter((m) => m.kind === 'free').map((m) => ({ d: d.index, m })));

  if (consumedFree.length > 0) {
    freeMeal = { day: consumedFree[0].d, meal: consumedFree[0].m.mealId };
  } else if (eventFree) {
    freeMeal = { day: eventFree.day, meal: eventFree.meal };
  } else {
    // Va ricollocato, ma solo tra i giorni ancora modificabili.
    const mealId = plan.structure.freeMealDefaultMeal;
    const forbidden = (day: number) =>
      (plan.structure.freeMealForbidden ?? []).some(
        (r) =>
          (r.meal === undefined || r.meal === mealId) &&
          (r.days === undefined || r.days.includes(day)),
      );
    const busy = new Set(external.filter((e) => e.meal === mealId).map((e) => e.day));
    const candidates = [6, 5, 4, 3, 2, 1, 0].filter(
      (d) => d >= opts.fromDay && !forbidden(d) && !busy.has(d),
    );
    if (candidates.length > 0) freeMeal = { day: candidates[0], meal: mealId };
  }

  const eventDays = new Set([
    ...external.map((e) => e.day),
    ...(freeMeal ? [freeMeal.day] : []),
  ]);
  const distanceFromEvent = (d: number) =>
    Math.min(...[...eventDays].map((e) => Math.abs(e - d)), 7);

  const flexible = [0, 1, 2, 3, 4, 5, 6]
    .filter((d) => d >= opts.fromDay && !eventDays.has(d))
    .sort((a, b) => distanceFromEvent(a) - distanceFromEvent(b) || a - b);

  const baseOptions = {
    seed: opts.seed ?? week.seed,
    previous: week,
    external,
    freeMeal: freeMeal ?? ('none' as const),
    alcoholUnits: week.alcoholUnits,
  };

  let result;
  for (let released = 0; released <= flexible.length; released++) {
    const free = new Set([...eventDays, ...flexible.slice(0, released)]);
    const keep = [0, 1, 2, 3, 4, 5, 6]
      .filter((d) => !free.has(d))
      .map((day) => ({ day }));

    try {
      const attempt = generateWeek(plan, { ...baseOptions, keep, maxAttempts: 60 });
      if (attempt.validation.ok) {
        result = attempt;
        break;
      }
    } catch {
      // Con troppi giorni congelati i vincoli possono non avere soluzione:
      // si passa semplicemente al livello successivo.
    }
  }

  // Altrimenti si ricompone tutto dal primo giorno modificabile.
  result ??= generateWeek(plan, {
    ...baseOptions,
    keep: keptDays.map((day) => ({ day })),
  });

  return {
    ...result,
    keptDays,
    changes: diffWeeks(plan, week, result.week),
  };
}

/** Differenze leggibili tra due versioni della settimana. */
export function diffWeeks(plan: NutritionPlan, before: WeekPlan, after: WeekPlan): string[] {
  const changes: string[] = [];
  const labelOf = (mealId: string) =>
    mealLabel(plan, mealId);

  for (let d = 0; d < 7; d++) {
    for (const tpl of allMealTemplates(plan)) {
      const a = before.days[d]?.meals.find((m) => m.mealId === tpl.id);
      const b = after.days[d]?.meals.find((m) => m.mealId === tpl.id);
      if (!a || !b) continue;
      if (a.signature === b.signature && a.kind === b.kind) continue;

      const describe = (m: typeof a) =>
        m.kind === 'free'
          ? 'pasto libero'
          : m.kind === 'external'
            ? (m.note ?? 'fuori casa')
            : m.items.map((i) => i.food.label).join(', ');

      changes.push(`${DAY_NAMES[d]} · ${labelOf(tpl.id)}: ${describe(a)} → ${describe(b)}`);
    }
  }
  return changes;
}
