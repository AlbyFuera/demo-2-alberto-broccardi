/**
 * Comprensione della richiesta di sostituzione.
 *
 * `assistant.interpret` capisce «voglio cambiare il riso». Non basta: la
 * domanda che il cliente fa davvero è quasi sempre a due nomi — «posso mettere
 * le patate al posto del riso?» — e i due nomi vanno in due direzioni opposte.
 *
 *   food    ciò che ESCE dal piatto   → decide QUALE slot toccare
 *   foodTo  ciò che ENTRA nel piatto   → decide COSA verificare
 *
 * Scambiarli produce la risposta giusta alla domanda sbagliata: l'elenco delle
 * alternative alle patate quando il cliente ha nel piatto il riso.
 *
 * Questo modulo avvolge l'assistente invece di modificarlo: `interpret` resta
 * il riconoscitore generico, qui si aggiunge solo la coppia.
 */

import type { NutritionPlan } from '../types.ts';
import type { Intent } from './assistant.ts';
import { interpret } from './assistant.ts';
import { mealsForDay } from './plan.ts';

/** Intento con la coppia «cosa esce / cosa entra». */
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

/**
 * I modi in cui si esprime una sostituzione, e da che parte sta cosa.
 *
 * `invertito: true` significa che a SINISTRA del separatore c'è l'alimento che
 * entra: «metto le patate AL POSTO DEL riso». Con «sostituisco il riso CON le
 * patate» l'ordine è l'opposto. È una differenza che nessuna euristica di
 * prossimità indovina: va enumerata.
 */
