import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { allergeneDi, attenzioniDellaDieta, vociAllergie } from '../src/core/allergeni.ts';
import { dietaDiProva } from './dieta-di-prova.ts';

describe('allergie e intolleranze', () => {
  it('separa le voci scritte a testo libero', () => {
    assert.deepEqual(vociAllergie('Lattosio, frutta a guscio;  kiwi\n'), [
      'lattosio',
      'frutta a guscio',
      'kiwi',
    ]);
    assert.deepEqual(vociAllergie(''), []);
    assert.deepEqual(vociAllergie(null), []);
  });

  it('una voce nota trova gli alimenti che la contengono', () => {
    const voci = vociAllergie('lattosio');
    assert.equal(allergeneDi('yogurt greco', voci), 'lattosio');
    assert.equal(allergeneDi('fiocchi di latte', voci), 'lattosio');
    assert.equal(allergeneDi('petto di pollo', voci), null);
  });

  it('il nome che dichiara l’assenza non è un allarme', () => {
    const voci = vociAllergie('lattosio, glutine');
    assert.equal(allergeneDi('latte senza lattosio', voci), null);
    assert.equal(allergeneDi('pasta senza glutine', voci), null);
  });

  it('cerca parole intere, non pezzi di parola', () => {
    const voci = vociAllergie('glutine');
    assert.equal(allergeneDi('pane integrale', voci), 'glutine');
    assert.equal(allergeneDi('panettone', voci), null);
  });

  it('una voce sconosciuta si cerca anche al singolare', () => {
    const voci = vociAllergie('fragole');
    assert.equal(allergeneDi('fragola', voci), 'fragole');
    assert.equal(allergeneDi('fragole', voci), 'fragole');
  });

  it('elenca dove compare nella dieta, alternative comprese', () => {
    const dieta = dietaDiProva();
    const trovate = attenzioniDellaDieta(dieta, 'glutine');
    assert.ok(trovate.length > 0);
    for (const t of trovate) {
      assert.equal(t.allergene, 'glutine');
      assert.ok(t.dove.length > 0);
    }
    assert.deepEqual(attenzioniDellaDieta(dieta, ''), []);
  });
});
