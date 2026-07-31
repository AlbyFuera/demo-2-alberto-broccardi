import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  alimentiInTabella,
  composizioneDi,
  macroDi,
  normalizza,
  type Libreria,
} from '../src/core/composizione.ts';

describe('composizione degli alimenti', () => {
  it('trova un alimento per nome esatto', () => {
    const c = composizioneDi('pasta', 'g');
    assert.ok(c);
    assert.equal(c.per, 'g100');
    assert.equal(c.fonte, 'tabella');
    assert.ok(c.carboidrati > 60);
  });

  /*
   * L'ordine per lunghezza decrescente è ciò che impedisce a «pane» di
   * catturare «pane integrale». Sono due alimenti con macronutrienti diversi, e
   * scambiarli sposta i conti di ogni dieta che li usa.
   */
  it('il nome più specifico vince su quello più corto', () => {
    const bianco = composizioneDi('pane bianco', 'g');
    const integrale = composizioneDi('pane integrale', 'g');
    assert.ok(bianco && integrale);
    assert.notEqual(bianco.carboidrati, integrale.carboidrati);
  });

  it('gli alimenti a pezzo si cercano nella tabella dei pezzi', () => {
    const c = composizioneDi('uova', 'pz');
    assert.ok(c);
    assert.equal(c.per, 'pz');
  });

  it('un alimento sconosciuto restituisce null, non uno zero', () => {
    assert.equal(composizioneDi('nduja di spilinga', 'g'), null);
    assert.equal(macroDi({ nome: 'nduja di spilinga', quantita: 30, unita: 'g' }), null);
  });

  it('scala i macronutrienti sulla quantità', () => {
    const cento = macroDi({ nome: 'petto di pollo', quantita: 100, unita: 'g' });
    const duecento = macroDi({ nome: 'petto di pollo', quantita: 200, unita: 'g' });
    assert.ok(cento && duecento);
    assert.ok(Math.abs(duecento.macro.proteine - cento.macro.proteine * 2) < 0.001);
  });

  it('moltiplica per il numero di pezzi, non per la centesima parte', () => {
    const due = macroDi({ nome: 'uova', quantita: 2, unita: 'pz' });
    const uno = macroDi({ nome: 'uova', quantita: 1, unita: 'pz' });
    assert.ok(due && uno);
    assert.ok(Math.abs(due.macro.proteine - uno.macro.proteine * 2) < 0.001);
  });

  it('una quantità libera non ha macronutrienti da calcolare', () => {
    assert.equal(macroDi({ nome: 'zucchine', quantita: null, unita: 'g', libera: true }), null);
  });

  /*
   * La regola che regge tutto il resto: i valori del professionista vincono
   * sempre su quelli interni, e la fonte lo dichiara. Se un giorno lo strumento
   * mostrasse i propri numeri al posto dei suoi, lui non potrebbe più metterci
   * la firma.
   */
  it('la libreria dello studio vince sulla tabella interna', () => {
    const libreria: Libreria = new Map([
      [
        normalizza('pasta'),
        { chiave: normalizza('pasta'), nome: 'pasta', proteine: 99, carboidrati: 1, grassi: 0, per: 'g100' },
      ],
    ]);

    const c = composizioneDi('pasta', 'g', libreria);
    assert.ok(c);
    assert.equal(c.proteine, 99);
    assert.equal(c.fonte, 'studio');
  });

  it('la libreria copre anche gli alimenti che la tabella non conosce', () => {
    const libreria: Libreria = new Map([
      [
        normalizza('nduja'),
        { chiave: normalizza('nduja'), nome: 'nduja', proteine: 14, carboidrati: 2, grassi: 40, per: 'g100' },
      ],
    ]);

    const m = macroDi({ nome: 'nduja', quantita: 50, unita: 'g' }, libreria);
    assert.ok(m);
    assert.equal(m.composizione.fonte, 'studio');
    assert.ok(Math.abs(m.macro.grassi - 20) < 0.001);
  });

  it('la voce della libreria vale per la sua base, non per l’altra', () => {
    const libreria: Libreria = new Map([
      [
        normalizza('barretta'),
        { chiave: normalizza('barretta'), nome: 'barretta', proteine: 20, carboidrati: 20, grassi: 8, per: 'pz' },
      ],
    ]);

    // Chiesta a pezzo: la trova.
    assert.equal(composizioneDi('barretta', 'pz', libreria)?.fonte, 'studio');
    // Chiesta a grammi: quella voce non vale, e nemmeno la tabella la conosce.
    assert.equal(composizioneDi('barretta', 'g', libreria), null);
  });

  it('normalizza i nomi in modo stabile', () => {
    assert.equal(normalizza('  Petto di POLLO '), 'petto di pollo');
    assert.equal(normalizza('Pasta Integrale'), 'pasta integrale');
  });

  it('la tabella interna copre gli alimenti comuni', () => {
    assert.ok(alimentiInTabella() > 100);
  });
});
