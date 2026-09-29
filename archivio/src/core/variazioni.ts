import type { FoodOption, NutritionPlan, WeekPlan } from '../types.ts';
import { DAY_NAMES } from '../types.ts';
import { unitDaysFor } from './generator.ts';
import { mealLabel, mealTemplate } from './plan.ts';
import { dayEnergy, energyDelta, type EnergyDelta } from './nutrition.ts';
import { applySubstitution, formatQuantity, substitutionsFor } from './substitutions.ts';

const NORM = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/* Una variazione valutata */

export interface Alternativa {
  foodId: string;
  /** Etichetta con la quantità giusta, pronta da mostrare. */
  label: string;
  /** Nome dell'alimento senza quantità. */
  nome: string;
  quantita: string;
  /** Ammessa dal piano del professionista. */
  ammessa: boolean;
  /** Perché non è ammessa, in italiano comprensibile. */
  motivo?: string;
  /** Di quanto sposta la giornata. */
  delta: EnergyDelta;
  /** Sostituzioni trascinate (metà di una combo tira l'altra metà). */
  ancheCambia?: { slotId: string; foodId: string; label: string }[];
  /** Giorni toccati: i pasti appaiati cambiano insieme. */
  giorniToccati: number[];
}

export interface Variazione {
  day: number;
  mealId: string;
  slotId: string;
  /** Cosa c'è ora nel piatto. */
  attuale: { foodId: string; nome: string; quantita: string } | null;
  alternative: Alternativa[];
  giorniToccati: number[];
  mealLabel: string;
  dayName: string;
}

export function alternativeOrdinate(
  plan: NutritionPlan,
  week: WeekPlan,
  day: number,
  mealId: string,
  slotId: string,
): Variazione {
  const meal = week.days[day]?.meals.find((m) => m.mealId === mealId);
  const current = meal?.items.find((it) => it.slotId === slotId);
  const primaEnergia = dayEnergy(week.days[day]);

  const alternative: Alternativa[] = substitutionsFor(plan, week, day, mealId, slotId).map(
    (opt) => {
      const changes = [
        { slotId, food: opt.food },
        ...(opt.alsoChanges ?? []),
      ];
      const dopo = applySubstitution(plan, week, day, mealId, changes);
      const delta = energyDelta(primaEnergia, dayEnergy(dopo.days[day]));

      return {
        foodId: opt.food.id,
        label: opt.label.replace(/\*\(([^)]*)\)\*/g, '($1)'),
        nome: opt.food.label,
        quantita: opt.quantity,
        ammessa: opt.allowed,
        motivo: opt.reason,
        delta,
        ancheCambia: opt.alsoChanges?.map((a) => ({
          slotId: a.slotId,
          foodId: a.food.id,
          label: a.food.label,
        })),
        giorniToccati: opt.affectsDays,
      };
    },
  );

  alternative.sort(
    (a, b) =>
      Number(b.ammessa) - Number(a.ammessa) ||
      Math.abs(a.delta.kcal) - Math.abs(b.delta.kcal) ||
      a.nome.localeCompare(b.nome),
  );

  return {
    day,
    mealId,
    slotId,
    attuale: current
      ? {
          foodId: current.food.id,
          nome: current.food.label,
          quantita: formatQuantity(current.food),
        }
      : null,
    alternative,
    giorniToccati: unitDaysFor(plan, mealId, day),
    mealLabel: mealLabel(plan, mealId),
    dayName: DAY_NAMES[day],
  };
}

export type EsitoVerifica =
  /** Il piano lo prevede in questo slot e la settimana resta conforme. */
  | 'ammesso'
  /** Il piano lo prevede, ma qui romperebbe un vincolo. */
  | 'non-ammesso'
  /** Il piano non lo prevede in questo pasto: decide il professionista. */
  | 'fuori-piano';

export interface Verifica {
  esito: EsitoVerifica;
  richiesto: string;
  /** L'alternativa corrispondente, se il piano la prevede. */
  trovata?: Alternativa;
  /** Perché no, quando l'esito non è 'ammesso'. */
  motivo?: string;
  /** Le tre che spostano meno, da proporre in cambio di un rifiuto. */
  ripiego: Alternativa[];
  contesto: Variazione;
}

