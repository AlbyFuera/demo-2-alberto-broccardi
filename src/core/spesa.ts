import type { Dieta } from '../types.ts';
import { normalizza } from './composizione.ts';

export interface RigaSpesa {
  nome: string;
  unita: string;
  /** Totale settimanale; null per gli alimenti q.b. */
  quantita: number | null;
  /** Numero di pasti in cui compare. */
  ricorrenze: number;
}

/** Ordinata per ricorrenza decrescente. */
export function listaSpesa(dieta: Dieta): RigaSpesa[] {
  const righe = new Map<string, RigaSpesa>();

  for (const giorno of dieta.giorni) {
    for (const pasto of giorno.pasti) {
      for (const a of pasto.alimenti) {
        const chiave = `${normalizza(a.nome)}|${a.unita}`;
        const riga = righe.get(chiave) ?? {
          nome: a.nome,
          unita: a.unita,
          quantita: a.libera || a.quantita === null ? null : 0,
          ricorrenze: 0,
        };

        riga.ricorrenze++;
        if (a.libera || a.quantita === null) riga.quantita = null;
        else if (riga.quantita !== null) riga.quantita += a.quantita;

        righe.set(chiave, riga);
      }
    }
  }

  return [...righe.values()].sort(
    (a, b) => b.ricorrenze - a.ricorrenze || a.nome.localeCompare(b.nome),
  );
}
