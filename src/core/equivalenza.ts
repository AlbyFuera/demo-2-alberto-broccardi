import type { Alimento, BaseSostituzione, Macro, Unita, Valori } from '../types.ts';
import { kcalDi, valoriDi } from '../types.ts';
import { composizioneDi, macroDi, type Composizione, type Libreria } from './composizione.ts';

export type Caratterizzante = 'proteine' | 'carboidrati' | 'grassi' | 'nessuno';

/** Si guarda la ripartizione delle calorie, non dei grammi. */
export function caratterizzante(c: Macro): Caratterizzante {
  const kcal = kcalDi(c);
  if (kcal < 25) return 'nessuno'; // per 100 g: verdure, brodi, bevande

  const quote = {
    proteine: (c.proteine * 4) / kcal,
    carboidrati: (c.carboidrati * 4) / kcal,
    grassi: (c.grassi * 9) / kcal,
  };

  const [nome, quota] = Object.entries(quote).sort((a, b) => b[1] - a[1])[0] as [
    Caratterizzante,
    number,
  ];

  // Sotto il 40% è un alimento misto: si pareggiano le kcal.
  return quota >= 0.4 ? nome : 'nessuno';
}

const ETICHETTA: Record<Caratterizzante, string> = {
  proteine: 'fonte proteica',
  carboidrati: 'fonte di carboidrati',
  grassi: 'fonte di grassi',
  nessuno: 'alimento misto o a basso apporto',
};

const ARTICOLO: Record<Caratterizzante, string> = {
  proteine: 'le proteine',
  carboidrati: 'i carboidrati',
  grassi: 'i grassi',
  nessuno: 'le calorie',
};

const SU: Record<Caratterizzante, string> = {
  proteine: 'sulle proteine',
  carboidrati: 'sui carboidrati',
  grassi: 'sui grassi',
  nessuno: 'sulle calorie',
};

/** Come si chiama, in italiano, una sostituzione fatta su quella base. */
export const NOME_BASE: Record<Caratterizzante, string> = {
  proteine: 'isoproteica',
  carboidrati: 'isoglucidica',
  grassi: 'isolipidica',
  nessuno: 'isocalorica',
};

function baseRichiesta(base: BaseSostituzione, composizioneUscente: Macro): Caratterizzante {
  if (base === 'auto') return caratterizzante(composizioneUscente);
  return base === 'kcal' ? 'nessuno' : base;
}

export type EsitoEquivalenza =
  /** Calcolata: c'è una quantità consigliata. */
  | 'calcolata'
  /** Composizione di uno dei due ignota. */
  | 'sconosciuta'
  /** L'alimento che esce è a quantità libera: non c'è niente da pareggiare. */
  | 'quantita-libera';

export interface Equivalenza {
  esito: EsitoEquivalenza;
  /** Cosa esce dal piatto. */
  esce: Alimento;
  /** Il nome scritto dal cliente per ciò che vorrebbe metterci. */
  nomeEntra: string;
  /** La porzione consigliata, pronta da mettere nel piatto. */
  entra?: Alimento;
  /** Su quale macronutriente è stato fatto il pareggio. */
  base: Caratterizzante;
  nomeBase: string;
  /** Quella che era stata chiesta: 'auto' quando la sceglie il motore. */
  baseChiesta: BaseSostituzione;
  /** Vero quando la base chiesta non era applicabile e si è ripiegato. */
  baseRipiegata: boolean;
  /** Come si legge il pareggio, in italiano. */
  spiegazione: string;
  /** Di quanto si sposta la giornata con la quantità consigliata. */
  delta?: Valori;
  /** Cose che il cliente e il professionista devono sapere. */
  avvisi: string[];
  /** Perché non si è potuto calcolare. */
  motivo?: string;
  /** L'alimento che manca dalla libreria, quando l'esito è 'sconosciuta'. */
  daCompletare?: { nome: string; unita: Unita };
}

/** Una porzione può crescere al massimo di 5 volte. */
const PORZIONE_MASSIMA = 5;

/** Porzioni arrotondate a 5. */
const arrotondaPorzione = (q: number, unita: Unita): number => {
  if (unita === 'pz') return Math.max(0.5, Math.round(q * 2) / 2);
  const passo = q < 30 ? 1 : 5;
  return Math.max(passo, Math.round(q / passo) * passo);
};

const macroDaComposizione = (c: Composizione, quantita: number, unita: Unita): Macro => {
  const fattore = c.per === 'pz' ? quantita : quantita / 100;
  return {
    proteine: c.proteine * fattore,
    carboidrati: c.carboidrati * fattore,
    grassi: c.grassi * fattore,
  };
};

