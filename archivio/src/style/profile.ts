/**
 * Profilo di stile del professionista.
 *
 * Il valore commerciale del prodotto sta qui: più il nutrizionista lo usa, più
 * lo strumento assomiglia al suo metodo. È anche la risposta alla domanda
 * "non mi basta caricare il PDF su un assistente generico?" — un assistente
 * generico non conserva nulla tra una volta e l'altra.
 *
 * Tre vincoli di progetto, non negoziabili:
 *
 *  1. NIENTE SCATOLA NERA. Ogni regola appresa è una frase leggibile, con
 *     l'evidenza che l'ha generata, e il professionista può disattivarla.
 *  2. LO STILE NON TOCCA LA SOSTANZA. Una regola appresa può influenzare
 *     distribuzione, presentazione e terminologia. Non può mai cambiare
 *     alimenti ammessi o quantità: quelli restano sotto il validatore.
 *  3. NESSUNA CONTAMINAZIONE TRA STUDI. Un profilo appartiene a un solo
 *     professionista. Il suo metodo è la sua proprietà intellettuale.
 */

import type { SoftPreference } from '../types.ts';

/** Ambiti su cui una regola appresa può legittimamente intervenire. */
export const SCOPI_AMMESSI = [
  'distribuzione', // dove cade un pasto nella settimana
  'preferenza', // quali opzioni privilegiare a parità di vincoli
  'presentazione', // come viene scritto l'output
  'terminologia', // come questo professionista chiama le cose
] as const;

export type ScopoRegola = (typeof SCOPI_AMMESSI)[number];

/**
 * Ambiti VIETATI: se una correzione tocca questi, non diventa mai una regola
 * di stile. Deve passare da una modifica esplicita del piano.
 */
export const SCOPI_VIETATI = ['quantita', 'alimento-ammesso', 'frequenza'] as const;
export type ScopoVietato = (typeof SCOPI_VIETATI)[number];

export interface Correction {
  id: string;
  professionalId: string;
  planId: string;
  /** ISO date: il chiamante fornisce il timestamp, il modulo non lo inventa. */
  at: string;
  scope: ScopoRegola | ScopoVietato;
  /** Chiave di raggruppamento: correzioni "uguali" hanno la stessa chiave. */
  key: string;
  before: string;
  after: string;
  note?: string;
}

export interface LearnedRule {
  id: string;
  scope: ScopoRegola;
  /** Frase leggibile, mostrata nella pagina "Il mio metodo". */
  description: string;
  /** Quante correzioni indipendenti la sostengono. */
  evidence: number;
  status: 'proposta' | 'attiva' | 'disattivata';
  /** Id delle correzioni che l'hanno generata: tracciabilità completa. */
  sourceCorrections: string[];
  /** Traduzione in preferenza morbida, se applicabile al generatore. */
  preference?: SoftPreference;
}

export interface DocumentFormat {
  /** Come questo professionista esprime le quantità. */
  weighingPhrase?: string;
  /** Sinonimi che usa: "porzione" = "quantità", ecc. */
  terminology: Record<string, string>;
  /** Numero di piani già interpretati con successo per questo formato. */
  confirmedPlans: number;
}

export interface StyleProfile {
  professionalId: string;
  format: DocumentFormat;
  rules: LearnedRule[];
  corrections: Correction[];
}

export function emptyProfile(professionalId: string): StyleProfile {
  return {
    professionalId,
    format: { terminology: {}, confirmedPlans: 0 },
    rules: [],
    corrections: [],
  };
}

export function isStyleScope(scope: string): scope is ScopoRegola {
  return (SCOPI_AMMESSI as readonly string[]).includes(scope);
}

/**
 * Registra una correzione fatta in fase di conferma del piano.
 *
 * Va chiamata SEMPRE, fin dalla prima versione del prodotto, anche prima di
 * saper usare i dati: le correzioni non registrate sono perse per sempre.
 */
export function recordCorrection(profile: StyleProfile, correction: Correction): StyleProfile {
  if (correction.professionalId !== profile.professionalId) {
    throw new Error(
      'Correzione di un altro professionista: i profili di stile non si mescolano.',
    );
  }
  return { ...profile, corrections: [...profile.corrections, correction] };
}

export interface ProposalOptions {
  /** Quante volte una correzione deve ripetersi per diventare una proposta. */
  threshold?: number;
}

/**
 * Trasforma le correzioni ricorrenti in proposte di regola.
 *
 * Non attiva nulla da sola: produce una proposta che il professionista deve
 * confermare. È la differenza tra uno strumento che impara e uno che indovina.
 */
export function proposeRules(
  profile: StyleProfile,
  opts: ProposalOptions = {},
): LearnedRule[] {
  const threshold = opts.threshold ?? 3;

  const groups = new Map<string, Correction[]>();
  for (const c of profile.corrections) {
    // Le correzioni su quantità/alimenti/frequenze non generano MAI stile.
    if (!isStyleScope(c.scope)) continue;
    const list = groups.get(c.key) ?? [];
    list.push(c);
    groups.set(c.key, list);
  }

  const proposals: LearnedRule[] = [];
  for (const [key, list] of groups) {
    if (list.length < threshold) continue;

    const already = profile.rules.find((r) => r.id === `rule:${key}`);
    if (already && already.status !== 'proposta') continue;

    const last = list[list.length - 1];
    proposals.push({
      id: `rule:${key}`,
      scope: last.scope as ScopoRegola,
      description:
        already?.description ??
        `Hai corretto ${list.length} volte "${last.before}" in "${last.after}". ` +
          `Vuoi che diventi una tua regola fissa?`,
      evidence: list.length,
      status: 'proposta',
      sourceCorrections: list.map((c) => c.id),
    });
  }

  return proposals.sort((a, b) => b.evidence - a.evidence);
}

/** Conferma una proposta: da qui in poi il generatore ne terrà conto. */
export function activateRule(
  profile: StyleProfile,
  ruleId: string,
  preference?: SoftPreference,
): StyleProfile {
  const rules = profile.rules.map((r) =>
    r.id === ruleId ? { ...r, status: 'attiva' as const, preference: preference ?? r.preference } : r,
  );
  return { ...profile, rules };
}

export function deactivateRule(profile: StyleProfile, ruleId: string): StyleProfile {
  return {
    ...profile,
    rules: profile.rules.map((r) =>
      r.id === ruleId ? { ...r, status: 'disattivata' as const } : r,
    ),
  };
}

export function upsertRules(profile: StyleProfile, incoming: LearnedRule[]): StyleProfile {
  const byId = new Map(profile.rules.map((r) => [r.id, r]));
  for (const rule of incoming) {
    const existing = byId.get(rule.id);
    // Una regola disattivata a mano non torna da sola: la scelta del
    // professionista vince sempre sull'inferenza.
    if (existing?.status === 'disattivata') continue;
    byId.set(rule.id, { ...existing, ...rule });
  }
  return { ...profile, rules: [...byId.values()] };
}

/**
 * Preferenze morbide derivate dalle regole attive, da iniettare nel piano
 * prima della generazione. Solo `SoftPreference`: per costruzione non possono
 * alterare alimenti né quantità.
 */
export function activePreferences(profile: StyleProfile): SoftPreference[] {
  return profile.rules
    .filter((r) => r.status === 'attiva' && r.preference)
    .map((r) => r.preference!);
}
