/**
 * Cambio di un pasto intero, a calorie invariate.
 *
 * L'equivalenza (`equivalenza.ts`) sostituisce UN alimento. Qui si sostituisce
 * un PASTO: il cliente non ha voglia del pranzo di oggi e ne vuole un altro che
 * non gli sfasi la giornata.
 *
 * DA DOVE ESCONO I PASTI PROPOSTI, ed è la scelta che regge tutto: dagli ALTRI
 * GIORNI DELLA SUA STESSA DIETA. Non da una tabella di ricette, non
 * dall'invenzione di un modello. Sono pasti che il suo nutrizionista ha già
 * scritto per lui, quindi già adatti alle sue intolleranze, ai suoi gusti e ai
 * suoi obiettivi — e lo scambio si limita a spostarli di giorno.
 *
 * Questo è ciò che permette al cambio di avvenire SENZA approvazione: non si sta
 * concedendo niente di nuovo, si sta permettendo al cliente di mangiare giovedì
 * quello che avrebbe mangiato sabato. Un motore che inventasse pasti nuovi
 * dovrebbe invece passare dal professionista, perché starebbe scrivendo dieta.
 */

import type { Dieta, Pasto, Valori } from '../types.ts';
import type { Libreria } from './composizione.ts';
import { nomeGiorno, totalePasto } from './dieta.ts';

export interface PastoAlternativo {
  giorno: number;
  giornoNome: string;
  pasto: Pasto;
  valori: Valori;
  /** Scostamento rispetto al pasto che si sta sostituendo. */
  delta: Valori;
  /** Scarto calorico assoluto: è l'ordinamento. */
  scarto: number;
  /** Il conto di questo pasto è incompleto. */
  parziale: boolean;
}

/**
 * Quanto un pasto alternativo può discostarsi, in percentuale sulle calorie.
 *
 * Il quindici per cento su un pranzo da 600 kcal sono novanta: una differenza
 * che si assorbe nella giornata. Oltre non è più «lo stesso pranzo di un altro
 * giorno», è un'altra dieta, e quella la scrive il professionista.
 */
const SCOSTAMENTO_MASSIMO = 0.15;

/** Perché due pasti siano confrontabili devono avere lo stesso ruolo. */
const stessoRuolo = (a: string, b: string): boolean => {
  const n = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  return n(a) === n(b);
};

/**
 * I pasti con cui si può scambiare quello di oggi.
 *
 * Solo pasti con lo STESSO NOME: si scambia un pranzo con un pranzo. Scambiare
 * il pranzo con una colazione rispetterebbe le calorie e produrrebbe fette
 * biscottate alle tredici — aritmeticamente giusto, umanamente assurdo.
 */
export function pastiAlternativi(
  dieta: Dieta,
  giorno: number,
  pastoId: string,
  libreria?: Libreria,
  quanti = 4,
): { attuale: Pasto | null; alternativi: PastoAlternativo[] } {
  const oggi = dieta.giorni.find((g) => g.indice === giorno);
  const attuale = oggi?.pasti.find((p) => p.id === pastoId) ?? null;
  if (!attuale) return { attuale: null, alternativi: [] };

  const suo = totalePasto(attuale, libreria);
  const soglia = Math.max(60, suo.kcal * SCOSTAMENTO_MASSIMO);

  const firmaDi = (p: Pasto) =>
    p.alimenti
      .map((a) => `${a.nome}|${a.quantita ?? 'q'}${a.unita}`)
      .sort()
      .join('+');

  const trovati: PastoAlternativo[] = [];
  // La firma del pasto ATTUALE entra subito fra quelle già viste: due giorni
  // diversi possono avere lo stesso identico pranzo, e proporre al cliente
  // quello che ha già nel piatto è peggio che non proporgli niente.
  const visti = new Set<string>([firmaDi(attuale)]);

  for (const g of dieta.giorni) {
    for (const p of g.pasti) {
      if (p.id === pastoId) continue;
      if (!stessoRuolo(p.nome, attuale.nome)) continue;
      if (p.alimenti.length === 0) continue;

      // Due giorni possono avere lo stesso identico pasto: proporlo due volte
      // fa sembrare che ci sia più scelta di quanta ce ne sia.
      const firma = firmaDi(p);
      if (visti.has(firma)) continue;
      visti.add(firma);

      const t = totalePasto(p, libreria);
      const delta: Valori = {
        kcal: t.kcal - suo.kcal,
        proteine: t.proteine - suo.proteine,
        carboidrati: t.carboidrati - suo.carboidrati,
        grassi: t.grassi - suo.grassi,
      };

      if (Math.abs(delta.kcal) > soglia) continue;

      trovati.push({
        giorno: g.indice,
        giornoNome: nomeGiorno(g.indice),
        pasto: p,
        valori: { kcal: t.kcal, proteine: t.proteine, carboidrati: t.carboidrati, grassi: t.grassi },
        delta,
        scarto: Math.abs(delta.kcal),
        parziale: t.mancanti.length > 0 || suo.mancanti.length > 0,
      });
    }
  }

  return {
    attuale,
    alternativi: trovati.sort((a, b) => a.scarto - b.scarto).slice(0, quanti),
  };
}
