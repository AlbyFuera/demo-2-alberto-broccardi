/**
 * Il piano a sostituzione.
 *
 * È la cosa che il nutrizionista chiede da sempre e che nessuno scrive sul
 * foglio, perché sul foglio non ci sta: «a colazione la fonte proteica può
 * essere lo yogurt greco, i fiocchi di latte o due uova — scegli tu, basta che
 * resti in questo elenco».
 *
 * QUI L'ELENCO È CHIUSO, e questa è la differenza con `equivalenza.ts`. Là si
 * risponde a «posso mettere X al posto di Y?» per qualunque X, calcolando. Qui
 * si risponde a «cosa posso mettere?» con le SOLE cose che il professionista ha
 * ammesso. Le due convivono:
 *
 *   DENTRO il piano   il cliente sceglie da solo, l'aderenza non ne risente
 *   FUORI dal piano   il calcolo risponde lo stesso, ma è una deviazione, e
 *                     come tale viene registrata e contata
 *
 * LE QUANTITÀ. Il professionista può scriverle («yogurt greco 170 g») e allora
 * sono legge; se non le scrive le calcola il motore pareggiando secondo la base
 * dello slot — isocalorica, isoproteica, o il caratterizzante dell'alimento che
 * esce. Nessuno scriverebbe a mano sei grammature per trenta alimenti, ma tutti
 * vogliono poter correggere quella singola che nella loro esperienza va scritta
 * diversamente. Il campo dice anche a chi legge da dove viene il numero:
 * `fissata` significa «l'ha scritto lui», e in quel caso non c'è niente da
 * discutere.
 *
 * QUELLO CHE QUESTO MODULO NON FA: non inventa alternative. Se il professionista
 * non ne ha scritte, lo slot è `libero` e l'interfaccia lo dice — non si va a
 * pescare qualcosa di simile dalla tabella spacciandolo per una scelta sua.
 */

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

/* ------------------------------------------------------------------ */
/* Come si chiama questo posto nel pasto                               */
/* ------------------------------------------------------------------ */

const ETICHETTA_GRUPPO: Record<Caratterizzante, string> = {
  proteine: 'fonte proteica',
  carboidrati: 'fonte di carboidrati',
  grassi: 'fonte di grassi',
  nessuno: 'contorno o alimento libero',
};

/**
 * «Scegli la tua fonte proteica» invece di «scegli al posto del petto di pollo».
 *
 * Se il professionista ha scritto il gruppo, vince il suo: è il linguaggio con
 * cui parla ai suoi clienti. Altrimenti si deduce dal macronutriente
 * caratterizzante di quello che ha prescritto.
 */
export function etichettaGruppo(alimento: Alimento, libreria?: Libreria): string {
  const suo = alimento.gruppo?.trim();
  if (suo) return suo;

  const m = macroDi(alimento, libreria);
  return m ? ETICHETTA_GRUPPO[caratterizzante(m.composizione)] : 'alimento';
}

/* ------------------------------------------------------------------ */
/* Le opzioni di uno slot                                              */
/* ------------------------------------------------------------------ */

export interface OpzionePiano {
  nome: string;
  /** `null` solo quando non si è potuta calcolare: l'esito lo spiega. */
  quantita: number | null;
  unita: Unita;
  /** Come si scrive la porzione: «170g», «2 pz». */
  etichetta: string;
  /** La quantità l'ha scritta il professionista: non è un calcolo. */
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
  /** «fonte proteica». */
  gruppo: string;
  /** Su cosa si pareggia: la scelta del professionista, o 'auto'. */
  base: BaseSostituzione;
  /** Come si legge: «isoproteica», «isocalorica». */
  nomeBase: string;
  /** L'alimento come lo ha scritto il professionista. */
  prescritto: { nome: string; quantita: string };
  /** La prescritta più tutte le ammesse, in ordine di scrittura. */
  opzioni: OpzionePiano[];
  /**
   * Il professionista non ha previsto sostituzioni per questo alimento.
   *
   * Non è un errore ed è il caso più comune sulle diete già scritte: significa
   * che il cliente può ancora chiedere un cambio, ma sarà fuori piano.
   */
  libero: boolean;
}

