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

/** Scostamento massimo sulle kcal del pasto. */
const SCOSTAMENTO_MASSIMO = 0.15;

/** Perché due pasti siano confrontabili devono avere lo stesso ruolo. */
const stessoRuolo = (a: string, b: string): boolean => {
  const n = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  return n(a) === n(b);
};

/** Solo pasti con lo stesso nome. */
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
  const visti = new Set<string>([firmaDi(attuale)]);

  for (const g of dieta.giorni) {
    for (const p of g.pasti) {
      if (p.id === pastoId) continue;
      if (!stessoRuolo(p.nome, attuale.nome)) continue;
      if (p.alimenti.length === 0) continue;

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
