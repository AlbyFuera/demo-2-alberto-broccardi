/**
 * Generatore della settimana.
 *
 * Non usa modelli linguistici: comporre una settimana rispettando alimenti,
 * quantità, pattern di ripetizione e frequenze è un problema di soddisfacimento
 * di vincoli. In codice è istantaneo, riproducibile e verificabile.
 *
 * Strategia:
 *  1. la settimana viene divisa in "unità di composizione" (un pasto fisso vale
 *     per 7 giorni, una coppia di pranzi per 2, una cena per 1);
 *  2. le frequenze minime vengono PRE-ASSEGNATE alle unità che possono ospitarle,
 *     invece di sperare che escano a caso;
 *  3. le frequenze massime sono un contatore che vieta le scelte in eccesso;
 *  4. si compone, si valida, e se qualcosa non torna si ritenta con un altro seed.
 *
 * Il risultato passa comunque dal validatore prima di essere restituito.
 */

import type {
  ComboRule,
  FoodOption,
  MealTemplate,
  NutritionPlan,
  PlannedDay,
  PlannedItem,
  PlannedMeal,
  Slot,
  ValidationResult,
  WeekPlan,
} from '../types.ts';
import { DAY_NAMES } from '../types.ts';
import { expectedPortion, mealsForDay } from './plan.ts';
import { validate } from './validator.ts';

/* ------------------------------------------------------------------ */
/* PRNG deterministico: stesso seed -> stessa settimana.               */
/* ------------------------------------------------------------------ */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;