/** Con quanto di `nomeEntra` si sostituisce `esce`. */
export function equivalenza(
  esce: Alimento,
  nomeEntra: string,
  libreria?: Libreria,
  baseVoluta: BaseSostituzione = 'auto',
): Equivalenza {
  const comune: Pick<
    Equivalenza,
    'esce' | 'nomeEntra' | 'avvisi' | 'baseChiesta' | 'baseRipiegata'
  > = {
    esce,
    nomeEntra: nomeEntra.trim(),
    avvisi: [],
    baseChiesta: baseVoluta,
    baseRipiegata: false,
  };

  if (esce.libera || esce.quantita === null) {
    return {
      ...comune,
      esito: 'quantita-libera',
      base: 'nessuno',
      nomeBase: NOME_BASE.nessuno,
      spiegazione: '',
      motivo:
        `${esce.nome} nella tua dieta è «q.b.», senza un peso prescritto: ` +
        `non c'è una quantità da pareggiare. Chiedilo al tuo nutrizionista.`,
    };
  }

  const uscente = macroDi(esce, libreria);
  if (!uscente) {
    return {
      ...comune,
      esito: 'sconosciuta',
      base: 'nessuno',
      nomeBase: NOME_BASE.nessuno,
      spiegazione: '',
      motivo: `Non conosco la composizione di ${esce.nome}, quindi non posso dire cosa lo pareggia.`,
      daCompletare: { nome: esce.nome, unita: esce.unita },
    };
  }

  const provaG = composizioneDi(nomeEntra, esce.unita, libreria);
  const provaPz = provaG ? null : composizioneDi(nomeEntra, 'pz', libreria);
  const entrante = provaG ?? provaPz;

  if (!entrante) {
    return {
      ...comune,
      esito: 'sconosciuta',
      base: 'nessuno',
      nomeBase: NOME_BASE.nessuno,
      spiegazione: '',
      motivo:
        `Non conosco la composizione di «${nomeEntra.trim()}»: senza quella non posso ` +
        `calcolare la porzione equivalente. La domanda va al tuo nutrizionista.`,
      daCompletare: { nome: nomeEntra.trim(), unita: esce.unita },
    };
  }

  const unitaEntra: Unita = entrante.per === 'pz' ? 'pz' : esce.unita;
  const macroUscente = uscente.macro;
  const su = baseRichiesta(baseVoluta, uscente.composizione);

  const resaEntrante =
    su === 'nessuno'
      ? kcalDi({
          proteine: entrante.proteine,
          carboidrati: entrante.carboidrati,
          grassi: entrante.grassi,
        })
      : entrante[su];

  const daPareggiare = su === 'nessuno' ? kcalDi(macroUscente) : macroUscente[su];

  const avvisi: string[] = [];
  let quantita: number;
  let baseUsata: Caratterizzante = su;
  let ripiegata = false;

  if (resaEntrante <= 0.01 || daPareggiare <= 0.01) {
    // Non si può pareggiare sul macronutriente voluto: si ripiega sulle kcal.
    const kcalEntrante = kcalDi({
      proteine: entrante.proteine,
      carboidrati: entrante.carboidrati,
      grassi: entrante.grassi,
    });
    if (kcalEntrante <= 0.01) {
      return {
        ...comune,
        esito: 'sconosciuta',
        base: su,
        nomeBase: NOME_BASE[su],
        spiegazione: '',
        motivo: `«${nomeEntra.trim()}» non apporta praticamente nulla: non c'è un'equivalenza sensata.`,
      };
    }

    quantita = (kcalDi(macroUscente) / kcalEntrante) * (entrante.per === 'pz' ? 1 : 100);
    baseUsata = 'nessuno';
    ripiegata = su !== 'nessuno';
    avvisi.push(
      baseVoluta === 'auto'
        ? `${esce.nome} è una ${ETICHETTA[su]}, «${nomeEntra.trim()}» no: ho pareggiato le ` +
            `calorie, ma i macronutrienti della giornata cambiano parecchio.`
        : `Una sostituzione ${NOME_BASE[su]} qui non è possibile — ` +
            `${daPareggiare <= 0.01 ? `${esce.nome} non` : `«${nomeEntra.trim()}» non`} ` +
            `apporta ${ARTICOLO[su]}. Ho pareggiato le calorie e te lo sto dicendo.`,
    );
  } else {
    quantita = (daPareggiare / resaEntrante) * (entrante.per === 'pz' ? 1 : 100);

    const smisurata =
      unitaEntra === esce.unita &&
      esce.quantita !== null &&
      quantita > esce.quantita * PORZIONE_MASSIMA;

    if (smisurata) {
      const kcalEntrante = kcalDi({
        proteine: entrante.proteine,
        carboidrati: entrante.carboidrati,
        grassi: entrante.grassi,
      });
      if (kcalEntrante > 0.01) {
        avvisi.push(
          `Pareggiare ${ARTICOLO[su]} con «${nomeEntra.trim()}» chiederebbe ` +
            `${Math.round(quantita)}${unitaEntra === 'pz' ? ' pz' : unitaEntra}: una porzione che ` +
            `non sta in un piatto. Ho pareggiato le calorie, e i macronutrienti si spostano.`,
        );
        quantita = (kcalDi(macroUscente) / kcalEntrante) * (entrante.per === 'pz' ? 1 : 100);
        baseUsata = 'nessuno';
        ripiegata = true;
      }
    }
  }

  const arrotondata = arrotondaPorzione(quantita, unitaEntra);
  const entra: Alimento = {
    nome: nomeEntra.trim(),
    quantita: arrotondata,
    unita: unitaEntra,
  };

  // Delta calcolato sulla quantità arrotondata.
  const macroEntrante = macroDaComposizione(entrante, arrotondata, unitaEntra);
  const delta: Valori = {
    kcal: kcalDi(macroEntrante) - kcalDi(macroUscente),
    proteine: macroEntrante.proteine - macroUscente.proteine,
    carboidrati: macroEntrante.carboidrati - macroUscente.carboidrati,
    grassi: macroEntrante.grassi - macroUscente.grassi,
  };

  const caratterizzanteEntrante = caratterizzante({
    proteine: entrante.proteine,
    carboidrati: entrante.carboidrati,
    grassi: entrante.grassi,
  });
  if (
    baseUsata !== 'nessuno' &&
    caratterizzanteEntrante !== su &&
    caratterizzanteEntrante !== 'nessuno'
  ) {
    avvisi.push(
      `«${nomeEntra.trim()}» è soprattutto una ${ETICHETTA[caratterizzanteEntrante]}: ` +
        `il pareggio è ${SU[su]}, il resto della giornata si sposta.`,
    );
  }

  if (uscente.composizione.fonte === 'tabella' || entrante.fonte === 'tabella') {
    avvisi.push(
      'Il conto usa valori di composizione indicativi, non confermati dal tuo nutrizionista.',
    );
  }

  if (Math.abs(delta.kcal) > 80) {
    avvisi.push(
      `Sono ${Math.abs(Math.round(delta.kcal))} kcal di differenza: non è una sostituzione a costo zero.`,
    );
  }

  return {
    ...comune,
    esito: 'calcolata',
    entra,
    base: baseUsata,
    nomeBase: NOME_BASE[baseUsata],
    baseRipiegata: ripiegata,
    delta,
    avvisi,
    spiegazione:
      baseUsata === 'nessuno'
        ? `pareggiando le calorie di ${esce.nome} (${Math.round(kcalDi(macroUscente))} kcal)`
        : `pareggiando ${ARTICOLO[baseUsata]} di ${esce.nome} (${Math.round(daPareggiare)} g)`,
  };
}