export function verificaSostituto(
  plan: NutritionPlan,
  week: WeekPlan,
  day: number,
  mealId: string,
  slotId: string,
  richiesto: string,
): Verifica {
  const contesto = alternativeOrdinate(plan, week, day, mealId, slotId);
  const target = NORM(richiesto);
  const ripiego = contesto.alternative.filter((a) => a.ammessa).slice(0, 3);

  const trovata =
    contesto.alternative.find((a) => NORM(a.nome) === target) ??
    contesto.alternative.find((a) => NORM(a.nome).includes(target) && target.length > 2);

  if (!trovata) {
    return {
      esito: 'fuori-piano',
      richiesto,
      ripiego,
      contesto,
      motivo:
        `Il piano non prevede «${richiesto}» in ${contesto.mealLabel.toLowerCase()}. ` +
        `Non posso deciderlo io: la richiesta va al professionista.`,
    };
  }

  return {
    esito: trovata.ammessa ? 'ammesso' : 'non-ammesso',
    richiesto,
    trovata,
    motivo: trovata.motivo,
    ripiego,
    contesto,
  };
}

/* Applicazione e registrazione */

export interface RegistroVariazione {
  day: number;
  dayName: string;
  mealId: string;
  mealLabel: string;
  slotId: string;
  daNome: string;
  daQuantita: string;
  aNome: string;
  aQuantita: string;
  kcalPrima: number;
  kcalDopo: number;
  kcalDelta: number;
  proteineDelta: number;
  carboidratiDelta: number;
  grassiDelta: number;
  copertura: 'completa' | 'parziale';
  nonCalcolati: string[];
  giorniToccati: number[];
  /** Ammessa dal validatore: una variazione non ammessa non si applica. */
  ammessa: boolean;
  motivo?: string;
}

export interface EsitoApplicazione {
  ok: boolean;
  /** La settimana risultante. Uguale a quella di partenza se `ok` è falso. */
  week: WeekPlan;
  registro: RegistroVariazione | null;
  errore?: string;
}

export function applicaVariazione(
  plan: NutritionPlan,
  week: WeekPlan,
  day: number,
  mealId: string,
  slotId: string,
  foodId: string,
): EsitoApplicazione {
  const contesto = alternativeOrdinate(plan, week, day, mealId, slotId);
  const scelta = contesto.alternative.find((a) => a.foodId === foodId);

  if (!scelta) {
    return {
      ok: false,
      week,
      registro: null,
      errore: `«${foodId}» non è tra le alternative previste dal piano per questo slot.`,
    };
  }
  if (!scelta.ammessa) {
    return {
      ok: false,
      week,
      registro: null,
      errore: scelta.motivo ?? 'La sostituzione romperebbe un vincolo del piano.',
    };
  }

  const changes = [
    { slotId, food: optionById(plan, day, mealId, slotId, foodId, scelta.nome) },
    ...(scelta.ancheCambia ?? []).map((a) => ({
      slotId: a.slotId,
      food: optionById(plan, day, mealId, a.slotId, a.foodId, a.label),
    })),
  ].filter((c): c is { slotId: string; food: FoodOption } => c.food !== null);

  const dopo = applySubstitution(plan, week, day, mealId, changes);

  return {
    ok: true,
    week: dopo,
    registro: {
      day,
      dayName: DAY_NAMES[day],
      mealId,
      mealLabel: contesto.mealLabel,
      slotId,
      daNome: contesto.attuale?.nome ?? '—',
      daQuantita: contesto.attuale?.quantita ?? '—',
      aNome: scelta.nome,
      aQuantita: scelta.quantita,
      kcalPrima: Math.round(scelta.delta.before.kcal),
      kcalDopo: Math.round(scelta.delta.after.kcal),
      kcalDelta: scelta.delta.kcal,
      proteineDelta: scelta.delta.protein,
      carboidratiDelta: scelta.delta.carbs,
      grassiDelta: scelta.delta.fat,
      copertura: scelta.delta.coverage,
      nonCalcolati: scelta.delta.unknown,
      giorniToccati: scelta.giorniToccati,
      ammessa: true,
    },
  };
}

/** L'alimento preso dal piano. */
function optionById(
  plan: NutritionPlan,
  day: number,
  mealId: string,
  slotId: string,
  foodId: string,
  _label: string,
): FoodOption | null {
  const tpl = mealTemplate(plan, day, mealId);
  const slot = tpl?.slots.find((s) => s.id === slotId);
  const fromSlot = slot?.options.find((o) => o.id === foodId);
  if (fromSlot) return fromSlot;

  // Gli alimenti che esistono solo dentro una combo non stanno negli slot.
  for (const combo of tpl?.combos ?? []) {
    for (const part of combo.parts) {
      if (part.slotId !== slotId) continue;
      const found = part.options.find((o) => o.id === foodId);
      if (found) return found;
    }
  }
  return null;
}
