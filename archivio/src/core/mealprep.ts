import type { NutritionPlan, WeekPlan } from '../types.ts';
import { DAY_NAMES } from '../types.ts';

export interface PrepBatch {
  label: string;
  unit: string;
  qty: number;
  /** Giorni coperti da questa cottura. */
  coversDays: number[];
}

export interface PrepSession {
  day: number;
  dayName: string;
  batches: PrepBatch[];
}

export interface FreshItem {
  day: number;
  dayName: string;
  labels: string[];
}

export interface MealPrep {
  sessions: PrepSession[];
  fresh: FreshItem[];
  notes: string[];
}

interface Need {
  day: number;
  qty: number;
}

export function buildMealPrep(plan: NutritionPlan, week: WeekPlan): MealPrep {
  const batchNeeds = new Map<string, { unit: string; keeps: number; needs: Need[] }>();
  const freshByDay = new Map<number, Set<string>>();

  for (const day of week.days) {
    for (const meal of day.meals) {
      if (meal.kind !== 'plan') continue;
      for (const { food } of meal.items) {
        if (food.cook === 'batch') {
          const entry = batchNeeds.get(food.label) ?? {
            unit: food.unit,
            keeps: food.keepsDays ?? 3,
            needs: [],
          };
          entry.keeps = Math.min(entry.keeps, food.keepsDays ?? 3);
          entry.needs.push({ day: day.index, qty: food.qty });
          batchNeeds.set(food.label, entry);
        } else if (food.cook === 'quick') {
          const set = freshByDay.get(day.index) ?? new Set<string>();
          set.add(food.label);
          freshByDay.set(day.index, set);
        }
      }
    }
  }

  /* Raggruppo i fabbisogni in cotture, rispettando la conservazione. */
  const sessionMap = new Map<number, PrepBatch[]>();

  for (const [label, entry] of batchNeeds) {
    const days = [...new Set(entry.needs.map((n) => n.day))].sort((a, b) => a - b);
    let cursor = 0;
    while (cursor < days.length) {
      const start = days[cursor];
      const covered: number[] = [];
      while (cursor < days.length && days[cursor] - start < entry.keeps) {
        covered.push(days[cursor]);
        cursor++;
      }
      const qty = entry.needs
        .filter((n) => covered.includes(n.day))
        .reduce((a, n) => a + n.qty, 0);

      const batches = sessionMap.get(start) ?? [];
      batches.push({ label, unit: entry.unit, qty, coversDays: covered });
      sessionMap.set(start, batches);
    }
  }

  const sessions: PrepSession[] = [...sessionMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day, batches]) => ({
      day,
      dayName: DAY_NAMES[day],
      batches: batches.sort((a, b) => b.coversDays.length - a.coversDays.length),
    }));

  const fresh: FreshItem[] = [...freshByDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day, labels]) => ({
      day,
      dayName: DAY_NAMES[day],
      labels: [...labels].sort(),
    }));

  const notes: string[] = [];
  const multi = sessions.filter((s) => s.batches.some((b) => b.coversDays.length > 1));
  if (multi.length > 0) {
    notes.push(
      `${multi.length} sessioni di cottura coprono più giorni: cucinando in quei ` +
        `giorni si riduce il numero di preparazioni.`,
    );
  }
  notes.push(
    'Le quantità sono a crudo: pesa prima di cuocere, poi porziona.',
  );
  if (plan.structure.waterLitersTrainingDay > plan.structure.waterLitersPerDay) {
    notes.push(
      `Acqua: ${plan.structure.waterLitersPerDay} L al giorno, ` +
        `${plan.structure.waterLitersTrainingDay} L nei giorni di allenamento.`,
    );
  }

  return { sessions, fresh, notes };
}