const scriviPorzione = (q: number | null, u: Unita): string =>
  q === null ? 'q.b.' : u === 'pz' ? `${Math.round(q * 10) / 10} pz` : `${Math.round(q * 10) / 10}${u}`;

/**
 * Le scelte che il cliente ha davanti per un alimento.
 *
 * `prescritto` è l'alimento come l'ha scritto il professionista — NON quello
 * che il cliente ci ha già messo. È deliberato: le porzioni equivalenti si
 * calcolano sempre dall'originale, o sostituendo il sostituto le deviazioni si
 * accumulerebbero una sull'altra fino a portare il piatto lontanissimo da quello
 * che era stato prescritto.
 *
 * `nomeInPiatto` serve solo a marcare quale opzione risulta scelta adesso.
 *
 * `baseDieta` è la regola scritta dal professionista per tutto il piano. La
 * base con cui si pareggia si decide qui, e in QUESTO ordine:
 *
 *   1. l'eccezione scritta sull'alimento, se c'è;
 *   2. altrimenti la regola della dieta;
 *   3. altrimenti 'auto', sul macronutriente caratterizzante.
 *
 * Nell'elenco non c'è il cliente, e non è una dimenticanza: isocalorica o
 * isoproteica è una decisione clinica: chi segue la dieta la legge, non la
 * cambia.
 */
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
    // Un'alternativa che ripete l'alimento prescritto è rumore: il piatto di
    // partenza è già la prima opzione dell'elenco.
    if (normalizza(opzione.nome) === normalizza(prescritto.nome)) continue;
    opzione.scelta = inPiatto === normalizza(opzione.nome);
    opzioni.push(opzione);
  }

  // La base che si dichiara è quella dello slot, non quella di una singola
  // opzione: le opzioni possono aver ripiegato, e ognuna lo dice per sé.
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

/** Una singola alternativa: quantità scritta dal professionista o calcolata. */
function opzioneDa(
  prescritto: Alimento,
  alt: Alternativa,
  libreria: Libreria | undefined,
  base: BaseSostituzione,
): OpzionePiano {
  const nome = alt.nome.trim();

  /* Quantità scritta dal professionista: è legge, non si ricalcola. Si conta
     comunque quanto porta, perché il delta va mostrato lo stesso — lui ha
     deciso la porzione, non ha deciso che sia identica. */
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
      // Il motivo è scritto per il cliente: qui è l'unica cosa che spiega
      // perché un'alternativa che il suo nutrizionista ha ammesso compare
      // senza grammatura.
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

/* ------------------------------------------------------------------ */
/* Dentro o fuori dal piano                                            */
/* ------------------------------------------------------------------ */

/**
 * La sostituzione che il cliente sta facendo è fra quelle ammesse?
 *
 * È la domanda da cui dipende l'aderenza (`core/aderenza.ts`): dentro il piano
 * non toglie niente, fuori sì. Per questo il confronto è sui NOMI NORMALIZZATI
 * e non sulle quantità — il cliente sceglie «fiocchi di latte», la grammatura
 * gliela dà il motore, e pretendere che coincida al grammo significherebbe
 * dichiarare fuori piano una scelta che il professionista aveva ammesso.
 *
 * Torna sempre falso quando l'elenco è vuoto: senza un piano scritto non c'è
 * niente da rispettare, e dire il contrario renderebbe conforme qualunque cosa.
 */
export function nelPiano(prescritto: Alimento, nomeScelto: string): boolean {
  const cercato = normalizza(nomeScelto);
  if (!cercato) return false;

  // Tornare all'alimento prescritto è sempre dentro il piano: è la dieta.
  if (cercato === normalizza(prescritto.nome)) return true;

  return (prescritto.alternative ?? []).some((a) => normalizza(a.nome) === cercato);
}

/** Gli alimenti di una dieta per cui il professionista ha scritto delle alternative. */
export function alimentiConAlternative(alimenti: Alimento[]): number {
  return alimenti.filter((a) => (a.alternative?.length ?? 0) > 0).length;
}
