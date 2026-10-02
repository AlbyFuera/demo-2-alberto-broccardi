import type { Dieta, Valori } from '../types.ts';
import { NOMI_GIORNI } from '../types.ts';
import type { Libreria } from './composizione.ts';
import {
  alimentiDellaDieta,
  giornoDi,
  nomeGiorno,
  scriviAlimento,
  scriviQuantita,
  totaleGiorno,
  totalePasto,
  trovaAlimento,
} from './dieta.ts';
import { recupero } from './recupero.ts';

export type TipoDomanda =
  | 'saluto'
  /** Cosa mangio adesso / qual è il prossimo pasto. */
  | 'adesso'
  /** Cosa prevede un giorno o un pasto preciso. */
  | 'giorno'
  /** Vuole cambiare un alimento. */
  | 'sostituzione'
  /** Ha saltato un pasto e vuole sapere come sta messo. */
  | 'saltato'
  /** Quante calorie / proteine ha questo pasto o questa giornata. */
  | 'valori'
  /** Acqua, alcol, integratori: le indicazioni del professionista. */
  | 'indicazioni'
  /** La spesa della settimana. */
  | 'spesa'
  | 'ignoto';

export interface Domanda {
  tipo: TipoDomanda;
  /** 0 = lunedì … 6 = domenica. */
  giorno?: number;
  /** Il pasto di cui parla, quando lo nomina. */
  pastoId?: string;
  /** L'alimento da togliere. */
  alimento?: string;
  /** L'alimento da mettere; può non essere nella dieta. */
  alimentoNuovo?: string;
  /** Testo originale della domanda. */
  testo: string;
}

const NORM = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const GIORNI_SCRITTI: Record<string, number> = {
  lunedi: 0, martedi: 1, mercoledi: 2, giovedi: 3,
  venerdi: 4, sabato: 5, domenica: 6,
};

