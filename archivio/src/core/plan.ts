/**
 * Accesso al piano.
 *
 * Un piano può avere un regime unico (`meals`) oppure più regimi alternati
 * (`variants` + `schedule`): "lunedì-giovedì schema A, venerdì-sabato schema B".
 * Tutto il resto del motore passa da qui e non deve sapere quale dei due casi
 * ha davanti.
 */

import type { FoodOption, MealTemplate, NutritionPlan, NutrientTarget, Slot } from '../types.ts';

/** I pasti previsti per un dato giorno della settimana. */
export function mealsForDay(plan: NutritionPlan, day: number): MealTemplate[] {
  if (plan.variants && plan.variants.length > 0) {
    const variantId = plan.schedule?.[day];
    const variant = plan.variants.find((v) => v.id === variantId);
    if (!variant) {
      throw new Error(
        `Il piano non dice quale regime si applica al giorno ${day}: ` +
          `manca la voce corrispondente in "schedule".`,
      );
    }
    return variant.meals;
  }
  return plan.meals ?? [];
}

/** Il template di un pasto in un giorno specifico. */
export function mealTemplate(
  plan: NutritionPlan,
  day: number,
  mealId: string,
): MealTemplate | undefined {
  return mealsForDay(plan, day).find((m) => m.id === mealId);
}

/**
 * Tutti i pasti che compaiono almeno una volta nella settimana, nell'ordine in
 * cui si presentano. Serve alle intestazioni: con due regimi alternati le
 * colonne devono essere l'unione, non quelle di un giorno solo.
 */
export function allMealTemplates(plan: NutritionPlan): MealTemplate[] {
  const seen = new Map<string, MealTemplate>();
  for (let day = 0; day < 7; day++) {
    for (const tpl of mealsForDay(plan, day)) {
      if (!seen.has(tpl.id)) seen.set(tpl.id, tpl);
    }
  }
  return [...seen.values()];
}

/** Etichetta leggibile di un pasto, cercata su tutti i regimi. */
export function mealLabel(plan: NutritionPlan, mealId: string): string {
  return allMealTemplates(plan).find((m) => m.id === mealId)?.label ?? mealId;
}

/** Il regime applicato a un giorno, se il piano ne ha più di uno. */
export function variantLabelForDay(plan: NutritionPlan, day: number): string | undefined {
  if (!plan.variants || plan.variants.length === 0) return undefined;
  return plan.variants.find((v) => v.id === plan.schedule?.[day])?.label;
}

/* ------------------------------------------------------------------ */
/* Porzioni espresse in nutriente                                      */
/* ------------------------------------------------------------------ */

export interface ResolvedPortion {
  qty: number;
  unit: FoodOption['unit'];
  /** true se la quantità è stata calcolata dalla quota di nutriente. */
  derived: boolean;
  /** Testo della derivazione, da mostrare sempre accanto alla quantità. */
  explanation?: string;
}

/**
 * Quanto alimento serve per coprire la quota di nutriente dello slot.
 *
 * Il calcolo è banale; ciò che conta è che sia SEMPRE visibile. Il paziente
 * deve poter leggere "riso basmati 63 g (= 50 g di carboidrati)" e il
 * professionista deve poter controllare il valore che l'ha prodotto.
 */
export function resolvePortion(food: FoodOption, target?: NutrientTarget): ResolvedPortion {
  if (!target || food.fixedQty) {
    return { qty: food.qty, unit: food.unit, derived: false };
  }

  const per100 = food.nutrients?.[target.nutrient];
  if (per100 === undefined || per100 <= 0) {
    throw new Error(
      `"${food.label}" non ha il valore di ${target.nutrient} per 100 g: ` +
        `senza quel dato la porzione non è calcolabile e non va indovinata.`,
    );
  }

  return {
    qty: Math.round((target.qty * 100) / per100),
    unit: food.unit,
    derived: true,
    explanation: `= ${target.qty} g di ${target.nutrient}`,
  };
}

