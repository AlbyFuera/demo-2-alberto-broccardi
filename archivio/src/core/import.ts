export interface DraftFood {
  label: string;
  qty: number | null;
  unit: 'g' | 'ml' | 'pz' | null;
  freeQuantity?: boolean;
  /** Testo originale da cui è stato ricavato: serve al controllo umano. */
  raw: string;
}

export interface DraftSlot {
  id: string;
  label: string;
  options: DraftFood[];
}

export interface DraftMeal {
  id: string;
  label: string;
  slots: DraftSlot[];
}

export interface Draft {
  patientName: string | null;
  meals: DraftMeal[];
  generalRules: string[];
  /** Righe che l'estrattore non ha saputo interpretare: vanno mostrate. */
  unparsed: string[];
  warnings: string[];
}

const MEAL_HEAD =
  /^\s*(pasto\s*\d+[^:\n]*|colazione|pranzo|cena|spuntino[^:\n]*|merenda[^:\n]*)\s*:?\s*$/i;

const RULE_WORDS =
  /(acqua|alcol|pasto libero|sale|integrator|creatina|proteine in polvere|barrett|condiment|acqua)/i;

const UNITS: Record<string, 'g' | 'ml' | 'pz'> = {
  g: 'g',
  gr: 'g',
  grammi: 'g',
  ml: 'ml',
  pz: 'pz',
  pezzi: 'pz',
};

/** Da "130g riso/pasta/cous cous" a tre alternative da 130 g. */
function expandAlternatives(chunk: string): DraftFood[] {
  const raw = chunk.trim();
  if (!raw) return [];

  // Quantità in testa ("130g riso") oppure in coda ("riso 130g").
  const lead = raw.match(/^(\d+(?:[.,]\d+)?)\s*([a-z]+)?\s*(?:di\s+)?(.*)$/i);
  const trail = raw.match(/^(.*?)\s+(\d+(?:[.,]\d+)?)\s*([a-z]+)\s*$/i);

  let qty: number | null = null;
  let unit: 'g' | 'ml' | 'pz' | null = null;
  let rest = raw;

  if (lead && UNITS[(lead[2] ?? '').toLowerCase()]) {
    qty = Number(lead[1].replace(',', '.'));
    unit = UNITS[lead[2].toLowerCase()];
    rest = lead[3];
  } else if (lead && lead[1] && !UNITS[(lead[2] ?? '').toLowerCase()]) {
    qty = Number(lead[1].replace(',', '.'));
    unit = 'pz';
    rest = [lead[2], lead[3]].filter(Boolean).join(' ');
  } else if (trail && UNITS[(trail[3] ?? '').toLowerCase()]) {
    qty = Number(trail[2].replace(',', '.'));
    unit = UNITS[trail[3].toLowerCase()];
    rest = trail[1];
  }

  // Nomi separati da "/" condividono la stessa quantità.
  return rest
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((label) => ({ label: label.replace(/\s+/g, ' '), qty, unit, raw }));
}

