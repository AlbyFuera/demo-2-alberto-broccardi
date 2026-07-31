/**
 * Validatore deterministico.
 *
 * È il guardiano del prodotto: nessuna settimana raggiunge il paziente senza
 * essere passata di qui. Non contiene euristiche, non chiama modelli, non
 * "interpreta" nulla — confronta la settimana proposta con il piano e basta.
 *
 * Regola d'oro: in caso di dubbio, ERRORE. Meglio rigenerare che mostrare
 * al paziente un pasto non conforme al piano del professionista.
 */

import type {
  ComboRule,
  FoodOption,
  MealTemplate,
  NutritionPlan,
  PlannedDay,
  PlannedMeal,
  Slot,
  ValidationResult,
  Violation,
  WeekPlan,
} from '../types.ts';
import { DAY_NAMES } from '../types.ts';
import { expectedPortion, mealLabel, mealTemplate, mealsForDay } from './plan.ts';

/**
 * Opzioni ammesse per uno slot.
 *
 * Gli alimenti che arrivano da una combo valgono SOLO se la combo è applicata
 * per intero. Altrimenti "100g di cereali", che nel piano esistono unicamente
 * in coppia con "100g di legumi", passerebbero come sostituto della porzione
 * piena da 130g: una porzione monca spacciata per conforme.
 */
function allowedFoods(
  tpl: MealTemplate,
  slotId: string,
  comboUsed: ComboRule | undefined,
): FoodOption[] {
  const out: FoodOption[] = [];
  const slot = tpl.slots.find((s) => s.id === slotId);
  if (slot) out.push(...slot.options);
  for (const part of comboUsed?.parts ?? []) {
    if (part.slotId === slotId) out.push(...part.options);
  }
  return out;
}

/**
 * Scarto ammesso, convertito da grammi di nutriente a grammi di alimento.
 * Il +1 assorbe l'arrotondamento al grammo della porzione calcolata.
 */
function toleranceInGrams(slot: Slot | undefined, food: FoodOption): number {
  const target = slot?.target;
  const per100 = target && food.nutrients?.[target.nutrient];
  if (!target || !per100) return 0;
  return Math.round(((target.tolerance ?? 0) * 100) / per100) + 1;
}

/** Conta le occorrenze di un tag, contando UNA sola volta per pasto. */
function tagCountInMeal(meal: PlannedMeal, tag: string): number {
  return meal.items.some((it) => it.food.tags?.includes(tag)) ? 1 : 0;
}

/** Quante volte un tag compare in un giorno (max 1 per pasto). */
export function tagCountInDay(day: PlannedDay, tag: string): number {
  return day.meals.reduce((n, m) => n + tagCountInMeal(m, tag), 0);
}

/** Quante volte un tag compare nella settimana. */
export function tagCountInWeek(week: WeekPlan, tag: string): number {
  return week.days.reduce((n, d) => n + tagCountInDay(d, tag), 0);
}

