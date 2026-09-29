import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizza, type Libreria } from '../src/core/composizione.ts';
import { caratterizzante, equivalenza, proposte } from '../src/core/equivalenza.ts';
import type { Alimento } from '../src/types.ts';

const g = (nome: string, quantita: number): Alimento => ({ nome, quantita, unita: 'g' });

describe('macronutriente caratterizzante', () => {
  it('riconosce una fonte di carboidrati', () => {
    assert.equal(caratterizzante({ proteine: 13, carboidrati: 75, grassi: 1.5 }), 'carboidrati');
  });

  it('riconosce una fonte proteica', () => {
    assert.equal(caratterizzante({ proteine: 23, carboidrati: 0, grassi: 1.5 }), 'proteine');
  });

  it('riconosce una fonte di grassi', () => {
    assert.equal(caratterizzante({ proteine: 0, carboidrati: 0, grassi: 100 }), 'grassi');
  });

  it('non attribuisce un caratterizzante a un alimento a basso apporto', () => {
    assert.equal(caratterizzante({ proteine: 1.3, carboidrati: 1.4, grassi: 0.1 }), 'nessuno');
  });

  it('nemmeno a un alimento misto, dove nessun macronutriente comanda', () => {
    // 288 kcal: 38% grassi, 35% carboidrati, 28% proteine.
    assert.equal(caratterizzante({ proteine: 20, carboidrati: 25, grassi: 12 }), 'nessuno');
  });
});

describe('equivalenza tra due alimenti', () => {
  it('pareggia i carboidrati tra due fonti di carboidrati', () => {
    const e = equivalenza(g('pasta', 100), 'riso');
    assert.equal(e.esito, 'calcolata');
    assert.equal(e.base, 'carboidrati');
    assert.ok(e.entra);
    // Il riso ha più carboidrati per 100 g: ne serve meno.
    assert.ok(e.entra.quantita! < 100);
    assert.ok(Math.abs(e.delta!.carboidrati) < 6, 'i carboidrati restano quasi identici');
  });

  it('pareggia le proteine tra due fonti proteiche', () => {
    const e = equivalenza(g('petto di pollo', 150), 'merluzzo');
    assert.equal(e.base, 'proteine');
    // Il merluzzo è meno proteico: ne serve di più.
    assert.ok(e.entra!.quantita! > 150);
    assert.ok(Math.abs(e.delta!.proteine) < 3);
  });

  it('arrotonda la porzione: nessuno pesa 137 grammi di riso', () => {
    const e = equivalenza(g('pasta', 100), 'riso');
    assert.equal(e.entra!.quantita! % 5, 0);
  });

  it('REGRESSIONE: lo scostamento è quello della porzione arrotondata', () => {
    const e = equivalenza(g('pasta', 100), 'riso');
    const q = e.entra!.quantita!;
    // Ricalcolo indipendente: riso 7/80/0.6 per 100 g, pasta 13/75/1.5.
    const attesoCarbo = (80 * q) / 100 - 75;
    assert.ok(Math.abs(e.delta!.carboidrati - attesoCarbo) < 0.01);
  });

  it('eredita l’unità di chi esce quando l’alimento non è a pezzo', () => {
    const e = equivalenza(
      { nome: 'latte scremato o parz. scremato', quantita: 200, unita: 'ml' },
      'bevanda vegetale',
    );
    assert.equal(e.esito, 'calcolata');
    assert.equal(e.entra!.unita, 'ml');
  });

  it('usa i pezzi quando l’alimento entrante si conta a pezzo', () => {
    const e = equivalenza(g('petto di pollo', 150), 'uova');
    assert.equal(e.entra!.unita, 'pz');
  });

  it('ripiega sulle calorie quando il caratterizzante non è pareggiabile, e avvisa', () => {
    const e = equivalenza(g('pasta', 100), 'petto di pollo');
    assert.equal(e.esito, 'calcolata');
    assert.equal(e.base, 'nessuno');
    assert.ok(e.avvisi.some((a) => a.includes('pareggiato le calorie')));
    assert.ok(Math.abs(e.delta!.kcal) < 30, 'le calorie tornano');
    assert.ok(Math.abs(e.delta!.carboidrati) > 50, 'i macronutrienti no, ed è dichiarato');
  });

  it('avvisa quando l’alimento entrante è di un’altra famiglia', () => {
    const e = equivalenza(g('petto di pollo', 150), 'uova');
    assert.ok(e.avvisi.some((a) => a.includes('fonte di grassi')));
  });

  it('avvisa quando lo scostamento calorico è grosso', () => {
    const e = equivalenza(g('petto di pollo', 150), 'uova');
    assert.ok(e.avvisi.some((a) => a.includes('kcal di differenza')));
  });

  it('le frasi generate sono in italiano corretto', () => {
    for (const [uscente, entrante] of [
      ['pasta', 'riso'],
      ['petto di pollo', 'merluzzo'],
      ['olio extravergine', 'burro'],
    ] as const) {
      const e = equivalenza(g(uscente, 100), entrante);
      assert.doesNotMatch(e.spiegazione, /\bi proteine\b|\bsui proteine\b/);
      for (const a of e.avvisi) assert.doesNotMatch(a, /\bsui proteine\b|\bi proteine\b/);
    }
  });

  it('non calcola nulla se non conosce l’alimento che ENTRA', () => {
    const e = equivalenza(g('pasta', 100), 'nduja');
    assert.equal(e.esito, 'sconosciuta');
    assert.equal(e.entra, undefined);
    assert.equal(e.daCompletare?.nome, 'nduja');
  });

  it('né se non conosce quello che ESCE', () => {
    const e = equivalenza(g('nduja', 30), 'riso');
    assert.equal(e.esito, 'sconosciuta');
    assert.equal(e.daCompletare?.nome, 'nduja');
  });

  it('con i valori dello studio lo calcola', () => {
    const libreria: Libreria = new Map([
      [
        normalizza('nduja'),
        { chiave: normalizza('nduja'), nome: 'nduja', proteine: 14, carboidrati: 2, grassi: 40, per: 'g100' },
      ],
    ]);
    const e = equivalenza(g('olio extravergine', 10), 'nduja', libreria);
    assert.equal(e.esito, 'calcolata');
    assert.equal(e.base, 'grassi');
  });

  it('un alimento a quantità libera non ha niente da pareggiare', () => {
    const e = equivalenza({ nome: 'zucchine', quantita: null, unita: 'g', libera: true }, 'broccoli');
    assert.equal(e.esito, 'quantita-libera');
    assert.ok(e.motivo?.includes('q.b.'));
  });

  it('dichiara che i valori usati sono indicativi', () => {
    const e = equivalenza(g('pasta', 100), 'riso');
    assert.ok(e.avvisi.some((a) => a.includes('indicativi')));
  });
});

