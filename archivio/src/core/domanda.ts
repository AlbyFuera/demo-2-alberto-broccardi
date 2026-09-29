import type { NutritionPlan } from '../types.ts';
import type { Intent } from './assistant.ts';
import { interpret } from './assistant.ts';
import { mealsForDay } from './plan.ts';

export interface IntentEsteso extends Intent {
  foodTo?: string;
}

const NORM = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const SEPARATORI: { re: RegExp; invertito: boolean }[] = [
  { re: /\bal posto (?:del|della|dello|dei|degli|delle|di|d')\b/, invertito: true },
  { re: /\binvece (?:del|della|dello|dei|degli|delle|di|d')\b/, invertito: true },
  { re: /\bin sostituzione (?:del|della|dello|di|d')\b/, invertito: true },
  { re: /\banziche\b/, invertito: true },
  { re: /\bpiuttosto che\b/, invertito: true },
  { re: /\bcon\b/, invertito: false },
  { re: /\bcambiare?(?:lo|la)? in\b/, invertito: false },
];

function alimentiDelGiorno(plan: NutritionPlan, day: number): { label: string; norm: string }[] {
  const out = new Map<string, string>();

  for (const tpl of mealsForDay(plan, day)) {
    const tutti = [
      ...tpl.slots.flatMap((s) => s.options),
      ...(tpl.combos ?? []).flatMap((c) => c.parts.flatMap((p) => p.options)),
    ];
    for (const opt of tutti) {
      const norm = NORM(opt.label);
      if (norm.length > 2) out.set(norm, opt.label);
    }
  }

  return [...out.entries()]
    .map(([norm, label]) => ({ norm, label }))
    .sort((a, b) => b.norm.length - a.norm.length);
}

/** Il primo alimento del piano nominato nel frammento. */
function alimentoIn(frammento: string, alimenti: { label: string; norm: string }[]): string | undefined {
  const q = NORM(frammento);
  return alimenti.find((a) => q.includes(a.norm))?.label;
}

const RIEMPITIVI = new Set(
  ('posso potrei vorrei voglio devo puo si e possibile mettere metterci mangiare mangiarmi ' +
    'prendere usare fare mettere sostituire sostituirlo sostituirla cambiare cambiarlo ' +
    'cambiarla scambiare magari forse invece un uno una po del dello della dei degli delle ' +
    'di il lo la i gli le l al allo alla ai agli alle a con per in su da oggi domani ieri ' +
    'stasera stamattina stanotte pranzo cena colazione spuntino merenda pasto favore grazie ' +
    'ci mi ti se che cosa qualcosa qualcos altro niente nulla')
    .split(' '),
);

/** Nomi troppo vaghi per essere un alimento. */
const GENERICI = new Set(['', 'altro', 'roba', 'cose', 'cosa']);

function nomeLibero(frammento: string): string | undefined {
  const q = NORM(frammento);

  if (/\b(qualcosa|qualcos|altro|niente|nulla)\b/.test(q)) return undefined;

  const parole = q.split(' ').filter((p) => p && !RIEMPITIVI.has(p));
  const nome = parole.slice(0, 3).join(' ').trim();

  return GENERICI.has(nome) || nome.length < 3 ? undefined : nome;
}

export function coppiaSostituzione(
  domanda: string,
  plan: NutritionPlan,
  day: number,
): { food?: string; foodTo?: string } {
  const alimenti = alimentiDelGiorno(plan, day);
  const q = NORM(domanda);

  for (const { re, invertito } of SEPARATORI) {
    const match = re.exec(q);
    if (!match) continue;

    const sinistra = q.slice(0, match.index);
    const destra = q.slice(match.index + match[0].length);

    const testoEntra = invertito ? sinistra : destra;
    const testoEsce = invertito ? destra : sinistra;

    const esce = alimentoIn(testoEsce, alimenti);
    const entra = alimentoIn(testoEntra, alimenti);

    if (esce && entra) return { food: esce, foodTo: entra };

    if (esce) {
      const fuoriPiano = nomeLibero(testoEntra);
      return fuoriPiano ? { food: esce, foodTo: fuoriPiano } : { food: esce };
    }

    if (entra) return { foodTo: entra };
  }

  const unico = alimentoIn(q, alimenti);
  return unico ? { food: unico } : {};
}

export function interpretaEsteso(
  domanda: string,
  plan: NutritionPlan,
  oggi: number,
): IntentEsteso {
  const intento = interpret(domanda, plan, oggi);
  if (intento.kind !== 'sostituzione') return intento;

  const coppia = coppiaSostituzione(domanda, plan, intento.day ?? oggi);
  return {
    ...intento,
    food: coppia.food ?? intento.food,
    foodTo: coppia.foodTo,
  };
}

export function ancoraAlPiano(
  intento: IntentEsteso,
  plan: NutritionPlan,
  oggi: number,
  domanda?: string,
): IntentEsteso {
  const giorno = intento.day ?? oggi;
  const alimenti = alimentiDelGiorno(plan, giorno);
  const risolvi = (nome?: string) => (nome ? alimentoIn(nome, alimenti) : undefined);

  const ripiego =
    intento.kind === 'sostituzione' && domanda && (!intento.food || !intento.foodTo)
      ? coppiaSostituzione(domanda, plan, giorno)
      : {};

  return {
    ...intento,
    food: risolvi(intento.food) ?? ripiego.food,
    foodTo: intento.foodTo ?? ripiego.foodTo,
  };
}
