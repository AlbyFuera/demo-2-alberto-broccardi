import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { dietaDiProva } from './dieta-di-prova.ts';
import { recupero } from '../src/core/recupero.ts';
import { totaleGiorno } from '../src/core/dieta.ts';
import { giornoDi } from '../src/core/dieta.ts';

const dieta = dietaDiProva();
const LUN = 0;

describe('pasto saltato', () => {
  it('togliendo un pasto, l’assunto scende di quel pasto', () => {
    const intero = recupero(dieta, LUN, [], 7)!;
    const senzaPranzo = recupero(dieta, LUN, ['pas_pra'], 7)!;

    assert.ok(senzaPranzo.assunto.kcal < intero.assunto.kcal);
    assert.equal(senzaPranzo.saltati.length, 1);
    assert.equal(senzaPranzo.saltati[0].nome, 'Pranzo');
  });

  it('il previsto resta quello scritto dal professionista', () => {
    const r = recupero(dieta, LUN, ['pas_pra'], 7)!;
    const atteso = totaleGiorno(giornoDi(dieta, LUN)!);
    assert.ok(Math.abs(r.previsto.kcal - atteso.kcal) < 0.001);
  });

  it('misura la mancanza contro l’obiettivo, non contro la somma dei pasti', () => {
    const r = recupero(dieta, LUN, [], 7)!;
    assert.equal(r.obiettivoKcal, 1800);
    assert.ok(Math.abs(r.manca.kcal - (1800 - r.assunto.kcal)) < 0.001);
  });

  it('senza obiettivi dichiarati usa la somma dei pasti', () => {
    const senza = { ...dieta, obiettivi: {} };
    const r = recupero(senza, LUN, [], 7)!;
    assert.equal(r.obiettivoKcal, null);
    assert.ok(Math.abs(r.manca.kcal) < 0.001, 'niente saltato e niente obiettivo: non manca nulla');
  });

  it('i pasti rimanenti dipendono dall’ora', () => {
    assert.equal(recupero(dieta, LUN, [], 7)!.rimanenti.length, 3);
    assert.equal(recupero(dieta, LUN, [], 14)!.rimanenti.length, 1);
    assert.equal(recupero(dieta, LUN, [], 22)!.rimanenti.length, 0);
  });

  it('un pasto saltato non è più «da fare»', () => {
    const r = recupero(dieta, LUN, ['pas_cen'], 7)!;
    assert.ok(!r.rimanenti.some((p) => p.id === 'pas_cen'));
  });

  it('un pasto senza orario si considera ancora da fare', () => {
    const senzaOrario: typeof dieta = structuredClone(dieta);
    delete senzaOrario.giorni[0].pasti[2].orario;
    const r = recupero(senzaOrario, LUN, [], 23)!;
    assert.equal(r.rimanenti.length, 1);
  });

  it('lo scoperto è quello che manca a fine giornata, facendo tutto il resto', () => {
    const r = recupero(dieta, LUN, ['pas_pra'], 7)!;
    const pranzo = r.saltati[0].valori.kcal;
    const scartoObiettivo = 1800 - r.previsto.kcal;
    assert.ok(Math.abs(r.scoperto.kcal - (pranzo + scartoObiettivo)) < 0.001);
  });

  it('a giornata già conclusa lo scoperto tiene conto solo di quanto mangiato', () => {
    const r = recupero(dieta, LUN, [], 23)!;
    assert.equal(r.rimanenti.length, 0);
    assert.ok(Math.abs(r.scoperto.kcal - (1800 - r.previsto.kcal)) < 0.001);
  });

  it('dichiara parziale un giorno con un alimento sconosciuto', () => {
    assert.equal(recupero(dieta, 1, [], 7)!.parziale, true);
    assert.equal(recupero(dieta, LUN, [], 7)!.parziale, false);
  });

  it('un giorno vuoto non è un errore', () => {
    const r = recupero(dieta, 4, [], 12)!;
    assert.ok(r);
    assert.equal(r.rimanenti.length, 0);
    assert.equal(r.previsto.kcal, 0);
  });

  it('un giorno che non esiste sì', () => {
    assert.equal(recupero(dieta, 9, [], 12), null);
  });
});
