/**
 * Una dieta di prova, scritta come la scriverebbe un professionista.
 *
 * Non è un dato di produzione e non finisce nel Worker: serve ai test, e
 * contiene di proposito i tre casi che rompono le cose —
 *
 *   · un alimento a quantità libera («zucchine q.b.»), che deve stare fuori dai
 *     conti senza renderli incompleti;
 *   · un alimento di cui il motore NON conosce la composizione («nduja»), che
 *     deve rendere il conto dichiaratamente parziale;
 *   · un nome scritto per esteso («petto di pollo») che il cliente nominerà per
 *     abbreviazione («pollo»).
 */

import type { Dieta } from '../src/types.ts';

export function dietaDiProva(): Dieta {
  return {
    id: 'die_prova',
    titolo: 'Dieta di prova',
    indicazioni: ['Le quantità si intendono a crudo.', "Almeno 2 litri d'acqua al giorno."],
    obiettivi: { kcal: 1800, proteine: 120, carboidrati: 180, grassi: 55, acqua: 2 },
    giorni: [
      {
        indice: 0,
        allenamento: true,
        pasti: [
          {
            id: 'pas_col',
            nome: 'Colazione',
            orario: '08:00',
            alimenti: [
              { nome: 'fette biscottate', quantita: 40, unita: 'g' },
              { nome: 'marmellata', quantita: 30, unita: 'g' },
            ],
          },
          {
            id: 'pas_pra',
            nome: 'Pranzo',
            orario: '13:00',
            alimenti: [
              { nome: 'pasta', quantita: 100, unita: 'g' },
              { nome: 'petto di pollo', quantita: 150, unita: 'g' },
              { nome: 'zucchine', quantita: null, unita: 'g', libera: true },
              { nome: 'olio extravergine', quantita: 10, unita: 'g' },
            ],
          },
          {
            id: 'pas_cen',
            nome: 'Cena',
            orario: '20:00',
            alimenti: [
              { nome: 'riso', quantita: 80, unita: 'g' },
              { nome: 'merluzzo', quantita: 180, unita: 'g' },
            ],
          },
        ],
      },
      {
        indice: 1,
        pasti: [
          {
            id: 'pas_cen2',
            nome: 'Cena',
            orario: '20:00',
            alimenti: [
              { nome: 'pane', quantita: 60, unita: 'g' },
              // Non è in tabella: rende il conto del giorno parziale.
              { nome: 'nduja', quantita: 30, unita: 'g' },
            ],
          },
        ],
      },
      // I giorni da 2 a 6 restano vuoti: la media deve calcolarsi sui due
      // scritti, non su sette.
      { indice: 2, pasti: [] },
      { indice: 3, pasti: [] },
      { indice: 4, pasti: [] },
      { indice: 5, pasti: [] },
      { indice: 6, pasti: [] },
    ],
  };
}