/** La porzione prevista dal piano per un alimento in un dato slot. */
export function expectedPortion(slot: Slot | undefined, food: FoodOption): ResolvedPortion {
  return resolvePortion(food, slot?.target);
}

export interface DerivationRow {
  label: string;
  portion: number;
  unit: FoodOption['unit'];
  /** g di nutriente per 100 g, oppure null se la quantità è imposta. */
  per100: number | null;
  fixed: boolean;
}

export interface DerivationGroup {
  nutrient: string;
  qty: number;
  rows: DerivationRow[];
}

/**
 * Conversioni porzione ↔ nutriente, come dati.
 *
 * Vive qui e non nel renderer perché serve identica al Markdown, alla
 * dashboard e alla stampa: il calcolo che decide quanto finisce nel piatto
 * non va riscritto tre volte.
 */
export function portionDerivations(plan: NutritionPlan): DerivationGroup[] {
  const groups = new Map<string, DerivationGroup>();

  // Tutti i regimi, non l'unione deduplicata: due schemi alternati hanno
  // quote diverse e una delle due sparirebbe.
  for (let day = 0; day < 7; day++) {
    for (const tpl of mealsForDay(plan, day)) {
      for (const slot of tpl.slots) {
        if (!slot.target) continue;
        const key = `${slot.target.nutrient}|${slot.target.qty}`;
        const group =
          groups.get(key) ??
          ({ nutrient: slot.target.nutrient, qty: slot.target.qty, rows: [] } as DerivationGroup);

        for (const food of slot.options) {
          if (group.rows.some((r) => r.label === food.label)) continue;
          group.rows.push({
            label: food.label,
            portion: resolvePortion(food, slot.target).qty,
            unit: food.unit,
            per100: food.nutrients?.[slot.target.nutrient] ?? null,
            fixed: food.fixedQty === true,
          });
        }
        groups.set(key, group);
      }
    }
  }

  return [...groups.values()].sort((a, b) => a.qty - b.qty);
}

/* ------------------------------------------------------------------ */
/* Verifica di coerenza del piano                                      */
/* ------------------------------------------------------------------ */

export interface PlanIssue {
  severity: 'errore' | 'avviso';
  message: string;
}

export type PlanMode = 'prescrittivo' | 'macro';

/**
 * Che tipo di piano è.
 *
 *  - `prescrittivo`: elenca alimenti e quantità. È pianificabile: c'è qualcosa
 *    da comporre.
 *  - `macro`: fissa solo quantità di macronutrienti. Non c'è nulla da
 *    scegliere, quindi non è pianificabile — ma è verificabile.
 */
export function planMode(plan: NutritionPlan): PlanMode {
  const hasFoods = (plan.variants?.length ?? 0) > 0 || (plan.meals?.length ?? 0) > 0;
  return hasFoods ? 'prescrittivo' : 'macro';
}

/**
 * Se il motore può comporre una settimana da questo piano.
 *
 * Un "no" qui non è un difetto del piano: è una constatazione. Un piano a
 * macronutrienti non elenca alimenti, e inventarli significherebbe che il
 * software si mette a decidere la dieta al posto del professionista.
 */
export function canGenerateWeek(plan: NutritionPlan): { ok: boolean; reason?: string } {
  if (planMode(plan) === 'prescrittivo') return { ok: true };
  return {
    ok: false,
    reason:
      'Questo piano fissa obiettivi di macronutrienti ma non elenca alimenti: ' +
      'non c\'è nulla da comporre. Il software può verificarne la coerenza e ' +
      'controllare i pasti che il paziente registra, non proporre un menù — ' +
      'quello significherebbe scegliere la dieta al posto del professionista.',
  };
}

/**
 * Controlli sul piano stesso, da eseguire quando il professionista lo conferma.
 * Un piano incoerente deve fallire subito e a voce alta, non produrre settimane
 * silenziosamente sbagliate.
 */
