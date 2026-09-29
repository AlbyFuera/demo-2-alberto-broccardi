import type { Alimento, Dieta } from '../src/types.ts';
import {
  alimentiDellaDieta,
  dietaVuotaDavvero,
  giornoDi,
  nomeGiorno,
  scriviQuantita,
  totaleGiorno,
  totalePasto,
  totaleSettimana,
  trovaAlimento,
} from '../src/core/dieta.ts';
import { equivalenza, proposte, valoriPorzione } from '../src/core/equivalenza.ts';
import { nelPiano, slotDi } from '../src/core/piano.ts';
import { normalizza } from '../src/core/composizione.ts';
import { calcolaAderenza, calcolaSerie, giorniPrima, indiceGiorno } from '../src/core/aderenza.ts';
import { pastiAlternativi } from '../src/core/cambiopasto.ts';
import { listaSpesa } from '../src/core/spesa.ts';
import { recupero } from '../src/core/recupero.ts';
import * as assistente from '../src/core/assistente.ts';

import * as db from './db.ts';
import * as ai from './ai.ts';
import { ErroreHttp } from './auth.ts';
import { conNome } from './nomi.ts';
import { conSostituzioni, sostituzioniAttive, type Sostituzione } from './sovrapposizione.ts';
import { nomeDi, type Env, type Utente } from './types.ts';

/* ------------------------------------------------------------------ */
/* Il contesto del cliente                                             */
/* ------------------------------------------------------------------ */

/** Il collegamento e la dieta del cliente della sessione. */
async function contesto(env: Env, utente: Utente) {
  const collegamento = await db.collegamentoDelCliente(env, utente.id);

  if (!collegamento || collegamento.stato !== 'attivo') {
    return { collegamento, dieta: null, libreria: undefined, variazioni: [] };
  }

  const [riga, libreria, variazioni] = await Promise.all([
    db.dietaDelCliente(env, utente.id),
    db.libreriaDelloStudio(env, collegamento.studioId),
    db.variazioniDelCliente(env, utente.id, 60),
  ]);

  return { collegamento, dieta: riga, libreria, variazioni };
}

/** Il contesto con la dieta, o l'errore giusto per lo stato in cui si trova. */
async function esigiDieta(env: Env, utente: Utente) {
  const ctx = await contesto(env, utente);

  if (!ctx.collegamento) {
    throw new ErroreHttp(
      409,
      'Non hai ancora un nutrizionista. Aggiungilo con la sua email per iniziare.',
    );
  }
  if (ctx.collegamento.stato === 'in-attesa') {
    throw new ErroreHttp(
      409,
      `La tua richiesta a ${nomeDi({ nome: ctx.collegamento.studioNome, email: ctx.collegamento.studioEmail })} ` +
        `è in attesa: appena la accetta trovi qui la tua dieta.`,
    );
  }
  if (!ctx.dieta) {
    throw new ErroreHttp(
      404,
      'Il tuo nutrizionista non ti ha ancora pubblicato una dieta. Appena lo fa, la trovi qui.',
    );
  }

  const sovrapposta = conSostituzioni(ctx.dieta.dieta, ctx.variazioni);

  return {
    ...ctx,
    dietaRiga: ctx.dieta,
    /** La dieta come la vede il cliente: con le sue sostituzioni. */
    dieta: sovrapposta.dieta,
    /** La dieta come l'ha scritta il professionista. */
    originale: ctx.dieta.dieta,
    applicate: sovrapposta.applicate,
    scartate: sovrapposta.scartate,
    studioId: ctx.collegamento.studioId,
    nomeStudio: nomeDi({ nome: ctx.collegamento.studioNome, email: ctx.collegamento.studioEmail }),
  };
}

/* ------------------------------------------------------------------ */
/* Stato: dove si trova il cliente                                     */
/* ------------------------------------------------------------------ */

export async function stato(env: Env, utente: Utente) {
  const ctx = await contesto(env, utente);

  const professionista = ctx.collegamento
    ? {
        linkId: ctx.collegamento.id,
        nome: nomeDi({ nome: ctx.collegamento.studioNome, email: ctx.collegamento.studioEmail }),
        email: ctx.collegamento.studioEmail,
        stato: ctx.collegamento.stato,
        richiestoIl: ctx.collegamento.richiestoIl,
      }
    : null;

  return {
    io: { nome: utente.nome, email: utente.email, obiettivo: utente.obiettivo },
    professionista,
    haDieta: ctx.dieta !== null,
    ai: ai.stato(env),
  };
}

/* ------------------------------------------------------------------ */
/* Collegamento                                                        */
/* ------------------------------------------------------------------ */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function cercaStudio(env: Env, _utente: Utente, params: URLSearchParams) {
  const email = String(params.get('email') ?? '').trim();
  if (!EMAIL_RE.test(email)) throw new ErroreHttp(400, 'Scrivi l’email del tuo nutrizionista.');

  const studio = await db.studioPerEmail(env, email);
  if (!studio) {
    // Stessa risposta in entrambi i casi, per non rivelare chi è iscritto.
    return { trovato: false };
  }

  return {
    trovato: true,
    studio: {
      id: studio.id,
      nome: nomeDi({ nome: studio.nome, email: studio.email }),
      email: studio.email,
    },
  };
}

