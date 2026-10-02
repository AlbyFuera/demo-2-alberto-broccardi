import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  calcolaAderenza,
  calcolaSerie,
  giorniPrima,
  indiceGiorno,
  type SostituzioneAttiva,
  type Spunta,
} from '../src/core/aderenza.ts';
import type { Dieta } from '../src/types.ts';

/** Una dieta con due pasti identici in tutti e sette i giorni. */
function dietaSettimanale(): Dieta {
  return {
    id: 'die_test',
    titolo: 'Sette giorni uguali',
    indicazioni: [],
    obiettivi: {},
    giorni: [0, 1, 2, 3, 4, 5, 6].map((indice) => ({
      indice,
      pasti: [
        {
          id: `pas_pranzo_${indice}`,
          nome: 'Pranzo',
          alimenti: [{ nome: 'pasta', quantita: 100, unita: 'g' as const }],
        },
        {
          id: `pas_cena_${indice}`,
          nome: 'Cena',
          alimenti: [{ nome: 'merluzzo', quantita: 180, unita: 'g' as const }],
        },
      ],
    })),
  };
}

const OGGI = '2026-07-15';

/** Le spunte di tutti i pasti dei giorni indicati, contati all'indietro da oggi. */
function tuttoFatto(dieta: Dieta, giorniIndietro: number[]): Spunta[] {
  return giorniIndietro.flatMap((n) => {
    const giorno = giorniPrima(OGGI, n);
    const pasti = dieta.giorni.find((g) => g.indice === indiceGiorno(giorno))!.pasti;
    return pasti.map((p) => ({ giorno, pastoId: p.id, stato: 'fatto' as const }));
  });
}

describe('aderenza, le regole di sempre', () => {
  it('senza spunte non è zero: è ignota', () => {
    const a = calcolaAderenza(dietaSettimanale(), [], OGGI);
    assert.equal(a.livello, 'ignota');
    assert.equal(a.percentuale, null);
  });

  it('tutti i pasti fatti fanno cento', () => {
    const dieta = dietaSettimanale();
    const a = calcolaAderenza(dieta, tuttoFatto(dieta, [1, 2, 3]), OGGI);
    assert.equal(a.percentuale, 100);
    assert.equal(a.livello, 'buona');
    assert.equal(a.giorniConDati, 3);
  });

  it('il giorno di oggi non entra nel conto: è ancora in corso', () => {
    const dieta = dietaSettimanale();
    const soloOggi = dieta.giorni
      .find((g) => g.indice === indiceGiorno(OGGI))!
      .pasti.map((p) => ({ giorno: OGGI, pastoId: p.id, stato: 'fatto' as const }));

    assert.equal(calcolaAderenza(dieta, soloOggi, OGGI).percentuale, null);
  });

  it('un pasto saltato abbassa la percentuale', () => {
    const dieta = dietaSettimanale();
    const spunte = tuttoFatto(dieta, [1]);
    spunte[0] = { ...spunte[0], stato: 'saltato' };

    assert.equal(calcolaAderenza(dieta, spunte, OGGI).percentuale, 50);
  });
});

describe('aderenza e piano a sostituzione', () => {
  const dieta = dietaSettimanale();
  const ieri = giorniPrima(OGGI, 1);
  const indiceIeri = indiceGiorno(ieri);
  const pranzoIeri = dieta.giorni.find((g) => g.indice === indiceIeri)!.pasti[0].id;

  const sostituzione = (nelPiano: boolean): SostituzioneAttiva[] => [
    { giorno: indiceIeri, pastoId: pranzoIeri, dal: ieri, nelPiano },
  ];

  it('una sostituzione prevista dal piano non toglie niente', () => {
    const a = calcolaAderenza(dieta, tuttoFatto(dieta, [1]), OGGI, 7, sostituzione(true));
    assert.equal(a.percentuale, 100);
    assert.equal(a.pastiConSostituzioniAmmesse, 1);
    assert.equal(a.pastiFuoriPiano, 0);
    assert.ok(a.descrizione.includes('non contano contro'));
  });

  it('una sostituzione fuori dal piano fa pesare il pasto per metà', () => {
    const a = calcolaAderenza(dieta, tuttoFatto(dieta, [1]), OGGI, 7, sostituzione(false));
    // Due pasti previsti, entrambi fatti, uno dei due deviato: 1,5 su 2.
    assert.equal(a.percentuale, 75);
    assert.equal(a.pastiFatti, 2, 'resta un pasto fatto: non è saltato');
    assert.equal(a.pastiFuoriPiano, 1);
  });

  it('non si applica ai giorni precedenti a quando è stata fatta', () => {
    const spunte = tuttoFatto(dieta, [1, 8]);
    const soloDaIeri: SostituzioneAttiva[] = [
      { giorno: indiceIeri, pastoId: pranzoIeri, dal: ieri, nelPiano: false },
    ];

    // Ieri e otto giorni fa: stesso giorno della settimana e pasto.
    const a = calcolaAderenza(dieta, spunte, OGGI, 15, soloDaIeri);
    assert.equal(a.pastiFuoriPiano, 1, 'solo il pasto di ieri è deviato');
  });

  it('un pasto saltato non diventa fuori piano per una sostituzione', () => {
    const spunte = tuttoFatto(dieta, [1]).map((s) =>
      s.pastoId === pranzoIeri ? { ...s, stato: 'saltato' as const } : s,
    );
    const a = calcolaAderenza(dieta, spunte, OGGI, 7, sostituzione(false));
    assert.equal(a.pastiFuoriPiano, 0);
    assert.equal(a.pastiSaltati, 1);
    assert.equal(a.percentuale, 50);
  });
});

describe('serie di giorni consecutivi', () => {
  it('non si azzera perché oggi non è ancora completo', () => {
    const dieta = dietaSettimanale();
    const s = calcolaSerie(dieta, tuttoFatto(dieta, [1, 2, 3]), OGGI);
    assert.equal(s.giorni, 3);
    assert.equal(s.oggiCompleto, false);
  });

  it('un giorno con un pasto saltato interrompe la serie', () => {
    const dieta = dietaSettimanale();
    const spunte = tuttoFatto(dieta, [1, 2, 3]);
    spunte[0] = { ...spunte[0], stato: 'saltato' };

    assert.equal(calcolaSerie(dieta, spunte, OGGI).giorni, 0);
  });
});

describe('pasto libero', () => {
  it('vale come un pasto fatto e si conta a parte', () => {
    const dieta = dietaSettimanale();
    const ieri = giorniPrima(OGGI, 1);
    const i = indiceGiorno(ieri);
    const spunte: Spunta[] = [
      { giorno: ieri, pastoId: `pas_pranzo_${i}`, stato: 'fatto' },
      { giorno: ieri, pastoId: `pas_cena_${i}`, stato: 'libero' },
    ];
    const a = calcolaAderenza(dieta, spunte, OGGI);
    assert.equal(a.percentuale, 100);
    assert.equal(a.pastiFatti, 2);
    assert.equal(a.pastiLiberi, 1);
  });

  it('non interrompe la serie', () => {
    const dieta = dietaSettimanale();
    const ieri = giorniPrima(OGGI, 1);
    const i = indiceGiorno(ieri);
    const spunte: Spunta[] = [
      { giorno: ieri, pastoId: `pas_pranzo_${i}`, stato: 'libero' },
      { giorno: ieri, pastoId: `pas_cena_${i}`, stato: 'fatto' },
    ];
    assert.equal(calcolaSerie(dieta, spunte, OGGI).giorni, 1);
  });
});