export function checkPlanIntegrity(plan: NutritionPlan): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const problems: string[] = [];
  const hasVariants = (plan.variants?.length ?? 0) > 0;

  if (planMode(plan) === 'macro') {
    return checkMacroPlan(plan);
  }

  if (hasVariants) {
    if (!plan.schedule || plan.schedule.length !== 7) {
      problems.push('Con più regimi serve uno "schedule" di 7 voci, una per giorno.');
    } else {
      for (const [day, id] of plan.schedule.entries()) {
        if (!plan.variants!.some((v) => v.id === id)) {
          problems.push(`Il giorno ${day} rimanda al regime "${id}", che non esiste.`);
        }
      }
    }
    if (plan.structure.repeatPatterns.length > 0) {
      problems.push(
        'Pattern di ripetizione e regimi alternati non sono ancora combinabili: ' +
          'il pattern presuppone che tutti i giorni condividano gli stessi pasti.',
      );
    }
  }

  // Ogni slot a quota di nutriente deve avere il dato su TUTTE le sue opzioni.
  for (let day = 0; day < 7; day++) {
    let meals: MealTemplate[];
    try {
      meals = mealsForDay(plan, day);
    } catch (error) {
      problems.push((error as Error).message);
      continue;
    }
    for (const tpl of meals) {
      for (const slot of tpl.slots) {
        if (!slot.target) continue;
        for (const food of slot.options) {
          if (food.fixedQty) continue;
          const per100 = food.nutrients?.[slot.target.nutrient];
          if (per100 === undefined || per100 <= 0) {
            problems.push(
              `${tpl.label} → ${slot.label}: "${food.label}" non ha il valore di ` +
                `${slot.target.nutrient} per 100 g.`,
            );
          }
        }
      }
    }
  }

  for (const message of new Set(problems)) issues.push({ severity: 'errore', message });
  return issues;
}

/* ------------------------------------------------------------------ */
/* Verifica dei piani a macronutrienti                                 */
/* ------------------------------------------------------------------ */

/** Scarto tollerato sugli arrotondamenti del professionista. */
const KCAL_SLACK = 5;

/**
 * Controlla che i conti di un piano a macro tornino.
 *
 * È il caso in cui il software vale di più: questi documenti sono compilati a
 * mano, spesso dentro un foglio di calcolo, e un macronutriente non ricalcolato
 * dopo un cambio di calorie non si vede a occhio. Al paziente arriva un
 * obiettivo matematicamente irraggiungibile.
 */
