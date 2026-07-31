/**
 * Server di anteprima — NON è il prodotto.
 *
 * Il prodotto è il Worker in `worker/`, con autenticazione, ruoli e database.
 * Questo resta perché serve a un lavoro diverso: guardare il motore da solo,
 * senza account e senza D1, quando si sta lavorando su generatore, validatore o
 * sostituzioni. Zero dipendenze: `node:http` più i file statici in `prototipo/`.
 *
 *   node src/server.ts     →  http://localhost:4000
 *
 * È volutamente SENZA STATO: la settimana è funzione del seed e dei parametri,
 * quindi ogni richiesta la ricompone identica. Non serve un database per
 * guardare un'interfaccia, e non averlo evita di illudersi che il prodotto sia
 * più avanti di dov'è.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as store from './store.ts';
import * as assistant from './core/assistant.ts';
import * as llm from './core/llm.ts';
import { draftFromText, planFromDraft } from './core/import.ts';
import {
  activateRule,
  deactivateRule,
  proposeRules,
  upsertRules,
} from './style/profile.ts';
import type { Correction } from './style/profile.ts';
import { generateWeek } from './core/generator.ts';
import { validate } from './core/validator.ts';
import { buildShoppingList } from './core/shopping.ts';
import { buildMealPrep } from './core/mealprep.ts';
import { substitutionsFor } from './core/substitutions.ts';
import { replan } from './core/replan.ts';
import {
  allMealTemplates,
  canGenerateWeek,
  checkPlanIntegrity,
  planMode,
  portionDerivations,
  variantLabelForDay,
} from './core/plan.ts';
import { tagCountInDay, tagCountInWeek } from './core/validator.ts';
import type { NutritionPlan, WeekPlan } from './types.ts';

const WEB_DIR = fileURLToPath(new URL('../prototipo/', import.meta.url));
const PORT = Number(process.env.PORT ?? 4000);

/** I piani vivono nello store: quelli di collaudo sono solo i primi tre. */
async function getPlan(key: string): Promise<NutritionPlan> {
  const entry = await store.findPlan(key);
  if (!entry) throw new HttpError(404, `Piano "${key}" sconosciuto.`);
  return entry.plan;
}

/* ------------------------------------------------------------------ */
/* Composizione delle risposte                                         */
/* ------------------------------------------------------------------ */

function parseDayMeal(token: string | null): { day: number; meal: string }[] {
  if (!token) return [];
  return token
    .split(',')
    .filter(Boolean)
    .map((piece) => {
      const [d, m] = piece.split(':');
      return { day: Number(d), meal: m };
    })
    .filter((x) => Number.isInteger(x.day) && x.day >= 0 && x.day <= 6 && !!x.meal);
}

interface WeekRequest {
  plan: NutritionPlan;
  key: string;
  seed: number;
  libero: { day: number; meal: string } | undefined;
  fuori: { day: number; meal: string }[];
  alcol: number;
  opzionali: string[];
}

async function readWeekRequest(params: URLSearchParams): Promise<WeekRequest> {
  const key = params.get('piano') ?? 'demarco';
  const plan = await getPlan(key);

  return {
    plan,
    key,
    seed: Number(params.get('seed') ?? 1) || 1,
    libero: parseDayMeal(params.get('libero'))[0],
    fuori: parseDayMeal(params.get('fuori')),
    alcol: Number(params.get('alcol') ?? 0) || 0,
    opzionali: (params.get('opzionali') ?? '').split(',').filter(Boolean),
  };
}

function buildWeek(req: WeekRequest): WeekPlan {
  return generateWeek(req.plan, {
    seed: req.seed,
    freeMeal: req.libero ?? 'auto',
    external: req.fuori.map((f) => ({ ...f, note: 'Pasto fuori casa' })),
    alcoholUnits: req.alcol,
    includeOptional: req.opzionali,
  }).week;
}

/**
 * La settimana che il client sta guardando, ricostruita in UN SOLO posto.
 *
 * Senza questo, la tabella verrebbe da una via (ripianificazione) e l'elenco
 * delle sostituzioni da un'altra (rigenerazione): due settimane diverse, e
 * alternative calcolate su un piatto che l'utente non ha davanti.
 */
function resolveWeek(
  req: WeekRequest,
  params: URLSearchParams,
): { week: WeekPlan; changes: string[]; keptDays: number[] } {
  const eventi = parseDayMeal(params.get('eventi'));
  const base = buildWeek(req);
  if (eventi.length === 0) return { week: base, changes: [], keptDays: [] };

  const fromDay = Number(params.get('da') ?? 0) || 0;
  const result = replan(req.plan, base, {
    fromDay,
    seed: req.seed,
    events: eventi.map((e) => ({ type: 'fuori' as const, ...e, note: 'Pasto fuori casa' })),
  });
  return { week: result.week, changes: result.changes, keptDays: result.keptDays };
}

