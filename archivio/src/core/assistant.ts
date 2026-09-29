import type { NutritionPlan, WeekPlan } from '../types.ts';
import { DAY_NAMES } from '../types.ts';
import { mealTemplate, mealsForDay } from './plan.ts';
import { formatQuantity, substitutionsFor } from './substitutions.ts';
import type { StyleProfile } from '../style/profile.ts';

/* Interpretazione della domanda */

export type IntentKind =
  | 'saluto'
  | 'pasto-adesso'
  | 'pasto-giorno'
  | 'sostituzione'
  | 'porzione'
  | 'spesa'
  | 'regola'
  | 'fuori-casa'
  | 'ignoto';

export interface Intent {
  kind: IntentKind;
  /** Giorno di riferimento, se la domanda lo indica. */
  day?: number;
  /** Pasto di riferimento. */
  mealId?: string;
  /** Alimento nominato nella domanda. */
  food?: string;
  /** Argomento della regola richiesta (acqua, alcol, caffè…). */
  topic?: string;
}

const NORM = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const GIORNI: Record<string, number> = {
  lunedi: 0, martedi: 1, mercoledi: 2, giovedi: 3,
  venerdi: 4, sabato: 5, domenica: 6,
};

export function interpret(question: string, plan: NutritionPlan, today: number): Intent {
  const q = NORM(question);

  if (/^(ciao|buongiorno|buonasera|salve|ehi|hey)\b/.test(q) && q.length < 25) {
    return { kind: 'saluto' };
  }

  // Giorno citato esplicitamente, altrimenti oggi.
  let day = today;
  for (const [nome, idx] of Object.entries(GIORNI)) {
    if (q.includes(nome)) day = idx;
  }
  if (/\bdomani\b/.test(q)) day = (today + 1) % 7;
  if (/\bieri\b/.test(q)) day = (today + 6) % 7;

  // Pasto citato: si cerca sull'elenco reale del piano.
  let mealId: string | undefined;
  for (const tpl of mealsForDay(plan, day)) {
    if (q.includes(NORM(tpl.label))) mealId = tpl.id;
  }
  if (!mealId) {
    if (/\bstaser|\bcena\b/.test(q)) mealId = findMeal(plan, day, /cena|pasto 5/i);
    else if (/\bpranzo\b/.test(q)) mealId = findMeal(plan, day, /pranzo|pasto 3/i);
    else if (/\bcolazione\b/.test(q)) mealId = findMeal(plan, day, /colazione|pasto 1/i);
  }

  if (/\b(fuori|ristorante|invitat\w*|mangio fuori|non ci sono)\b/.test(q)) {
    return { kind: 'fuori-casa', day, mealId };
  }
  if (/\b(sostitu\w*|posso mettere|al posto|invece d\w+|cambiar\w*|scambiar\w*)/.test(q)) {
    return { kind: 'sostituzione', day, mealId, food: extractFood(q, plan, day) };
  }
  if (/\b(spesa|comprare|supermercato|lista)\b/.test(q)) {
    return { kind: 'spesa' };
  }
  if (/\b(acqua|alcol|vino|birra|caffe|te|tisana|libero|creatina|integrator|sale)\b/.test(q)) {
    return { kind: 'regola', topic: q, day };
  }
  if (/\b(quant\w*|pes\w*|grammi|crudo|cotto)\b/.test(q)) {
    return { kind: 'porzione', day, mealId, food: extractFood(q, plan, day) };
  }
  if (/\b(cosa mangio|che mangio|cosa devo mangiare|adesso|ora|prossimo pasto)\b/.test(q)) {
    return { kind: mealId ? 'pasto-giorno' : 'pasto-adesso', day, mealId };
  }
  if (/\b(cosa|che cosa|mangio|menu|giornata)\b/.test(q)) {
    return { kind: 'pasto-giorno', day, mealId };
  }

  return { kind: 'ignoto' };
}

function findMeal(plan: NutritionPlan, day: number, re: RegExp): string | undefined {
  return mealsForDay(plan, day).find((m) => re.test(m.label))?.id;
}

/** Cerca nella domanda un alimento che esista davvero nel piano di quel giorno. */
function extractFood(q: string, plan: NutritionPlan, day: number): string | undefined {
  let best: string | undefined;
  for (const tpl of mealsForDay(plan, day)) {
    for (const slot of tpl.slots) {
      for (const opt of slot.options) {
        const label = NORM(opt.label);
        if (label.length > 2 && q.includes(label)) {
          if (!best || label.length > NORM(best).length) best = opt.label;
        }
      }
    }
  }
  return best;
}

