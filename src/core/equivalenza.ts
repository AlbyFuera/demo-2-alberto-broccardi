/**
 * Sostituzioni per equivalenza nutrizionale.
 *
 * Nel sistema precedente una sostituzione era ammessa se il piano la elencava.
 * Qui la dieta la scrive il professionista giorno per giorno e non contiene un
 * elenco di alternative: la domanda «posso mettere X al posto di Y?» va quindi
 * risolta con un calcolo, non con un'appartenenza.
 *
 * LA REGOLA PREDEFINITA, che è quella che usano i nutrizionisti a mano:
 *
 *   si pareggia il MACRONUTRIENTE CARATTERIZZANTE dell'alimento che esce.
 *
 * 100 g di pasta si sostituiscono con la quantità di riso che porta gli stessi
 * carboidrati, non le stesse calorie. Pareggiare le kcal tra una fonte di
 * carboidrati e una di grassi darebbe un numero giusto e una dieta sbagliata:
 * stesse calorie, macronutrienti stravolti.
 *
 * MA LA REGOLA SI PUÒ FISSARE, ed è il professionista a farlo per ogni alimento
 * (`Alimento.base`): isocalorica o isoproteica sono due domande diverse e su un
 * piano danno due porzioni diverse. 180 g di merluzzo portano 31 g di proteine
 * e 128 kcal: la sostituzione ISOPROTEICA è quella che porta 31 g di proteine —
 * 135 g di petto di pollo — e la ISOCALORICA quella che porta 128 kcal — 85 g.
 * Quale delle due sia quella giusta lo decide chi ha firmato la dieta, non
 * questo modulo; qui si calcolano entrambe e si dice sempre quale si è usata.
 *
 * TRE COSE CHE QUESTO MODULO NON FA, per scelta:
 *
 *  · non decide se la sostituzione è opportuna. Dice di quanto sposta la
 *    giornata e lo manda al professionista, che ha l'ultima parola;
 *  · non inventa composizioni. Se non conosce uno dei due alimenti si ferma e
 *    lo dice — un'equivalenza calcolata su valori inventati è peggio di nessuna
 *    equivalenza;
 *  · non arrotonda in silenzio verso il basso o l'alto. La quantità consigliata
 *    è arrotondata a 5 g e lo scostamento è calcolato SULLA QUANTITÀ
 *    ARROTONDATA, cioè su quello che il cliente si metterà davvero nel piatto.
 */

import type { Alimento, BaseSostituzione, Macro, Unita, Valori } from '../types.ts';
import { kcalDi, valoriDi } from '../types.ts';
import { composizioneDi, macroDi, type Composizione, type Libreria } from './composizione.ts';

/* ------------------------------------------------------------------ */
/* Che tipo di alimento è                                              */
/* ------------------------------------------------------------------ */

export type Caratterizzante = 'proteine' | 'carboidrati' | 'grassi' | 'nessuno';

/**
 * Il macronutriente che caratterizza un alimento.
 *
 * Si guarda la ripartizione delle CALORIE, non dei grammi: 100 g di olio sono
 * 100 g di grassi e nessun dubbio, ma 100 g di pasta sono 75 g di carboidrati e
 * 13 di proteine — a grammi sembrerebbe meno sbilanciata di quanto sia.
 *
 * `nessuno` per gli alimenti che non caratterizzano niente (le verdure): lì la
 * sostituzione si fa a peso, ed è giusto così.
 */
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

  // Sotto il 40% nessun macronutriente comanda davvero: è un alimento misto
  // (un piatto pronto, un gelato) e si pareggiano le calorie.
  return quota >= 0.4 ? nome : 'nessuno';
}

const ETICHETTA: Record<Caratterizzante, string> = {
  proteine: 'fonte proteica',
  carboidrati: 'fonte di carboidrati',
  grassi: 'fonte di grassi',
  nessuno: 'alimento misto o a basso apporto',
};

/** «le proteine» ma «i carboidrati»: il genere cambia, e le frasi si leggono. */
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

/**
 * Dalla base chiesta al macronutriente su cui si pareggia.
 *
 * `auto` guarda l'alimento che esce e sceglie il suo caratterizzante: è il
 * comportamento storico, e resta quello che si usa quando nessuno ha deciso
 * altro. `kcal` diventa 'nessuno', che in questo modulo significa da sempre
 * «pareggia le calorie».
 */
function baseRichiesta(base: BaseSostituzione, composizioneUscente: Macro): Caratterizzante {
  if (base === 'auto') return caratterizzante(composizioneUscente);
  return base === 'kcal' ? 'nessuno' : base;
}

/* ------------------------------------------------------------------ */
/* L'equivalenza                                                       */
/* ------------------------------------------------------------------ */

export type EsitoEquivalenza =
  /** Calcolata: c'è una quantità consigliata. */
  | 'calcolata'
  /** Non si conosce la composizione di uno dei due: decide il professionista. */
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
  /**
   * Come si chiama il pareggio fatto: «isoproteica», «isocalorica».
   *
   * Sta accanto a `base` e non al posto suo perché sono due letture della
   * stessa cosa e servono a due lettori diversi: il professionista legge «su
   * proteine», il cliente legge «isoproteica».
   */
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