/** Riepilogo dei vincoli, già pronto da mostrare. */
function constraintRows(plan: NutritionPlan, week: WeekPlan) {
  const rows = plan.frequencies.map((rule) => {
    const name = rule.label ?? rule.tag;
    if (rule.per === 'week') {
      const count = tagCountInWeek(week, rule.tag);
      return {
        name,
        required: rule.min !== undefined ? `≥ ${rule.min}/sett` : `≤ ${rule.max}/sett`,
        actual: String(count),
        ok:
          (rule.min === undefined || count >= rule.min) &&
          (rule.max === undefined || count <= rule.max),
      };
    }
    const perDay = week.days.map((d) => tagCountInDay(d, rule.tag));
    return {
      name,
      required: rule.min !== undefined ? `≥ ${rule.min}/giorno` : `≤ ${rule.max}/giorno`,
      actual: perDay.join(' · '),
      ok: perDay.every(
        (c, i) =>
          (rule.min === undefined ||
            c >= rule.min ||
            week.days[i].meals.some((m) => m.kind !== 'plan')) &&
          (rule.max === undefined || c <= rule.max),
      ),
    };
  });

  const liberi = week.days.flatMap((d) => d.meals.filter((m) => m.kind === 'free')).length;
  if (plan.structure.freeMeals > 0) {
    rows.push({
      name: 'Pasto libero',
      required: `${plan.structure.freeMeals}/sett`,
      actual: String(liberi),
      ok: liberi === plan.structure.freeMeals,
    });
  }
  if (plan.structure.alcoholUnitsMax > 0 || week.alcoholUnits > 0) {
    rows.push({
      name: 'Alcol',
      required: `≤ ${plan.structure.alcoholUnitsMax} unità`,
      actual: String(week.alcoholUnits),
      ok: week.alcoholUnits <= plan.structure.alcoholUnitsMax,
    });
  }
  return rows;
}

function planSummary(key: string, plan: NutritionPlan) {
  const mode = planMode(plan);
  return {
    key,
    id: plan.id,
    mode,
    patient: plan.patient,
    professional: plan.professional,
    issuedAt: plan.issuedAt,
    weighingNote: plan.weighingNote,
    generalRules: plan.generalRules,
    supplements: plan.supplements,
    canGenerate: canGenerateWeek(plan),
    hasFreeMeal: plan.structure.freeMeals > 0,
    issues: checkPlanIntegrity(plan),
    macro: plan.macro ?? null,
    hasVariants: (plan.variants?.length ?? 0) > 0,
    meals: mode === 'prescrittivo' ? allMealTemplates(plan).map((m) => ({ id: m.id, label: m.label })) : [],
    optionalMeals:
      mode === 'prescrittivo'
        ? allMealTemplates(plan)
            .filter((m) => m.optional)
            .map((m) => ({ id: m.id, label: m.label, note: m.placementNote ?? null }))
        : [],
    derivations: portionDerivations(plan),
  };
}