export async function richiedi(env: Env, utente: Utente, body: any) {
  const email = String(body?.email ?? '').trim();
  const messaggio = body?.messaggio ? String(body.messaggio).slice(0, 500) : null;

  const studio = await db.studioPerEmail(env, email);
  if (!studio) throw new ErroreHttp(404, 'Nessun nutrizionista con questa email.');

  const attuale = await db.collegamentoDelCliente(env, utente.id);
  if (attuale?.stato === 'attivo') {
    throw new ErroreHttp(
      409,
      `Sei già seguito da ${nomeDi({ nome: attuale.studioNome, email: attuale.studioEmail })}. ` +
        `Per cambiare, scollegati prima.`,
    );
  }

  await db.chiediCollegamento(env, utente.id, studio.id, messaggio);
  return { ok: true };
}

export async function scollega(env: Env, utente: Utente, body: any) {
  const linkId = String(body?.link ?? '');
  if (!linkId) throw new ErroreHttp(400, 'Manca il collegamento.');

  await db.sciogliCollegamento(env, utente.id, linkId);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* La dieta                                                            */
/* ------------------------------------------------------------------ */

/** Il giorno come lo vede il cliente; le alternative si leggono da `originale`. */
function decoraGiorno(
  dieta: Dieta,
  indice: number,
  libreria: any,
  applicate: Sostituzione[],
  originale?: Dieta,
) {
  const giorno = giornoDi(dieta, indice);
  if (!giorno) return null;

  /** L'alimento come l'aveva scritto il professionista, a quella posizione. */
  const prescrittoA = (pastoId: string, i: number): Alimento | undefined =>
    (originale ? giornoDi(originale, indice) : giorno)?.pasti.find((p) => p.id === pastoId)
      ?.alimenti[i];

  const t = totaleGiorno(giorno, libreria);

  return {
    indice,
    nome: nomeGiorno(indice),
    allenamento: giorno.allenamento === true,
    nota: giorno.nota ?? null,
    kcal: Math.round(t.kcal),
    proteine: Math.round(t.proteine),
    carboidrati: Math.round(t.carboidrati),
    grassi: Math.round(t.grassi),
    parziale: t.mancanti.length > 0,
    mancanti: [...new Set(t.mancanti)],
    pasti: giorno.pasti.map((pasto) => {
      const tp = totalePasto(pasto, libreria);
      return {
        id: pasto.id,
        nome: pasto.nome,
        orario: pasto.orario ?? null,
        nota: pasto.nota ?? null,
        kcal: Math.round(tp.kcal),
        parziale: tp.mancanti.length > 0,
        alimenti: pasto.alimenti.map((a, i) => {
          const cambiato = applicate.find(
            (s) => s.giorno === indice && s.pastoId === pasto.id && s.indice === i,
          );
          const prescritto = prescrittoA(pasto.id, i) ?? a;
          const quante = prescritto.alternative?.length ?? 0;

          return {
            indice: i,
            nome: a.nome,
            quantita: scriviQuantita(a),
            libera: a.libera === true || a.quantita === null,
            nota: a.nota ?? null,
            /** Presente se il cliente ha sostituito questo alimento. */
            cambiatoDa: cambiato?.originale ?? null,
            variazioneId: cambiato?.variazioneId ?? null,
            /** Sostituzioni previste dal professionista; null se non ce ne sono. */
            piano:
              quante > 0
                ? {
                    gruppo: slotDi(prescritto, libreria, a.nome).gruppo,
                    alternative: quante,
                  }
                : null,
          };
        }),
      };
    }),
  };
}

export async function scheda(env: Env, utente: Utente) {
  const ctx = await esigiDieta(env, utente);
  const { totale, media, giorniScritti } = totaleSettimana(ctx.dieta, ctx.libreria);

  const domande = await db.domandeDelCliente(env, utente.id);

  return {
    professionista: {
      nome: ctx.nomeStudio,
      linkId: ctx.collegamento!.id,
    },
    dieta: {
      id: ctx.dieta.id,
      titolo: ctx.dieta.titolo,
      indicazioni: ctx.dieta.indicazioni,
      obiettivi: ctx.dieta.obiettivi,
      pubblicataIl: ctx.dietaRiga.pubblicataIl,
      vuota: dietaVuotaDavvero(ctx.dieta),
    },
    giorni: [0, 1, 2, 3, 4, 5, 6]
      .map((i) => decoraGiorno(ctx.dieta, i, ctx.libreria, ctx.applicate, ctx.originale))
      .filter(Boolean),
    settimana: {
      giorniScritti,
      mediaKcal: Math.round(media.kcal),
      mediaProteine: Math.round(media.proteine),
      mediaCarboidrati: Math.round(media.carboidrati),
      mediaGrassi: Math.round(media.grassi),
      parziale: totale.mancanti.length > 0,
      mancanti: [...new Set(totale.mancanti)],
    },
    spesa: listaSpesa(ctx.dieta),
    variazioni: ctx.variazioni.slice(0, 30).map(conNome),
    variazioniScartate: ctx.scartate.length,
    risposte: domande.filter((d) => d.risposta).map(conNome),
    ai: ai.stato(env),
  };
}

/* ------------------------------------------------------------------ */
/* Sostituzioni                                                        */
/* ------------------------------------------------------------------ */

function posizioneDaBody(body: any) {
  const giorno = Number(body?.giorno);
  const pastoId = String(body?.pasto ?? '');
  const indice = Number(body?.indice);

  if (!Number.isInteger(giorno) || giorno < 0 || giorno > 6 || !pastoId || !Number.isInteger(indice)) {
    throw new ErroreHttp(400, 'Servono giorno, pasto e alimento.');
  }
  return { giorno, pastoId, indice };
}

function cercaAlimento(
  dieta: Dieta,
  pos: { giorno: number; pastoId: string; indice: number },
): Alimento | undefined {
  return giornoDi(dieta, pos.giorno)
    ?.pasti.find((p) => p.id === pos.pastoId)
    ?.alimenti[pos.indice];
}

function alimentoA(dieta: Dieta, pos: { giorno: number; pastoId: string; indice: number }): Alimento {
  const alimento = cercaAlimento(dieta, pos);
  if (!alimento) throw new ErroreHttp(404, 'Quell’alimento non è nella tua dieta.');
  return alimento;
}

// La base di pareggio non si legge mai dal browser.

/** Alternative previste dal piano e altre calcolate per equivalenza. */
export async function alternative(env: Env, utente: Utente, params: URLSearchParams) {
  const ctx = await esigiDieta(env, utente);
  const pos = posizioneDaBody({
    giorno: Number(params.get('giorno')),
    pasto: params.get('pasto'),
    indice: Number(params.get('indice')),
  });

  const alimento = alimentoA(ctx.dieta, pos);
  // Le alternative si leggono dall'alimento prescritto, non dal sostituto.
  const prescritto = cercaAlimento(ctx.originale, pos) ?? alimento;

  const slot = slotDi(prescritto, ctx.libreria, alimento.nome, ctx.dieta.base);

  // Candidati: gli alimenti già usati nella stessa dieta.
  const candidati = alimentiDellaDieta(ctx.originale);
  const trovate = proposte(prescritto, candidati, ctx.libreria, 6, slot.base).filter(
    // Escluse quelle già nel piano.
    (p) => !nelPiano(prescritto, p.nome),
  );

  return {
    posizione: pos,
    attuale: {
      nome: alimento.nome,
      quantita: scriviQuantita(alimento),
      valori: valoriPorzione(alimento, ctx.libreria),
    },
    /** Il piano: gruppo, base del pareggio, opzioni ammesse. */
    piano: {
      gruppo: slot.gruppo,
      base: slot.base,
      nomeBase: slot.nomeBase,
      prescritto: slot.prescritto,
      libero: slot.libero,
      opzioni: slot.opzioni.map((o) => ({
        nome: o.nome,
        quantita: o.quantita,
        unita: o.unita,
        etichetta: o.etichetta,
        fissata: o.fissata,
        scelta: o.scelta,
        prescritta: o.prescritta,
        delta: o.delta,
        esito: o.esito,
        avvisi: o.avvisi,
      })),
    },
    /** Dove è scritta la regola in vigore. */
    regola: prescritto.base ? 'alimento' : ctx.dieta.base ? 'dieta' : 'nessuna',
    proposte: trovate.map((p) => ({
      nome: p.nome,
      quantita: p.quantita,
      unita: p.unita,
      etichetta: `${p.quantita}${p.unita === 'pz' ? ' pz' : p.unita}`,
      delta: p.delta,
    })),
    /** Nessun alimento simile nella dieta. */
    nessuna: trovate.length === 0 && slot.libero,
  };
}

/** Verifica una sostituzione senza applicarla. */
export async function verifica(env: Env, utente: Utente, body: any) {
  const ctx = await esigiDieta(env, utente);
  const pos = posizioneDaBody(body);
  const nuovo = String(body?.alimento ?? '').trim();
  if (!nuovo) throw new ErroreHttp(400, 'Dimmi cosa vorresti metterci.');
  if (nuovo.length > 80) throw new ErroreHttp(400, 'Nome dell’alimento troppo lungo.');

  const alimento = alimentoA(ctx.dieta, pos);
  const prescritto = cercaAlimento(ctx.originale, pos) ?? alimento;

  // Stessa base di `applica`, altrimenti la porzione annunciata non coincide.
  const base = prescritto.base ?? ctx.dieta.base ?? 'auto';

  // Si calcola sempre dal prescritto, per non accumulare deviazioni.
  const e = equivalenza(prescritto, nuovo, ctx.libreria, base);
  const dentro = nelPiano(prescritto, nuovo);

  return {
    posizione: pos,
    equivalenza: e,
    nelPiano: dentro,
    /** Effetto sull'aderenza, mostrato prima della scelta. */
    effettoAderenza: dentro
      ? 'Questa sostituzione è fra quelle previste dal tuo nutrizionista: la tua aderenza non cambia.'
      : (prescritto.alternative?.length ?? 0) > 0
        ? 'Questa non è fra le sostituzioni previste: il pasto conterà a metà nella tua aderenza.'
        : null,
    girataAlloStudio: false,
  };
}

/** Applica la sostituzione registrando una variazione. */
export async function applica(env: Env, utente: Utente, body: any) {
  const ctx = await esigiDieta(env, utente);
  const pos = posizioneDaBody(body);
  const nuovo = String(body?.alimento ?? '').trim();
  if (!nuovo) throw new ErroreHttp(400, 'Dimmi cosa vuoi metterci.');

  const pasto = giornoDi(ctx.dieta, pos.giorno)?.pasti.find((p) => p.id === pos.pastoId);
  if (!pasto) throw new ErroreHttp(404, 'Quel pasto non è nella tua dieta.');

  const alimento = alimentoA(ctx.dieta, pos);
  const prescritto = cercaAlimento(ctx.originale, pos) ?? alimento;
  const dentro = nelPiano(prescritto, nuovo);

  // La base la decide il professionista, mai il corpo della richiesta.
  const base = prescritto.base ?? ctx.dieta.base ?? 'auto';

  // Per un'alternativa ammessa vale la porzione scritta nel piano.
  const e = equivalenza(prescritto, nuovo, ctx.libreria, base);
  const opzione = dentro
    ? slotDi(prescritto, ctx.libreria, alimento.nome, base).opzioni.find(
        (o) => normalizza(o.nome) === normalizza(nuovo),
      )
    : undefined;

  const porzione =
    opzione && opzione.quantita !== null
      ? { nome: opzione.nome, quantita: opzione.quantita, unita: opzione.unita }
      : e.entra;

  if (!porzione || (e.esito !== 'calcolata' && !opzione)) {
    // 409: richiesta valida ma equivalenza non calcolabile.
    throw new ErroreHttp(409, e.motivo ?? 'Non so calcolare questa sostituzione.');
  }

  const id = await db.registraVariazione(
    env,
    { clienteId: utente.id, studioId: ctx.studioId, dietaId: ctx.dieta.id },
    {
      giorno: pos.giorno,
      pastoId: pos.pastoId,
      pastoNome: pasto.nome,
      indice: pos.indice,
      daNome: alimento.nome,
      daQuantita: scriviQuantita(alimento),
      aNome: porzione.nome,
      aQuantita: scriviQuantita(porzione as Alimento),
      base: e.base,
      kcalDelta: e.delta?.kcal ?? 0,
      proteineDelta: e.delta?.proteine ?? 0,
      carboidratiDelta: e.delta?.carboidrati ?? 0,
      grassiDelta: e.delta?.grassi ?? 0,
      avvisi: opzione ? opzione.avvisi : e.avvisi,
      nelPiano: dentro,
    },
  );

  const dopo = await esigiDieta(env, utente);
  return {
    ok: true,
    id,
    equivalenza: e,
    nelPiano: dentro,
    /** La porzione applicata: quella del piano, se fissata dal professionista. */
    porzione: {
      nome: porzione.nome,
      quantita: scriviQuantita(porzione as Alimento),
      fissataDalProfessionista: Boolean(opzione?.fissata && !opzione.prescritta),
    },
    giorno: decoraGiorno(dopo.dieta, pos.giorno, dopo.libreria, dopo.applicate, dopo.originale),
  };
}

/** Annulla una variazione; la notifica al professionista resta. */
export async function annulla(env: Env, utente: Utente, body: any) {
  const ctx = await esigiDieta(env, utente);
  const variazioneId = String(body?.id ?? '');
  if (!variazioneId) throw new ErroreHttp(400, 'Manca la variazione.');

  const mia = ctx.variazioni.find((v) => v.id === variazioneId);
  if (!mia) throw new ErroreHttp(404, 'Variazione non trovata.');

  // La riga resta visibile allo studio, solo annullata.
  await db.annullaVariazione(env, ctx.studioId, variazioneId, 'Annullata dal cliente.');

  const dopo = await esigiDieta(env, utente);
  return {
    ok: true,
    giorno: decoraGiorno(dopo.dieta, mia.giorno, dopo.libreria, dopo.applicate, dopo.originale),
  };
}

/* ------------------------------------------------------------------ */
/* Recupero di un pasto saltato                                        */
/* ------------------------------------------------------------------ */

export async function saltato(env: Env, utente: Utente, body: any) {
  const ctx = await esigiDieta(env, utente);

  const giorno = Number.isInteger(Number(body?.giorno))
    ? Number(body.giorno)
    : (new Date().getDay() + 6) % 7;
  const saltati = Array.isArray(body?.pasti) ? body.pasti.map(String).slice(0, 6) : [];

  const r = recupero(ctx.dieta, giorno, saltati, new Date().getHours(), ctx.libreria);
  if (!r) throw new ErroreHttp(404, 'Quel giorno non è nella tua dieta.');

  // Oltre 150 kcal scoperte si avvisa il professionista.
  if (Math.round(r.scoperto.kcal) > 150 && saltati.length > 0) {
    await db.aggiungiDomanda(
      env,
      { clienteId: utente.id, studioId: ctx.studioId },
      `Ho saltato ${r.saltati.map((p) => p.nome).join(', ')} di ${nomeGiorno(giorno).toLowerCase()}.`,
      `Resterebbe sotto di ${Math.round(r.scoperto.kcal)} kcal rispetto a quanto previsto.`,
    );
  }

  return { recupero: r, nomeGiorno: nomeGiorno(giorno) };
}

/* ------------------------------------------------------------------ */
/* Conversazione                                                       */
/* ------------------------------------------------------------------ */

/** Messaggio del cliente: risponde l'assistente se l'automazione è accesa. */
export async function chat(env: Env, utente: Utente, body: any) {
  const testo = String(body?.domanda ?? '').trim();
  if (!testo) throw new ErroreHttp(400, 'Manca la domanda.');
  if (testo.length > 1000) throw new ErroreHttp(400, 'Domanda troppo lunga.');

  const ctx = await esigiDieta(env, utente);
  const filo = { clienteId: utente.id, studioId: ctx.studioId };

  // Si salva prima di tutto, così non si perde se il modello fallisce.
  await db.scriviMessaggio(env, filo, 'cliente', testo);

  if (!ctx.collegamento!.automazione) {
    return {
      tipo: 'allo-studio' as const,
      automazione: false,
      risposta:
        `L'ho mandato a ${ctx.nomeStudio}: le risposte le scrive lui di persona. ` +
        `Le trovi qui appena risponde.`,
      fonte: 'studio' as const,
      schede: [],
      citazioni: [],
    };
  }

  const esito = await rispostaAutomatica(env, utente, ctx, testo);

  // Anche la risposta dell'assistente entra nel filo.
  if (typeof esito?.risposta === 'string' && esito.risposta.trim()) {
    await db.scriviMessaggio(env, filo, 'assistente', esito.risposta);
  }

  return { ...esito, automazione: true };
}

/** Il filo, e i messaggi dello studio diventano letti nel momento in cui li apre. */
export async function messaggi(env: Env, utente: Utente) {
  const collegamento = await db.collegamentoDelCliente(env, utente.id);
  if (!collegamento || collegamento.stato !== 'attivo') {
    throw new ErroreHttp(409, 'Non hai ancora un nutrizionista.');
  }

  const filo = await db.filoMessaggi(env, utente.id, collegamento.studioId);
  await db.segnaMessaggiLetti(env, utente.id, collegamento.studioId, 'cliente');

  return {
    automazione: collegamento.automazione,
    professionista: nomeDi({ nome: collegamento.studioNome, email: collegamento.studioEmail }),
    messaggi: filo,
  };
}

async function rispostaAutomatica(
  env: Env,
  utente: Utente,
  ctx: Awaited<ReturnType<typeof esigiDieta>>,
  testo: string,
) {
  const adesso = new Date();
  const oggi = (adesso.getDay() + 6) % 7;

  const contestoAssistente: assistente.Contesto = {
    dieta: ctx.dieta,
    oggi,
    ora: adesso.getHours(),
    nomeProfessionista: ctx.nomeStudio,
    nomeCliente: nomeDi(utente),
    libreria: ctx.libreria,
  };

  /* 1. Capire la domanda: con il modello se c'è, altrimenti con le regex. */
  const pasti = giornoDi(ctx.dieta, oggi)?.pasti.map((p) => ({ id: p.id, nome: p.nome })) ?? [];
  const dalModello = await ai.interpreta(env, testo, pasti, oggi);
  const domanda = dalModello
    ? ancora(dalModello, ctx.dieta, testo)
    : assistente.interpreta(testo, ctx.dieta, oggi);

  /* 2. Le sostituzioni passano dall'equivalenza. */
  if (domanda.tipo === 'sostituzione') {
    return await rispondiSostituzione(env, utente, ctx, domanda, oggi, testo);
  }

  /* 3. Tutto il resto passa dall'assistente, che risolve contro il motore. */
  const risposta = assistente.risolvi(contestoAssistente, domanda);

  /* 3b. Se il motore non sa rispondere, prova il modello. */
  if (risposta.daGirare || !risposta.risposta) {
    const libera = await ai.rispondiLibero(env, testo, fattiDellaDieta(ctx, oggi), ctx.nomeStudio);
    if (libera) {
      return {
        tipo: domanda.tipo,
        ...risposta,
        risposta: libera,
        fonte: 'ai' as const,
        daGirare: undefined,
      };
    }
    // Senza risposta dal modello la domanda va al professionista.
    if (risposta.daGirare) {
      await db.aggiungiDomanda(
        env,
        { clienteId: utente.id, studioId: ctx.studioId },
        testo,
        risposta.daGirare.motivo,
      );
    }
    return { tipo: domanda.tipo, ...risposta };
  }

  const voce = await ai.parlaConLaVoce(env, risposta, ctx.nomeStudio, testo);
  if (voce) {
    risposta.risposta = voce;
    risposta.fonte = 'ai';
  }

  return { tipo: domanda.tipo, ...risposta, daGirare: undefined };
}

/** I dati della dieta in forma di elenco, per la risposta libera. */
function fattiDellaDieta(ctx: Awaited<ReturnType<typeof esigiDieta>>, oggi: number): string[] {
  const g = giornoDi(ctx.dieta, oggi);
  const o = ctx.dieta.obiettivi;

  return [
    `Dieta: «${ctx.dieta.titolo}», scritta da ${ctx.nomeStudio}.`,
    ...(o.kcal ? [`Obiettivo giornaliero: ${o.kcal} kcal.`] : []),
    ...(o.proteine ? [`Proteine: ${o.proteine} g al giorno.`] : []),
    ...(o.carboidrati ? [`Carboidrati: ${o.carboidrati} g al giorno.`] : []),
    ...(o.grassi ? [`Grassi: ${o.grassi} g al giorno.`] : []),
    ...(o.acqua ? [`Acqua: ${o.acqua} litri al giorno.`] : []),
    ...(o.passi ? [`Passi: ${o.passi} al giorno.`] : []),
    ...(ctx.dieta.indicazioni.length
      ? [`Indicazioni del professionista: ${ctx.dieta.indicazioni.join(' · ')}`]
      : []),
    `Oggi (${nomeGiorno(oggi)}) la dieta prevede:`,
    ...(g?.pasti.length
      ? g.pasti.map(
          (p) =>
            `  ${p.nome}${p.orario ? ` (${p.orario})` : ''}: ` +
            p.alimenti.map((a) => `${a.nome} ${scriviQuantita(a)}`).join(', '),
        )
      : ['  niente scritto per oggi']),
    `Alimenti che compaiono in tutta la settimana: ${alimentiDellaDieta(ctx.dieta).join(', ')}.`,
  ];
}

/** Riconduce alla dieta gli alimenti estratti dal modello. */
function ancora(domanda: assistente.Domanda, dieta: Dieta, testo: string): assistente.Domanda {
  if (domanda.tipo !== 'sostituzione') return domanda;

  const ripiego = assistente.coppia(testo, dieta);
  const esce = domanda.alimento
    ? (trovaAlimento(dieta, domanda.alimento, domanda.giorno ?? 0)
        ? domanda.alimento
        : undefined)
    : undefined;

  return {
    ...domanda,
    alimento: esce ?? ripiego.alimento,
    alimentoNuovo: domanda.alimentoNuovo ?? ripiego.alimentoNuovo,
  };
}

async function rispondiSostituzione(
  env: Env,
  utente: Utente,
  ctx: Awaited<ReturnType<typeof esigiDieta>>,
  domanda: assistente.Domanda,
  oggi: number,
  testo: string,
) {
  const giorno = domanda.giorno ?? oggi;

  const pos = domanda.alimento
    ? trovaAlimento(ctx.dieta, domanda.alimento, giorno, domanda.pastoId)
    : primoAlimentoDelPasto(ctx.dieta, giorno, domanda.pastoId);

  if (!pos) {
    return {
      tipo: 'sostituzione' as const,
      risposta:
        `Non ho capito cosa vuoi cambiare. Dimmi il pasto e l'alimento — per esempio ` +
        `«posso mettere il riso al posto della pasta a pranzo?» — oppure toccalo ` +
        `direttamente nella tua dieta.`,
      schede: [],
      citazioni: [],
      fonte: 'motore' as const,
      domanda,
    };
  }

  const alimento = giornoDi(ctx.dieta, pos.giorno)!.pasti.find((p) => p.id === pos.pastoId)!
    .alimenti[pos.indice];

  /* Caso A: sostituto indicato, si calcola l'equivalenza. */
  if (domanda.alimentoNuovo) {
    const e = equivalenza(alimento, domanda.alimentoNuovo, ctx.libreria);

    // Composizione non nota: prima il modello, poi lo studio.
    if (e.esito !== 'calcolata') {
      const libera = await ai.rispondiLibero(env, testo, fattiDellaDieta(ctx, oggi), ctx.nomeStudio);
      if (libera) {
        return {
          tipo: 'equivalenza' as const,
          esito: e.esito,
          risposta: libera,
          fonte: 'ai' as const,
          equivalenza: e,
          posizione: pos,
          schede: [],
          citazioni: [],
          domanda,
        };
      }
      await db.aggiungiDomanda(
        env,
        { clienteId: utente.id, studioId: ctx.studioId },
        testo,
        e.motivo ?? 'Composizione non nota.',
      );
    }

    const voce = await ai.raccontaEquivalenza(env, e, ctx.nomeStudio, testo);

    return {
      tipo: 'equivalenza' as const,
      esito: e.esito,
      risposta: voce ?? fraseEquivalenza(e, ctx.nomeStudio),
      fonte: voce ? ('ai' as const) : ('motore' as const),
      equivalenza: e,
      posizione: pos,
      schede: [],
      citazioni: e.avvisi,
      domanda,
      daGirare: undefined,
    };
  }

  /* Caso B: nessun sostituto indicato, si propongono alternative. */
  const trovate = proposte(alimento, alimentiDellaDieta(ctx.originale), ctx.libreria, 6);

  const frase =
    trovate.length === 0
      ? `Nella tua dieta non c'è niente di simile a ${alimento.nome} da proporti. ` +
        `Dimmi tu con cosa vorresti sostituirlo e ti dico quanto ce ne vuole.`
      : `${alimento.nome} ${scriviQuantita(alimento)} lo puoi sostituire con ${trovate.length} ` +
        `alimenti che il tuo nutrizionista ha già messo nella tua dieta. Il primo è quello ` +
        `che sposta meno la giornata.`;

  const risposta = {
    risposta: frase,
    schede: [
      {
        titolo: `Al posto di ${alimento.nome}`,
        righe: trovate.map((p) => ({
          nome: p.nome,
          quantita: `${p.quantita}${p.unita === 'pz' ? ' pz' : p.unita}`,
        })),
      },
    ],
    citazioni: [] as string[],
    fonte: 'motore' as const,
    domanda,
  };

  const voce = await ai.parlaConLaVoce(env, risposta, ctx.nomeStudio, testo);

  return {
    tipo: 'proposte' as const,
    ...risposta,
    risposta: voce ?? frase,
    fonte: voce ? ('ai' as const) : ('motore' as const),
    posizione: pos,
    proposte: trovate,
    attuale: { nome: alimento.nome, quantita: scriviQuantita(alimento) },
  };
}

function primoAlimentoDelPasto(dieta: Dieta, giorno: number, pastoId?: string) {
  const pasto = pastoId
    ? giornoDi(dieta, giorno)?.pasti.find((p) => p.id === pastoId)
    : undefined;
  return pasto?.alimenti.length
    ? { giorno, pastoId: pasto.id, indice: 0 }
    : null;
}

function fraseEquivalenza(
  e: ReturnType<typeof equivalenza>,
  nomeStudio: string,
): string {
  if (e.esito === 'calcolata' && e.entra && e.delta) {
    const segno = e.delta.kcal >= 0 ? '+' : '';
    return (
      `Sì: al posto di ${e.esce.nome} ${scriviQuantita(e.esce)} ci vogliono ` +
      `${scriviQuantita(e.entra)} di ${e.entra.nome}, ${e.spiegazione}. ` +
      `La giornata si sposta di ${segno}${Math.round(e.delta.kcal)} kcal. ` +
      `${nomeStudio} vede la modifica sulla sua schermata.`
    );
  }
  return e.motivo ?? `Questa non la so dire: l'ho girata a ${nomeStudio}.`;
}

/* ------------------------------------------------------------------ */
/* Impostazioni                                                        */
/* ------------------------------------------------------------------ */

export async function impostazioni(env: Env, utente: Utente, body: any) {
  const nome = body?.nome !== undefined ? String(body.nome).trim().slice(0, 80) : undefined;
  const obiettivo =
    body?.obiettivo !== undefined ? String(body.obiettivo).trim().slice(0, 300) : undefined;

  if (nome !== undefined && nome.length < 2) {
    throw new ErroreHttp(400, 'Il nome deve avere almeno due caratteri.');
  }

  await db.aggiornaProfilo(env, utente.id, { nome, obiettivo });
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* La dashboard                                                        */
/* ------------------------------------------------------------------ */

/** La data di oggi come 'AAAA-MM-GG'. */
const oggiData = () => new Date().toISOString().slice(0, 10);

/** I dati della schermata principale, in una sola richiesta. */
export async function dashboard(env: Env, utente: Utente) {
  const ctx = await esigiDieta(env, utente);
  const data = oggiData();
  const indice = indiceGiorno(data);

  const [spunte, passi, storico] = await Promise.all([
    db.pastiDelGiorno(env, utente.id, data),
    db.passiRecenti(env, utente.id, 14),
    // 90 giorni di storico per la serie.
    db.spunteRecenti(env, utente.id, giorniPrima(data, 90)),
  ]);

  const giorno = decoraGiorno(ctx.dieta, indice, ctx.libreria, ctx.applicate, ctx.originale);
  const aderenza = calcolaAderenza(ctx.dieta, storico, data, 7, sostituzioniAttive(ctx.variazioni));
  const serie = calcolaSerie(ctx.dieta, storico, data);

  const obiettivoPassi = ctx.dieta.obiettivi.passi ?? null;
  const passiOggi = passi.find((p) => p.giorno === data)?.passi ?? null;

  // Pasti di oggi con il loro stato.
  const pasti = (giorno?.pasti ?? []).map((p) => ({
    ...p,
    stato: spunte[p.id] ?? null,
  }));

  const fatti = pasti.filter((p) => p.stato === 'fatto');
  const saltati = pasti.filter((p) => p.stato === 'saltato');

  const consumate = fatti.reduce((s, p) => s + p.kcal, 0);
  const previste = pasti.reduce((s, p) => s + p.kcal, 0);

  return {
    professionista: { nome: ctx.nomeStudio, linkId: ctx.collegamento!.id },
    dieta: {
      id: ctx.dieta.id,
      titolo: ctx.dieta.titolo,
      obiettivi: ctx.dieta.obiettivi,
      indicazioni: ctx.dieta.indicazioni,
      haPdf: (await db.infoPdf(env, ctx.dieta.id)) !== null,
    },
    oggi: {
      data,
      indice,
      nome: nomeGiorno(indice),
      allenamento: giorno?.allenamento ?? false,
      nota: giorno?.nota ?? null,
      pasti,
      kcalPreviste: Math.round(previste),
      kcalConsumate: Math.round(consumate),
      parziale: giorno?.parziale ?? false,
      pastiFatti: fatti.length,
      pastiSaltati: saltati.length,
      pastiTotali: pasti.length,
    },
    passi: {
      oggi: passiOggi,
      obiettivo: obiettivoPassi,
      /** Gli ultimi giorni, dal più vecchio: serve al grafico a barre. */
      storico: passi.slice().reverse(),
    },
    aderenza,
    serie,
    variazioni: ctx.variazioni.slice(0, 8).map(conNome),
    ai: ai.stato(env),
  };
}

/* ------------------------------------------------------------------ */
/* Passi                                                              */
/* ------------------------------------------------------------------ */

export async function passi(env: Env, utente: Utente, body: any) {
  const quanti = Number(body?.passi);
  if (!Number.isFinite(quanti) || quanti < 0 || quanti > 200_000) {
    throw new ErroreHttp(400, 'Il numero di passi non è valido.');
  }

  const giorno = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.giorno ?? ''))
    ? String(body.giorno)
    : oggiData();

  if (giorno > oggiData()) throw new ErroreHttp(400, 'Non puoi segnare i passi di un giorno futuro.');

  await db.salvaPassi(env, utente.id, giorno, quanti);
  return { ok: true, passi: await db.passiRecenti(env, utente.id, 14) };
}