export function checkMacroPlan(plan: NutritionPlan): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const m = plan.macro;
  const err = (message: string) => issues.push({ severity: 'errore' as const, message });
  const warn = (message: string) => issues.push({ severity: 'avviso' as const, message });

  if (!m) {
    err('Il piano non elenca alimenti e non dichiara obiettivi di macronutrienti: è vuoto.');
    return issues;
  }

  /* 1. Coerenza interna di ogni macronutriente. */
  for (const dt of m.dayTypes) {
    if (dt.macros.length === 0) {
      warn(`"${dt.label}": nessun macronutriente indicato. La riga è rimasta in bianco.`);
      continue;
    }

    for (const macro of dt.macros) {
      if (macro.grams !== undefined && macro.kcal !== undefined) {
        const atteso = macro.grams * macro.kcalPerGram;
        if (Math.abs(atteso - macro.kcal) > KCAL_SLACK) {
          err(
            `"${dt.label}" → ${macro.nutrient}: ${macro.grams} g × ${macro.kcalPerGram} = ` +
              `${atteso} kcal, ma il piano ne dichiara ${macro.kcal}.`,
          );
        }
      }
      if (macro.gramsPerKg !== undefined && macro.grams !== undefined && m.bodyWeightKg) {
        const atteso = macro.gramsPerKg * m.bodyWeightKg;
        if (Math.abs(atteso - macro.grams) > 2) {
          err(
            `"${dt.label}" → ${macro.nutrient}: ${macro.gramsPerKg} g/kg su ` +
              `${m.bodyWeightKg} kg fa ${atteso.toFixed(0)} g, ma il piano ne dichiara ` +
              `${macro.grams}.`,
          );
        }
      }
    }

    /* 2. La somma dei macro contro le calorie obiettivo di quella giornata. */
    const somma = dt.macros.reduce(
      (acc, macro) => acc + (macro.kcal ?? (macro.grams ?? 0) * macro.kcalPerGram),
      0,
    );
    const obiettivo = dt.kcal ?? unicoValore(m.dailyKcal);

    if (obiettivo !== undefined && somma > 0 && Math.abs(somma - obiettivo) > KCAL_SLACK) {
      err(
        `"${dt.label}": i macronutrienti sommano a ${somma} kcal, ma l'obiettivo ` +
          `giornaliero è ${obiettivo} kcal (scarto ${somma - obiettivo > 0 ? '+' : ''}` +
          `${somma - obiettivo}).`,
      );

      // Il caso peggiore: obiettivo matematicamente irraggiungibile.
      const senzaGrassi = dt.macros
        .filter((x) => x.kcalPerGram === 4)
        .reduce((acc, x) => acc + (x.kcal ?? (x.grams ?? 0) * x.kcalPerGram), 0);
      if (senzaGrassi > obiettivo) {
        err(
          `"${dt.label}": proteine e carboidrati da soli fanno ${senzaGrassi} kcal, ` +
            `più dell'obiettivo di ${obiettivo}. Il target è irraggiungibile anche ` +
            `azzerando i grassi.`,
        );
      }

      // Indizio utile: spesso i macro sono rimasti quelli del TDEE di partenza.
      if (m.tdeeStart !== undefined && Math.abs(somma - m.tdeeStart) <= KCAL_SLACK) {
        warn(
          `I macronutrienti di "${dt.label}" coincidono con il TDEE iniziale ` +
            `(${m.tdeeStart} kcal): sembrano non essere stati ricalcolati dopo il deficit.`,
        );
      }
    }
  }

  /* 3. Totale settimanale contro le calorie giornaliere. */
  if (m.dailyKcal) {
    const noti = m.dailyKcal.filter((k): k is number => k !== undefined);
    if (noti.length < 7) {
      warn(`Le calorie obiettivo sono indicate solo per ${noti.length} giorni su 7.`);
    }
    if (m.weeklyKcal !== undefined && noti.length === 7) {
      const somma = noti.reduce((a, b) => a + b, 0);
      if (Math.abs(somma - m.weeklyKcal) > KCAL_SLACK) {
        err(
          `La somma dei giorni fa ${somma} kcal, ma il totale settimanale ` +
            `dichiarato è ${m.weeklyKcal}.`,
        );
      }
    }
  }

  /* 4. Suddivisione dei pasti contro l'obiettivo giornaliero. */
  const obiettivo = unicoValore(m.dailyKcal);
  if (m.mealSplit && m.mealSplit.length > 0 && obiettivo !== undefined) {
    const min = m.mealSplit.reduce((a, p) => a + (p.kcalMin ?? 0), 0);
    if (min > obiettivo) {
      err(
        `La suddivisione dei pasti parte da ${min} kcal minime, oltre l'obiettivo ` +
          `di ${obiettivo} kcal.`,
      );
    }
  }

  /* 5. Dati mancanti che servono per usare il piano. */
  if (!m.bodyWeightKg) {
    warn('Manca il peso corporeo: i valori in g/kg non sono verificabili.');
  }
  if (m.dayTypes.some((dt) => dt.macros.length > 0) && m.dayTypes.some((dt) => dt.macros.length === 0)) {
    warn(
      'Alcuni tipi di giornata hanno i macronutrienti e altri no: il piano ' +
        'distingue le giornate ma non le compila tutte.',
    );
  }

  return issues;
}

/** Il valore comune di una serie, se tutti i giorni hanno lo stesso obiettivo. */
function unicoValore(values?: (number | undefined)[]): number | undefined {
  const noti = values?.filter((v): v is number => v !== undefined) ?? [];
  if (noti.length === 0) return undefined;
  return noti.every((v) => v === noti[0]) ? noti[0] : undefined;
}