/* Risoluzione */

export interface AssistantCard {
  kind: 'pasto' | 'alternative' | 'elenco';
  title: string;
  day?: number;
  mealId?: string;
  items?: { label: string; qty: string; slotId?: string }[];
  options?: { label: string; allowed: boolean; reason?: string }[];
  lines?: string[];
}

export interface AssistantFlag {
  reason: string;
  question: string;
}

export interface AssistantReply {
  answer: string;
  cards: AssistantCard[];
  /** Le regole del piano su cui poggia la risposta. */
  citations: string[];
  flag?: AssistantFlag;
  source: 'motore' | 'ai';
  intent: Intent;
}

export interface AssistantContext {
  plan: NutritionPlan;
  week: WeekPlan;
  today: number;
  profile?: StyleProfile;
}

/** Come si chiama il professionista quando l'assistente lo cita. */
function professional(plan: NutritionPlan): string {
  return plan.professional.name;
}

/** Regole attive apprese dal professionista, in forma di frasi. */
function learnedRules(profile?: StyleProfile): string[] {
  return (profile?.rules ?? [])
    .filter((r) => r.status === 'attiva')
    .map((r) => r.preference?.description ?? r.description);
}

function describeMealCard(ctx: AssistantContext, day: number, mealId: string): AssistantCard | null {
  const tpl = mealTemplate(ctx.plan, day, mealId);
  const meal = ctx.week.days[day]?.meals.find((m) => m.mealId === mealId);
  if (!tpl || !meal) return null;

  if (meal.kind === 'free') {
    return { kind: 'pasto', title: `${DAY_NAMES[day]} · ${tpl.label}`, day, mealId, lines: ['Pasto libero'] };
  }
  if (meal.kind === 'external') {
    return {
      kind: 'pasto',
      title: `${DAY_NAMES[day]} · ${tpl.label}`,
      day,
      mealId,
      lines: [meal.note ?? 'Fuori casa'],
    };
  }

  return {
    kind: 'pasto',
    title: `${DAY_NAMES[day]} · ${tpl.label}`,
    day,
    mealId,
    items: meal.items.map((i) => ({
      label: i.food.label,
      qty: formatQuantity(i.food),
      slotId: i.slotId,
    })),
  };
}

/** Il pasto che viene "adesso", per posizione nella giornata. */
function nextMeal(ctx: AssistantContext, hour: number): { day: number; mealId: string } | null {
  const meals = mealsForDay(ctx.plan, ctx.today).filter((tpl) =>
    ctx.week.days[ctx.today].meals.some((m) => m.mealId === tpl.id),
  );
  if (meals.length === 0) return null;

  const step = meals.length > 1 ? 13 / (meals.length - 1) : 0;
  const idx = meals.findIndex((_, i) => Math.round(8 + i * step) >= hour);
  return { day: ctx.today, mealId: meals[idx >= 0 ? idx : meals.length - 1].id };
}