/* ------------------------------------------------------------------ */
/* Spuntare un pasto                                                   */
/* ------------------------------------------------------------------ */

/** Segna un pasto come fatto o saltato, o toglie il segno. */
export async function spunta(env: Env, utente: Utente, body: any) {
  const ctx = await esigiDieta(env, utente);
  const pastoId = String(body?.pasto ?? '');
  if (!pastoId) throw new ErroreHttp(400, 'Manca il pasto.');

  const grezzo = body?.stato;
  const stato = grezzo === 'fatto' || grezzo === 'saltato' ? grezzo : null;

  const giorno = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.giorno ?? ''))
    ? String(body.giorno)
    : oggiData();
  if (giorno > oggiData()) throw new ErroreHttp(400, 'Non puoi segnare un giorno futuro.');

  // Il pasto deve esistere in quel giorno, o falserebbe l'aderenza.
  const esiste = giornoDi(ctx.dieta, indiceGiorno(giorno))?.pasti.some((p) => p.id === pastoId);
  if (!esiste) throw new ErroreHttp(404, 'Quel pasto non è previsto in questo giorno.');

  await db.segnaPasto(env, utente.id, giorno, pastoId, stato);
  return { ok: true, stato };
}

/* ------------------------------------------------------------------ */
/* Cambiare un pasto intero                                            */
/* ------------------------------------------------------------------ */