const SEPARATORI: { re: RegExp; invertito: boolean }[] = [
  { re: /\bal posto (?:del|della|dello|dei|degli|delle|di|d')\b/, invertito: true },
  { re: /\binvece (?:del|della|dello|dei|degli|delle|di|d')\b/, invertito: true },
  { re: /\bin sostituzione (?:del|della|dello|di|d')\b/, invertito: true },
  { re: /\banziche\b/, invertito: true },
  { re: /\bpiuttosto che\b/, invertito: true },
  { re: /\bcon\b/, invertito: false },
  { re: /\bcambiare?(?:lo|la)? in\b/, invertito: false },
];

/** Gli alimenti che il piano prevede in quel giorno, dal più lungo al più corto. */
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

/** Il primo alimento del piano nominato nel frammento. Il più specifico vince. */
function alimentoIn(frammento: string, alimenti: { label: string; norm: string }[]): string | undefined {
  const q = NORM(frammento);
  return alimenti.find((a) => q.includes(a.norm))?.label;
}

/**
 * Parole che non nominano un alimento: verbi della richiesta, articoli,
 * riferimenti temporali. Tolte queste, quel che resta è il nome che il cliente
 * ha in mente.
 */
const RIEMPITIVI = new Set(
  ('posso potrei vorrei voglio devo puo si e possibile mettere metterci mangiare mangiarmi ' +
    'prendere usare fare mettere sostituire sostituirlo sostituirla cambiare cambiarlo ' +
    'cambiarla scambiare magari forse invece un uno una po del dello della dei degli delle ' +
    'di il lo la i gli le l al allo alla ai agli alle a con per in su da oggi domani ieri ' +
    'stasera stamattina stanotte pranzo cena colazione spuntino merenda pasto favore grazie ' +
    'ci mi ti se che cosa qualcosa qualcos altro niente nulla')
    .split(' '),
);

/** Nomi troppo vaghi per essere un alimento: chiedono alternative, non verificano. */
const GENERICI = new Set(['', 'altro', 'roba', 'cose', 'cosa']);

/**
 * Il nome dell'alimento che il cliente vuole METTERE, anche se il piano non lo
 * prevede.
 *
 * Serve al caso che conta di più: «posso mangiare una pizza al posto del
 * merluzzo?». La pizza non è nel piano — cercarla tra gli alimenti del piano
 * non la trova, e senza questo passaggio la richiesta si degrada in «dammi le
 * alternative al merluzzo», che risponde a una domanda diversa e soprattutto
 * NON avvisa il professionista.
 *
 * Sbagliare qui costa poco e nella direzione giusta: un nome estratto male
 * produce un esito «fuori piano», cioè «non lo decido io, l'ho girata al tuo
 * nutrizionista» più le alternative vere. Mai un sì che il piano non prevede.
 */
function nomeLibero(frammento: string): string | undefined {
  const q = NORM(frammento);

  // «con qualcosa di leggero», «al posto di altro»: il cliente non ha nominato
  // niente, sta chiedendo proposte. Trattarlo come un alimento fuori piano
  // manderebbe al professionista una segnalazione senza contenuto.
  if (/\b(qualcosa|qualcos|altro|niente|nulla)\b/.test(q)) return undefined;

  const parole = q.split(' ').filter((p) => p && !RIEMPITIVI.has(p));
  const nome = parole.slice(0, 3).join(' ').trim();

  return GENERICI.has(nome) || nome.length < 3 ? undefined : nome;
}

/**
 * La coppia (esce, entra) nominata nella domanda.
 *
 * Se non c'è un separatore riconoscibile si restituisce solo l'alimento
 * trovato, e come `food`: senza separatore la lettura naturale di «posso
 * cambiare il riso» è che il riso esca. Mettere l'unico nome trovato in
 * `foodTo` trasformerebbe una richiesta di alternative in una verifica su un
 * alimento che il cliente non ha nemmeno chiesto.
 */
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

    // Il separatore dice da che parte sta cosa. È l'unica cosa che lo dice.
    const testoEntra = invertito ? sinistra : destra;
    const testoEsce = invertito ? destra : sinistra;

    const esce = alimentoIn(testoEsce, alimenti);
    const entra = alimentoIn(testoEntra, alimenti);

    if (esce && entra) return { food: esce, foodTo: entra };

    // Sappiamo cosa esce ma non riconosciamo cosa entra: quasi sempre è un
    // alimento FUORI dal piano, ed è il caso che il professionista deve
    // vedere. Si prende il nome così com'è scritto e si lascia decidere a lui.
    if (esce) {
      const fuoriPiano = nomeLibero(testoEntra);
      return fuoriPiano ? { food: esce, foodTo: fuoriPiano } : { food: esce };
    }

    // Solo il lato che entra è riconoscibile: «al posto del riso» senza dire
    // cosa. Chiede alternative, non verifica un sostituto.
    if (entra) return { foodTo: entra };
  }

  const unico = alimentoIn(q, alimenti);
  return unico ? { food: unico } : {};
}

/**
 * Interpretazione completa: l'assistente per l'intento, questo modulo per la
 * coppia. Quando il modello linguistico ha già estratto la coppia (vedi
 * `worker/ai.ts`) la sua vince, perché capisce le frasi storte meglio di
 * qualunque espressione regolare — ma solo dopo che gli alimenti sono stati
 * verificati contro il piano.
 */
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

/**
 * Riconduce al piano gli alimenti che il modello ha estratto.
 *
 * Il modello restituisce testo libero: può scrivere «patate dolci» dove il
 * piano dice «patate americane». Se il nome non corrisponde a nulla nel piano
 * di quel giorno, il valore viene SCARTATO — mai passato avanti così com'è,
 * altrimenti finirebbe a cercare un alimento che non esiste e la risposta
 * sarebbe «non ho capito» invece di «il piano non lo prevede».
 */
export function ancoraAlPiano(
  intento: IntentEsteso,
  plan: NutritionPlan,
  oggi: number,
  domanda?: string,
): IntentEsteso {
  const giorno = intento.day ?? oggi;
  const alimenti = alimentiDelGiorno(plan, giorno);
  const risolvi = (nome?: string) => (nome ? alimentoIn(nome, alimenti) : undefined);

  // Il modello vince, ma non può far PERDERE informazione: se ha lasciato vuoto
  // un lato della coppia, si guarda cosa trova l'analisi deterministica. Il caso
  // reale che questo salva è «posso mangiare una pizza al posto del merluzzo?»:
  // i modelli piccoli tendono a non compilare `foodTo` quando l'alimento non
  // compare nell'elenco che gli abbiamo dato, e senza questa rete la richiesta
  // diventa «alternative al merluzzo» — corretta come risposta, ma il
  // professionista non viene mai a sapere che il suo cliente voleva la pizza.
  const ripiego =
    intento.kind === 'sostituzione' && domanda && (!intento.food || !intento.foodTo)
      ? coppiaSostituzione(domanda, plan, giorno)
      : {};

  return {
    ...intento,
    food: risolvi(intento.food) ?? ripiego.food,
    // Ciò che ENTRA nel piatto non si àncora: se il cliente nomina un alimento
    // che il piano non prevede, quel nome deve arrivare intatto alla verifica,
    // che risponderà «fuori piano» e girerà la domanda al professionista.
    foodTo: intento.foodTo ?? ripiego.foodTo,
  };
}
