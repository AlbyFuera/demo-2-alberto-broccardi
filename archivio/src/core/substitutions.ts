import type { FoodOption, NutritionPlan, PlannedItem, WeekPlan } from '../types.ts';
import { DAY_NAMES } from '../types.ts';
import { unitDaysFor } from './generator.ts';
import { expectedPortion, mealTemplate } from './plan.ts';
import { validate } from './validator.ts';

export interface SubstitutionOption {
  food: FoodOption;
  allowed: boolean;
  /** Quantità formattata, pronta da mostrare al paziente. */
  quantity: string;
  /** Perché non è ammessa, in linguaggio comprensibile. */
  reason?: string;
  /** Giorni impattati dalla sostituzione (i pranzi appaiati cambiano insieme). */
  affectsDays: number[];
  alsoChanges?: { slotId: string; food: FoodOption }[];
  /** Etichetta completa da mostrare, comprensiva delle modifiche collegate. */
  label: string;
}

export function formatQuantity(food: FoodOption): string {
  // "Verdure o insalata" non ha un peso.
  if (food.freeQuantity) return 'q.b.';
  const value =
    food.qtyMax && food.qtyMax !== food.qty ? `${food.qty}–${food.qtyMax}` : `${food.qty}`;
  return food.unit === 'pz' ? `${value} pz` : `${value}${food.unit}`;
}

function optionsForSlot(
  plan: NutritionPlan,
  day: number,
  mealId: string,
  slotId: string,
): FoodOption[] {
  const tpl = mealTemplate(plan, day, mealId);
  return [...(tpl?.slots.find((s) => s.id === slotId)?.options ?? [])];
}

function portionFor(
  plan: NutritionPlan,
  day: number,
  mealId: string,
  slotId: string,
  food: FoodOption,
): FoodOption {
  const slot = mealTemplate(plan, day, mealId)?.slots.find((s) => s.id === slotId);
  const portion = expectedPortion(slot, food);
  return portion.derived ? { ...food, qty: portion.qty } : food;
}

/** Applica una o più sostituzioni contestuali su una copia della settimana. */
export function applySubstitution(
  plan: NutritionPlan,
  week: WeekPlan,
  day: number,
  mealId: string,
  changes: { slotId: string; food: FoodOption }[],
): WeekPlan {
  const draft: WeekPlan = structuredClone(week);
  const days = unitDaysFor(plan, mealId, day);

  for (const d of days) {
    const meal = draft.days[d]?.meals.find((m) => m.mealId === mealId);
    if (!meal || meal.kind !== 'plan') continue;
    for (const { slotId, food } of changes) {
      const idx = meal.items.findIndex((it) => it.slotId === slotId);
      const next: PlannedItem = { slotId, food: portionFor(plan, d, mealId, slotId, food) };
      if (idx >= 0) meal.items[idx] = next;
      else meal.items.push(next);
    }
    meal.signature = meal.items
      .map((i) => `${i.slotId}:${i.food.id}`)
      .sort()
      .join('|');
  }
  return draft;
}

/** La combo eventualmente attiva in questo pasto. */
function activeCombo(plan: NutritionPlan, week: WeekPlan, day: number, mealId: string) {
  const tpl = mealTemplate(plan, day, mealId);
  const meal = week.days[day]?.meals.find((m) => m.mealId === mealId);
  if (!tpl || !meal || meal.kind !== 'plan') return undefined;
  return (tpl.combos ?? []).find((c) =>
    c.parts.every((p) =>
      meal.items.some(
        (it) => it.slotId === p.slotId && p.options.some((o) => o.id === it.food.id),
      ),
    ),
  );
}