function slotsFromLine(line: string, index: number): DraftSlot[] {
  return line
    .split(/\s*\+\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((component, i) => {
      const options = component
        .split(/\s+(?:o|oppure)\s+/i)
        .flatMap(expandAlternatives)
        .filter((f) => f.label.length > 1);

      let ultima: { qty: number; unit: 'g' | 'ml' | 'pz' } | null = null;
      for (const opt of options) {
        if (opt.qty !== null && opt.unit !== null) {
          ultima = { qty: opt.qty, unit: opt.unit };
        } else if (ultima) {
          opt.qty = ultima.qty;
          opt.unit = ultima.unit;
          opt.raw = `${opt.raw} (quantità ereditata da "${component.trim()}")`;
        }
      }

      return {
        id: `slot-${index}-${i}`,
        label: options.length > 1 ? 'Scegli una fonte' : 'Componente',
        options,
      };
    })
    .filter((s) => s.options.length > 0);
}

export function draftFromText(text: string): Draft {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const meals: DraftMeal[] = [];
  const generalRules: string[] = [];
  const unparsed: string[] = [];
  const warnings: string[] = [];

  let current: DraftMeal | null = null;
  let lineIndex = 0;
  let patientName: string | null = null;

  for (const line of lines) {
    const anagrafica = line.match(/^(?:paziente|nome|assistit[oa])\s*:\s*(.+)$/i);
    if (anagrafica) {
      patientName ??= anagrafica[1].trim();
      continue;
    }

    const head = line.match(MEAL_HEAD);
    if (head) {
      current = {
        id: `pasto-${meals.length + 1}`,
        label: head[1].trim().replace(/^\w/, (c) => c.toUpperCase()),
        slots: [],
      };
      meals.push(current);
      continue;
    }

    if (RULE_WORDS.test(line) && !/\d+\s*(g|gr|ml)\b/i.test(line)) {
      generalRules.push(line);
      continue;
    }

    const slots = slotsFromLine(line, lineIndex++);
    if (slots.length === 0) {
      unparsed.push(line);
      continue;
    }
    if (!current) {
      current = { id: `pasto-${meals.length + 1}`, label: 'Pasto senza titolo', slots: [] };
      meals.push(current);
      warnings.push(
        'Alcuni alimenti compaiono prima di qualsiasi intestazione di pasto: ' +
          'sono stati raggruppati in "Pasto senza titolo", da assegnare a mano.',
      );
    }
    current.slots.push(...slots);
  }

  if (meals.length === 0) {
    warnings.push('Non è stato riconosciuto nessun pasto: il piano va inserito a mano.');
  }
  const senzaQuantita = meals
    .flatMap((m) => m.slots)
    .flatMap((s) => s.options)
    .filter((o) => o.qty === null && !o.freeQuantity).length;
  if (senzaQuantita > 0) {
    warnings.push(
      `${senzaQuantita} alimenti sono senza quantità: completali, oppure segnali come ` +
        `"q.b." se il piano non prescrive un peso.`,
    );
  }

  return { patientName, meals, generalRules, unparsed, warnings };
}

/* Dalla bozza confermata al piano */

import type { NutritionPlan, MealTemplate } from '../types.ts';

export interface ConfirmInput {
  key: string;
  patientName: string;
  professionalId: string;
  professionalName: string;
  issuedAt: string;
  weighingNote: string;
  draft: Draft;
}

export function planFromDraft(input: ConfirmInput): NutritionPlan {
  const buchi = input.draft.meals
    .flatMap((m) => m.slots.flatMap((s) => s.options.map((o) => ({ m, s, o }))))
    .filter((x) => !x.o.freeQuantity && (x.o.qty === null || x.o.unit === null));

  if (buchi.length > 0) {
    throw new Error(
      `Mancano le quantità di: ${buchi
        .slice(0, 5)
        .map((x) => `"${x.o.label}" (${x.m.label})`)
        .join(', ')}${buchi.length > 5 ? ` e altri ${buchi.length - 5}` : ''}.`,
    );
  }

  const meals: MealTemplate[] = input.draft.meals.map((m) => ({
    id: m.id,
    label: m.label,
    slots: m.slots.map((s) => ({
      id: s.id,
      label: s.label,
      options: s.options.map((o) => ({
        id: `${s.id}-${o.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        label: o.label,
        qty: o.freeQuantity ? 0 : o.qty!,
        unit: o.freeQuantity ? (o.unit ?? 'g') : o.unit!,
        ...(o.freeQuantity ? { freeQuantity: true } : {}),
        shoppingCategory: 'Da classificare',
      })),
    })),
  }));

  return {
    id: input.key,
    patient: { name: input.patientName },
    professional: { id: input.professionalId, name: input.professionalName },
    issuedAt: input.issuedAt,
    weighingNote: input.weighingNote,
    meals,
    generalRules: input.draft.generalRules,
    supplements: [],
    frequencies: [],
    structure: {
      fixedMeals: [],
      allDifferentMeals: [],
      repeatPatterns: [],
      freeMeals: 0,
      freeMealDefaultMeal: '',
      alcoholUnitsMax: 0,
      waterLitersPerDay: 0,
      waterLitersTrainingDay: 0,
      softPreferences: [],
    },
  };
}
