import type { Dieta } from '../types.ts';
import { giornoDi } from './dieta.ts';

export interface Spunta {
  /** 'AAAA-MM-GG' */
  giorno: string;
  pastoId: string;
  stato: 'fatto' | 'saltato';
}

/** `giorno` è l'indice 0-6, non una data. */
export interface SostituzioneAttiva {
  giorno: number;
  pastoId: string;
  /** 'AAAA-MM-GG' */
  dal: string;
  /** Rientra fra le alternative ammesse dal professionista. */
  nelPiano: boolean;
}

/** Quanto vale un pasto fatto con una sostituzione fuori dal piano. */
const PESO_FUORI_PIANO = 0.5;

export type LivelloAderenza = 'buona' | 'parziale' | 'scarsa' | 'ignota';

export interface Aderenza {
  livello: LivelloAderenza;
  /** 0–100, oppure null quando non ci sono dati. */
  percentuale: number | null;
  /** Giorni in cui il cliente ha spuntato almeno una volta. */
  giorniConDati: number;
  /** Giorni della finestra, oggi escluso. */
  giorniOsservati: number;
  pastiFatti: number;
  pastiSaltati: number;
  pastiPrevisti: number;
  /** Pasti con sostituzioni ammesse. */
  pastiConSostituzioniAmmesse: number;
  /** Pasti fatti con una sostituzione che il piano non prevedeva. */
  pastiFuoriPiano: number;
  /** Frase pronta per l'interfaccia. */
  descrizione: string;
}

/** L'indice 0–6 (lunedì–domenica) di una data 'AAAA-MM-GG'. */
export function indiceGiorno(data: string): number {
  const [a, m, g] = data.split('-').map(Number);
  return (new Date(Date.UTC(a, m - 1, g)).getUTCDay() + 6) % 7;
}

/** La data di N giorni fa rispetto a `oggi`, in 'AAAA-MM-GG'. */
export function giorniPrima(oggi: string, n: number): string {
  const [a, m, g] = oggi.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1, g));
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export function calcolaAderenza(
  dieta: Dieta,
  spunte: Spunta[],
  oggi: string,
  finestra = 7,
  sostituzioni: SostituzioneAttiva[] = [],
): Aderenza {
  const perGiorno = new Map<string, Spunta[]>();
  for (const s of spunte) {
    // Oggi non entra nel conto.
    if (s.giorno >= oggi) continue;
    const lista = perGiorno.get(s.giorno) ?? [];
    lista.push(s);
    perGiorno.set(s.giorno, lista);
  }

  let pastiFatti = 0;
  let pastiSaltati = 0;
  let pastiPrevisti = 0;
  let giorniConDati = 0;
  let giorniOsservati = 0;
  let ammesse = 0;
  let fuoriPiano = 0;
  /** I pasti fuori piano valgono metà. */
  let punteggio = 0;

  for (let i = 1; i <= finestra; i++) {
    const data = giorniPrima(oggi, i);
    const indice = indiceGiorno(data);
    const previsti = giornoDi(dieta, indice)?.pasti ?? [];
    if (previsti.length === 0) continue; // giorno senza pasti: escluso

    giorniOsservati++;

    const delGiorno = perGiorno.get(data) ?? [];
    if (delGiorno.length === 0) continue; // nessuna spunta: dato mancante

    giorniConDati++;
    pastiPrevisti += previsti.length;

    const validi = new Set(previsti.map((p) => p.id));
    for (const s of delGiorno) {
      if (!validi.has(s.pastoId)) continue; // spunta di un pasto non più previsto
      if (s.stato !== 'fatto') {
        pastiSaltati++;
        continue;
      }

      pastiFatti++;

      const sue = sostituzioni.filter(
        (v) => v.giorno === indice && v.pastoId === s.pastoId && v.dal <= data,
      );

      if (sue.some((v) => !v.nelPiano)) {
        fuoriPiano++;
        punteggio += PESO_FUORI_PIANO;
      } else {
        if (sue.length > 0) ammesse++;
        punteggio += 1;
      }
    }
  }

  if (giorniConDati === 0 || pastiPrevisti === 0) {
    return {
      livello: 'ignota',
      percentuale: null,
      giorniConDati: 0,
      giorniOsservati,
      pastiFatti: 0,
      pastiSaltati: 0,
      pastiPrevisti: 0,
      pastiConSostituzioniAmmesse: 0,
      pastiFuoriPiano: 0,
      descrizione: 'Non ha ancora segnato nessun pasto: non c’è modo di dirlo.',
    };
  }

  const percentuale = Math.round((punteggio / pastiPrevisti) * 100);
  const livello: LivelloAderenza =
    percentuale >= 80 ? 'buona' : percentuale >= 50 ? 'parziale' : 'scarsa';

  return {
    livello,
    percentuale,
    giorniConDati,
    giorniOsservati,
    pastiFatti,
    pastiSaltati,
    pastiPrevisti,
    pastiConSostituzioniAmmesse: ammesse,
    pastiFuoriPiano: fuoriPiano,
    descrizione:
      `${pastiFatti} pasti su ${pastiPrevisti} negli ultimi ${giorniConDati} ` +
      `giorn${giorniConDati === 1 ? 'o' : 'i'} in cui ha segnato qualcosa` +
      (ammesse > 0
        ? `, ${ammesse} con sostituzioni previste dal piano (non contano contro)`
        : '') +
      (fuoriPiano > 0
        ? `, ${fuoriPiano} con sostituzioni fuori dal piano`
        : '') +
      `.`,
  };
}

