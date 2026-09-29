import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { plausibile } from '../worker/plausibile.ts';

const FATTI = 'Mercoledì: 1528 kcal, 99 g proteine, 216 g carboidrati, 39 g grassi.';

describe('plausibilità della frase del modello', () => {
  it('accetta una risposta italiana normale', () => {
    assert.equal(
      plausibile(
        'Il tuo nutrizionista prevede oggi 1528 kcal, con 99 g di proteine. ' +
          'Il conto è completo.',
        FATTI,
      ).ok,
      true,
    );
  });

  it('accetta accenti, virgolette e trattini', () => {
    assert.equal(
      plausibile(
        'Sì: al posto di 150g di petto di pollo ci vogliono 205g di merluzzo — ' +
          'la giornata si sposta di -6 kcal, e il tuo nutrizionista lo vedrà.',
        FATTI,
      ).ok,
      true,
    );
  });

  it('REGRESSIONE: boccia l’impasto di token visto in produzione', () => {
    const v = plausibile(
      'diffusion inclusive mingle besar_slave Incre kleingreenuntosشار秒-spec' +
        'gpsutut Mour Dict::|dek_SCOREliquid mlx тру_AUTH_fiveswers Gors协TEST getchar',
      FATTI,
    );
    assert.equal(v.ok, false);
    assert.ok(v.motivo);
  });

  it('boccia un impasto di alfabeti', () => {
    assert.equal(plausibile('Оggi мangi 1528 кcal 秒 конечно шар', FATTI).ok, false);
  });

  it('boccia frammenti di codice', () => {
    assert.equal(plausibile('La tua dieta prevede return null per oggi.', FATTI).ok, false);
    assert.equal(plausibile('Oggi hai 1528 kcal <div>e va bene</div>', FATTI).ok, false);
  });

  it('boccia le parole incollate', () => {
    assert.equal(
      plausibile('Oggimangiquesto_cibo_moltolungosenzaspazidinessuntipoquindi bene', FATTI).ok,
      false,
    );
  });

  it('boccia una frase troppo corta o vuota', () => {
    assert.equal(plausibile('Sì.', FATTI).ok, false);
    assert.equal(plausibile('   ', FATTI).ok, false);
  });

  it('boccia una risposta sproporzionata rispetto ai fatti', () => {
    assert.equal(plausibile('Va bene. '.repeat(120), FATTI).ok, false);
  });

  it('boccia un testo senza vocali', () => {
    assert.equal(plausibile('brtz kcl grss prtn crbdrt xyz kkk mmm', FATTI).ok, false);
  });

  it('non boccia una frase corretta solo perché è lunga', () => {
    const lunga =
      'Il tuo nutrizionista ha scritto per oggi quattro pasti, che insieme fanno ' +
      '1528 kcal: la colazione ne porta 323, lo spuntino 171, il pranzo 614 e la ' +
      'cena 420. Le proteine arrivano a 99 grammi.';
    assert.equal(plausibile(lunga, FATTI).ok, true);
  });
});