describe('proposte quando il cliente non nomina il sostituto', () => {
  const dieta = [
    'fette biscottate',
    'marmellata',
    'latte scremato o parz. scremato',
    'mandorle',
    'mela',
    'pasta',
    'petto di pollo',
    'zucchine',
    'olio extravergine',
    'riso',
    'merluzzo',
    'insalata mista',
  ];

  it('propone solo alimenti della stessa famiglia', () => {
    for (const p of proposte(g('petto di pollo', 150), dieta)) {
      assert.ok(['merluzzo'].includes(p.nome), `proposto ${p.nome}, che non è una fonte proteica della dieta`);
    }
  });

  it('ordina per scostamento calorico crescente', () => {
    const p = proposte(g('pasta', 100), dieta);
    for (let i = 1; i < p.length; i++) assert.ok(p[i - 1].scarto <= p[i].scarto);
  });

  it('REGRESSIONE: non propone porzioni fuori scala', () => {
    for (const p of proposte(g('pasta', 100), dieta)) {
      assert.ok(p.quantita <= 300, `proposto ${p.quantita}${p.unita} di ${p.nome}`);
      assert.ok(!/latte/.test(p.nome), 'il latte non è un sostituto sensato di 100 g di pasta');
    }
  });

  it('REGRESSIONE: non propone alimenti con un’unità diversa', () => {
    for (const p of proposte(g('petto di pollo', 150), dieta)) {
      assert.equal(p.unita, 'g', `proposto ${p.nome} in ${p.unita}`);
    }
  });

  it('non propone l’alimento che si sta sostituendo', () => {
    assert.ok(!proposte(g('pasta', 100), dieta).some((p) => p.nome === 'pasta'));
  });

  it('nessuna proposta è un risultato ammesso, non un errore', () => {
    assert.deepEqual(proposte(g('pasta', 100), ['pasta']), []);
  });

  it('non propone niente per un alimento sconosciuto', () => {
    assert.deepEqual(proposte(g('nduja', 30), dieta), []);
  });

  it('rispetta il numero massimo di proposte richiesto', () => {
    assert.ok(proposte(g('pasta', 100), dieta, undefined, 1).length <= 1);
  });
});
