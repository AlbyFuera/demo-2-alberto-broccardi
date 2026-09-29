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

/** Applica le sostituzioni attive; l'ultima su uno stesso alimento vince. */
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

    // Resta visibile barrato accanto alla sostituzione.
    const originale = { nome: v.daNome, quantita: v.daQuantita };

    const { quantita, unita } = leggiQuantita(v.aQuantita);
    pasto.alimenti[v.indice] = {
      nome: v.aNome,
      quantita,
      unita,
      libera: quantita === null,
      nota: alimento.nota,
    // Le alternative restano quelle del posto nel pasto.
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

/** Le variazioni non annullate, nel formato dell'aderenza. */
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

/** Da "205g" o "1.5 pz" ai due campi; se non si riconosce, quantità libera. */
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