export function substitutionsFor(
  plan: NutritionPlan,
  week: WeekPlan,
  day: number,
  mealId: string,
  slotId: string,
): SubstitutionOption[] {
  const affectsDays = unitDaysFor(plan, mealId, day);
  const meal = week.days[day]?.meals.find((m) => m.mealId === mealId);
  const current = meal?.items.find((it) => it.slotId === slotId);
  const combo = activeCombo(plan, week, day, mealId);

  const preesistenti = new Set(
    validate(plan, week).errors.map((e) => `${e.rule}|${e.message}`),
  );

  const out: SubstitutionOption[] = [];
  const evaluate = (
    food: FoodOption,
    also: { slotId: string; food: FoodOption }[] = [],
  ): SubstitutionOption => {
    const changes = [{ slotId, food }, ...also];
    const result = validate(plan, applySubstitution(plan, week, day, mealId, changes));
    const introdotti = result.errors.filter(
      (e) => !preesistenti.has(`${e.rule}|${e.message}`),
    );
    const shown = portionFor(plan, day, mealId, slotId, food);
    const extra = also
      .map((a) => {
        const p = portionFor(plan, day, mealId, a.slotId, a.food);
        return `${p.label} ${formatQuantity(p)}`;
      })
      .join(' + ');

    return {
      food,
      allowed: introdotti.length === 0,
      quantity: formatQuantity(shown),
      reason: introdotti.length === 0 ? undefined : humanize(introdotti[0].message),
      affectsDays,
      alsoChanges: also.length > 0 ? also : undefined,
      label: `${shown.label} ${formatQuantity(shown)}` + (extra ? ` *(con ${extra})*` : ''),
    };
  };

  if (!combo || !combo.replaces.includes(slotId)) {
    for (const food of optionsForSlot(plan, day, mealId, slotId)) {
      if (food.id === current?.food.id) continue;
      out.push(evaluate(food));
    }
  }

  if (combo && combo.replaces.includes(slotId)) {
    const otherSlots = combo.replaces.filter((s) => s !== slotId);

    // 2a. altre varianti della stessa combo.
    const thisPart = combo.parts.find((p) => p.slotId === slotId);
    for (const food of thisPart?.options ?? []) {
      if (food.id === current?.food.id) continue;
      out.push(evaluate(food));
    }

    for (const food of optionsForSlot(plan, day, mealId, slotId)) {
      const also: { slotId: string; food: FoodOption }[] = [];
      for (const other of otherSlots) {
        const candidates = optionsForSlot(plan, day, mealId, other);
        const pick = candidates.find((o) => {
          const trial = [{ slotId, food }, ...also, { slotId: other, food: o }];
          return validate(plan, applySubstitution(plan, week, day, mealId, trial)).ok;
        });
        also.push({ slotId: other, food: pick ?? candidates[0] });
      }
      out.push(evaluate(food, also));
    }
  }

  if (!combo) {
    const tpl = mealTemplate(plan, day, mealId);
    for (const c of tpl?.combos ?? []) {
      if (!c.replaces.includes(slotId)) continue;
      const thisPart = c.parts.find((p) => p.slotId === slotId);
      for (const food of thisPart?.options ?? []) {
        const also: { slotId: string; food: FoodOption }[] = [];
        for (const part of c.parts) {
          if (part.slotId === slotId) continue;
          const pick = part.options.find((o) => {
            const trial = [{ slotId, food }, ...also, { slotId: part.slotId, food: o }];
            return validate(plan, applySubstitution(plan, week, day, mealId, trial)).ok;
          });
          also.push({ slotId: part.slotId, food: pick ?? part.options[0] });
        }
        out.push(evaluate(food, also));
      }
    }
  }

  // Prima le ammesse, poi in ordine alfabetico: elenco leggibile.
  return out
    .filter((o, i, all) => all.findIndex((x) => x.label === o.label) === i)
    .sort((a, b) => Number(b.allowed) - Number(a.allowed) || a.label.localeCompare(b.label));
}

function humanize(message: string): string {
  return message
    .replace(/^frequenza\//, '')
    .replace('il piano ne ammette al massimo', 'supereresti il limite di')
    .replace('il piano ne chiede almeno', 'scenderesti sotto il minimo di');
}

export function swapProteins(
  plan: NutritionPlan,
  week: WeekPlan,
  day: number,
): { week: WeekPlan; description: string } | null {
  const rule = plan.structure.proteinSwap;
  if (!rule) return null;

  const [mealA, mealB] = rule.between;
  const draft: WeekPlan = structuredClone(week);
  const dayA = draft.days[day];
  if (!dayA) return null;

  const a = dayA.meals.find((m) => m.mealId === mealA);
  const b = dayA.meals.find((m) => m.mealId === mealB);
  if (!a || !b || a.kind !== 'plan' || b.kind !== 'plan') return null;

  const ia = a.items.findIndex((it) => it.slotId === rule.slot);
  const ib = b.items.findIndex((it) => it.slotId === rule.slot);
  if (ia < 0 || ib < 0) return null;

  const foodA = a.items[ia].food;
  const foodB = b.items[ib].food;

  // L'alimento deve essere previsto anche nell'altro pasto, con la sua quantità.
  const inB = optionsForSlot(plan, day, mealB, rule.slot).find((o) => o.id === foodA.id);
  const inA = optionsForSlot(plan, day, mealA, rule.slot).find((o) => o.id === foodB.id);
  if (!inA || !inB) return null;

  a.items[ia] = { slotId: rule.slot, food: portionFor(plan, day, mealA, rule.slot, inA) };
  b.items[ib] = { slotId: rule.slot, food: portionFor(plan, day, mealB, rule.slot, inB) };
  for (const meal of [a, b]) {
    meal.signature = meal.items
      .map((i) => `${i.slotId}:${i.food.id}`)
      .sort()
      .join('|');
  }

  if (!validate(plan, draft).ok) return null;

  return {
    week: draft,
    description:
      `${DAY_NAMES[day]}: invertite le proteine — ` +
      `${foodA.label} passa a ${mealB}, ${foodB.label} passa a ${mealA}.`,
  };
}
