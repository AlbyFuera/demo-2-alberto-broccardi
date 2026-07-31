/**
 * Persistenza minima su file JSON.
 *
 * Non è un database e non finge di esserlo: serve perché l'onboarding, il
 * registro delle correzioni e il profilo di stile abbiano senso: uno strumento
 * che dimentica tutto a ogni riavvio non può imparare il metodo di nessuno.
 *
 * Quando si passerà a un database vero cambia solo questo file — il resto del
 * codice non sa dove finiscono i dati.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { NutritionPlan } from './types.ts';
import type { Correction, StyleProfile } from './style/profile.ts';
import { emptyProfile } from './style/profile.ts';
import { pianoDeMarco } from './data/piano-demarco.ts';
import { pianoAlimAB } from './data/piano-alim-ab.ts';
import { pianoMacro } from './data/piano-macro.ts';

const DATA_DIR = fileURLToPath(new URL('../data/', import.meta.url));
const FILE = join(DATA_DIR, 'store.json');

export interface StoredPlan {
  key: string;
  plan: NutritionPlan;
  /** I tre piani di collaudo non si cancellano né si modificano. */
  builtin: boolean;
  /** ISO. Fornito dal chiamante: il modulo non inventa timestamp. */
  createdAt: string;
  confirmedBy: string | null;
}

/**
 * Domanda che l'assistente non ha saputo risolvere dal piano.
 *
 * È il canale che riporta il paziente al professionista invece di lasciarlo
 * a un modello che improvvisa — e per lo studio è il segnale che qualcosa nel
 * piano non è chiaro.
 */
export interface Flag {
  id: string;
  planKey: string;
  professionalId: string;
  patientName: string;
  at: string;
  question: string;
  reason: string;
  status: 'aperta' | 'chiusa';
}

export interface Store {
  plans: StoredPlan[];
  corrections: Correction[];
  profiles: Record<string, StyleProfile>;
  flags: Flag[];
}

const BUILTIN: Array<[string, NutritionPlan]> = [
  ['demarco', pianoDeMarco],
  ['alim-ab', pianoAlimAB],
  ['macro', pianoMacro],
];

function seed(): Store {
  return {
    plans: BUILTIN.map(([key, plan]) => ({
      key,
      plan,
      builtin: true,
      createdAt: plan.issuedAt,
      confirmedBy: plan.professional.name,
    })),
    corrections: [],
    profiles: {},
    flags: [],
  };
}

let cache: Store | null = null;

export async function load(): Promise<Store> {
  if (cache) return cache;

  try {
    const raw = await readFile(FILE, 'utf8');
    const parsed = JSON.parse(raw) as Store;

    // I piani di collaudo vengono sempre riallineati al codice: sono dati di
    // prova, non contenuto dell'utente, e devono seguire le modifiche allo schema.
    const custom = parsed.plans.filter((p) => !p.builtin);
    cache = { ...seed(), ...parsed, plans: [...seed().plans, ...custom] };
  } catch {
    cache = seed();
  }
  return cache;
}

export async function save(store: Store): Promise<void> {
  cache = store;
  await mkdir(dirname(FILE), { recursive: true });

  // Scrittura in due tempi: un crash a metà non lascia un file monco.
  const tmp = `${FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(store, null, 2), 'utf8');
  await rename(tmp, FILE);
}

export async function findPlan(key: string): Promise<StoredPlan | undefined> {
  return (await load()).plans.find((p) => p.key === key);
}

export async function upsertPlan(entry: StoredPlan): Promise<void> {
  const store = await load();
  const existing = store.plans.findIndex((p) => p.key === entry.key);

  if (existing >= 0) {
    if (store.plans[existing].builtin) {
      throw new Error('I piani di collaudo non si modificano: creane uno nuovo.');
    }
    store.plans[existing] = entry;
  } else {
    store.plans.push(entry);
  }
  await save(store);
}

export async function removePlan(key: string): Promise<void> {
  const store = await load();
  const entry = store.plans.find((p) => p.key === key);
  if (!entry) return;
  if (entry.builtin) throw new Error('I piani di collaudo non si cancellano.');

  store.plans = store.plans.filter((p) => p.key !== key);
  await save(store);
}

/* ------------------------------------------------------------------ */
/* Correzioni e profilo di stile                                       */
/* ------------------------------------------------------------------ */

export async function addCorrections(items: Correction[]): Promise<void> {
  if (items.length === 0) return;
  const store = await load();
  store.corrections.push(...items);

  // Il profilo raccoglie le correzioni del suo professionista: è da lì che
  // nascono le proposte di regola.
  for (const c of items) {
    const profile = store.profiles[c.professionalId] ?? emptyProfile(c.professionalId);
    profile.corrections = [...profile.corrections, c];
    store.profiles[c.professionalId] = profile;
  }
  await save(store);
}

export async function getProfile(professionalId: string): Promise<StyleProfile> {
  const store = await load();
  return store.profiles[professionalId] ?? emptyProfile(professionalId);
}

export async function putProfile(profile: StyleProfile): Promise<void> {
  const store = await load();
  store.profiles[profile.professionalId] = profile;
  await save(store);
}

/* ------------------------------------------------------------------ */
/* Segnalazioni allo studio                                            */
/* ------------------------------------------------------------------ */

export async function addFlag(flag: Flag): Promise<void> {
  const store = await load();
  // Stessa domanda già aperta: non la si duplica, allo studio non serve rumore.
  const gia = store.flags.some(
    (f) => f.status === 'aperta' && f.planKey === flag.planKey && f.question === flag.question,
  );
  if (gia) return;

  store.flags.push(flag);
  await save(store);
}

export async function listFlags(planKey?: string): Promise<Flag[]> {
  const store = await load();
  const all = planKey ? store.flags.filter((f) => f.planKey === planKey) : store.flags;
  return [...all].reverse();
}

export async function closeFlag(id: string): Promise<void> {
  const store = await load();
  const flag = store.flags.find((f) => f.id === id);
  if (!flag) return;
  flag.status = 'chiusa';
  await save(store);
}