/** Aggiunge a ogni pasto lo slot di provenienza, per l'interfaccia. */
function decorateWeek(plan: NutritionPlan, week: WeekPlan) {
  return {
    ...week,
    days: week.days.map((day) => ({
      ...day,
      variant: variantLabelForDay(plan, day.index) ?? null,
      meals: day.meals.map((meal) => ({
        ...meal,
        items: meal.items.map((it) => ({
          slotId: it.slotId,
          label: it.food.label,
          qty: it.food.qty,
          unit: it.food.unit,
          qtyMax: it.food.qtyMax ?? null,
          freeQuantity: it.food.freeQuantity === true,
        })),
      })),
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Routing                                                             */
/* ------------------------------------------------------------------ */

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

async function handleApi(
  pathname: string,
  params: URLSearchParams,
  body: any,
): Promise<unknown> {
  if (pathname === '/api/piani') {
    const s = await store.load();
    return s.plans.map((entry) => {
      const issues = checkPlanIntegrity(entry.plan);
      return {
        key: entry.key,
        label: entry.plan.patient.name,
        professional: entry.plan.professional.name,
        professionalId: entry.plan.professional.id,
        mode: planMode(entry.plan),
        builtin: entry.builtin,
        createdAt: entry.createdAt,
        errors: issues.filter((i) => i.severity === 'errore').length,
        warnings: issues.filter((i) => i.severity === 'avviso').length,
        meals: (entry.plan.meals?.length ?? entry.plan.variants?.[0]?.meals.length ?? 0),
      };
    });
  }

  if (pathname === '/api/piano') {
    const key = params.get('piano') ?? 'demarco';
    return planSummary(key, await getPlan(key));
  }

  /* ---------- caricamento di un piano nuovo ---------- */

  if (pathname === '/api/bozza') {
    const text = String(body?.testo ?? '');
    if (text.trim().length < 20) {
      throw new HttpError(400, 'Incolla il testo del piano: servono almeno poche righe.');
    }
    return draftFromText(text);
  }

  if (pathname === '/api/conferma') {
    const { key, patientName, professionalId, professionalName, issuedAt, weighingNote, draft } =
      body ?? {};
    if (!key || !patientName || !professionalId) {
      throw new HttpError(400, 'Servono almeno chiave, nome del paziente e professionista.');
    }
    if (await store.findPlan(key)) {
      throw new HttpError(409, `Esiste già un piano con la chiave "${key}".`);
    }

    let plan;
    try {
      plan = planFromDraft({
        key,
        patientName,
        professionalId,
        professionalName: professionalName ?? professionalId,
        issuedAt: issuedAt ?? new Date().toISOString().slice(0, 10),
        weighingNote: weighingNote ?? '',
        draft,
      });
    } catch (error) {
      throw new HttpError(400, (error as Error).message);
    }

    await store.upsertPlan({
      key,
      plan,
      builtin: false,
      createdAt: new Date().toISOString().slice(0, 10),
      confirmedBy: professionalName ?? professionalId,
    });

    // Le correzioni fatte in fase di conferma sono il carburante del profilo
    // di stile: vanno registrate SEMPRE, anche prima di saperle usare.
    const corrections: Correction[] = (body.correzioni ?? []).map((c: any, i: number) => ({
      id: `${key}-${i}`,
      professionalId,
      planId: key,
      at: new Date().toISOString(),
      scope: c.scope ?? 'preferenza',
      key: c.key ?? 'generica',
      before: String(c.before ?? ''),
      after: String(c.after ?? ''),
    }));
    await store.addCorrections(corrections);

    return { key, issues: checkPlanIntegrity(plan), corrections: corrections.length };
  }

  if (pathname === '/api/elimina') {
    await store.removePlan(String(body?.key ?? ''));
    return { ok: true };
  }

  /* ---------- profilo di stile ---------- */

  if (pathname === '/api/metodo') {
    const profId = params.get('prof') ?? body?.prof ?? '';
    let profile = await store.getProfile(profId);
    profile = upsertRules(profile, proposeRules(profile));
    await store.putProfile(profile);

    return {
      professionalId: profId,
      corrections: profile.corrections.length,
      rules: profile.rules,
      recent: profile.corrections.slice(-8).reverse(),
    };
  }

  if (pathname === '/api/metodo/regola') {
    const { prof, ruleId, azione } = body ?? {};
    let profile = await store.getProfile(String(prof));
    profile = azione === 'attiva' ? activateRule(profile, ruleId) : deactivateRule(profile, ruleId);
    await store.putProfile(profile);
    return { rules: profile.rules };
  }

  /* ---------- assistente ---------- */

  if (pathname === '/api/assistente/stato') {
    return await llm.status();
  }

  if (pathname === '/api/chat') {
    const key = String(body?.piano ?? 'demarco');
    const question = String(body?.domanda ?? '').trim();
    if (!question) throw new HttpError(400, 'Manca la domanda.');

    const plan = await getPlan(key);
    if (!canGenerateWeek(plan).ok) {
      throw new HttpError(409, canGenerateWeek(plan).reason ?? 'Piano non pianificabile.');
    }

    const req = await readWeekRequest(new URLSearchParams(body?.settimana ?? ''));
    const { week } = resolveWeek(req, new URLSearchParams(body?.settimana ?? ''));

    const now = new Date();
    const today = (now.getDay() + 6) % 7;
    const profile = await store.getProfile(plan.professional.id);
    const ctx = { plan, week, today, profile };

    // 1. Capire la domanda. Con l'AI meglio; senza, le espressioni regolari.
    const meals = allMealTemplates(plan).map((m) => ({ id: m.id, label: m.label }));
    const intent =
      (await llm.interpretWithAi(question, meals, today)) ??
      assistant.interpret(question, plan, today);

    // 2. Risolvere contro il motore. Questa parte non passa MAI dall'AI.
    const reply = assistant.resolve(ctx, intent, now.getHours());

    // 3. Dirlo con la voce del professionista, se l'AI è disponibile.
    const voice = await llm.speakWithVoice(
      reply,
      assistant.styleBrief(plan, profile),
      question,
    );
    if (voice) {
      reply.answer = voice;
      reply.source = 'ai';
    }

    // 4. Quello che il piano non copre torna allo studio, non viene inventato.
    if (reply.flag) {
      await store.addFlag({
        id: `flag-${now.getTime()}`,
        planKey: key,
        professionalId: plan.professional.id,
        patientName: plan.patient.name,
        at: now.toISOString(),
        question,
        reason: reply.flag.reason,
        status: 'aperta',
      });
    }

    return reply;
  }

  if (pathname === '/api/segnalazioni') {
    return await store.listFlags(params.get('piano') ?? undefined);
  }

  if (pathname === '/api/segnalazioni/chiudi') {
    await store.closeFlag(String(body?.id ?? ''));
    return { ok: true };
  }

  if (pathname === '/api/settimana') {
    const req = await readWeekRequest(params);
    const generabile = canGenerateWeek(req.plan);
    if (!generabile.ok) throw new HttpError(409, generabile.reason ?? 'Piano non pianificabile.');

    const { week, changes, keptDays } = resolveWeek(req, params);
    return {
      plan: planSummary(req.key, req.plan),
      week: decorateWeek(req.plan, week),
      validation: validate(req.plan, week),
      constraints: constraintRows(req.plan, week),
      shopping: buildShoppingList(req.plan, week),
      prep: buildMealPrep(req.plan, week),
      changes,
      keptDays,
    };
  }

  if (pathname === '/api/sostituzioni') {
    const req = await readWeekRequest(params);
    const day = Number(params.get('giorno'));
    const mealId = params.get('pasto') ?? '';
    const slotId = params.get('slot') ?? '';
    if (!Number.isInteger(day) || !mealId || !slotId) {
      throw new HttpError(400, 'Servono giorno, pasto e slot.');
    }

    // Stessa settimana che l'utente ha davanti, non una ricomposta a parte.
    const { week } = resolveWeek(req, params);
    const meal = week.days[day]?.meals.find((m) => m.mealId === mealId);
    const current = meal?.items.find((it) => it.slotId === slotId);

    return {
      current: current ? { label: current.food.label, qty: current.food.qty, unit: current.food.unit } : null,
      options: substitutionsFor(req.plan, week, day, mealId, slotId).map((o) => ({
        label: o.label,
        allowed: o.allowed,
        reason: o.reason ?? null,
        affectsDays: o.affectsDays,
      })),
    };
  }

  if (pathname === '/api/ripianifica') {
    const req = await readWeekRequest(params);
    const fromDay = Number(params.get('da') ?? 0);
    const eventi = parseDayMeal(params.get('eventi')).map((e) => ({
      type: 'fuori' as const,
      ...e,
      note: 'Pasto fuori casa',
    }));

    const base = buildWeek(req);
    const result = replan(req.plan, base, { fromDay, events: eventi, seed: req.seed });

    return {
      plan: planSummary(req.key, req.plan),
      week: decorateWeek(req.plan, result.week),
      validation: result.validation,
      constraints: constraintRows(req.plan, result.week),
      shopping: buildShoppingList(req.plan, result.week),
      prep: buildMealPrep(req.plan, result.week),
      keptDays: result.keptDays,
      changes: result.changes,
    };
  }

  throw new HttpError(404, `Endpoint sconosciuto: ${pathname}`);
}

async function serveStatic(pathname: string): Promise<{ body: Buffer; type: string }> {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  // Nessuna risalita fuori da web/: è un server locale, ma le abitudini contano.
  const safe = normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const file = join(WEB_DIR, safe);
  if (!file.startsWith(WEB_DIR)) throw new HttpError(403, 'Percorso non ammesso.');

  try {
    const body = await readFile(file);
    return { body, type: MIME[extname(file)] ?? 'application/octet-stream' };
  } catch {
    throw new HttpError(404, `File non trovato: ${safe}`);
  }
}

async function readBody(req: import('node:http').IncomingMessage): Promise<any> {
  if (req.method !== 'POST') return null;

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    // Un piano incollato è testo: oltre questa soglia è un errore o un abuso.
    if (size > 2_000_000) throw new HttpError(413, 'Contenuto troppo grande.');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return null;

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Corpo della richiesta non è JSON valido.');
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  try {
    if (url.pathname.startsWith('/api/')) {
      const body = await readBody(req);
      const payload = await handleApi(url.pathname, url.searchParams, body);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(payload));
      return;
    }

    const { body, type } = await serveStatic(url.pathname);
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = (error as Error).message;
    if (status === 500) console.error(error);

    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: message }));
  }
});

server.listen(PORT, async () => {
  console.log(`\n  Pianificatore — anteprima su http://localhost:${PORT}\n`);
  const s = await store.load();
  console.log('  Piani in archivio:');
  for (const entry of s.plans) {
    console.log(
      `   · ${entry.key.padEnd(12)} ${entry.plan.patient.name} ` +
        `(${planMode(entry.plan)}${entry.builtin ? ', collaudo' : ''})`,
    );
  }
  console.log('\n  Ctrl+C per fermare.\n');
});
