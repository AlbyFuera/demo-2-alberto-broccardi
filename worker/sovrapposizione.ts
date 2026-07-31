/**
 * Le sostituzioni del cliente, sovrapposte alla dieta del professionista.
 *
 * LA DIETA NON SI TOCCA. È il documento di chi la firma: quando il cliente
 * sostituisce il riso con le patate, il professionista deve poter continuare a
 * vedere che lui aveva scritto riso. La sostituzione vive altrove e viene
 * applicata al momento della lettura.
 *
 * Non c'è una tabella apposta: le sostituzioni attive SONO le righe di
 * `variations` non annullate. Una fonte di verità sola, con due conseguenze
 * che vengono gratis:
 *
 *   · il veto del professionista funziona da sé — mette la riga ad
 *     'annullata' e il piatto torna quello prescritto, senza una seconda
 *     scrittura che potrebbe fallire a metà;
 *   · non possono esistere una sostituzione applicata di cui lo studio non sa
 *     nulla, o una notifica senza il piatto corrispondente.
 */

import type { Dieta } from '../src/types.ts';
import type { SostituzioneAttiva } from '../src/core/aderenza.ts';
import type { VariazioneRiga } from './db.ts';

/** Una sostituzione applicata, come la vede l'interfaccia. */
export interface Sostituzione {
  variazioneId: string;
  giorno: number;
  pastoId: string;
  indice: number;
  /** Cosa aveva scritto il professionista. */
  originale: { nome: string; quantita: string };
}

/**
 * Applica le sostituzioni attive e restituisce una dieta nuova.
 *
 * L'ordine è dal più vecchio al più recente, così l'ultima sostituzione su uno
 * stesso alimento vince. Le variazioni che puntano a una posizione che non
 * esiste più — il professionista ha riscritto quel pasto — vengono SCARTATE e
 * dichiarate, mai applicate a caso su ciò che si trova a quell'indice.
 */
export function conSostituzioni(
  dieta: Dieta,
  variazioni: VariazioneRiga[],
): { dieta: Dieta; applicate: Sostituzione[]; scartate: VariazioneRiga[] } {
  const attive = variazioni
    .filter((v) => v.stato !== 'annullata' && v.dietaId === dieta.id)
    .slice()
    .sort((a, b) => a.at.localeCompare(b.at));

  if (attive.length === 0) return { dieta, applicate: [], scartate: [] };

  const copia: Dieta = structuredClone(dieta);
  const applicate: Sostituzione[] = [];
  const scartate: VariazioneRiga[] = [];

  for (const v of attive) {
    const pasto = copia.giorni
      .find((g) => g.indice === v.giorno)
      ?.pasti.find((p) => p.id === v.pastoId);
    const alimento = pasto?.alimenti[v.indice];

    if (!pasto || !alimento) {
      scartate.push(v);
      continue;
    }

    // Si conserva quello che il professionista aveva scritto: è ciò che il
    // cliente vede barrato accanto alla sostituzione, e ciò a cui si torna.
    const originale = { nome: v.daNome, quantita: v.daQuantita };

    const { quantita, unita } = leggiQuantita(v.aQuantita);
    pasto.alimenti[v.indice] = {
      nome: v.aNome,
      quantita,
      unita,
      libera: quantita === null,
      nota: alimento.nota,
      // Il piano a sostituzione appartiene al POSTO, non all'alimento che ci
      // sta dentro: chi ha già scelto i fiocchi di latte deve continuare a
      // vedere tutte le alternative previste per la sua fonte proteica, non
      // ritrovarsi senza scelte proprio perché ne ha fatta una.
      alternative: alimento.alternative,
      base: alimento.base,
      gruppo: alimento.gruppo,
    };

    applicate.push({
      variazioneId: v.id,
      giorno: v.giorno,
      pastoId: v.pastoId,
      indice: v.indice,
      originale,
    });
  }

  return { dieta: copia, applicate, scartate };
}

/**
 * Le variazioni tradotte in quello che serve all'aderenza.
 *
 * Le annullate escono: il piatto è tornato quello prescritto, e continuare a
 * contarle come deviazioni significherebbe far scendere l'aderenza di qualcuno
 * per una scelta che non è più nel suo piatto — o peggio, per un veto del suo
 * nutrizionista.
 */
export function sostituzioniAttive(variazioni: VariazioneRiga[]): SostituzioneAttiva[] {
  return variazioni
    .filter((v) => v.stato !== 'annullata')
    .map((v) => ({
      giorno: v.giorno,
      pastoId: v.pastoId,
      dal: v.at.slice(0, 10),
      nelPiano: v.nelPiano,
    }));
}

/**
 * Da "205g" o "1.5 pz" ai due campi separati.
 *
 * La quantità viaggia come testo nella riga di variazione perché è così che la
 * legge un umano nella notifica. Qui torna numero, e un testo non riconosciuto
 * diventa una quantità libera invece di uno zero: zero significherebbe «niente
 * nel piatto», che è un'affermazione forte e sbagliata.
 */
export function leggiQuantita(testo: string): {
  quantita: number | null;
  unita: 'g' | 'ml' | 'pz';
} {
  const m = /^\s*([\d.,]+)\s*(g|ml|pz)?\s*$/i.exec(testo);
  if (!m) return { quantita: null, unita: 'g' };

  const numero = Number(m[1].replace(',', '.'));
  const unita = (m[2]?.toLowerCase() ?? 'g') as 'g' | 'ml' | 'pz';

  return Number.isFinite(numero) ? { quantita: numero, unita } : { quantita: null, unita };
}
