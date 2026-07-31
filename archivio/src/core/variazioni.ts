/**
 * Variazioni chieste dal cliente.
 *
 * È la funzione che vende il prodotto, e l'unica il cui esito arriva sul
 * tavolo del professionista. Tre domande, una risposta ciascuna:
 *
 *   «posso mettere X al posto di Y?»      → verificaSostituto()
 *   «trovami qualcosa che vada bene»       → alternativeOrdinate()
 *   «ok, cambio»                           → applicaVariazione()
 *
 * CHI DECIDE COSA — è il punto su cui si regge la responsabilità legale:
 *
 *   ammesso / non ammesso   →  il validatore, cioè il piano del professionista
 *   di quanto sposta        →  core/nutrition.ts, con la copertura dichiarata
 *   come lo si dice         →  l'AI, e solo questo
 *
 * L'AI non compare in questo file. Nessuna variazione viene mai concessa da un
 * modello linguistico: se il validatore dice no, è no, anche se il modello
 * saprebbe argomentare il contrario.
 */

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

/* ------------------------------------------------------------------ */
/* Una variazione valutata                                             */
/* ------------------------------------------------------------------ */

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

/**
 * Alternative per uno slot, ordinate per SCOSTAMENTO CALORICO CRESCENTE.
 *
 * L'ordine è la risposta alla richiesta vera del cliente: non «cosa posso
 * mangiare» ma «cosa posso mangiare senza sfasare la giornata». La prima
 * alternativa ammessa dell'elenco è quella che sposta meno.
 *
 * Le non ammesse restano in coda, con il motivo: un elenco che le fa sparire
 * lascia il cliente a chiedersi perché, e a riprovare.
 */
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

/* ------------------------------------------------------------------ */
/* «Posso mettere X?»                                                  */
/* ------------------------------------------------------------------ */

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

/**
 * Verifica un sostituto NOMINATO dal cliente.
 *
 * Il caso 'fuori-piano' è quello che conta di più: il cliente ha chiesto
 * qualcosa che il piano non elenca. Lo strumento non lo concede e non lo nega
 * — non è una decisione che possa prendere né il codice né un modello. Va al
 * professionista, e nel frattempo il cliente riceve alternative vere.
 */
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

  // Corrispondenza esatta, poi per contenimento: "riso" trova "riso integrale"
  // solo se non esiste un "riso" secco, così la scelta non cambia da sola.
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

/* ------------------------------------------------------------------ */
/* Applicazione e registrazione                                        */
/* ------------------------------------------------------------------ */

/**
 * La variazione come finisce sulla dashboard del professionista.
 *
 * Contiene già tutto ciò che serve a giudicarla in tre secondi: cosa era, cosa
 * è diventata, di quanto si è spostata la giornata e quanto è affidabile quel
 * numero. Non contiene interpretazioni.
 */
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

/**
 * Applica la variazione, se ammessa.
 *
 * Rifiuta in modo esplicito: una variazione non conforme non viene applicata
 * «con un avviso». Il piano del professionista non è una linea guida.
 */
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

/** L'oggetto alimento vero, preso dal piano: mai ricostruito a mano. */
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