/** `invertito`: a sinistra del separatore c'è l'alimento che entra. */
const SEPARATORI: { re: RegExp; invertito: boolean }[] = [
  { re: /\bal posto (?:del|della|dello|dei|degli|delle|di|d')\b/, invertito: true },
  { re: /\binvece (?:del|della|dello|dei|degli|delle|di|d')\b/, invertito: true },
  { re: /\bin sostituzione (?:del|della|dello|di|d')\b/, invertito: true },
  { re: /\banziche\b/, invertito: true },
  { re: /\bpiuttosto che\b/, invertito: true },
  { re: /\bcon\b/, invertito: false },
  { re: /\bcambiare?(?:lo|la)? in\b/, invertito: false },
];

/** Parole che non nominano un alimento. */
const RIEMPITIVI = new Set(
  ('posso potrei vorrei voglio devo puo si e possibile mettere metterci mangiare mangiarmi ' +
    'prendere usare fare sostituire sostituirlo sostituirla cambiare cambiarlo cambiarla ' +
    'scambiare magari forse invece un uno una po del dello della dei degli delle di il lo la ' +
    'i gli le l al allo alla ai agli alle a con per in su da oggi domani ieri stasera ' +
    'stamattina stanotte pranzo cena colazione spuntino merenda pasto favore grazie ci mi ti ' +
    'se che cosa qualcosa qualcos altro niente nulla')
    .split(' '),
);

const GENERICI = new Set(['', 'altro', 'roba', 'cose', 'cosa']);

/** Parole che in un nome di alimento non identificano nulla da sole. */
const PAROLE_VUOTE = new Set(['di', 'da', 'del', 'della', 'dello', 'dei', 'delle', 'e', 'o', 'a', 'al', 'con', 'in']);

function alimentoDellaDietaIn(frammento: string, alimenti: string[]): string | undefined {
  const q = NORM(frammento);
  const parole = new Set(q.split(' '));

  let migliore: { nome: string; punti: number } | null = null;

  for (const nome of alimenti) {
    const n = NORM(nome);
    if (n.length < 3) continue;

    // Il nome intero dentro la domanda vale più di qualunque conteggio.
    let punti = q.includes(n) ? 100 + n.length : 0;

    if (punti === 0) {
      const significative = n.split(' ').filter((p) => p.length >= 4 && !PAROLE_VUOTE.has(p));
      const trovate = significative.filter((p) => parole.has(p));
      if (trovate.length === 0) continue;
      punti = trovate.length * 10 + n.length / 100;
    }

    if (!migliore || punti > migliore.punti) migliore = { nome, punti };
  }

  return migliore?.nome;
}

function nomeLibero(frammento: string): string | undefined {
  const q = NORM(frammento);
  if (/\b(qualcosa|qualcos|altro|niente|nulla)\b/.test(q)) return undefined;

  const parole = q.split(' ').filter((p) => p && !RIEMPITIVI.has(p));
  const nome = parole.slice(0, 3).join(' ').trim();

  return GENERICI.has(nome) || nome.length < 3 ? undefined : nome;
}

/** La coppia esce/entra nominata nella domanda. */
export function coppia(
  testo: string,
  dieta: Dieta,
): { alimento?: string; alimentoNuovo?: string } {
  const alimenti = alimentiDellaDieta(dieta);
  const q = NORM(testo);

  for (const { re, invertito } of SEPARATORI) {
    const match = re.exec(q);
    if (!match) continue;

    const sinistra = q.slice(0, match.index);
    const destra = q.slice(match.index + match[0].length);
    const testoEntra = invertito ? sinistra : destra;
    const testoEsce = invertito ? destra : sinistra;

    const esce = alimentoDellaDietaIn(testoEsce, alimenti);
    const entra = alimentoDellaDietaIn(testoEntra, alimenti);

    if (esce && entra) return { alimento: esce, alimentoNuovo: entra };

    if (esce) {
      const fuori = nomeLibero(testoEntra);
      return fuori ? { alimento: esce, alimentoNuovo: fuori } : { alimento: esce };
    }
    if (entra) return { alimentoNuovo: entra };
  }

  const unico = alimentoDellaDietaIn(q, alimenti);
  return unico ? { alimento: unico } : {};
}

export function interpreta(testo: string, dieta: Dieta, oggi: number): Domanda {
  const q = NORM(testo);
  const base = { testo };

  if (/^(ciao|buongiorno|buonasera|salve|ehi|hey)\b/.test(q) && q.length < 25) {
    return { ...base, tipo: 'saluto' };
  }

  let giorno = oggi;
  for (const [nome, i] of Object.entries(GIORNI_SCRITTI)) if (q.includes(nome)) giorno = i;
  if (/\bdomani\b/.test(q)) giorno = (oggi + 1) % 7;
  if (/\bieri\b/.test(q)) giorno = (oggi + 6) % 7;

  // Il pasto si cerca sui nomi che il professionista ha davvero usato.
  let pastoId: string | undefined;
  for (const pasto of giornoDi(dieta, giorno)?.pasti ?? []) {
    const n = NORM(pasto.nome);
    if (n.length > 2 && q.includes(n)) pastoId = pasto.id;
  }
  if (!pastoId && /\bstaser|\bcena\b/.test(q)) pastoId = perNome(dieta, giorno, /cena/i);
  if (!pastoId && /\bpranzo\b/.test(q)) pastoId = perNome(dieta, giorno, /pranzo/i);
  if (!pastoId && /\bcolazione\b/.test(q)) pastoId = perNome(dieta, giorno, /colazione/i);

  if (/\b(saltat\w*|non ho mangiato|mi sono perso|ho perso|recuper\w*|saltar\w*)\b/.test(q)) {
    return { ...base, tipo: 'saltato', giorno, pastoId };
  }
  if (/\b(sostitu\w*|posso mettere|al posto|invece d\w+|cambiar\w*|scambiar\w*|anziche)/.test(q)) {
    return { ...base, tipo: 'sostituzione', giorno, pastoId, ...coppia(testo, dieta) };
  }
  if (/\b(spesa|comprare|supermercato|lista)\b/.test(q)) {
    return { ...base, tipo: 'spesa' };
  }
  if (/\b(caloria|calorie|kcal|proteine|carboidrati|grassi|macro|quanto pesa|quante)\b/.test(q)) {
    return { ...base, tipo: 'valori', giorno, pastoId };
  }
  if (/\b(acqua|alcol|vino|birra|caffe|integrator|creatina|sale|regol\w*|indicazion\w*)\b/.test(q)) {
    return { ...base, tipo: 'indicazioni', giorno };
  }
  if (/\b(adesso|ora|prossimo pasto|cosa mangio|che mangio|cosa devo mangiare)\b/.test(q)) {
    return { ...base, tipo: pastoId ? 'giorno' : 'adesso', giorno, pastoId };
  }
  if (/\b(cosa|che cosa|mangio|menu|giornata|prevede|previsto)\b/.test(q)) {
    return { ...base, tipo: 'giorno', giorno, pastoId };
  }

  return { ...base, tipo: 'ignoto', giorno, pastoId };
}

function perNome(dieta: Dieta, giorno: number, re: RegExp): string | undefined {
  return giornoDi(dieta, giorno)?.pasti.find((p) => re.test(p.nome))?.id;
}

export interface Scheda {
  titolo: string;
  righe?: { nome: string; quantita: string }[];
  testo?: string[];
}

export interface Risposta {
  /** Frase composta dal codice; l'AI può solo riformularla. */
  risposta: string;
  schede: Scheda[];
  /** Le indicazioni del professionista su cui poggia la risposta. */
  citazioni: string[];
  /** Presente quando la domanda va girata allo studio. */
  daGirare?: { motivo: string };
  fonte: 'motore' | 'ai';
  domanda: Domanda;
}

export interface Contesto {
  dieta: Dieta;
  oggi: number;
  ora: number;
  nomeProfessionista: string;
  nomeCliente: string;
  libreria?: Libreria;
  /** Gli id dei pasti di oggi già segnati come fatti. */
  fattiOggi?: string[];
  /** Gli id dei pasti di oggi già segnati come saltati. */
  saltatiOggi?: string[];
}

const arr = (n: number) => Math.round(n);

function descriviValori(v: Valori, parziale: boolean): string {
  return (
    `${parziale ? 'circa ' : ''}${arr(v.kcal)} kcal · ` +
    `${arr(v.proteine)} g proteine · ${arr(v.carboidrati)} g carboidrati · ` +
    `${arr(v.grassi)} g grassi`
  );
}

function schedaPasto(ctx: Contesto, giorno: number, pastoId: string): Scheda | null {
  const pasto = giornoDi(ctx.dieta, giorno)?.pasti.find((p) => p.id === pastoId);
  if (!pasto) return null;

  const t = totalePasto(pasto, ctx.libreria);
  return {
    titolo: `${nomeGiorno(giorno)} · ${pasto.nome}${pasto.orario ? ` (${pasto.orario})` : ''}`,
    righe: pasto.alimenti.map((a) => ({ nome: a.nome, quantita: scriviQuantita(a) })),
    testo: [descriviValori(t, t.mancanti.length > 0), ...(pasto.nota ? [pasto.nota] : [])],
  };
}

/** Il prossimo pasto in programma, secondo l'ora; quelli già segnati non contano. */
function prossimoPasto(ctx: Contesto): { giorno: number; pastoId: string } | null {
  const segnati = new Set([...(ctx.fattiOggi ?? []), ...(ctx.saltatiOggi ?? [])]);
  const daFare = giornoDi(ctx.dieta, ctx.oggi)?.pasti.filter((p) => !segnati.has(p.id)) ?? [];

  for (const pasto of daFare) {
    if (!pasto.orario) continue;
    const m = /^(\d{1,2})/.exec(pasto.orario.trim());
    if (m && Number(m[1]) >= ctx.ora) return { giorno: ctx.oggi, pastoId: pasto.id };
  }

  if (daFare.length) return { giorno: ctx.oggi, pastoId: daFare[0].id };

  const domani = giornoDi(ctx.dieta, (ctx.oggi + 1) % 7);
  return domani?.pasti.length
    ? { giorno: (ctx.oggi + 1) % 7, pastoId: domani.pasti[0].id }
    : null;
}

export function risolvi(ctx: Contesto, d: Domanda): Risposta {
  const base = { schede: [] as Scheda[], citazioni: [] as string[], fonte: 'motore' as const, domanda: d };
  const giorno = d.giorno ?? ctx.oggi;

  if (d.tipo === 'saluto') {
    const p = prossimoPasto(ctx);
    return {
      ...base,
      risposta:
        `Ciao ${ctx.nomeCliente.split(' ')[0]}. Ho la tua dieta di ${ctx.nomeProfessionista}: ` +
        `posso dirti cosa prevede, cosa puoi mettere al posto di un alimento e come stai messo ` +
        `se salti un pasto.`,
      schede: p ? [schedaPasto(ctx, p.giorno, p.pastoId)!].filter(Boolean) : [],
    };
  }

  if (d.tipo === 'adesso') {
    const p = prossimoPasto(ctx);
    if (!p) {
      return {
        ...base,
        risposta: `Per oggi ${ctx.nomeProfessionista} non ha scritto nessun pasto.`,
      };
    }
    const scheda = schedaPasto(ctx, p.giorno, p.pastoId)!;
    return {
      ...base,
      risposta:
        p.giorno === ctx.oggi
          ? `Il prossimo è ${scheda.titolo.split('·')[1].trim()}.`
          : `Oggi hai finito. Il prossimo è domani: ${scheda.titolo.split('·')[1].trim()}.`,
      schede: [scheda],
    };
  }

  if (d.tipo === 'giorno') {
    if (d.pastoId) {
      const scheda = schedaPasto(ctx, giorno, d.pastoId);
      if (!scheda) {
        return { ...base, risposta: `Quel pasto non è previsto ${nomeGiorno(giorno).toLowerCase()}.` };
      }
      return { ...base, risposta: `Ecco cosa prevede.`, schede: [scheda] };
    }

    const g = giornoDi(ctx.dieta, giorno);
    if (!g?.pasti.length) {
      return {
        ...base,
        risposta: `${nomeGiorno(giorno)} ${ctx.nomeProfessionista} non ha ancora scritto nulla.`,
      };
    }
    const t = totaleGiorno(g, ctx.libreria);
    return {
      ...base,
      risposta:
        `${nomeGiorno(giorno)} sono ${g.pasti.length} pasti, ` +
        `${descriviValori(t, t.mancanti.length > 0)} in tutto.`,
      schede: g.pasti.map((p) => schedaPasto(ctx, giorno, p.id)!).filter(Boolean),
      citazioni: g.nota ? [g.nota] : [],
    };
  }

  if (d.tipo === 'valori') {
    if (d.pastoId) {
      const pasto = giornoDi(ctx.dieta, giorno)?.pasti.find((p) => p.id === d.pastoId);
      if (pasto) {
        const t = totalePasto(pasto, ctx.libreria);
        return {
          ...base,
          risposta: `${pasto.nome} di ${nomeGiorno(giorno).toLowerCase()}: ${descriviValori(t, t.mancanti.length > 0)}.`,
          schede: [schedaPasto(ctx, giorno, pasto.id)!],
          citazioni: t.mancanti.length
            ? [`Non entrano nel conto: ${t.mancanti.join(', ')} — composizione non nota.`]
            : [],
        };
      }
    }

    const g = giornoDi(ctx.dieta, giorno);
    const t = totaleGiorno(g!, ctx.libreria);
    const obiettivo = ctx.dieta.obiettivi.kcal;

    return {
      ...base,
      risposta:
        `${nomeGiorno(giorno)}: ${descriviValori(t, t.mancanti.length > 0)}.` +
        (obiettivo ? ` L'obiettivo che ti ha dato è ${obiettivo} kcal.` : ''),
      citazioni: [
        ...(t.mancanti.length
          ? [`Non entrano nel conto: ${t.mancanti.join(', ')} — composizione non nota.`]
          : []),
        ...(t.libere.length ? [`A quantità libera: ${t.libere.join(', ')}.`] : []),
      ],
    };
  }

  if (d.tipo === 'saltato') {
    // Per oggi contano anche i pasti già segnati.
    const diOggi = giorno === ctx.oggi;
    const saltati = [
      ...(d.pastoId ? [d.pastoId] : []),
      ...(diOggi ? (ctx.saltatiOggi ?? []) : []),
    ];
    const r = recupero(
      ctx.dieta,
      giorno,
      [...new Set(saltati)],
      ctx.ora,
      ctx.libreria,
      diOggi ? (ctx.fattiOggi ?? []) : [],
    );
    if (!r) return { ...base, risposta: 'Non trovo quel giorno nella tua dieta.' };

    return {
      ...base,
      risposta: raccontaRecuperoLocale(r, ctx.nomeProfessionista),
      schede: r.rimanenti.map((p) => schedaPasto(ctx, giorno, p.id)!).filter(Boolean),
      // Il recupero lo decide il professionista.
      daGirare:
        Math.round(r.scoperto.kcal) > 150
          ? {
              motivo:
                `Ha saltato ${r.saltati.map((p) => p.nome).join(', ') || 'un pasto'} ` +
                `${nomeGiorno(giorno).toLowerCase()}: resterebbe sotto di ` +
                `${Math.round(r.scoperto.kcal)} kcal.`,
            }
          : undefined,
    };
  }

  if (d.tipo === 'indicazioni') {
    const o = ctx.dieta.obiettivi;
    const righe = [
      ...ctx.dieta.indicazioni,
      ...(o.acqua ? [`Acqua: ${o.acqua} litri al giorno.`] : []),
    ];
    if (righe.length === 0) {
      return {
        ...base,
        risposta: `${ctx.nomeProfessionista} non ha scritto indicazioni generali su questo.`,
        daGirare: { motivo: 'Ha chiesto un’indicazione che non è nella dieta.' },
      };
    }
    return {
      ...base,
      risposta: `Queste sono le indicazioni che ti ha dato ${ctx.nomeProfessionista}.`,
      schede: [{ titolo: 'Indicazioni', testo: righe }],
    };
  }

  if (d.tipo === 'spesa') {
    return { ...base, risposta: 'Ti apro la lista della spesa della settimana.' };
  }

  if (d.tipo === 'sostituzione') {
    // Le sostituzioni passano da worker/api-cliente.ts.
    return { ...base, risposta: '' };
  }

  return {
    ...base,
    risposta:
      `Questa non la so, e non voglio inventarla: l'ho girata a ${ctx.nomeProfessionista}. ` +
      `La risposta la trovi qui appena arriva.`,
    daGirare: { motivo: 'L’assistente non ha trovato la risposta nella dieta.' },
  };
}

/** Duplicata per non far dipendere recupero.ts dal nome del professionista. */
function raccontaRecuperoLocale(
  r: ReturnType<typeof recupero> & object,
  nomeProfessionista: string,
): string {
  const a = (n: number) => Math.abs(Math.round(n));
  const frasi: string[] = [];

  if (r.saltati.length > 0) {
    frasi.push(
      `Saltando ${r.saltati.map((p) => p.nome.toLowerCase()).join(' e ')} lasci fuori ` +
        `${a(r.saltati.reduce((s, p) => s + p.valori.kcal, 0))} kcal e ` +
        `${a(r.saltati.reduce((s, p) => s + p.valori.proteine, 0))} g di proteine.`,
    );
  }

  frasi.push(
    r.rimanenti.length
      ? `Ti restano ${r.rimanenti.map((p) => p.nome.toLowerCase()).join(', ')}: ` +
        `messi insieme fanno ${a(r.copertoDaiRimanenti.kcal)} kcal.`
      : 'Per oggi non ti resta nessun pasto in programma.',
  );

  const scoperto = Math.round(r.scoperto.kcal);
  if (scoperto > 50) {
    frasi.push(
      `Anche facendo tutto il resto resteresti sotto di circa ${a(scoperto)} kcal e ` +
        `${a(r.scoperto.proteine)} g di proteine${r.parziale ? ' (conto parziale)' : ''}. ` +
        `Come recuperarle non lo decido io: l'ho segnalato a ${nomeProfessionista}.`,
    );
  } else if (scoperto < -50) {
    frasi.push(`Così arriveresti circa ${a(scoperto)} kcal sopra quello che era previsto per oggi.`);
  } else {
    frasi.push('Facendo il resto della giornata rientri in quello che era previsto.');
  }

  return frasi.join(' ');
}

/** I giorni della settimana, per l'interfaccia. */
export { NOMI_GIORNI };
