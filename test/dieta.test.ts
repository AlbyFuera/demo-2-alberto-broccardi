import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { dietaDiProva } from './dieta-di-prova.ts';
import { normalizza, type Libreria } from '../src/core/composizione.ts';
import {
  alimentiDaCompletare,
  alimentiDellaDieta,
  dietaVuotaDavvero,
  giornoDi,
  scostamento,
  scriviQuantita,
  totaleGiorno,
  totalePasto,
  totaleSettimana,
  trovaAlimento,
} from '../src/core/dieta.ts';
import { dietaVuota } from '../src/types.ts';
import { listaSpesa } from '../src/core/spesa.ts';

const dieta = dietaDiProva();
const LUN = 0;
const MAR = 1;

describe('conti di una dieta', () => {
  it('somma i macronutrienti di un pasto', () => {
    const t = totalePasto(giornoDi(dieta, LUN)!.pasti[1]);
    assert.ok(t.kcal > 400);
    assert.ok(t.proteine > 30);
  });

  it('una quantità libera non rende il conto incompleto', () => {
    const t = totaleGiorno(giornoDi(dieta, LUN)!);
    assert.deepEqual(t.mancanti, []);
    assert.ok(t.libere.includes('zucchine'));
  });

  it('un alimento sconosciuto SÌ, e lo dichiara per nome', () => {
    const t = totaleGiorno(giornoDi(dieta, MAR)!);
    assert.deepEqual(t.mancanti, ['nduja']);
  });

  it('dichiara quali valori sono stime interne', () => {
    const t = totalePasto(giornoDi(dieta, LUN)!.pasti[0]);
    assert.ok(t.stimati.includes('fette biscottate'));
  });

  it('con i valori dello studio non sono più stime', () => {
    const libreria: Libreria = new Map([
      [
        normalizza('fette biscottate'),
        {
          chiave: normalizza('fette biscottate'),
          nome: 'fette biscottate',
          proteine: 11,
          carboidrati: 73,
          grassi: 6,
          per: 'g100',
        },
      ],
      [
        normalizza('marmellata'),
        {
          chiave: normalizza('marmellata'),
          nome: 'marmellata',
          proteine: 0.5,
          carboidrati: 60,
          grassi: 0,
          per: 'g100',
        },
      ],
    ]);

    const t = totalePasto(giornoDi(dieta, LUN)!.pasti[0], libreria);
    assert.deepEqual(t.stimati, []);
  });

  it('REGRESSIONE: la media si calcola sui giorni SCRITTI, non su sette', () => {
    const { media, giorniScritti, totale } = totaleSettimana(dieta);
    assert.equal(giorniScritti, 2);
    assert.ok(Math.abs(media.kcal - totale.kcal / 2) < 0.001);
  });

  it('lo scostamento dagli obiettivi non dichiarati è null, non zero', () => {
    const senzaObiettivi = { ...dieta, obiettivi: { kcal: 1800 } };
    const s = scostamento(senzaObiettivi, giornoDi(dieta, LUN)!);
    assert.equal(typeof s.kcal, 'number');
    assert.equal(s.proteine, null);
    assert.equal(s.carboidrati, null);
  });

  it('un giorno con un alimento sconosciuto ha lo scostamento dichiarato parziale', () => {
    assert.equal(scostamento(dieta, giornoDi(dieta, MAR)!).parziale, true);
    assert.equal(scostamento(dieta, giornoDi(dieta, LUN)!).parziale, false);
  });
});