function shuffled<T>(arr: readonly T[], rng: Rng): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function weightedPick<T>(items: T[], weights: number[], rng: Rng): T {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return items[Math.floor(rng() * items.length)];
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

export function signatureOf(items: PlannedItem[]): string {
  return items
    .map((i) => `${i.slotId}:${i.food.id}`)
    .sort()
    .join('|');
}

/**
 * Fissa la porzione effettiva di un alimento.
 *
 * Negli slot espressi in nutriente ("50 g di carboidrati") il peso non sta nel
 * piano: va calcolato. Qui viene inciso nell'alimento scelto, così che lista
 * della spesa, tabella e validatore lavorino tutti sullo stesso numero.
 */
function materialize(slot: Slot, food: FoodOption): FoodOption {
  const portion = expectedPortion(slot, food);
  return portion.derived ? { ...food, qty: portion.qty } : food;
}

/* ------------------------------------------------------------------ */
/* Unità di composizione                                               */
/* ------------------------------------------------------------------ */

interface CompositionUnit {
  id: string;
  mealId: string;
  tpl: MealTemplate;
  /** Giorni coperti da questa unità: determina il peso sulle frequenze. */
  days: number[];
  requiredTags: string[];
  /** Unità dello stesso pasto da cui deve differire. */
  mustDifferFrom: string[];
}

/** Giorni raggruppati per regime: senza varianti c'è un solo gruppo. */
function dayGroupsByVariant(plan: NutritionPlan): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  for (let d = 0; d < 7; d++) {
    const key = plan.variants?.length ? (plan.schedule?.[d] ?? '?') : 'unico';
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  return groups;
}

function buildUnits(plan: NutritionPlan, includeOptional: Set<string>): CompositionUnit[] {
  const S = plan.structure;
  const units: CompositionUnit[] = [];
  const byMeal = new Map<string, CompositionUnit[]>();

  for (const [variantKey, days] of dayGroupsByVariant(plan)) {
    for (const tpl of mealsForDay(plan, days[0])) {
      if (tpl.optional && !includeOptional.has(tpl.id)) continue;

      const made: CompositionUnit[] = [];
      // Ogni unità deve avere i PROPRI array: condividerli via spread
      // significherebbe che assegnare "pesce" a una cena lo assegna a tutte.
      const unit = (id: string, unitDays: number[]): CompositionUnit => ({
        id,
        mealId: tpl.id,
        tpl,
        days: unitDays,
        requiredTags: [],
        mustDifferFrom: [],
      });

      if (S.fixedMeals.includes(tpl.id)) {
        // Un pasto "identico tutti i giorni" lo è all'interno del suo regime:
        // due regimi diversi hanno per definizione pasti diversi.
        made.push(unit(`${variantKey}:${tpl.id}#fisso`, days));
      } else {
        const rp = S.repeatPatterns.find((r) => r.meal === tpl.id);
        if (rp) {
          let cursor = 0;
          for (const [gi, size] of rp.pattern.entries()) {
            made.push(
              unit(
                `${variantKey}:${tpl.id}#g${gi}`,
                Array.from({ length: size }, (_, i) => cursor + i),
              ),
            );
            cursor += size;
          }
        } else {
          for (const d of days) made.push(unit(`${variantKey}:${tpl.id}#d${d}`, [d]));
        }
      }

      byMeal.set(tpl.id, [...(byMeal.get(tpl.id) ?? []), ...made]);
      units.push(...made);
    }
  }

  // I pasti "tutti diversi" lo sono sull'intera settimana, anche a cavallo di
  // regimi; i gruppi di un pattern devono differire tra loro.
  for (const [mealId, made] of byMeal) {
    const unique =
      S.allDifferentMeals.includes(mealId) || S.repeatPatterns.some((r) => r.meal === mealId);
    if (!unique) continue;
    for (const u of made) u.mustDifferFrom = made.filter((o) => o.id !== u.id).map((o) => o.id);
  }

  return units;
}

/**
 * Giorni che condividono la stessa composizione di un pasto.
 * Serve alle sostituzioni: cambiare il pranzo del lunedì significa
 * cambiare anche quello del martedì, se il piano li tiene appaiati.
 */
export function unitDaysFor(plan: NutritionPlan, mealId: string, day: number): number[] {
  // Il pasto va incluso anche se facoltativo: se è nel piatto, esiste.
  const unit = buildUnits(plan, new Set([mealId])).find(
    (u) => u.mealId === mealId && u.days.includes(day),
  );
  return unit ? unit.days.slice() : [day];
}

/* ------------------------------------------------------------------ */
/* Capacità: quali unità possono ospitare un certo tag                 */
/* ------------------------------------------------------------------ */

function foodsOfMeal(tpl: MealTemplate): FoodOption[] {
  const out = tpl.slots.flatMap((s) => s.options);
  for (const c of tpl.combos ?? []) for (const p of c.parts) out.push(...p.options);
  return out;
}

function canHost(tpl: MealTemplate, tag: string): boolean {
  return foodsOfMeal(tpl).some((f) => f.tags?.includes(tag));
}

/**
 * Pre-assegna i tag necessari a soddisfare le frequenze minime.
 * Senza questo passaggio "pesce almeno 2 volte" verrebbe soddisfatto solo
 * per fortuna, e il generatore passerebbe il tempo a ritentare.
 */
function assignRequiredTags(plan: NutritionPlan, units: CompositionUnit[], rng: Rng): void {
  for (const rule of plan.frequencies) {
    if (rule.min === undefined || rule.min <= 0) continue;

    const hosts = units.filter((u) => canHost(u.tpl, rule.tag));
    if (hosts.length === 0) continue;

    if (rule.per === 'week') {
      // Copertura settimanale: sommo i giorni finché raggiungo il minimo.
      // Preferisco le unità "leggere" (1 giorno) per non saturare la settimana.
      const pool = shuffled(hosts, rng).sort((a, b) => a.days.length - b.days.length);
      let covered = 0;
      for (const u of pool) {
        if (covered >= rule.min) break;
        if (u.requiredTags.includes(rule.tag)) continue;
        u.requiredTags.push(rule.tag);
        covered += u.days.length;
      }
    } else {
      // Copertura giornaliera: ogni giorno deve essere toccato almeno `min` volte.
      const perDay = new Map<number, number>();
      for (const u of hosts) {
        if (!u.requiredTags.includes(rule.tag)) continue;
        for (const d of u.days) perDay.set(d, (perDay.get(d) ?? 0) + 1);
      }
      for (let d = 0; d < 7; d++) {
        while ((perDay.get(d) ?? 0) < rule.min) {
          // Preferisco l'unità che copre più giorni: una sola scelta risolve
          // il vincolo per l'intera settimana (es. la colazione fissa).
          const cand = shuffled(
            hosts.filter((u) => u.days.includes(d) && !u.requiredTags.includes(rule.tag)),
            rng,
          ).sort((a, b) => b.days.length - a.days.length)[0];
          if (!cand) break;
          cand.requiredTags.push(rule.tag);
          for (const dd of cand.days) perDay.set(dd, (perDay.get(dd) ?? 0) + 1);
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Composizione di un singolo pasto                                    */
/* ------------------------------------------------------------------ */

interface Ctx {
  plan: NutritionPlan;
  rng: Rng;
  /** Occorrenze settimanali già impegnate per ogni tag a massimale. */
  maxCounters: Map<string, number>;
  maxLimits: Map<string, number>;
  /** Quante volte un alimento è già stato usato: spinge la varietà. */
  usage: Map<string, number>;
}

function wouldExceedMax(ctx: Ctx, food: FoodOption, multiplicity: number): boolean {
  for (const tag of food.tags ?? []) {
    const limit = ctx.maxLimits.get(tag);
    if (limit === undefined) continue;
    if ((ctx.maxCounters.get(tag) ?? 0) + multiplicity > limit) return true;
  }
  return false;
}

function registerFood(ctx: Ctx, food: FoodOption, multiplicity: number): void {
  ctx.usage.set(food.id, (ctx.usage.get(food.id) ?? 0) + multiplicity);
  for (const tag of food.tags ?? []) {
    if (ctx.maxLimits.has(tag)) {
      ctx.maxCounters.set(tag, (ctx.maxCounters.get(tag) ?? 0) + multiplicity);
    }
  }
}

function unregisterFood(ctx: Ctx, food: FoodOption, multiplicity: number): void {
  ctx.usage.set(food.id, Math.max(0, (ctx.usage.get(food.id) ?? 0) - multiplicity));
  for (const tag of food.tags ?? []) {
    if (ctx.maxLimits.has(tag)) {
      ctx.maxCounters.set(tag, Math.max(0, (ctx.maxCounters.get(tag) ?? 0) - multiplicity));
    }
  }
}

/** Peso di preferenza: varietà + preferenze morbide del professionista. */
function scoreFood(ctx: Ctx, food: FoodOption, days: number[]): number {
  let w = 1 / (1 + (ctx.usage.get(food.id) ?? 0) * 1.5);

  for (const pref of ctx.plan.structure.softPreferences) {
    const hit =
      pref.foodIds?.includes(food.id) || pref.tags?.some((t) => food.tags?.includes(t)) || false;
    if (!hit) continue;
    const overlap = days.filter((d) => pref.days.includes(d)).length;
    if (overlap === 0) continue;
    const factor = (overlap / days.length) * pref.weight;
    w *= pref.kind === 'avoid' ? 1 / (1 + factor) : 1 + factor;
  }

  return Math.max(w, 1e-6);
}

function composeUnit(ctx: Ctx, unit: CompositionUnit): PlannedItem[] | null {
  const tpl = unit.tpl;
  const mult = unit.days.length;
  const pending = new Set(unit.requiredTags);
  const items: PlannedItem[] = [];
  const coveredSlots = new Set<string>();
  const slotById = new Map(tpl.slots.map((s) => [s.id, s]));

  /* 1. Le combo (es. "cereali + legumi" al posto di carbo+proteine) sono il
        modo più naturale di soddisfare certi tag: le provo per prime. */
  const combos = tpl.combos ?? [];
  const viableParts = (c: ComboRule) =>
    c.parts.map((p) => p.options.filter((o) => !wouldExceedMax(ctx, o, mult)));
  const usable = (c: ComboRule) => viableParts(c).every((opts) => opts.length > 0);
  const helpful = combos.filter((c) =>
    c.parts.some((p) => p.options.some((o) => [...pending].some((t) => o.tags?.includes(t)))),
  );

  let combo: ComboRule | null = null;
  if (helpful.length > 0 && ctx.rng() < 0.85) {
    combo = shuffled(helpful.filter(usable), ctx.rng)[0] ?? null;
  } else if (combos.length > 0 && pending.size === 0) {
    // La probabilità cala man mano che la combo viene riutilizzata: senza
    // questo smorzamento la stessa sostituzione comparirebbe tutta la settimana.
    const used = ctx.usage.get(`combo:${combos[0].id}`) ?? 0;
    if (ctx.rng() < 0.18 / (1 + used)) {
      combo = shuffled(combos.filter(usable), ctx.rng)[0] ?? null;
    }
  }

  if (combo) {
    ctx.usage.set(`combo:${combo.id}`, (ctx.usage.get(`combo:${combo.id}`) ?? 0) + 1);
    for (const part of combo.parts) {
      // Anche dentro la combo si sceglie: "cereali + legumi" non significa
      // sempre lo stesso cereale e sempre gli stessi legumi.
      let pool = part.options.filter((o) => !wouldExceedMax(ctx, o, mult));
      const needed = pool.filter((o) => [...pending].some((t) => o.tags?.includes(t)));
      if (needed.length > 0) pool = needed;
      if (pool.length === 0) return null;

      const chosen = weightedPick(
        pool,
        pool.map((o) => scoreFood(ctx, o, unit.days)),
        ctx.rng,
      );
      const slot = slotById.get(part.slotId);
      items.push({ slotId: part.slotId, food: slot ? materialize(slot, chosen) : chosen });
      coveredSlots.add(part.slotId);
      registerFood(ctx, chosen, mult);
      for (const t of chosen.tags ?? []) pending.delete(t);
    }
    for (const s of combo.replaces) coveredSlots.add(s);
  }

  /* 2. Assegno i tag ancora scoperti agli slot che possono ospitarli,
        partendo da quelli con meno alternative (più vincolati). */
  const openSlots = tpl.slots.filter((s) => !coveredSlots.has(s.id));
  const slotTag = new Map<string, string>();
  for (const tag of pending) {
    const hosts = openSlots
      .filter((s) => !slotTag.has(s.id) && s.options.some((o) => o.tags?.includes(tag)))
      .sort(
        (a, b) =>
          a.options.filter((o) => o.tags?.includes(tag)).length -
          b.options.filter((o) => o.tags?.includes(tag)).length,
      );
    if (hosts.length === 0) return null; // nessuno slot può ospitarlo: unità impossibile
    slotTag.set(hosts[0].id, tag);
  }

  /* 3. Riempio ogni slot rimasto. */
  for (const slot of openSlots) {
    const needTag = slotTag.get(slot.id);
    const howMany = slot.choose ?? 1;

    let pool = slot.options.filter((o) => !wouldExceedMax(ctx, o, mult));
    if (needTag) pool = pool.filter((o) => o.tags?.includes(needTag));

    if (pool.length === 0) {
      if (slot.optional && !needTag) continue;
      // Il vincolo di massimale ha svuotato lo slot: questa unità non è
      // componibile in questo stato. Si ritenta con un altro seed.
      return null;
    }

    for (let k = 0; k < howMany; k++) {
      const candidates = pool.filter((o) => !items.some((it) => it.food.id === o.id));
      if (candidates.length === 0) return null;
      const chosen = weightedPick(
        candidates,
        candidates.map((o) => scoreFood(ctx, o, unit.days)),
        ctx.rng,
      );
      items.push({ slotId: slot.id, food: materialize(slot, chosen) });
      registerFood(ctx, chosen, mult);
      pool = pool.filter((o) => o.id !== chosen.id);
    }
  }

  return items;
}

/* ------------------------------------------------------------------ */
/* Generazione della settimana                                         */
/* ------------------------------------------------------------------ */

export interface ExternalMeal {
  day: number;
  meal: string;
  note?: string;
}

export interface GenerateOptions {
  seed?: number;
  maxAttempts?: number;
  /** Posizione del pasto libero. 'auto' = decide il motore. */
  freeMeal?: { day?: number; meal?: string } | 'auto' | 'none';
  /** Pasti fuori casa: escono dal piano ma restano in tabella. */
  external?: ExternalMeal[];
  alcoholUnits?: number;
  /** Pasti facoltativi che il paziente ha scelto di fare. */
  includeOptional?: string[];
  /**
   * Ripianificazione: mantiene invariati i pasti già consumati.
   * Richiede `previous`.
   */
  keep?: { day: number; meals?: string[] }[];
  previous?: WeekPlan;
}

export interface GenerateResult {
  week: WeekPlan;
  validation: ValidationResult;
  attempts: number;
}

/** Ricava dalle scelte già fatte le composizioni da congelare. */
function frozenCompositions(
  units: CompositionUnit[],
  opts: GenerateOptions,
): Map<string, PlannedItem[]> {
  const frozen = new Map<string, PlannedItem[]>();
  if (!opts.previous || !opts.keep) return frozen;

  for (const keep of opts.keep) {
    const prevDay = opts.previous.days.find((d) => d.index === keep.day);
    if (!prevDay) continue;
    for (const meal of prevDay.meals) {
      if (keep.meals && !keep.meals.includes(meal.mealId)) continue;
      if (meal.kind !== 'plan') continue;
      const unit = units.find((u) => u.mealId === meal.mealId && u.days.includes(keep.day));
      if (unit) frozen.set(unit.id, meal.items);
    }
  }
  return frozen;
}

function attemptWeek(plan: NutritionPlan, seed: number, opts: GenerateOptions): WeekPlan | null {
  const rng = mulberry32(seed);
  const includeOptional = new Set(opts.includeOptional ?? []);
  const units = buildUnits(plan, includeOptional);
  assignRequiredTags(plan, units, rng);

  const maxLimits = new Map<string, number>();
  for (const f of plan.frequencies) {
    if (f.per === 'week' && f.max !== undefined) maxLimits.set(f.tag, f.max);
  }

  const ctx: Ctx = { plan, rng, maxCounters: new Map(), maxLimits, usage: new Map() };

  const frozen = frozenCompositions(units, opts);
  const composed = new Map<string, PlannedItem[]>();

  // Le unità congelate vanno registrate per prime, così i contatori dei
  // massimali tengono conto di ciò che è già stato mangiato.
  for (const unit of units) {
    const items = frozen.get(unit.id);
    if (!items) continue;
    composed.set(unit.id, items);
    for (const it of items) registerFood(ctx, it.food, unit.days.length);
  }

  for (const unit of shuffled(
    units.filter((u) => !composed.has(u.id)),
    rng,
  ).sort((a, b) => b.days.length - a.days.length)) {
    let items: PlannedItem[] | null = null;
    for (let k = 0; k < 40; k++) {
      const candidate = composeUnit(ctx, unit);
      if (!candidate) continue;

      const sig = signatureOf(candidate);
      const clash = unit.mustDifferFrom.some((otherId) => {
        const other = composed.get(otherId);
        return other && signatureOf(other) === sig;
      });
      if (clash) {
        // Rollback dei contatori: questa composizione viene scartata.
        for (const it of candidate) unregisterFood(ctx, it.food, unit.days.length);
        continue;
      }
      items = candidate;
      break;
    }
    if (!items) return null;
    composed.set(unit.id, items);
  }

  /* Costruzione dei giorni. */
  const days: PlannedDay[] = [];
  for (let d = 0; d < 7; d++) {
    const meals: PlannedMeal[] = [];
    for (const tpl of mealsForDay(plan, d)) {
      if (tpl.optional && !includeOptional.has(tpl.id)) continue;
      const unit = units.find((u) => u.mealId === tpl.id && u.days.includes(d));
      if (!unit) continue;
      const source = composed.get(unit.id)!;
      // Ogni giorno riceve la PROPRIA copia: un'unità copre più giorni, e
      // condividere l'array significherebbe che modificare il pranzo di lunedì
      // cambia in silenzio anche quello di martedì.
      const items = source.map((it) => ({ ...it }));
      meals.push({ mealId: tpl.id, kind: 'plan', items, signature: signatureOf(items) });
    }
    days.push({
      index: d,
      name: DAY_NAMES[d],
      training: plan.patient.trainingDays?.includes(d) ?? false,
      meals,
    });
  }

  const week: WeekPlan = { planId: plan.id, seed, days, alcoholUnits: opts.alcoholUnits ?? 0 };

  applyExternal(week, opts.external ?? []);
  if (!applyFreeMeal(plan, week, rng, opts)) return null;

  return week;
}

function applyExternal(week: WeekPlan, external: ExternalMeal[]): void {
  for (const ext of external) {
    const day = week.days.find((d) => d.index === ext.day);
    const meal = day?.meals.find((m) => m.mealId === ext.meal);
    if (!meal) continue;
    meal.kind = 'external';
    meal.items = [];
    meal.signature = `FUORI#${ext.day}#${ext.meal}`;
    meal.note = ext.note ?? 'Pasto fuori casa';
  }
}

function applyFreeMeal(
  plan: NutritionPlan,
  week: WeekPlan,
  rng: Rng,
  opts: GenerateOptions,
): boolean {
  const S = plan.structure;
  if (opts.freeMeal === 'none' || S.freeMeals === 0) return true;

  const request = opts.freeMeal === 'auto' || opts.freeMeal === undefined ? {} : opts.freeMeal;
  const mealId = request.meal ?? S.freeMealDefaultMeal;

  const forbidden = (day: number) =>
    (S.freeMealForbidden ?? []).some(
      (r) =>
        (r.meal === undefined || r.meal === mealId) &&
        (r.days === undefined || r.days.includes(day)),
    );

  const isFree = (day: number) => {
    const meal = week.days[day].meals.find((m) => m.mealId === mealId);
    return meal !== undefined && meal.kind === 'plan';
  };

  let day: number | undefined = request.day;
  if (day === undefined) {
    // Di default il pasto libero sta nel fine settimana, dove è più realistico.
    const preferred = shuffled([5, 6, 4], rng).filter((d) => !forbidden(d) && isFree(d));
    const fallback = shuffled([0, 1, 2, 3], rng).filter((d) => !forbidden(d) && isFree(d));
    day = preferred[0] ?? fallback[0];
  }
  if (day === undefined || forbidden(day) || !isFree(day)) return false;

  const meal = week.days[day].meals.find((m) => m.mealId === mealId)!;
  meal.kind = 'free';
  meal.items = [];
  meal.signature = `LIBERO#${day}#${mealId}`;
  meal.note = 'Pasto libero';
  return true;
}

export function generateWeek(plan: NutritionPlan, opts: GenerateOptions = {}): GenerateResult {
  const baseSeed = opts.seed ?? 1;
  const maxAttempts = opts.maxAttempts ?? 300;

  let best: { week: WeekPlan; validation: ValidationResult } | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Il seed deriva dal seed base: stessa richiesta -> stessa settimana.
    const week = attemptWeek(plan, (baseSeed * 7919 + attempt * 104729) >>> 0, opts);
    if (!week) continue;

    const validation = validate(plan, week);
    if (validation.ok) return { week, validation, attempts: attempt + 1 };

    if (!best || validation.errors.length < best.validation.errors.length) {
      best = { week, validation };
    }
  }

  if (!best) {
    throw new Error(
      'Impossibile comporre una settimana con questo piano: i vincoli sono in ' +
        'contraddizione tra loro. Controlla frequenze minime e massime.',
    );
  }
  return { ...best, attempts: maxAttempts };
}