export interface Proposta {
  nome: string;
  quantita: number;
  unita: Unita;
  delta: Valori;
  /** Quanto è vicino l'originale, in kcal di scarto assoluto. */
  scarto: number;
}

/** Rapporto massimo di concentrazione rispetto all'originale. */
const DILUIZIONE_MASSIMA = 3;

/** Proposte tra gli alimenti già usati altrove nella dieta. */
export function proposte(
  esce: Alimento,
  candidati: string[],
  libreria?: Libreria,
  quante = 5,
  baseVoluta: BaseSostituzione = 'auto',
): Proposta[] {
  const uscente = macroDi(esce, libreria);
  if (!uscente) return [];

  const su = baseRichiesta(baseVoluta, uscente.composizione);
  const famiglia = caratterizzante(uscente.composizione);
  const norm = (s: string) => s.toLowerCase().trim();

  // Quanto del macronutriente di riferimento porta l'originale ogni 100 g.
  const resaUscente =
    su === 'nessuno'
      ? kcalDi(uscente.composizione)
      : uscente.composizione[su];

  const trovate: Proposta[] = [];
  const visti = new Set([norm(esce.nome)]);

  for (const nome of candidati) {
    if (visti.has(norm(nome))) continue;
    visti.add(norm(nome));

    const e = equivalenza(esce, nome, libreria, baseVoluta);
    if (e.esito !== 'calcolata' || !e.entra || !e.delta) continue;

    // Stessa unità dell'originale.
    if (e.entra.unita !== esce.unita) continue;

    // Stessa famiglia dell'alimento che esce.
    const c = composizioneDi(nome, e.entra.unita, libreria);
    if (!c) continue;
    if (caratterizzante(c) !== famiglia) continue;

    // Serve anche una concentrazione confrontabile.
    const resa = su === 'nessuno' ? kcalDi(c) : c[su];
    if (resa <= 0) continue;
    if (resa > resaUscente * DILUIZIONE_MASSIMA) continue;
    if (resa * DILUIZIONE_MASSIMA < resaUscente) continue;

    trovate.push({
      nome: e.entra.nome,
      quantita: e.entra.quantita!,
      unita: e.entra.unita,
      delta: e.delta,
      scarto: Math.abs(e.delta.kcal),
    });
  }

  return trovate.sort((a, b) => a.scarto - b.scarto).slice(0, quante);
}

/** Il totale di una porzione, per mostrarlo accanto alla proposta. */
export const valoriPorzione = (a: Alimento, libreria?: Libreria): Valori | null => {
  const m = macroDi(a, libreria);
  return m ? valoriDi(m.macro) : null;
};
