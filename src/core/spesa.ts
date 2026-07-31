/**
 * La lista della spesa della settimana.
 *
 * Aggrega gli stessi alimenti attraverso i sette giorni. Non c'è nulla di
 * clinico qui: è aritmetica, ma è la funzione che il cliente usa il sabato
 * mattina, e senza di essa deve rileggersi la dieta sommando a mente.
 *
 * Gli alimenti a quantità libera restano nell'elenco SENZA un peso: «verdure
 * q.b.» va comprata, e farla sparire dalla lista perché non ha un numero
 * sarebbe il modo più diretto di far tornare il cliente a casa senza verdure.
 */

import type { Dieta } from '../types.ts';
import { normalizza } from './composizione.ts';

export interface RigaSpesa {
  nome: string;
  unita: string;
  /** Totale della settimana. `null` per gli alimenti «q.b.». */
  quantita: number | null;
  /** In quanti pasti compare: dà l'idea dell'impegno. */
  ricorrenze: number;
}

/**
 * Una sola lista, ordinata per ricorrenza decrescente.
 *
 * Niente categorie merceologiche: classificare «seitan» o «crema di frutta
 * secca» richiederebbe una tabella che qualcuno deve mantenere, e sbagliarla
 * darebbe una lista peggiore di una lista non ordinata.
 */
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
