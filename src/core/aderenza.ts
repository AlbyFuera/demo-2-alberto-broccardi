/**
 * Quanto il cliente sta seguendo la dieta.
 *
 * È il numero che il nutrizionista guarda accanto a ogni nome, e per questo
 * deve essere difficile da leggere male. Quattro regole:
 *
 *  1. si misura su una FINESTRA di giorni passati, non da sempre. Un cliente
 *     bravo a marzo e sparito ad aprile non è un cliente all'85%;
 *  2. il giorno di OGGI non conta. È in corso: alle nove del mattino ha
 *     spuntato la colazione e mancano tre pasti, e includerlo farebbe crollare
 *     la percentuale ogni mattina per poi risalire ogni sera;
 *  3. i giorni SENZA NESSUNA SPUNTA non sono zero: sono ignoti. Chi non ha
 *     ancora capito che deve spuntare non è uno che salta i pasti, ed è una
 *     differenza che cambia la telefonata che il professionista gli farà;
 *  4. **chi rispetta il piano a sostituzione non perde niente.** Un pasto fatto
 *     scegliendo fra le alternative che il professionista ha ammesso vale
 *     quanto il pasto prescritto: è esattamente quello che gli è stato
 *     concesso di fare, e togliergli punti per averlo fatto significherebbe
 *     scrivere nell'applicazione il contrario di quello che c'è scritto nella
 *     dieta. Una sostituzione FUORI dal piano invece pesa: il pasto conta metà.
 *
 * La terza regola è quella che rende il numero onesto. Il costo è che un
 * cliente che smette di usare l'applicazione non appare come inadempiente:
 * appare come «nessun dato», che è esattamente quello che è.
 *
 * La quarta è quella che rende il prodotto usabile da chi lavora a
 * sostituzioni. Il mezzo punto non è una punizione, è un'informazione: dice al
 * professionista «segue, ma a modo suo», che è diverso sia da «segue» sia da
 * «non segue» e merita un numero diverso da entrambi.
 */

import type { Dieta } from '../types.ts';
import { giornoDi } from './dieta.ts';

export interface Spunta {
  /** 'AAAA-MM-GG' */
  giorno: string;
  pastoId: string;
  stato: 'fatto' | 'saltato';
}

/**
 * Una sostituzione attiva del cliente, come la vede l'aderenza.
 *
 * `giorno` è l'indice 0–6 e non una data, perché è così che vive nella dieta:
 * una sostituzione fatta sul pranzo di martedì vale per tutti i martedì
 * successivi, finché il professionista non la annulla. `dal` è la data in cui
 * il cliente l'ha fatta, e serve a non applicarla ai giorni precedenti — altri-
 * menti una sostituzione di oggi riscriverebbe all'indietro la settimana scorsa.
 */
export interface SostituzioneAttiva {
  giorno: number;
  pastoId: string;
  /** 'AAAA-MM-GG': il giorno in cui è stata fatta. */
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
  /** Pasti fatti scegliendo fra le alternative ammesse: non tolgono niente. */
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
    // Oggi è in corso: non entra nel conto.
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
  /** Il conto vero: i pasti fuori piano ci entrano per metà. */
  let punteggio = 0;

  for (let i = 1; i <= finestra; i++) {
    const data = giorniPrima(oggi, i);
    const indice = indiceGiorno(data);
    const previsti = giornoDi(dieta, indice)?.pasti ?? [];
    if (previsti.length === 0) continue; // giorno non scritto: non si giudica

    giorniOsservati++;

    const delGiorno = perGiorno.get(data) ?? [];
    if (delGiorno.length === 0) continue; // nessuna spunta: ignoto, non zero

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

      // Le sostituzioni attive su QUESTO pasto in QUESTO giorno. Una sola
      // fuori dal piano basta a rendere il pasto una deviazione: il resto del
      // piatto era conforme, ma quello che il cliente ha mangiato non è
      // quello che gli era stato concesso.
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

/* ------------------------------------------------------------------ */
/* La serie di giorni consecutivi                                      */
/* ------------------------------------------------------------------ */

export interface Serie {
  /** Giorni consecutivi in cui ha seguito la dieta. */
  giorni: number;
  /** Il record personale, per non azzerare la fatica fatta finora. */
  record: number;
  /** Oggi è già completo? Cambia cosa gli si dice. */
  oggiCompleto: boolean;
  descrizione: string;
}

/**
 * La serie: quanti giorni di fila sta seguendo la dieta.
 *
 * Un giorno conta quando TUTTI i pasti previsti sono stati segnati come fatti.
 * Non «almeno uno»: una serie che si allunga anche saltando due pasti su tre non
 * misura niente e chi la guarda smette di crederci.
 *
 * LA REGOLA CHE CONTA: se OGGI non è ancora completo, la serie si conta a
 * partire da IERI. Senza questo, alle nove del mattino la serie sarebbe sempre
 * zero e risalirebbe ogni sera — il numero più demotivante che si possa
 * mostrare a qualcuno che sta facendo bene da due settimane.
 */
export function calcolaSerie(dieta: Dieta, spunte: Spunta[], oggi: string): Serie {
  const perGiorno = new Map<string, Set<string>>();
  const saltati = new Map<string, Set<string>>();

  for (const s of spunte) {
    const mappa = s.stato === 'fatto' ? perGiorno : saltati;
    const insieme = mappa.get(s.giorno) ?? new Set<string>();
    insieme.add(s.pastoId);
    mappa.set(s.giorno, insieme);
  }

  /** Un giorno è «seguito» se tutti i pasti previsti sono stati fatti. */
  const seguito = (data: string): boolean => {
    const previsti = giornoDi(dieta, indiceGiorno(data))?.pasti ?? [];
    if (previsti.length === 0) return false;
    if ((saltati.get(data)?.size ?? 0) > 0) return false;

    const fatti = perGiorno.get(data) ?? new Set<string>();
    return previsti.every((p) => fatti.has(p.id));
  };

  const oggiCompleto = seguito(oggi);

  // Si parte da oggi se è completo, altrimenti da ieri: la giornata in corso
  // non deve azzerare quello che c'è dietro.
  let giorni = 0;
  for (let i = oggiCompleto ? 0 : 1; i < 400; i++) {
    if (!seguito(giorniPrima(oggi, i))) break;
    giorni++;
  }

  // Il record si cerca su tutto lo storico disponibile, non solo sulla serie in
  // corso: dopo un'interruzione resta la prova di essere già stato capace.
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