export function validate(plan: NutritionPlan, week: WeekPlan): ValidationResult {
  const errors: Violation[] = [];
  const warnings: Violation[] = [];

  const err = (rule: string, message: string, where?: Violation['where']) =>
    errors.push({ rule, severity: 'error', message, where });
  const warn = (rule: string, message: string, where?: Violation['where']) =>
    warnings.push({ rule, severity: 'warning', message, where });

  /* --- 0. struttura della settimana --------------------------------- */
  if (week.days.length !== 7) {
    err('settimana/giorni', `La settimana ha ${week.days.length} giorni invece di 7.`);
    return { ok: false, errors, warnings };
  }

  /* --- 1. alimenti e quantità (il controllo critico) ---------------- */
  for (const day of week.days) {
    // Ogni pasto obbligatorio previsto per QUEL giorno deve esserci: con due
    // regimi alternati i pasti cambiano da un giorno all'altro.
    for (const tpl of mealsForDay(plan, day.index)) {
      if (tpl.optional) continue;
      if (!day.meals.some((m) => m.mealId === tpl.id)) {
        err('pasto/mancante', `${DAY_NAMES[day.index]}: manca "${tpl.label}".`, {
          day: day.index,
          meal: tpl.id,
        });
      }
    }

    for (const meal of day.meals) {
      // I pasti liberi e quelli fuori casa non sono vincolati dal piano.
      if (meal.kind !== 'plan') continue;

      const tpl = mealTemplate(plan, day.index, meal.mealId);
      if (!tpl) {
        err(
          'pasto/sconosciuto',
          `${DAY_NAMES[day.index]}: "${meal.mealId}" non è previsto per questo giorno.`,
          { day: day.index, meal: meal.mealId },
        );
        continue;
      }

      // Una combo vale solo se applicata per intero: va riconosciuta PRIMA di
      // giudicare i singoli alimenti.
      const comboUsed = (tpl.combos ?? []).find((c) =>
        c.parts.every((p) =>
          meal.items.some(
            (it) => it.slotId === p.slotId && p.options.some((o) => o.id === it.food.id),
          ),
        ),
      );

      // 1a. ogni alimento scelto deve esistere nello slot, con la quantità esatta
      for (const item of meal.items) {
        const allowed = allowedFoods(tpl, item.slotId, comboUsed);
        const match = allowed.find((o) => o.id === item.food.id);
        if (!match) {
          err(
            'alimento/non-ammesso',
            `"${item.food.label}" non è tra le opzioni di ${tpl.label} → ${item.slotId}.`,
            { day: day.index, meal: meal.mealId, slot: item.slotId },
          );
          continue;
        }
        // "Verdure o insalata" senza peso: il professionista non lo prescrive.
        if (match.freeQuantity) continue;

        const slot = tpl.slots.find((s) => s.id === item.slotId);
        let portion;
        try {
          portion = expectedPortion(slot, match);
        } catch (error) {
          err('alimento/porzione-non-calcolabile', (error as Error).message, {
            day: day.index,
            meal: meal.mealId,
            slot: item.slotId,
          });
          continue;
        }

        const min = portion.qty;
        const max = portion.derived ? portion.qty : (match.qtyMax ?? match.qty);
        // Sulle porzioni calcolate si ammette lo scarto di arrotondamento
        // dichiarato dal piano: 63 g di riso non si pesano al decimo.
        const slack = portion.derived ? toleranceInGrams(slot, match) : 0;
        const outOfRange =
          item.food.unit !== portion.unit ||
          item.food.qty < min - slack ||
          item.food.qty > max + slack;

        if (outOfRange) {
          const expected =
            max === min ? `${min}${portion.unit}` : `${min}–${max}${portion.unit}`;
          err(
            'alimento/quantita',
            `${DAY_NAMES[day.index]} · ${tpl.label}: "${item.food.label}" indicato ` +
              `${item.food.qty}${item.food.unit}, il piano prevede ${expected}` +
              `${portion.explanation ? ` (${portion.explanation})` : ''}.`,
            { day: day.index, meal: meal.mealId, slot: item.slotId },
          );
        }
      }

      // 1b. ogni slot obbligatorio va coperto nel numero previsto
      for (const slot of tpl.slots) {
        if (comboUsed?.replaces.includes(slot.id)) continue;
        const n = meal.items.filter((it) => it.slotId === slot.id).length;
        const expected = slot.choose ?? 1;
        if (n === 0 && slot.optional) continue;
        if (n !== expected) {
          err(
            'slot/copertura',
            `${DAY_NAMES[day.index]} · ${tpl.label}: lo slot "${slot.label}" ha ` +
              `${n} scelte invece di ${expected}.`,
            { day: day.index, meal: meal.mealId, slot: slot.id },
          );
        }
      }

      // 1c. incompatibilità dichiarate
      for (const item of meal.items) {
        for (const bad of item.food.conflictsWith ?? []) {
          if (meal.items.some((o) => o.food.id === bad)) {
            err(
              'alimento/conflitto',
              `${DAY_NAMES[day.index]} · ${tpl.label}: "${item.food.label}" non è ` +
                `compatibile con l'altra scelta dello stesso pasto.`,
              { day: day.index, meal: meal.mealId },
            );
          }
        }
      }
    }
  }

  const S = plan.structure;

  /* --- 2. pasti fissi (es. colazione identica 7/7) ------------------ */
  for (const mealId of S.fixedMeals) {
    const sigs = new Set(
      week.days
        .flatMap((d) => d.meals.filter((m) => m.mealId === mealId && m.kind === 'plan'))
        .map((m) => m.signature),
    );
    if (sigs.size > 1) {
      err(
        'struttura/pasto-fisso',
        `"${mealLabel(plan, mealId)}" deve essere identico tutti i ` +
          `giorni, ne risultano ${sigs.size} versioni diverse.`,
        { meal: mealId },
      );
    }
  }

  /* --- 3. pasti tutti diversi (es. cene) ---------------------------- */
  for (const mealId of S.allDifferentMeals) {
    const seen = new Map<string, number>();
    for (const day of week.days) {
      for (const meal of day.meals) {
        if (meal.mealId !== mealId || meal.kind !== 'plan') continue;
        const prev = seen.get(meal.signature);
        if (prev !== undefined) {
          err(
            'struttura/tutti-diversi',
            `"${mealLabel(plan, mealId)}" di ${DAY_NAMES[day.index]} ` +
              `è identica a quella di ${DAY_NAMES[prev]}.`,
            { day: day.index, meal: mealId },
          );
        } else {
          seen.set(meal.signature, day.index);
        }
      }
    }
  }

  /* --- 3b. pasti che nello stesso giorno devono differire ----------- */
  for (const group of S.distinctWithinDay ?? []) {
    for (const day of week.days) {
      const sigs = day.meals
        .filter((m) => group.includes(m.mealId) && m.kind === 'plan')
        .map((m) => m.signature);
      if (new Set(sigs).size !== sigs.length) {
        err(
          'struttura/distinti-nel-giorno',
          `${DAY_NAMES[day.index]}: ${group.join(' e ')} sono identici, il piano ` +
            `chiede di variare.`,
          { day: day.index },
        );
      }
    }
  }

  /* --- 4. pattern di ripetizione (es. pranzi 2+2+2+1) --------------- */
  for (const rp of S.repeatPatterns) {
    const sum = rp.pattern.reduce((a, b) => a + b, 0);
    if (sum !== 7) {
      err(
        'struttura/pattern-invalido',
        `Il pattern di "${rp.meal}" copre ${sum} giorni invece di 7.`,
        { meal: rp.meal },
      );
      continue;
    }

    let cursor = 0;
    const groups: number[][] = [];
    for (const size of rp.pattern) {
      groups.push(Array.from({ length: size }, (_, i) => cursor + i));
      cursor += size;
    }

    // Dentro un gruppo il pasto è lo stesso; tra gruppi diversi cambia.
    const groupSignature: (string | null)[] = [];
    for (const [gi, group] of groups.entries()) {
      const sigs = group
        .map((di) => week.days[di].meals.find((m) => m.mealId === rp.meal))
        .filter((m): m is PlannedMeal => !!m)
        // Un pasto libero/fuori spezza legittimamente la coppia.
        .filter((m) => m.kind === 'plan')
        .map((m) => m.signature);

      const uniq = new Set(sigs);
      if (uniq.size > 1) {
        err(
          'struttura/pattern-gruppo',
          `"${rp.meal}": i giorni ${group.map((d) => DAY_NAMES[d]).join(' e ')} ` +
            `dovrebbero avere lo stesso pasto.`,
          { meal: rp.meal },
        );
      }
      groupSignature.push(sigs[0] ?? null);

      for (let prev = 0; prev < gi; prev++) {
        if (groupSignature[prev] && groupSignature[prev] === (sigs[0] ?? null)) {
          err(
            'struttura/pattern-duplicato',
            `"${rp.meal}": il gruppo ${gi + 1} ripete lo stesso pasto del gruppo ${prev + 1}.`,
            { meal: rp.meal },
          );
        }
      }
    }
  }

  /* --- 5. pasto libero ---------------------------------------------- */
  const freeMeals = week.days.flatMap((d) =>
    d.meals.filter((m) => m.kind === 'free').map((m) => ({ day: d.index, meal: m })),
  );
  if (freeMeals.length !== S.freeMeals) {
    err(
      'pasto-libero/numero',
      `La settimana ha ${freeMeals.length} pasti liberi, il piano ne prevede ${S.freeMeals}.`,
    );
  }
  for (const f of freeMeals) {
    for (const rule of S.freeMealForbidden ?? []) {
      const mealMatch = rule.meal === undefined || rule.meal === f.meal.mealId;
      const dayMatch = rule.days === undefined || rule.days.includes(f.day);
      if (mealMatch && dayMatch && (rule.meal !== undefined || rule.days !== undefined)) {
        err(
          'pasto-libero/posizione',
          `Il pasto libero non può cadere su ${mealLabel(plan, f.meal.mealId)} ` +
            `di ${DAY_NAMES[f.day]}.`,
          { day: f.day, meal: f.meal.mealId },
        );
      }
    }
  }

  /* --- 6. frequenze -------------------------------------------------- */
  for (const rule of plan.frequencies) {
    const name = rule.label ?? rule.tag;

    if (rule.per === 'week') {
      const count = week.days.reduce((n, d) => n + tagCountInDay(d, rule.tag), 0);
      if (rule.min !== undefined && count < rule.min) {
        err(
          'frequenza/minimo',
          `${name}: ${count} volte a settimana, il piano ne chiede almeno ${rule.min}.`,
        );
      }
      if (rule.max !== undefined && count > rule.max) {
        err(
          'frequenza/massimo',
          `${name}: ${count} volte a settimana, il piano ne ammette al massimo ${rule.max}.`,
        );
      }
    } else {
      for (const day of week.days) {
        const count = tagCountInDay(day, rule.tag);
        // Un giorno con pasto libero può legittimamente saltare un minimo.
        const hasFree = day.meals.some((m) => m.kind !== 'plan');
        if (rule.min !== undefined && count < rule.min) {
          const v: Violation = {
            rule: 'frequenza/minimo-giornaliero',
            severity: hasFree ? 'warning' : 'error',
            message: `${DAY_NAMES[day.index]} — ${name}: ${count}, il piano ne chiede almeno ${rule.min}${
              hasFree ? ' (giorno con pasto libero/fuori)' : ''
            }.`,
            where: { day: day.index },
          };
          (hasFree ? warnings : errors).push(v);
        }
        if (rule.max !== undefined && count > rule.max) {
          err(
            'frequenza/massimo-giornaliero',
            `${DAY_NAMES[day.index]} — ${name}: ${count}, massimo ${rule.max}.`,
            { day: day.index },
          );
        }
      }
    }
  }

  /* --- 7. alcol ------------------------------------------------------ */
  if (week.alcoholUnits > S.alcoholUnitsMax) {
    err(
      'alcol/massimo',
      `${week.alcoholUnits} unità alcoliche, il piano ne ammette ${S.alcoholUnitsMax}.`,
    );
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** Riassunto leggibile, usato dalla CLI e dal log delle rigenerazioni. */
export function formatValidation(result: ValidationResult): string {
  const lines: string[] = [];
  lines.push(result.ok ? '✅ Settimana conforme al piano.' : '❌ Settimana NON conforme.');
  for (const e of result.errors) lines.push(`  ✗ [${e.rule}] ${e.message}`);
  for (const w of result.warnings) lines.push(`  ⚠ [${w.rule}] ${w.message}`);
  return lines.join('\n');
}