export function resolve(ctx: AssistantContext, intent: Intent, hour: number): AssistantReply {
  const P = professional(ctx.plan);
  const cards: AssistantCard[] = [];
  const citations: string[] = [];
  const base = { cards, citations, source: 'motore' as const, intent };

  switch (intent.kind) {
    case 'saluto': {
      const oggi = DAY_NAMES[ctx.today];
      const allenamento = ctx.week.days[ctx.today].training;
      const acqua = allenamento
        ? ctx.plan.structure.waterLitersTrainingDay
        : ctx.plan.structure.waterLitersPerDay;
      if (acqua > 0) citations.push(`Acqua: ${acqua} L${allenamento ? ' (giorno di allenamento)' : ''}`);

      return {
        ...base,
        answer:
          `Ciao. Oggi è ${oggi}${allenamento ? ', giornata di allenamento' : ''}.` +
          (acqua > 0 ? ` Ricordati ${acqua} L d'acqua.` : '') +
          ` Chiedimi pure cosa mangi adesso, o se puoi sostituire qualcosa.`,
      };
    }

    case 'pasto-adesso': {
      const next = nextMeal(ctx, hour);
      if (!next) return { ...base, answer: 'Per oggi non trovo pasti nel piano.' };
      const card = describeMealCard(ctx, next.day, next.mealId);
      if (card) cards.push(card);
      if (ctx.plan.weighingNote) citations.push(ctx.plan.weighingNote);

      return { ...base, answer: `Il prossimo pasto è ${card?.title.split(' · ')[1] ?? 'questo'}.` };
    }

    case 'pasto-giorno': {
      const day = intent.day ?? ctx.today;
      if (intent.mealId) {
        const card = describeMealCard(ctx, day, intent.mealId);
        if (!card) {
          return {
            ...base,
            answer: `Quel pasto non è previsto ${DAY_NAMES[day].toLowerCase()} dal piano.`,
          };
        }
        cards.push(card);
        if (ctx.plan.weighingNote) citations.push(ctx.plan.weighingNote);
        return { ...base, answer: `Ecco ${card.title.toLowerCase()}.` };
      }

      for (const tpl of mealsForDay(ctx.plan, day)) {
        const card = describeMealCard(ctx, day, tpl.id);
        if (card) cards.push(card);
      }
      if (ctx.plan.weighingNote) citations.push(ctx.plan.weighingNote);
      return { ...base, answer: `Ecco la giornata di ${DAY_NAMES[day].toLowerCase()}.` };
    }

    case 'sostituzione': {
      const day = intent.day ?? ctx.today;
      const found = locate(ctx, day, intent.food, intent.mealId);
      if (!found) {
        return {
          ...base,
          answer:
            `Non ho capito quale alimento vuoi sostituire. Dimmi il pasto ` +
            `(per esempio “il pranzo di oggi”) e cosa vuoi cambiare.`,
        };
      }

      const options = substitutionsFor(ctx.plan, ctx.week, found.day, found.mealId, found.slotId);
      const ammesse = options.filter((o) => o.allowed);
      const tpl = mealTemplate(ctx.plan, found.day, found.mealId);

      cards.push({
        kind: 'alternative',
        title: `Al posto di ${found.label}`,
        day: found.day,
        mealId: found.mealId,
        options: options.map((o) => ({
          label: o.label.replace(/\*\(([^)]*)\)\*/g, '($1)'),
          allowed: o.allowed,
          reason: o.reason,
        })),
      });

      const altriGiorni = (options[0]?.affectsDays ?? []).filter((d) => d !== found.day);
      if (altriGiorni.length > 0) {
        citations.push(
          `Il piano tiene appaiati questi giorni: la sostituzione vale anche per ` +
            `${altriGiorni.map((d) => DAY_NAMES[d]).join(' e ')}.`,
        );
      }
      for (const r of learnedRules(ctx.profile)) citations.push(r);

      return {
        ...base,
        answer:
          `Sì, ${found.label} si può cambiare: ${ammesse.length} alternative ammesse su ` +
          `${options.length} in ${tpl?.label.toLowerCase() ?? 'questo pasto'}. ` +
          `Le altre romperebbero un vincolo del piano di ${P}.`,
      };
    }

    case 'porzione': {
      const day = intent.day ?? ctx.today;
      const found = locate(ctx, day, intent.food, intent.mealId);
      if (found) {
        if (ctx.plan.weighingNote) citations.push(ctx.plan.weighingNote);
        return { ...base, answer: `${found.label}: ${found.qty}. ${ctx.plan.weighingNote}` };
      }

      const fromPlan = intent.food ? portionsInPlan(ctx.plan, intent.food) : [];
      if (fromPlan.length > 0) {
        if (ctx.plan.weighingNote) citations.push(ctx.plan.weighingNote);
        const unici = [...new Set(fromPlan.map((p) => `${p.qty} (${p.meal.toLowerCase()})`))];
        return {
          ...base,
          answer:
            `${fromPlan[0].label}: ${unici.join(', ')}. ${ctx.plan.weighingNote} ` +
            `Questa settimana non è in programma, ma resta previsto dal piano.`,
        };
      }

      return { ...base, answer: 'Dimmi quale alimento e di quale pasto, così ti do il peso esatto.' };
    }

    case 'spesa':
      return {
        ...base,
        answer: 'La lista della spesa completa è nella scheda “Spesa”, aggiornata su questa settimana.',
      };

    case 'regola': {
      const q = NORM(intent.topic ?? '');
      const VUOTE = new Set([
        'posso', 'puoi', 'devo', 'bere', 'mangiare', 'prendere', 'fare',
        'quanto', 'quanta', 'quando', 'come', 'cosa', 'oggi', 'domani',
        'questo', 'questa', 'della', 'delle', 'degli', 'nella', 'sono',
      ]);
      const parole = q.split(' ').filter((w) => w.length > 3 && !VUOTE.has(w));

      const regole = ctx.plan.generalRules
        .map((r) => ({ r, score: parole.filter((w) => NORM(r).includes(w)).length }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.r);
      const apprese = learnedRules(ctx.profile);

      if (regole.length === 0 && apprese.length === 0) {
        return {
          ...base,
          answer: `Su questo il piano di ${P} non dice nulla. Giro la domanda allo studio.`,
          flag: { reason: 'Argomento non coperto dal piano', question: q },
        };
      }
      citations.push(...regole);
      return {
        ...base,
        answer: `Il piano di ${P} dice: ${regole[0] ?? apprese[0]}`,
      };
    }

    case 'fuori-casa': {
      const day = intent.day ?? ctx.today;
      const tpl = intent.mealId ? mealTemplate(ctx.plan, day, intent.mealId) : undefined;
      return {
        ...base,
        answer:
          `Va bene. Segna ${tpl ? tpl.label.toLowerCase() : 'il pasto'} di ` +
          `${DAY_NAMES[day].toLowerCase()} come “fuori casa” dalla settimana: ` +
          `riadatto il resto cambiando il minimo indispensabile.`,
      };
    }

    default:
      return {
        ...base,
        answer:
          `Su questo non posso risponderti io: non è qualcosa che il piano di ${P} ` +
          `stabilisce, e non voglio inventare. Ho girato la domanda allo studio.`,
        flag: { reason: 'Domanda fuori dal piano', question: intent.topic ?? '' },
      };
  }
}

