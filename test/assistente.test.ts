import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { dietaDiProva } from './dieta-di-prova.ts';
import { coppia, interpreta, risolvi, type Contesto } from '../src/core/assistente.ts';

const dieta = dietaDiProva();
const LUN = 0;

const ctx: Contesto = {
  dieta,
  oggi: LUN,
  ora: 9,
  nomeProfessionista: 'Dott. Rossi',
  nomeCliente: 'Mario Bianchi',
};

describe('interpretazione della domanda', () => {
  it('riconosce un saluto', () => {
    assert.equal(interpreta('Ciao', dieta, LUN).tipo, 'saluto');
  });

  it('riconosce «cosa mangio adesso»', () => {
    assert.equal(interpreta('cosa mangio adesso?', dieta, LUN).tipo, 'adesso');
  });

  it('riconosce un pasto nominato, e allora è una domanda sul giorno', () => {
    const d = interpreta('cosa mangio a pranzo?', dieta, LUN);
    assert.equal(d.tipo, 'giorno');
    assert.equal(d.pastoId, 'pas_pra');
  });

  it('riconosce il giorno scritto', () => {
    assert.equal(interpreta('cosa prevede martedì?', dieta, LUN).giorno, 1);
    assert.equal(interpreta('cosa mangio domani?', dieta, LUN).giorno, 1);
  });

  it('riconosce una richiesta di sostituzione', () => {
    assert.equal(interpreta('posso cambiare il riso?', dieta, LUN).tipo, 'sostituzione');
  });

  it('riconosce un pasto saltato', () => {
    assert.equal(interpreta('ho saltato il pranzo, come recupero?', dieta, LUN).tipo, 'saltato');
  });

  it('riconosce una domanda sui valori', () => {
    assert.equal(interpreta('quante calorie ho oggi?', dieta, LUN).tipo, 'valori');
  });

  it('riconosce una domanda sulle indicazioni', () => {
    assert.equal(interpreta("quanta acqua devo bere?", dieta, LUN).tipo, 'indicazioni');
  });

  it('riconosce la spesa', () => {
    assert.equal(interpreta('lista della spesa', dieta, LUN).tipo, 'spesa');
  });

  it('quello che non capisce lo dichiara ignoto, non lo indovina', () => {
    assert.equal(interpreta('mi fa male la schiena', dieta, LUN).tipo, 'ignoto');
  });
});

describe('coppia «cosa esce / cosa entra»', () => {
  it('legge «X al posto di Y»: X entra, Y esce', () => {
    const c = coppia('posso mettere il riso al posto della pasta?', dieta);
    assert.equal(c.alimento, 'pasta');
    assert.equal(c.alimentoNuovo, 'riso');
  });

  it('legge «sostituisco Y con X»: l’ordine è l’opposto', () => {
    const c = coppia('vorrei sostituire la pasta con il riso', dieta);
    assert.equal(c.alimento, 'pasta');
    assert.equal(c.alimentoNuovo, 'riso');
  });

  it('REGRESSIONE: «pollo» aggancia «petto di pollo»', () => {
    const c = coppia('posso mettere il tonno al posto del pollo a pranzo?', dieta);
    assert.equal(c.alimento, 'petto di pollo');
    assert.equal(c.alimentoNuovo, 'tonno');
  });

  it('REGRESSIONE: prende il nome anche quando NON è nella dieta', () => {
    const c = coppia('posso mangiare una pizza al posto della pasta?', dieta);
    assert.equal(c.alimento, 'pasta');
    assert.equal(c.alimentoNuovo, 'pizza');
  });

  it('«qualcosa» non è un alimento: chiede proposte, non una verifica', () => {
    const c = coppia('posso mettere qualcosa di diverso al posto della pasta?', dieta);
    assert.equal(c.alimento, 'pasta');
    assert.equal(c.alimentoNuovo, undefined);
  });

  it('senza separatore l’unico nome trovato è quello che ESCE', () => {
    const c = coppia('posso cambiare il merluzzo?', dieta);
    assert.equal(c.alimento, 'merluzzo');
    assert.equal(c.alimentoNuovo, undefined);
  });

  it('non inventa una coppia da una frase che non nomina alimenti', () => {
    assert.deepEqual(coppia('posso cambiare qualcosa?', dieta), {});
  });
});

describe('risoluzione contro il motore', () => {
  it('il saluto porta con sé il prossimo pasto', () => {
    const r = risolvi(ctx, interpreta('Ciao', dieta, LUN));
    assert.equal(r.fonte, 'motore');
    assert.ok(r.risposta.includes('Mario'));
    assert.equal(r.schede.length, 1);
    assert.ok(r.schede[0].titolo.includes('Pranzo') || r.schede[0].titolo.includes('Colazione'));
  });

  it('«cosa prevede oggi» elenca i pasti con i loro valori', () => {
    const r = risolvi(ctx, interpreta('cosa prevede oggi?', dieta, LUN));
    assert.equal(r.schede.length, 3);
    assert.ok(r.schede[0].righe!.length > 0);
    assert.ok(r.schede[0].testo!.some((t) => t.includes('kcal')));
  });

  it('un giorno vuoto lo dice, e non finge un menù', () => {
    const r = risolvi(ctx, interpreta('cosa prevede venerdì?', dieta, LUN));
    assert.ok(r.risposta.includes('non ha ancora scritto'));
    assert.equal(r.schede.length, 0);
  });

  it('un conto parziale dichiara quali alimenti sono fuori', () => {
    const r = risolvi(ctx, interpreta('quante calorie ho martedì?', dieta, LUN));
    assert.ok(r.citazioni.some((c) => c.includes('nduja')));
  });

  it('le indicazioni sono quelle scritte dal professionista', () => {
    const r = risolvi(ctx, interpreta("quanta acqua devo bere?", dieta, LUN));
    assert.ok(r.schede[0].testo!.some((t) => t.includes('2 litri')));
  });

  it('senza indicazioni gira la domanda allo studio invece di inventare', () => {
    const nuda: Contesto = { ...ctx, dieta: { ...dieta, indicazioni: [], obiettivi: {} } };
    const r = risolvi(nuda, interpreta('posso bere alcol?', nuda.dieta, LUN));
    assert.ok(r.daGirare);
  });

  it('quello che non sa lo gira allo studio, e lo dice', () => {
    const r = risolvi(ctx, interpreta('mi fa male la schiena', dieta, LUN));
    assert.ok(r.daGirare);
    assert.ok(r.risposta.includes('Dott. Rossi'));
  });

  it('sul pasto saltato dà i conti e rimanda la decisione al professionista', () => {
    const domanda = interpreta('ho saltato il pranzo', dieta, LUN);
    const r = risolvi({ ...ctx, ora: 15 }, domanda);
    assert.match(r.risposta, /kcal/);
    assert.ok(r.risposta.includes('Dott. Rossi'));
    assert.doesNotMatch(r.risposta, /aggiungi|mangia di più|raddoppia/i);
    assert.ok(r.daGirare, 'un buco importante viene segnalato allo studio');
  });

  it('se il buco è piccolo non disturba il professionista', () => {
    const senzaObiettivo: Contesto = { ...ctx, dieta: { ...dieta, obiettivi: {} }, ora: 7 };
    const r = risolvi(senzaObiettivo, interpreta('ho saltato qualcosa?', senzaObiettivo.dieta, LUN));
    assert.equal(r.daGirare, undefined);
  });

  it('le sostituzioni non passano da qui: le calcola l’equivalenza', () => {
    const r = risolvi(ctx, interpreta('posso cambiare il riso?', dieta, LUN));
    assert.equal(r.risposta, '');
  });
});
