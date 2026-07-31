import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  activateRule,
  activePreferences,
  deactivateRule,
  emptyProfile,
  proposeRules,
  recordCorrection,
  upsertRules,
} from '../src/style/profile.ts';
import type { Correction } from '../src/style/profile.ts';

let counter = 0;

function correction(over: Partial<Correction> = {}): Correction {
  return {
    id: `correzione-${++counter}`,
    professionalId: 'digiusto',
    planId: 'demarco-2026-02',
    at: '2026-07-01T10:00:00.000Z',
    scope: 'preferenza',
    key: 'legumi-a-cena',
    before: 'legumi a pranzo',
    after: 'legumi a cena',
    ...over,
  };
}

describe('profilo di stile', () => {
  it('rifiuta le correzioni di un altro professionista', () => {
    const profile = emptyProfile('digiusto');
    assert.throws(
      () => recordCorrection(profile, correction({ professionalId: 'altro-studio' })),
      /non si mescolano/,
    );
  });

  it('propone una regola solo dopo la terza correzione uguale', () => {
    let profile = emptyProfile('digiusto');

    profile = recordCorrection(profile, correction());
    assert.equal(proposeRules(profile).length, 0, 'una sola correzione non fa una regola');

    profile = recordCorrection(profile, correction());
    assert.equal(proposeRules(profile).length, 0);

    profile = recordCorrection(profile, correction());
    const proposte = proposeRules(profile);
    assert.equal(proposte.length, 1);
    assert.equal(proposte[0].evidence, 3);
    assert.equal(proposte[0].status, 'proposta', 'non si attiva da sola');
    assert.equal(proposte[0].sourceCorrections.length, 3, 'la regola resta tracciabile');
  });

  it('non trasforma MAI in stile le correzioni su quantità e alimenti', () => {
    let profile = emptyProfile('digiusto');
    for (let i = 0; i < 10; i++) {
      profile = recordCorrection(
        profile,
        correction({ scope: 'quantita', key: 'porzione-riso', before: '130g', after: '150g' }),
      );
      profile = recordCorrection(
        profile,
        correction({ scope: 'alimento-ammesso', key: 'aggiungi-farro', after: 'farro' }),
      );
      profile = recordCorrection(
        profile,
        correction({ scope: 'frequenza', key: 'pesce-3', before: '2', after: '3' }),
      );
    }
    assert.equal(
      proposeRules(profile).length,
      0,
      'quantità, alimenti e frequenze si cambiano solo modificando il piano',
    );
  });

  it('una regola disattivata a mano non torna da sola', () => {
    let profile = emptyProfile('digiusto');
    for (let i = 0; i < 5; i++) profile = recordCorrection(profile, correction());

    profile = upsertRules(profile, proposeRules(profile));
    profile = activateRule(profile, 'rule:legumi-a-cena');
    assert.equal(profile.rules[0].status, 'attiva');

    profile = deactivateRule(profile, 'rule:legumi-a-cena');

    // Nuove correzioni dello stesso tipo non devono resuscitarla.
    for (let i = 0; i < 5; i++) profile = recordCorrection(profile, correction());
    profile = upsertRules(profile, proposeRules(profile));

    assert.equal(
      profile.rules.find((r) => r.id === 'rule:legumi-a-cena')!.status,
      'disattivata',
      'la scelta del professionista vince sempre sull\'inferenza',
    );
  });

  it('espone al generatore solo le preferenze delle regole attive', () => {
    let profile = emptyProfile('digiusto');
    for (let i = 0; i < 3; i++) profile = recordCorrection(profile, correction());
    profile = upsertRules(profile, proposeRules(profile));

    assert.equal(activePreferences(profile).length, 0, 'una proposta non influenza nulla');

    profile = activateRule(profile, 'rule:legumi-a-cena', {
      id: 'legumi-a-cena',
      description: 'Legumi preferibilmente a cena',
      kind: 'prefer',
      days: [0, 1, 2, 3, 4, 5, 6],
      tags: ['legumi'],
      weight: 2,
    });

    const prefs = activePreferences(profile);
    assert.equal(prefs.length, 1);
    assert.equal(prefs[0].tags?.[0], 'legumi');
  });
});
