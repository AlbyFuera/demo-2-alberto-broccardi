import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { pianoDeMarco } from '../src/data/piano-demarco.ts';
import { ancoraAlPiano, coppiaSostituzione, interpretaEsteso } from '../src/core/domanda.ts';

const plan = pianoDeMarco;
const LUN = 0;

/**
 * La coppia «cosa esce / cosa entra».
 *
 * È la lettura da cui dipende quale slot viene toccato e cosa viene verificato:
 * scambiare i due nomi produce la risposta giusta alla domanda sbagliata.
 */
describe('coppia di una sostituzione', () => {
  it('legge «X al posto di Y»: X entra, Y esce', () => {
    const c = coppiaSostituzione('posso mettere il riso al posto della pasta?', plan, LUN);
    assert.equal(c.food, 'pasta');
    assert.equal(c.foodTo, 'riso');
  });

  it('legge «sostituisco Y con X»: l’ordine è l’opposto', () => {
    const c = coppiaSostituzione('vorrei sostituire la pasta con il riso', plan, LUN);
    assert.equal(c.food, 'pasta');
    assert.equal(c.foodTo, 'riso');
  });

  it('senza separatore l’unico nome trovato è quello che ESCE', () => {
    const c = coppiaSostituzione('posso cambiare il riso?', plan, LUN);
    assert.equal(c.food, 'riso');
    assert.equal(c.foodTo, undefined);
  });

  /*
   * Il caso che vale il prodotto.
   *
   * Un alimento fuori dal piano non si trova cercandolo tra gli alimenti del
   * piano: va preso così com'è scritto, o la richiesta si degrada in «dammi le
   * alternative alla pasta» e il professionista non viene mai a sapere che il
   * suo cliente voleva la pizza.
   */
  it('REGRESSIONE: prende il nome anche quando NON è nel piano', () => {
    const c = coppiaSostituzione('posso mangiare una pizza al posto della pasta?', plan, LUN);
    assert.equal(c.food, 'pasta');
    assert.equal(c.foodTo, 'pizza');
  });

  it('«qualcosa» non è un alimento: chiede alternative, non una verifica', () => {
    const c = coppiaSostituzione('posso mettere qualcosa di diverso al posto della pasta?', plan, LUN);
    assert.equal(c.food, 'pasta');
    assert.equal(c.foodTo, undefined);
  });
});

describe('interpretazione completa', () => {
  it('riconosce l’intento e compila la coppia', () => {
    const i = interpretaEsteso('posso mettere il riso invece della pasta a pranzo?', plan, LUN);
    assert.equal(i.kind, 'sostituzione');
    assert.equal(i.food, 'pasta');
    assert.equal(i.foodTo, 'riso');
  });
});

/**
 * Quando risponde il modello linguistico, i suoi nomi vanno ricondotti al piano
 * — ma il modello non deve poter far PERDERE informazione che l'analisi
 * deterministica avrebbe trovato.
 */
describe('ancoraggio dell’intento del modello', () => {
  it('scarta un alimento che il piano non prevede in USCITA', () => {
    const i = ancoraAlPiano(
      { kind: 'sostituzione', food: 'ananas caramellato', day: LUN },
      plan,
      LUN,
    );
    assert.equal(i.food, undefined);
  });

  it('lascia intatto un alimento fuori piano in ENTRATA', () => {
    const i = ancoraAlPiano(
      { kind: 'sostituzione', food: 'pasta', foodTo: 'pizza margherita', day: LUN },
      plan,
      LUN,
    );
    assert.equal(i.food, 'pasta');
    assert.equal(i.foodTo, 'pizza margherita');
  });

  it('REGRESSIONE: recupera il «cosa entra» che il modello non ha estratto', () => {
    const i = ancoraAlPiano(
      // Un modello piccolo che non compila `foodTo` perché la pizza non è
      // nell'elenco degli alimenti che gli abbiamo dato.
      { kind: 'sostituzione', food: 'pasta', day: LUN },
      plan,
      LUN,
      'posso mangiare una pizza al posto della pasta?',
    );
    assert.equal(i.food, 'pasta');
    assert.equal(i.foodTo, 'pizza');
  });

  it('senza il testo della domanda non inventa nulla', () => {
    const i = ancoraAlPiano({ kind: 'sostituzione', food: 'pasta', day: LUN }, plan, LUN);
    assert.equal(i.foodTo, undefined);
  });
});