describe('navigazione nella dieta', () => {
  it('REGRESSIONE: trova «petto di pollo» cercando «pollo»', () => {
    const pos = trovaAlimento(dieta, 'pollo', LUN);
    assert.ok(pos);
    assert.equal(pos.pastoId, 'pas_pra');
    assert.equal(giornoDi(dieta, LUN)!.pasti[1].alimenti[pos.indice].nome, 'petto di pollo');
  });

  it('preferisce il giorno indicato quando l’alimento compare in più giorni', () => {
    // Il giorno preferito si esplora per primo.
    const pos = trovaAlimento(dieta, 'riso', MAR);
    assert.ok(pos);
    assert.equal(pos.giorno, LUN);
  });

  it('la corrispondenza esatta batte quella parziale, anche in un altro giorno', () => {
    const conRiso: typeof dieta = structuredClone(dieta);
    conRiso.giorni[1].pasti.push({
      id: 'pas_x',
      nome: 'Pranzo',
      alimenti: [{ nome: 'riso', quantita: 50, unita: 'g' }],
    });
    conRiso.giorni[0].pasti[2].alimenti[0] = { nome: 'riso integrale', quantita: 80, unita: 'g' };

    const pos = trovaAlimento(conRiso, 'riso', LUN);
    assert.ok(pos);
    assert.equal(pos.giorno, MAR, 'la corrispondenza esatta di martedì vince sul parziale di lunedì');
  });

  it('non trova nulla per un alimento che non c’è', () => {
    assert.equal(trovaAlimento(dieta, 'ananas caramellato', LUN), null);
  });

  it('elenca gli alimenti senza ripetizioni', () => {
    const nomi = alimentiDellaDieta(dieta);
    assert.equal(new Set(nomi).size, nomi.length);
    assert.ok(nomi.includes('petto di pollo'));
  });

  it('elenca gli alimenti da completare, con dove compaiono', () => {
    const mancanti = alimentiDaCompletare(dieta);
    assert.equal(mancanti.length, 1);
    assert.equal(mancanti[0].nome, 'nduja');
    assert.ok(mancanti[0].dove[0].includes('Martedì'));
  });

  it('un alimento «q.b.» non è un alimento da completare', () => {
    assert.ok(!alimentiDaCompletare(dieta).some((m) => m.nome === 'zucchine'));
  });

  it('riconosce una dieta vuota, anche se ha dei pasti', () => {
    assert.equal(dietaVuotaDavvero(dieta), false);
    assert.equal(dietaVuotaDavvero(dietaVuota('x', 'y')), true);

    const conPastiSenzaAlimenti = dietaVuota('x', 'y');
    conPastiSenzaAlimenti.giorni[0].pasti.push({ id: 'p', nome: 'Pranzo', alimenti: [] });
    assert.equal(dietaVuotaDavvero(conPastiSenzaAlimenti), true);
  });

  it('scrive le quantità come si leggono', () => {
    assert.equal(scriviQuantita({ nome: 'x', quantita: 130, unita: 'g' }), '130g');
    assert.equal(scriviQuantita({ nome: 'x', quantita: 2, unita: 'pz' }), '2 pz');
    assert.equal(scriviQuantita({ nome: 'x', quantita: null, unita: 'g', libera: true }), 'q.b.');
  });
});

describe('lista della spesa', () => {
  it('somma lo stesso alimento attraverso i giorni', () => {
    const doppia: typeof dieta = structuredClone(dieta);
    doppia.giorni[1].pasti[0].alimenti.push({ nome: 'pasta', quantita: 50, unita: 'g' });

    const riga = listaSpesa(doppia).find((l) => l.nome === 'pasta');
    assert.ok(riga);
    assert.equal(riga.quantita, 150);
    assert.equal(riga.ricorrenze, 2);
  });

  it('tiene gli alimenti a quantità libera, senza un peso', () => {
    const riga = listaSpesa(dieta).find((l) => l.nome === 'zucchine');
    assert.ok(riga);
    assert.equal(riga.quantita, null);
  });

  it('tiene separati gli stessi nomi con unità diverse', () => {
    const mista: typeof dieta = structuredClone(dieta);
    mista.giorni[1].pasti[0].alimenti.push({ nome: 'latte', quantita: 200, unita: 'ml' });
    mista.giorni[0].pasti[0].alimenti.push({ nome: 'latte', quantita: 2, unita: 'pz' });

    const righe = listaSpesa(mista).filter((l) => l.nome === 'latte');
    assert.equal(righe.length, 2);
  });
});