/** Pasti alternativi presi dagli altri giorni della stessa dieta. */
export async function cambiaPasto(env: Env, utente: Utente, params: URLSearchParams) {
  const ctx = await esigiDieta(env, utente);
  const giorno = Number(params.get('giorno'));
  const pastoId = String(params.get('pasto') ?? '');

  if (!Number.isInteger(giorno) || giorno < 0 || giorno > 6 || !pastoId) {
    throw new ErroreHttp(400, 'Servono giorno e pasto.');
  }

  const { attuale, alternativi } = pastiAlternativi(ctx.dieta, giorno, pastoId, ctx.libreria, 4);
  if (!attuale) throw new ErroreHttp(404, 'Quel pasto non è nella tua dieta.');

  const suo = totalePasto(attuale, ctx.libreria);

  return {
    attuale: {
      id: attuale.id,
      nome: attuale.nome,
      kcal: Math.round(suo.kcal),
      alimenti: attuale.alimenti.map((a) => ({ nome: a.nome, quantita: scriviQuantita(a) })),
    },
    alternativi: alternativi.map((x) => ({
      giorno: x.giorno,
      giornoNome: x.giornoNome,
      pastoId: x.pasto.id,
      nome: x.pasto.nome,
      kcal: Math.round(x.valori.kcal),
      deltaKcal: Math.round(x.delta.kcal),
      parziale: x.parziale,
      alimenti: x.pasto.alimenti.map((a) => ({ nome: a.nome, quantita: scriviQuantita(a) })),
    })),
    nessuno: alternativi.length === 0,
  };
}

