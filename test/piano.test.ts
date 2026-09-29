import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { equivalenza } from '../src/core/equivalenza.ts';
import { etichettaGruppo, nelPiano, slotDi } from '../src/core/piano.ts';
import type { Alimento } from '../src/types.ts';

const g = (nome: string, quantita: number, resto: Partial<Alimento> = {}): Alimento => ({
  nome,
  quantita,
  unita: 'g',
  ...resto,
});

describe('sostituzione isocalorica e isoproteica', () => {
  it('la isoproteica pareggia le proteine, non le calorie', () => {
    const e = equivalenza(g('merluzzo', 180), 'petto di pollo', undefined, 'proteine');
    assert.equal(e.esito, 'calcolata');
    assert.equal(e.base, 'proteine');
    assert.equal(e.nomeBase, 'isoproteica');
    assert.equal(e.baseChiesta, 'proteine');
    assert.ok(Math.abs(e.delta!.proteine) < 2, 'le proteine restano quelle');
  });

  it('la isocalorica pareggia le calorie, e le proteine si spostano', () => {
    const e = equivalenza(g('merluzzo', 180), 'petto di pollo', undefined, 'kcal');
    assert.equal(e.base, 'nessuno');
    assert.equal(e.nomeBase, 'isocalorica');
    assert.ok(Math.abs(e.delta!.kcal) < 12, 'le calorie restano quelle');
  });

  it('le due basi danno due porzioni diverse dello stesso alimento', () => {
    const proteica = equivalenza(g('merluzzo', 180), 'petto di pollo', undefined, 'proteine');
    const calorica = equivalenza(g('merluzzo', 180), 'petto di pollo', undefined, 'kcal');
    assert.notEqual(proteica.entra!.quantita, calorica.entra!.quantita);
  });

  it('senza base dichiarata resta il comportamento di sempre: il caratterizzante', () => {
    const auto = equivalenza(g('pasta', 100), 'riso');
    assert.equal(auto.base, 'carboidrati');
    assert.equal(auto.baseChiesta, 'auto');
    assert.equal(auto.baseRipiegata, false);
  });

  it('quando la base chiesta non è applicabile lo dichiara invece di fingere', () => {
    const e = equivalenza(g('petto di pollo', 150), 'olio extravergine', undefined, 'proteine');
    assert.equal(e.esito, 'calcolata');
    assert.equal(e.base, 'nessuno', 'ha ripiegato sulle calorie');
    assert.equal(e.baseRipiegata, true);
    assert.ok(e.avvisi.some((a) => a.includes('isoproteica')));
  });

  it('non produce porzioni fuori scala: ripiega e lo scrive', () => {
    const e = equivalenza(g('petto di pollo', 150), 'miele', undefined, 'proteine');
    assert.equal(e.esito, 'calcolata');
    assert.equal(e.baseRipiegata, true);
    assert.ok(e.entra!.quantita! < 150 * 5, 'la porzione resta in scala');
    assert.ok(e.avvisi.some((a) => a.includes('non sta in un piatto')));
  });
});