/**
 * Quanto può crescere una porzione rispetto a quella prescritta prima di
 * smettere di essere una porzione. Cinque volte: 100 g di pasta possono
 * diventare 500 g di patate — che è tanto ma esiste — non un chilo e mezzo.
 */
const PORZIONE_MASSIMA = 5;

/** Le porzioni si arrotondano a 5: nessuno pesa 137 g di riso. */
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

/**
 * Calcola con quanto di `nomeEntra` si sostituisce `esce`.
 *
 * `unitaEntra` si eredita da chi esce quando è compatibile: se il cliente
 * sostituisce 130 g di pasta chiede grammi, non pezzi. Per gli alimenti che si
 * contano a pezzo la tabella lo sa già e l'unità la decide lei.
 *
 * `baseVoluta` è la scelta del professionista — isocalorica, isoproteica — e
 * quando non è applicabile (si chiede una isoproteica verso un alimento che di
 * proteine non ne ha) NON si finge di averla rispettata: si ripiega sulle
 * calorie, `baseRipiegata` diventa vero e l'avviso lo dice.
 */
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

  // L'unità di chi entra: quella della tabella se è un alimento a pezzo,
  // altrimenti si eredita da chi esce.
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

  // Per 100 g/ml (o per pezzo) di chi entra, quanto c'è del macronutriente su
  // cui si pareggia. Se è zero non si può pareggiare su quello.
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
    // Non si può pareggiare sul macronutriente voluto (es. pasta → petto di
    // pollo, che di carboidrati non ne ha). Si ripiega sulle calorie e lo si
    // dice: è una sostituzione che cambia la forma della giornata, non solo un
    // ingrediente, e chi la fa deve saperlo.
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

    /*
     * La porzione uscita dal pareggio è fuori scala.
     *
     * Succede quando l'alimento che entra contiene il macronutriente voluto
     * solo in tracce: il miele ha 0,3 g di proteine per 100 g, e pareggiare i
     * 34 g di proteine di un petto di pollo chiede undici chili di miele. Il
     * conto è giusto, la porzione non esiste, e stamparla sarebbe peggio che
     * non rispondere — qualcuno potrebbe seguirla.
     *
     * Si ripiega sulle calorie E LO SI DICE. Il limite è cinque volte la
     * porzione prescritta, e vale solo a unità confrontabili: «cinque volte»
     * fra grammi e pezzi non significa niente.
     */
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

  // Lo scostamento si calcola sulla quantità ARROTONDATA: è quella che il
  // cliente si mette nel piatto, e un delta calcolato sul numero esatto
  // descriverebbe un pasto che nessuno mangerà.
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

/* ------------------------------------------------------------------ */
/* Proposte, quando il cliente non nomina il sostituto                 */
/* ------------------------------------------------------------------ */

export interface Proposta {
  nome: string;
  quantita: number;
  unita: Unita;
  delta: Valori;
  /** Quanto è vicino l'originale, in kcal di scarto assoluto. */
  scarto: number;
}

/**
 * Quanto un candidato può essere più diluito o più concentrato dell'originale.
 *
 * Tre volte. È il limite che tiene fuori le proposte aritmeticamente corrette e
 * praticamente assurde: 100 g di pasta portano 75 g di carboidrati, e il latte
 * ne ha 5 per 100 ml — il pareggio esiste, ed è un litro e mezzo di latte.
 * Nessun nutrizionista lo scriverebbe, e proporlo fa perdere fiducia in tutte
 * le altre proposte, comprese quelle buone.
 *
 * Chi vuole comunque quella sostituzione può nominarla: `equivalenza` la
 * calcola e la dichiara, con i suoi avvisi. Qui si scelgono i suggerimenti, e
 * un suggerimento assurdo è peggio di un suggerimento in meno.
 */
const DILUIZIONE_MASSIMA = 3;

/**
 * «Cosa posso mettere al posto del pollo?»
 *
 * Le proposte si cercano tra gli alimenti che il professionista ha già usato
 * ALTROVE nella stessa dieta. È una scelta deliberata: sono cibi che lui ha già
 * ritenuto adatti a questo cliente, e proporre invece tutto il contenuto della
 * tabella significherebbe suggerire alimenti che nessuno ha approvato.
 */
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

    // Stessa unità di misura dell'originale. Sostituire 150 g di pollo con
    // «5,5 uova» è un conto giusto e un consiglio che nessuno seguirebbe: chi
    // vuole le uova le nomina, e allora l'equivalenza gliele calcola con i
    // suoi avvisi.
    if (e.entra.unita !== esce.unita) continue;

    // Solo alimenti della stessa famiglia: proporre le zucchine al posto del
    // pollo è aritmeticamente possibile e nutrizionalmente assurdo. La famiglia
    // si guarda SEMPRE sul caratterizzante dell'alimento che esce, anche quando
    // il pareggio è isocalorico: «stesse calorie» non autorizza a mettere
    // dell'olio al posto della pasta.
    const c = composizioneDi(nome, e.entra.unita, libreria);
    if (!c) continue;
    if (caratterizzante(c) !== famiglia) continue;

    // E con una concentrazione confrontabile, o la porzione esce di scala.
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
