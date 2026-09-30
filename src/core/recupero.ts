import type { Dieta, Giorno, Pasto, Totale, Valori } from '../types.ts';
import { TOTALE_ZERO, sommaTotali } from '../types.ts';
import type { Libreria } from './composizione.ts';
import { giornoDi, totaleGiorno, totalePasto } from './dieta.ts';

export interface Mancanza {
  kcal: number;
  proteine: number;
  carboidrati: number;
  grassi: number;
}

export interface Recupero {
  giorno: number;
  /** I pasti che il cliente dichiara di aver saltato. */
  saltati: { id: string; nome: string; valori: Valori }[];
  /** I pasti che restano da fare oggi, secondo l'ora. */
  rimanenti: { id: string; nome: string; orario?: string; valori: Valori }[];
  /** Il totale che il professionista aveva scritto per questo giorno. */
  previsto: Totale;
  /** Quanto il cliente ha effettivamente assunto, saltati esclusi. */
  assunto: Totale;
  /** Quanto manca al previsto. Positivo = manca. */
  manca: Mancanza;
  /** Quanto dei pasti rimanenti coprirà da solo. */
  copertoDaiRimanenti: Valori;
  /** Quanto resta scoperto a fine giornata. */
  scoperto: Mancanza;
  /** Il conto del giorno è incompleto. */
  parziale: boolean;
  /** Gli obiettivi dichiarati dal professionista, se ci sono. */
  obiettivoKcal: number | null;
}

const soloValori = (t: Totale): Valori => ({
  kcal: t.kcal,
  proteine: t.proteine,
  carboidrati: t.carboidrati,
  grassi: t.grassi,
});

const differenza = (previsto: Valori, assunto: Valori): Mancanza => ({
  kcal: previsto.kcal - assunto.kcal,
  proteine: previsto.proteine - assunto.proteine,
  carboidrati: previsto.carboidrati - assunto.carboidrati,
  grassi: previsto.grassi - assunto.grassi,
});

/** I pasti senza orario si considerano ancora da fare, salvo se già segnati. */
function ancoraDaFare(pasto: Pasto, ora: number, saltati: Set<string>, fatti: Set<string>): boolean {
  if (saltati.has(pasto.id) || fatti.has(pasto.id)) return false;
  if (!pasto.orario) return true;

  const m = /^(\d{1,2})[:.]?(\d{2})?/.exec(pasto.orario.trim());
  if (!m) return true;
  return Number(m[1]) >= ora;
}

/** `pastiSaltati`: id dei pasti dichiarati saltati; `pastiFatti`: già segnati come fatti. */
export function recupero(
  dieta: Dieta,
  indiceGiorno: number,
  pastiSaltati: string[],
  ora: number,
  libreria?: Libreria,
  pastiFatti: string[] = [],
): Recupero | null {
  const giorno = giornoDi(dieta, indiceGiorno);
  if (!giorno) return null;

  const saltati = new Set(pastiSaltati);
  const fatti = new Set(pastiFatti.filter((id) => !saltati.has(id)));
  const previsto = totaleGiorno(giorno, libreria);

  const assunto = giorno.pasti
    .filter((p) => !saltati.has(p.id))
    .reduce((acc, p) => sommaTotali(acc, totalePasto(p, libreria)), TOTALE_ZERO);

  const rimanenti = giorno.pasti.filter((p) => ancoraDaFare(p, ora, saltati, fatti));
  const copertoDaiRimanenti = soloValori(
    rimanenti.reduce((acc, p) => sommaTotali(acc, totalePasto(p, libreria)), TOTALE_ZERO),
  );

  // Quello che è già stato mangiato: né saltato, né ancora da fare.
  const idRimanenti = new Set(rimanenti.map((p) => p.id));
  const giaMangiato = soloValori(
    giorno.pasti
      .filter((p) => !saltati.has(p.id) && !idRimanenti.has(p.id))
      .reduce((acc, p) => sommaTotali(acc, totalePasto(p, libreria)), TOTALE_ZERO),
  );

  const finaleAtteso: Valori = {
    kcal: giaMangiato.kcal + copertoDaiRimanenti.kcal,
    proteine: giaMangiato.proteine + copertoDaiRimanenti.proteine,
    carboidrati: giaMangiato.carboidrati + copertoDaiRimanenti.carboidrati,
    grassi: giaMangiato.grassi + copertoDaiRimanenti.grassi,
  };

  // L'obiettivo dichiarato vince sul totale della dieta.
  const riferimento: Valori = {
    kcal: dieta.obiettivi.kcal ?? previsto.kcal,
    proteine: dieta.obiettivi.proteine ?? previsto.proteine,
    carboidrati: dieta.obiettivi.carboidrati ?? previsto.carboidrati,
    grassi: dieta.obiettivi.grassi ?? previsto.grassi,
  };

  return {
    giorno: indiceGiorno,
    saltati: giorno.pasti
      .filter((p) => saltati.has(p.id))
      .map((p) => ({ id: p.id, nome: p.nome, valori: soloValori(totalePasto(p, libreria)) })),
    rimanenti: rimanenti.map((p) => ({
      id: p.id,
      nome: p.nome,
      orario: p.orario,
      valori: soloValori(totalePasto(p, libreria)),
    })),
    previsto,
    assunto,
    manca: differenza(riferimento, soloValori(assunto)),
    copertoDaiRimanenti,
    scoperto: differenza(riferimento, finaleAtteso),
    parziale: previsto.mancanti.length > 0,
    obiettivoKcal: dieta.obiettivi.kcal ?? null,
  };
}

export function raccontaRecupero(r: Recupero, nomeProfessionista: string): string {
  const arr = (n: number) => Math.abs(Math.round(n));
  const frasi: string[] = [];

  if (r.saltati.length > 0) {
    const elenco = r.saltati.map((p) => p.nome.toLowerCase()).join(' e ');
    frasi.push(
      `Saltando ${elenco} lasci fuori ${arr(
        r.saltati.reduce((s, p) => s + p.valori.kcal, 0),
      )} kcal e ${arr(r.saltati.reduce((s, p) => s + p.valori.proteine, 0))} g di proteine.`,
    );
  }

  if (r.rimanenti.length > 0) {
    frasi.push(
      `Ti restano ${r.rimanenti.map((p) => p.nome.toLowerCase()).join(', ')}: ` +
        `messi insieme fanno ${arr(r.copertoDaiRimanenti.kcal)} kcal.`,
    );
  } else {
    frasi.push('Per oggi non ti resta nessun pasto in programma.');
  }

  const scoperto = Math.round(r.scoperto.kcal);
  if (scoperto > 50) {
    frasi.push(
      `Anche facendo tutto il resto, a fine giornata resteresti sotto di circa ` +
        `${arr(scoperto)} kcal e ${arr(r.scoperto.proteine)} g di proteine` +
        `${r.parziale ? ' (conto parziale)' : ''}. ` +
        `Come recuperarle non lo decido io: l'ho segnalato a ${nomeProfessionista}.`,
    );
  } else if (scoperto < -50) {
    frasi.push(
      `Così arriveresti circa ${arr(scoperto)} kcal SOPRA quello che ` +
        `${nomeProfessionista} ha previsto per oggi.`,
    );
  } else {
    frasi.push(`Facendo il resto della giornata rientri in quello che era previsto.`);
  }

  return frasi.join(' ');
}