describe('slot del piano a sostituzione', () => {
  const colazione = g('yogurt greco', 170, {
    gruppo: 'fonte proteica',
    base: 'proteine',
    alternative: [{ nome: 'fiocchi di latte' }, { nome: 'ricotta' }, { nome: 'uova', quantita: 2, unita: 'pz' }],
  });

  it('mette per prima la porzione prescritta dal professionista', () => {
    const s = slotDi(colazione);
    assert.equal(s.opzioni[0].nome, 'yogurt greco');
    assert.equal(s.opzioni[0].prescritta, true);
    assert.equal(s.opzioni[0].scelta, true, 'senza sostituzioni è quella nel piatto');
  });

  it('calcola le grammature delle alternative sulla base dello slot', () => {
    const s = slotDi(colazione);
    assert.equal(s.base, 'proteine');
    assert.equal(s.nomeBase, 'isoproteica');

    const fiocchi = s.opzioni.find((o) => o.nome === 'fiocchi di latte')!;
    assert.equal(fiocchi.esito, 'calcolata');
    assert.equal(fiocchi.fissata, false);
    assert.ok(fiocchi.quantita! > 0);
    assert.ok(Math.abs(fiocchi.delta!.proteine) < 2, 'isoproteica: le proteine restano');
  });

  it('la quantità scritta dal professionista non si ricalcola', () => {
    const s = slotDi(colazione);
    const uova = s.opzioni.find((o) => o.nome === 'uova')!;
    assert.equal(uova.fissata, true);
    assert.equal(uova.quantita, 2);
    assert.equal(uova.unita, 'pz');
    assert.equal(uova.etichetta, '2 pz');
  });

  it('marca come scelta l’alternativa che il cliente ha già nel piatto', () => {
    const s = slotDi(colazione, undefined, 'ricotta');
    assert.equal(s.opzioni.find((o) => o.nome === 'ricotta')!.scelta, true);
    assert.equal(s.opzioni[0].scelta, false);
  });

  it('le porzioni restano ancorate al prescritto anche dopo una sostituzione', () => {
    const primo = slotDi(colazione);
    const dopo = slotDi(colazione, undefined, 'ricotta');
    assert.deepEqual(
      primo.opzioni.map((o) => o.quantita),
      dopo.opzioni.map((o) => o.quantita),
    );
  });

  it('un alimento senza alternative è uno slot libero, non un errore', () => {
    const s = slotDi(g('pasta', 100));
    assert.equal(s.libero, true);
    assert.equal(s.opzioni.length, 1);
  });

  it('deduce l’etichetta del gruppo quando il professionista non la scrive', () => {
    assert.equal(etichettaGruppo(g('petto di pollo', 150)), 'fonte proteica');
    assert.equal(etichettaGruppo(g('pasta', 100)), 'fonte di carboidrati');
    assert.equal(etichettaGruppo(colazione), 'fonte proteica');
  });
});

describe('la base la decide il professionista', () => {
  const senzaRegola = g('petto di pollo', 150, {
    alternative: [{ nome: 'merluzzo' }],
  });

  it('senza niente di scritto pareggia sul macronutriente caratterizzante', () => {
    assert.equal(slotDi(senzaRegola).base, 'auto');
  });

  it('la regola della dieta arriva a un alimento che non ne ha una sua', () => {
    const s = slotDi(senzaRegola, undefined, undefined, 'proteine');
    assert.equal(s.base, 'proteine');
    assert.equal(s.nomeBase, 'isoproteica');
  });

  it('l’eccezione scritta sull’alimento vince sulla regola della dieta', () => {
    const conEccezione = g('pasta', 90, {
      base: 'carboidrati',
      alternative: [{ nome: 'riso' }],
    });
    const s = slotDi(conEccezione, undefined, undefined, 'proteine');
    assert.equal(s.base, 'carboidrati', 'la dieta non sovrascrive l’eccezione');
    assert.equal(s.nomeBase, 'isoglucidica');
  });

  it('due basi diverse danno porzioni diverse, ed è il motivo del vincolo', () => {
    const pasta = g('pasta', 90, { alternative: [{ nome: 'riso' }] });
    const suCarbo = slotDi(pasta, undefined, undefined, 'carboidrati').opzioni.find(
      (o) => o.nome === 'riso',
    )!;
    const suProt = slotDi(pasta, undefined, undefined, 'proteine').opzioni.find(
      (o) => o.nome === 'riso',
    )!;
    assert.ok(
      suProt.quantita! > suCarbo.quantita! * 1.2,
      'se il cliente potesse scegliere, sceglierebbe la più abbondante',
    );
  });
});

describe('dentro o fuori dal piano', () => {
  const con = g('petto di pollo', 150, { alternative: [{ nome: 'merluzzo' }, { nome: 'Tacchino' }] });

  it('riconosce un’alternativa ammessa a prescindere da maiuscole e accenti', () => {
    assert.equal(nelPiano(con, 'merluzzo'), true);
    assert.equal(nelPiano(con, 'TACCHINO'), true);
  });

  it('tornare al prescritto è sempre dentro il piano', () => {
    assert.equal(nelPiano(con, 'petto di pollo'), true);
  });

  it('quello che non è nell’elenco è fuori', () => {
    assert.equal(nelPiano(con, 'salmone'), false);
  });

  it('senza alternative scritte nessuna sostituzione è dentro il piano', () => {
    assert.equal(nelPiano(g('pasta', 100), 'riso'), false);
  });
});
