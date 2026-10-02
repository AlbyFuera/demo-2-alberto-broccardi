import type { Dieta } from '../types.ts';
import { giornoDi } from './dieta.ts';
import { giorniPrima, indiceGiorno, type Spunta } from './aderenza.ts';

export interface GiornoDiario {
  /** 'AAAA-MM-GG' */
  data: string;
  /** 0-6, lunedì-domenica. */
  indice: number;
  previsti: number;
  fatti: number;
  saltati: number;
  liberi: number;
  passi: number | null;
  /** Millilitri. */
  acqua: number | null;
  peso: number | null;
  /** 'completo' | 'parziale' | 'vuoto' (nessuna spunta) | 'riposo' (nessun pasto previsto). */
  esito: 'completo' | 'parziale' | 'vuoto' | 'riposo';
}

/** Gli ultimi giorni, oggi compreso, dal più recente. */
export function diario(
  dieta: Dieta,
  spunte: Spunta[],
  oggi: string,
  extra: {
    passi?: { giorno: string; passi: number }[];
    acqua?: { giorno: string; ml: number }[];
    misure?: { giorno: string; peso: number | null }[];
  } = {},
  giorni = 14,
): GiornoDiario[] {
  const righe: GiornoDiario[] = [];

  for (let i = 0; i < giorni; i++) {
    const data = giorniPrima(oggi, i);
    const indice = indiceGiorno(data);
    const previsti = giornoDi(dieta, indice)?.pasti ?? [];
    const validi = new Set(previsti.map((p) => p.id));
    const sue = spunte.filter((s) => s.giorno === data && validi.has(s.pastoId));

    const fatti = sue.filter((s) => s.stato !== 'saltato').length;
    const saltati = sue.filter((s) => s.stato === 'saltato').length;
    const liberi = sue.filter((s) => s.stato === 'libero').length;

    righe.push({
      data,
      indice,
      previsti: previsti.length,
      fatti,
      saltati,
      liberi,
      passi: extra.passi?.find((p) => p.giorno === data)?.passi ?? null,
      acqua: extra.acqua?.find((a) => a.giorno === data)?.ml ?? null,
      peso: extra.misure?.find((m) => m.giorno === data)?.peso ?? null,
      esito:
        previsti.length === 0
          ? 'riposo'
          : sue.length === 0
            ? 'vuoto'
            : fatti === previsti.length
              ? 'completo'
              : 'parziale',
    });
  }

  return righe;
}

/** Giorni dall'ultima spunta; null se non ne ha mai fatte nel periodo. */
export function giorniSenzaSpunte(spunte: Spunta[], oggi: string): number | null {
  if (spunte.length === 0) return null;
  const ultima = spunte.reduce((max, s) => (s.giorno > max ? s.giorno : max), spunte[0].giorno);
  const [a, m, g] = ultima.split('-').map(Number);
  const [ao, mo, go] = oggi.split('-').map(Number);
  return Math.round((Date.UTC(ao, mo - 1, go) - Date.UTC(a, m - 1, g)) / 86_400_000);
}