/** Trova un alimento nella settimana: quale giorno, quale pasto, quale slot. */
function locate(
  ctx: AssistantContext,
  day: number,
  food?: string,
  mealId?: string,
): { day: number; mealId: string; slotId: string; label: string; qty: string } | null {
  const giorni = [day, ...[...Array(7).keys()].filter((d) => d !== day)];

  for (const d of giorni) {
    for (const meal of ctx.week.days[d]?.meals ?? []) {
      if (meal.kind !== 'plan') continue;
      if (mealId && meal.mealId !== mealId) continue;

      for (const item of meal.items) {
        if (food && NORM(item.food.label) !== NORM(food)) continue;
        if (!food && !mealId) continue;
        return {
          day: d,
          mealId: meal.mealId,
          slotId: item.slotId,
          label: item.food.label,
          qty: formatQuantity(item.food),
        };
      }
    }
    // Senza un alimento preciso ci si ferma al giorno richiesto.
    if (!food) break;
  }
  return null;
}

/** Porzioni previste dal piano per un alimento, anche fuori dalla settimana. */
function portionsInPlan(
  plan: NutritionPlan,
  food: string,
): { label: string; qty: string; meal: string }[] {
  const out: { label: string; qty: string; meal: string }[] = [];
  const target = NORM(food);

  for (let day = 0; day < 7; day++) {
    for (const tpl of mealsForDay(plan, day)) {
      for (const slot of tpl.slots) {
        for (const opt of slot.options) {
          if (NORM(opt.label) !== target) continue;
          if (out.some((o) => o.meal === tpl.label && o.qty === formatQuantity(opt))) continue;
          out.push({ label: opt.label, qty: formatQuantity(opt), meal: tpl.label });
        }
      }
    }
  }
  return out;
}

/* Voce del professionista */

export function styleBrief(plan: NutritionPlan, profile?: StyleProfile): string {
  const parts = [
    `Professionista: ${plan.professional.name}${plan.professional.register ? ` (${plan.professional.register})` : ''}.`,
    `Paziente: ${plan.patient.name}${plan.patient.goal ? `, obiettivo: ${plan.patient.goal}` : ''}.`,
  ];

  if (plan.generalRules.length > 0) {
    parts.push(`Regole scritte dal professionista:\n- ${plan.generalRules.join('\n- ')}`);
  }
  const apprese = learnedRules(profile);
  if (apprese.length > 0) {
    parts.push(`Regole che il professionista ha confermato nel tempo:\n- ${apprese.join('\n- ')}`);
  }
  return parts.join('\n\n');
}