/** Scambia il pasto con quello scelto, una variazione per alimento. */
export async function applicaCambioPasto(env: Env, utente: Utente, body: any) {
  const ctx = await esigiDieta(env, utente);
  const giorno = Number(body?.giorno);
  const pastoId = String(body?.pasto ?? '');
  const versoId = String(body?.verso ?? '');

  if (!Number.isInteger(giorno) || giorno < 0 || giorno > 6 || !pastoId || !versoId) {
    throw new ErroreHttp(400, 'Servono giorno, pasto e pasto scelto.');
  }

  const { attuale, alternativi } = pastiAlternativi(ctx.dieta, giorno, pastoId, ctx.libreria, 8);
  const scelto = alternativi.find((x) => x.pasto.id === versoId);
  if (!attuale || !scelto) throw new ErroreHttp(409, 'Quel cambio non è più disponibile.');

  const nuovi = scelto.pasto.alimenti;
  let applicate = 0;

  // Posizione per posizione; gli alimenti in più si ignorano.
  for (let i = 0; i < attuale.alimenti.length && i < nuovi.length; i++) {
    const vecchio = attuale.alimenti[i];
    const nuovo = nuovi[i];
    if (vecchio.nome === nuovo.nome && vecchio.quantita === nuovo.quantita) continue;

    await db.registraVariazione(
      env,
      { clienteId: utente.id, studioId: ctx.studioId, dietaId: ctx.dieta.id },
      {
        giorno,
        pastoId,
        pastoNome: attuale.nome,
        indice: i,
        daNome: vecchio.nome,
        daQuantita: scriviQuantita(vecchio),
        aNome: nuovo.nome,
        aQuantita: scriviQuantita(nuovo),
        base: 'pasto-intero',
        kcalDelta: 0,
        proteineDelta: 0,
        carboidratiDelta: 0,
        grassiDelta: 0,
        avvisi: [
          `Scambio del pasto intero con quello di ${scelto.giornoNome.toLowerCase()} ` +
            `(${scelto.delta.kcal >= 0 ? '+' : ''}${Math.round(scelto.delta.kcal)} kcal sul pasto).`,
        ],
        // Conta come nel piano: il pasto è comunque della sua dieta.
        nelPiano: true,
      },
    );
    applicate++;
  }

  const dopo = await esigiDieta(env, utente);
  return {
    ok: true,
    sostituzioni: applicate,
    giorno: decoraGiorno(dopo.dieta, giorno, dopo.libreria, dopo.applicate, dopo.originale),
  };
}

/* ------------------------------------------------------------------ */
/* Il PDF originale                                                    */
/* ------------------------------------------------------------------ */

/** Il PDF che il nutrizionista ha caricato, come l'ha caricato. */
export async function pdf(env: Env, utente: Utente): Promise<Response> {
  const ctx = await esigiDieta(env, utente);
  const file = await db.contenutoPdf(env, ctx.dieta.id);
  if (!file) throw new ErroreHttp(404, 'Nessun PDF allegato a questa dieta.');

  const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));

  return new Response(bytes, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${encodeURIComponent(file.nome)}"`,
      'cache-control': 'no-store',
    },
  });
}
