import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { diario, giorniSenzaSpunte } from '../src/core/diario.ts';
import { giorniPrima, indiceGiorno, type Spunta } from '../src/core/aderenza.ts';
import { dietaDiProva } from './dieta-di-prova.ts';

const OGGI = '2026-07-13'; // lunedì

describe('diario', () => {
  it('un giorno per riga, dal più recente, oggi compreso', () => {
    const d = diario(dietaDiProva(), [], OGGI, {}, 7);
    assert.equal(d.length, 7);
    assert.equal(d[0].data, OGGI);
    assert.equal(d[1].data, giorniPrima(OGGI, 1));
  });

  it('distingue giorno completo, parziale e senza spunte', () => {
    const dieta = dietaDiProva();
    const lunedi = dieta.giorni.find((g) => g.indice === indiceGiorno(OGGI))!;
    const spunte: Spunta[] = lunedi.pasti.map((p) => ({ giorno: OGGI, pastoId: p.id, stato: 'fatto' }));
    const d = diario(dieta, spunte, OGGI, { passi: [{ giorno: OGGI, passi: 9000 }] }, 2);
    assert.equal(d[0].esito, 'completo');
    assert.equal(d[0].passi, 9000);
    assert.notEqual(d[1].esito, 'completo');

    const parziale = diario(dieta, spunte.slice(0, 1), OGGI, {}, 1);
    assert.equal(parziale[0].esito, lunedi.pasti.length > 1 ? 'parziale' : 'completo');
  });

  it('conta i giorni dall’ultima spunta', () => {
    assert.equal(giorniSenzaSpunte([], OGGI), null);
    const spunte: Spunta[] = [
      { giorno: giorniPrima(OGGI, 5), pastoId: 'x', stato: 'fatto' },
      { giorno: giorniPrima(OGGI, 3), pastoId: 'y', stato: 'fatto' },
    ];
    assert.equal(giorniSenzaSpunte(spunte, OGGI), 3);
  });
});