export interface Serie {
  /** Giorni consecutivi in cui ha seguito la dieta. */
  giorni: number;
  /** Record personale. */
  record: number;
  /** Oggi è già completo? */
  oggiCompleto: boolean;
  descrizione: string;
}

/** Un giorno conta solo se tutti i pasti previsti sono fatti. */
export function calcolaSerie(dieta: Dieta, spunte: Spunta[], oggi: string): Serie {
  const perGiorno = new Map<string, Set<string>>();
  const saltati = new Map<string, Set<string>>();

  for (const s of spunte) {
    const mappa = s.stato === 'fatto' ? perGiorno : saltati;
    const insieme = mappa.get(s.giorno) ?? new Set<string>();
    insieme.add(s.pastoId);
    mappa.set(s.giorno, insieme);
  }

  /** Seguito = tutti i pasti previsti fatti. */
  const seguito = (data: string): boolean => {
    const previsti = giornoDi(dieta, indiceGiorno(data))?.pasti ?? [];
    if (previsti.length === 0) return false;
    if ((saltati.get(data)?.size ?? 0) > 0) return false;

    const fatti = perGiorno.get(data) ?? new Set<string>();
    return previsti.every((p) => fatti.has(p.id));
  };

  const oggiCompleto = seguito(oggi);

  // Si parte da ieri se oggi non è completo.
  let giorni = 0;
  for (let i = oggiCompleto ? 0 : 1; i < 400; i++) {
    if (!seguito(giorniPrima(oggi, i))) break;
    giorni++;
  }

  let record = giorni;
  let corrente = 0;
  const date = [...new Set([...perGiorno.keys(), ...saltati.keys()])].sort();
  for (const data of date) {
    if (seguito(data)) {
      corrente++;
      record = Math.max(record, corrente);
    } else {
      corrente = 0;
    }
  }

  return {
    giorni,
    record,
    oggiCompleto,
    descrizione:
      giorni === 0
        ? 'Segna i pasti di oggi per iniziare una serie.'
        : giorni === 1
          ? oggiCompleto
            ? 'Oggi è a posto. Domani sono due.'
            : 'Ieri hai seguito tutto. Segna oggi e sono due.'
          : `${giorni} giorni di fila` +
            (oggiCompleto ? '.' : ', oggi ancora da completare.') +
            (record > giorni ? ` Il tuo record è ${record}.` : ''),
  };
}
