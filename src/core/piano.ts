import type { Alimento, Alternativa, BaseSostituzione, Unita, Valori } from '../types.ts';
import { valoriDi } from '../types.ts';
import { macroDi, normalizza, type Libreria } from './composizione.ts';
import {
  NOME_BASE,
  caratterizzante,
  equivalenza,
  type Caratterizzante,
  type EsitoEquivalenza,
} from './equivalenza.ts';

const ETICHETTA_GRUPPO: Record<Caratterizzante, string> = {
  proteine: 'fonte proteica',
  carboidrati: 'fonte di carboidrati',
  grassi: 'fonte di grassi',
  nessuno: 'contorno o alimento libero',
};

/** Il gruppo scritto dal professionista vince su quello dedotto. */
export function etichettaGruppo(alimento: Alimento, libreria?: Libreria): string {
  const suo = alimento.gruppo?.trim();
  if (suo) return suo;

  const m = macroDi(alimento, libreria);
  return m ? ETICHETTA_GRUPPO[caratterizzante(m.composizione)] : 'alimento';
}

export interface OpzionePiano {
  nome: string;
  /** `null` solo quando non si è potuta calcolare: l'esito lo spiega. */
  quantita: number | null;
  unita: Unita;
  /** Porzione formattata, es. 170g o 2 pz. */
  etichetta: string;
  /** Quantità scritta dal professionista, non calcolata. */
  fissata: boolean;
  /** È quello che sta nel piatto adesso. */
  scelta: boolean;
  /** È quello che il professionista aveva prescritto. */
  prescritta: boolean;
  valori: Valori | null;
  /** Scostamento rispetto all'alimento prescritto. Nullo sulla prescritta. */
  delta: Valori | null;
  esito: EsitoEquivalenza | 'prescritta' | 'fissata';
  avvisi: string[];
}

export interface Slot {
  /** Es. fonte proteica. */
  gruppo: string;
  /** Su cosa si pareggia: la scelta del professionista, o 'auto'. */
  base: BaseSostituzione;
  /** Es. isoproteica, isocalorica. */
  nomeBase: string;
  /** L'alimento come lo ha scritto il professionista. */
  prescritto: { nome: string; quantita: string };
  /** La prescritta più tutte le ammesse, in ordine di scrittura. */
  opzioni: OpzionePiano[];
  /** Nessuna alternativa prevista per questo alimento. */
  libero: boolean;
}

const scriviPorzione = (q: number | null, u: Unita): string =>
  q === null ? 'q.b.' : u === 'pz' ? `${Math.round(q * 10) / 10} pz` : `${Math.round(q * 10) / 10}${u}`;

/** Le quantità si calcolano sempre dal prescritto, non dalla scelta attuale. */
export function slotDi(
  prescritto: Alimento,
  libreria?: Libreria,
  nomeInPiatto?: string,
  baseDieta?: BaseSostituzione,
): Slot {
  const base = prescritto.base ?? baseDieta ?? 'auto';
  const alternative = prescritto.alternative ?? [];
  const inPiatto = normalizza(nomeInPiatto ?? prescritto.nome);

  const valoriPrescritto = macroDi(prescritto, libreria);

  const opzioni: OpzionePiano[] = [
    {
      nome: prescritto.nome,
      quantita: prescritto.quantita,
      unita: prescritto.unita,
      etichetta: scriviPorzione(prescritto.libera ? null : prescritto.quantita, prescritto.unita),
      fissata: true,
      scelta: inPiatto === normalizza(prescritto.nome),
      prescritta: true,
      valori: valoriPrescritto ? valoriDi(valoriPrescritto.macro) : null,
      delta: null,
      esito: 'prescritta',
      avvisi: [],
    },
  ];

  for (const alt of alternative) {
    const opzione = opzioneDa(prescritto, alt, libreria, base);
    if (normalizza(opzione.nome) === normalizza(prescritto.nome)) continue;
    opzione.scelta = inPiatto === normalizza(opzione.nome);
    opzioni.push(opzione);
  }

  const suDichiarata: Caratterizzante =
    base === 'auto'
      ? valoriPrescritto
        ? caratterizzante(valoriPrescritto.composizione)
        : 'nessuno'
      : base === 'kcal'
        ? 'nessuno'
        : base;

  return {
    gruppo: etichettaGruppo(prescritto, libreria),
    base,
    nomeBase: NOME_BASE[suDichiarata],
    prescritto: {
      nome: prescritto.nome,
      quantita: scriviPorzione(prescritto.libera ? null : prescritto.quantita, prescritto.unita),
    },
    opzioni,
    libero: alternative.length === 0,
  };
}

/** Quantità scritta dal professionista o calcolata. */
function opzioneDa(
  prescritto: Alimento,
  alt: Alternativa,
  libreria: Libreria | undefined,
  base: BaseSostituzione,
): OpzionePiano {
  const nome = alt.nome.trim();

  /* Quantità del professionista: non si ricalcola. */
  if (alt.quantita !== undefined && alt.quantita !== null) {
    const unita = alt.unita ?? prescritto.unita;
    const suo: Alimento = { nome, quantita: alt.quantita, unita };
    const m = macroDi(suo, libreria);
    const p = macroDi(prescritto, libreria);

    return {
      nome,
      quantita: alt.quantita,
      unita,
      etichetta: scriviPorzione(alt.quantita, unita),
      fissata: true,
      scelta: false,
      prescritta: false,
      valori: m ? valoriDi(m.macro) : null,
      delta:
        m && p
          ? {
              kcal: valoriDi(m.macro).kcal - valoriDi(p.macro).kcal,
              proteine: m.macro.proteine - p.macro.proteine,
              carboidrati: m.macro.carboidrati - p.macro.carboidrati,
              grassi: m.macro.grassi - p.macro.grassi,
            }
          : null,
      esito: 'fissata',
      avvisi: m ? [] : ['Quantità scritta dal tuo nutrizionista; il conto di questo alimento non lo so fare.'],
    };
  }

  /* Quantità da calcolare: l'equivalenza sulla base dello slot. */
  const e = equivalenza(prescritto, nome, libreria, base);

  if (e.esito !== 'calcolata' || !e.entra) {
    return {
      nome,
      quantita: null,
      unita: alt.unita ?? prescritto.unita,
      etichetta: '—',
      fissata: false,
      scelta: false,
      prescritta: false,
      valori: null,
      delta: null,
      esito: e.esito,
      avvisi: e.motivo ? [e.motivo] : [],
    };
  }

  const m = macroDi(e.entra, libreria);

  return {
    nome: e.entra.nome,
    quantita: e.entra.quantita,
    unita: e.entra.unita,
    etichetta: scriviPorzione(e.entra.quantita, e.entra.unita),
    fissata: false,
    scelta: false,
    prescritta: false,
    valori: m ? valoriDi(m.macro) : null,
    delta: e.delta ?? null,
    esito: 'calcolata',
    avvisi: e.avvisi,
  };
}

/** Confronto sui nomi normalizzati. */
export function nelPiano(prescritto: Alimento, nomeScelto: string): boolean {
  const cercato = normalizza(nomeScelto);
  if (!cercato) return false;

  // L'alimento prescritto è sempre nel piano.
  if (cercato === normalizza(prescritto.nome)) return true;

  return (prescritto.alternative ?? []).some((a) => normalizza(a.nome) === cercato);
}

/** Gli alimenti di una dieta per cui il professionista ha scritto delle alternative. */
export function alimentiConAlternative(alimenti: Alimento[]): number {
  return alimenti.filter((a) => (a.alternative?.length ?? 0) > 0).length;
}
