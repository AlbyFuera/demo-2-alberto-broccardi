/**
 * API del cliente.
 *
 * Il cliente vede una cosa sola: la SUA dieta. Nessun endpoint accetta un
 * identificativo di dieta o di paziente dal browser — si ricava dalla
 * sessione. Non è una comodità: è ciò che rende impossibile leggere la dieta di
 * un altro cambiando un parametro nell'URL.
 *
 * Tre stati, e l'interfaccia deve saperli distinguere perché richiedono azioni
 * diverse:
 *
 *   SOLO           nessun professionista → deve cercarlo e mandare la richiesta
 *   IN ATTESA      richiesta mandata     → non c'è niente da fare, si aspetta
 *   SEGUITO        collegamento attivo   → e allora, se c'è, la dieta
 *
 * Il percorso di una sostituzione, nell'ordine:
 *
 *   1. il PIANO dice cosa è ammesso                 (elenco chiuso, se c'è)
 *   2. l'EQUIVALENZA dice con quanto si sostituisce (calcolo, sempre)
 *   3. si REGISTRA come variazione                  (che è anche la notifica)
 *   4. la dieta del cliente la mostra sovrapposta   (l'originale resta)
 *   5. l'AI lo racconta                             (e solo questo)
 *
 * Il passo 1 non è un filtro che vieta: è quello che distingue una scelta
 * PREVISTA da una deviazione. Entrambe si possono fare — il cliente non è un
 * detenuto — ma solo la prima lascia intatta l'aderenza, e la riga di
 * variazione se lo porta scritto dietro.
 *
 * Se il passo 2 non sa rispondere, i passi 3 e 5 non avvengono e la domanda va
 * al professionista.
 */

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

/** Il collegamento e la dieta del cliente della sessione. Il punto di partenza. */
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
    // Non si distingue «non esiste» da «non è un professionista»: la differenza
    // direbbe a chiunque quali indirizzi hanno un account su questo servizio.
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

/**
 * Il giorno come lo vede il cliente.
 *
 * `originale` è la dieta SENZA le sue sostituzioni, e serve a una cosa sola ma
 * importante: le alternative ammesse stanno scritte sull'alimento prescritto
 * dal professionista, non su quello che il cliente ci ha messo sopra. Senza
 * questo, chi ha già sostituito una volta si troverebbe uno slot senza più
 * scelte — proprio lui, che le stava usando.
 */
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
            /**
             * Le sostituzioni previste dal professionista per questo posto.
             * `null` quando non ne ha scritte: l'interfaccia deve poter dire
             * «scegli fra le tue tre» e non «scegli fra le tue zero».
             */
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

/*
 * Qui stava `baseDa`, che leggeva dal browser la base con cui pareggiare.
 *
 * È stata tolta e non va rimessa: la base è una decisione clinica del
 * professionista, e finché il cliente poteva mandarla poteva anche scegliersi
 * la porzione più comoda fra due letture entrambe corrette. Ora la regola
 * arriva dalla dieta e dall'alimento, e il corpo della richiesta non ha voce.
 */

/**
 * «Cosa posso mettere al posto di questo?»
 *
 * Due elenchi, e stanno in questo ordine perché non hanno lo stesso peso:
 *
 *   PREVISTE   le alternative che il professionista ha ammesso per questo
 *              alimento, con la porzione già pronta. Scegliere qui non è
 *              chiedere un permesso: è fare quello che gli è stato concesso, e
 *              l'aderenza non ne risente;
 *   ALTRE      quello che compare altrove nella sua dieta, calcolato per
 *              equivalenza. Resta possibile, ma è una deviazione, e lo dice.
 *
 * Quando il professionista non ha scritto un piano c'è solo il secondo elenco:
 * è il prodotto di prima, che continua a funzionare com'era.
 */
export async function alternative(env: Env, utente: Utente, params: URLSearchParams) {
  const ctx = await esigiDieta(env, utente);
  const pos = posizioneDaBody({
    giorno: Number(params.get('giorno')),
    pasto: params.get('pasto'),
    indice: Number(params.get('indice')),
  });

  const alimento = alimentoA(ctx.dieta, pos);
  // Le alternative stanno sull'alimento PRESCRITTO: chi ha già sostituito una
  // volta deve continuare a vedere tutto l'elenco, non quello che resta.
  const prescritto = cercaAlimento(ctx.originale, pos) ?? alimento;

  // Una sola base, quella del professionista: l'eccezione sull'alimento se
  // c'è, altrimenti la regola della dieta. Il parametro `base` che il browser
  // mandava non esiste più — vedi `applica`.
  const slot = slotDi(prescritto, ctx.libreria, alimento.nome, ctx.dieta.base);

  // I candidati sono gli alimenti che il professionista ha già usato altrove
  // nella STESSA dieta: cibi che lui ha già ritenuto adatti a questo cliente.
  const candidati = alimentiDellaDieta(ctx.originale);
  const trovate = proposte(prescritto, candidati, ctx.libreria, 6, slot.base).filter(
    // Quelle già nel piano non si ripetono qui sotto come «altre»: la stessa
    // cosa in due elenchi con due significati diversi confonde e basta.
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
    /**
     * Dove è stata scritta la regola in vigore su questo alimento.
     *
     * Serve solo a come si legge: «il tuo nutrizionista ha scelto per tutta la
     * dieta» dice una cosa diversa da «per questo alimento in particolare», e
     * la seconda è quella che merita una riga a parte.
     */
    regola: prescritto.base ? 'alimento' : ctx.dieta.base ? 'dieta' : 'nessuna',
    proposte: trovate.map((p) => ({
      nome: p.nome,
      quantita: p.quantita,
      unita: p.unita,
      etichetta: `${p.quantita}${p.unita === 'pz' ? ' pz' : p.unita}`,
      delta: p.delta,
    })),
    /** Vuoto non è un errore: significa che nella dieta non c'è nulla di simile. */
    nessuna: trovate.length === 0 && slot.libero,
  };
}

/** «Posso mettere X al posto di Y?» — la verifica, senza applicare nulla. */
export async function verifica(env: Env, utente: Utente, body: any) {
  const ctx = await esigiDieta(env, utente);
  const pos = posizioneDaBody(body);
  const nuovo = String(body?.alimento ?? '').trim();
  if (!nuovo) throw new ErroreHttp(400, 'Dimmi cosa vorresti metterci.');
  if (nuovo.length > 80) throw new ErroreHttp(400, 'Nome dell’alimento troppo lungo.');

  const alimento = alimentoA(ctx.dieta, pos);
  const prescritto = cercaAlimento(ctx.originale, pos) ?? alimento;

  // Stessa gerarchia di `applica`, e per la stessa ragione: una verifica che
  // rispondesse su una base diversa da quella con cui poi si applica
  // annuncerebbe una porzione e ne metterebbe nel piatto un'altra.
  const base = prescritto.base ?? ctx.dieta.base ?? 'auto';

  // Si calcola sempre dal PRESCRITTO: sostituire il sostituto farebbe
  // accumulare le deviazioni una sull'altra.
  const e = equivalenza(prescritto, nuovo, ctx.libreria, base);
  const dentro = nelPiano(prescritto, nuovo);

  return {
    posizione: pos,
    equivalenza: e,
    nelPiano: dentro,
    /** Cosa cambia per lui, detto prima che scelga. */
    effettoAderenza: dentro
      ? 'Questa sostituzione è fra quelle previste dal tuo nutrizionista: la tua aderenza non cambia.'
      : (prescritto.alternative?.length ?? 0) > 0
        ? 'Questa non è fra le sostituzioni previste: il pasto conterà a metà nella tua aderenza.'
        : null,
    girataAlloStudio: false,
  };
}

/**
 * Applica la sostituzione.
 *
 * La scrittura è UNA: la riga di variazione. È quella che il professionista
 * vede ed è quella che, letta insieme alla dieta, produce il piatto nuovo. Non
 * esiste uno stato in cui il cliente ha un pasto cambiato e lo studio non lo sa.
 */
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

  /*
   * LA BASE LA DECIDE IL PROFESSIONISTA, e questa riga è tutta la differenza.
   *
   * Isocalorica o isoproteica è una scelta clinica: la fissa lui sulla dieta e
   * la può derogare sul singolo alimento. Il corpo della richiesta non entra
   * più in questo conto, ed è deliberato: senza il vincolo, chi volesse mangiare
   * di più cercherebbe la base che gli dà la porzione più grande — 90 g di
   * pasta diventano 85 g di riso pareggiando i carboidrati e 165 g pareggiando
   * le proteine, e a scegliere la dieta finirebbe il cliente.
   *
   * Dove non è stato dichiarato niente resta 'auto', che pareggia sul
   * macronutriente caratterizzante: nessuna regola da rispettare, quindi
   * nessuna regola da aggirare.
   */
  const base = prescritto.base ?? ctx.dieta.base ?? 'auto';

  /*
   * La porzione di un'alternativa AMMESSA la decide il piano, non questa
   * richiesta: se il professionista ha scritto «uova 2 pz», sono due uova
   * anche se il browser chiedesse altro. Per tutto il resto si calcola.
   */
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
    // 409, non 400: la richiesta è ben formata, è il motore che non sa dire
    // con quanto si sostituisce, e senza quel numero non si cambia un piatto.
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
    /**
     * La porzione finita davvero nel piatto.
     *
     * Non sempre coincide con quella dell'equivalenza: quando il professionista
     * ha scritto lui la grammatura di un'alternativa, vince la sua. Sta qui, a
     * parte, perché l'interfaccia deve poter mostrare quella vera e non il
     * calcolo che in quel caso non è stato usato.
     */
    porzione: {
      nome: porzione.nome,
      quantita: scriviQuantita(porzione as Alimento),
      fissataDalProfessionista: Boolean(opzione?.fissata && !opzione.prescritta),
    },
    giorno: decoraGiorno(dopo.dieta, pos.giorno, dopo.libreria, dopo.applicate, dopo.originale),
  };
}

/** Il cliente torna sui suoi passi. La notifica al professionista resta. */
export async function annulla(env: Env, utente: Utente, body: any) {
  const ctx = await esigiDieta(env, utente);
  const variazioneId = String(body?.id ?? '');
  if (!variazioneId) throw new ErroreHttp(400, 'Manca la variazione.');

  const mia = ctx.variazioni.find((v) => v.id === variazioneId);
  if (!mia) throw new ErroreHttp(404, 'Variazione non trovata.');

  // La riga si annulla, non si cancella: il professionista deve continuare a
  // vedere che il cliente aveva provato a cambiare quel piatto.
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

  // Come recuperare è una decisione clinica: si segnala, non si inventa.
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

/**
 * Il cliente scrive.
 *
 * Da qui partono due strade, e quale delle due la decide il professionista con
 * un interruttore (`links.auto_chat`), cliente per cliente:
 *
 *   AUTOMAZIONE ACCESA   risponde l'assistente, come ha sempre fatto. La
 *                        domanda e la risposta finiscono comunque nel filo, e
 *                        il professionista può leggerle quando vuole;
 *   AUTOMAZIONE SPENTA   nessuno risponde al posto suo. Il messaggio resta lì
 *                        e aspetta lui.
 *
 * Il messaggio del cliente si registra PRIMA di qualunque cosa. Se il modello
 * va in errore, se scade la quota, se il Worker viene terminato a metà, quello
 * che il cliente ha scritto non deve andare perso: è l'unica cosa in questo
 * scambio che non si può ricostruire.
 */
export async function chat(env: Env, utente: Utente, body: any) {
  const testo = String(body?.domanda ?? '').trim();
  if (!testo) throw new ErroreHttp(400, 'Manca la domanda.');
  if (testo.length > 1000) throw new ErroreHttp(400, 'Domanda troppo lunga.');

  const ctx = await esigiDieta(env, utente);
  const filo = { clienteId: utente.id, studioId: ctx.studioId };

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

  // La risposta dell'assistente entra nel filo: senza, il professionista che
  // spegne l'automazione domani si troverebbe a rispondere a metà di una
  // conversazione che non può leggere.
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

  /* 1. Capire la domanda. Con l'AI meglio; senza, le espressioni regolari.
        In entrambi i casi gli alimenti vengono verificati contro la dieta. */
  const pasti = giornoDi(ctx.dieta, oggi)?.pasti.map((p) => ({ id: p.id, nome: p.nome })) ?? [];
  const dalModello = await ai.interpreta(env, testo, pasti, oggi);
  const domanda = dalModello
    ? ancora(dalModello, ctx.dieta, testo)
    : assistente.interpreta(testo, ctx.dieta, oggi);

  /* 2. Le sostituzioni hanno un percorso proprio: è lì che serve
        l'equivalenza, e l'assistente generico non la calcola. */
  if (domanda.tipo === 'sostituzione') {
    return await rispondiSostituzione(env, utente, ctx, domanda, oggi, testo);
  }

  /* 3. Tutto il resto passa dall'assistente, che risolve contro il motore. */
  const risposta = assistente.risolvi(contestoAssistente, domanda);

  /* 3b. Quello che il motore non sa NON viene più girato al professionista:
        risponde l'assistente, con i dati della dieta sotto mano. È il confine
        che il committente ha spostato — vedi `ai.rispondiLibero`. */
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
    // Nemmeno il modello ha risposto (quota, rete): allora sì, va al
    // professionista. Meglio una domanda in attesa che una frase vuota.
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

/**
 * I dati della dieta, appiattiti per la risposta libera.
 *
 * Serve a tenere il modello ancorato a QUESTA dieta invece che alla nutrizione
 * in generale: senza, «quante proteine dovrei mangiare?» riceverebbe una
 * risposta da manuale al posto di quella che il suo nutrizionista ha scritto.
 */
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

/**
 * Riconduce alla dieta gli alimenti che il modello ha estratto.
 *
 * Ciò che ESCE dal piatto deve esistere nella dieta, o non c'è niente da
 * sostituire. Ciò che ENTRA no: se il cliente nomina un alimento che il
 * professionista non ha previsto, quel nome deve arrivare intatto al calcolo,
 * che risponderà con l'equivalenza o girerà la domanda allo studio.
 *
 * Il modello vince, ma non può far PERDERE informazione: se ha lasciato vuoto
 * un lato della coppia si guarda cosa trova l'analisi deterministica. I modelli
 * piccoli tendono a non compilare `alimentoNuovo` quando il cibo non compare
 * nell'elenco che gli abbiamo dato — ed è proprio il caso interessante.
 */
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

  /* Caso A — ha nominato il sostituto: si calcola l'equivalenza. */
  if (domanda.alimentoNuovo) {
    const e = equivalenza(alimento, domanda.alimentoNuovo, ctx.libreria);

    // Composizione non nota: prima si prova a farla spiegare all'assistente,
    // che può dire al cliente cosa considerare. Solo se non risponde nemmeno
    // lui la domanda va allo studio.
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
      // Nessun inoltro: se l'equivalenza non si calcola ha già risposto
      // l'assistente qui sopra. Restava un `daGirare` che faceva comparire al
      // cliente «l'ho girata al tuo nutrizionista» sotto una risposta che il
      // professionista non vedrà mai — la peggiore delle due cose.
      daGirare: undefined,
    };
  }

  /* Caso B — vuole delle proposte: quelle che spostano meno la giornata. */
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

/**
 * Tutto quello che il cliente vede appena apre: la giornata, i passi,
 * l'aderenza, e cosa gli resta da fare.
 *
 * Una richiesta sola. È la schermata principale, viene aperta cento volte al
 * giorno, e farne quattro chiamate significherebbe quattro attese e quattro
 * modi di vedere mezza pagina.
 */
export async function dashboard(env: Env, utente: Utente) {
  const ctx = await esigiDieta(env, utente);
  const data = oggiData();
  const indice = indiceGiorno(data);

  const [spunte, passi, storico] = await Promise.all([
    db.pastiDelGiorno(env, utente.id, data),
    db.passiRecenti(env, utente.id, 14),
    // La serie guarda più indietro dell'aderenza: quella misura la settimana,
    // questa la costanza, e due mesi di storia sono il minimo per dirla.
    db.spunteRecenti(env, utente.id, giorniPrima(data, 90)),
  ]);

  const giorno = decoraGiorno(ctx.dieta, indice, ctx.libreria, ctx.applicate, ctx.originale);
  const aderenza = calcolaAderenza(ctx.dieta, storico, data, 7, sostituzioniAttive(ctx.variazioni));
  const serie = calcolaSerie(ctx.dieta, storico, data);

  const obiettivoPassi = ctx.dieta.obiettivi.passi ?? null;
  const passiOggi = passi.find((p) => p.giorno === data)?.passi ?? null;

  // Quello che resta da fare oggi: i pasti non ancora spuntati. È la risposta
  // alla domanda vera di chi apre l'applicazione alle quattro del pomeriggio.
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

  // Non si registrano passi nel futuro: sarebbe un dato che non può esistere.
  if (giorno > oggiData()) throw new ErroreHttp(400, 'Non puoi segnare i passi di un giorno futuro.');

  await db.salvaPassi(env, utente.id, giorno, quanti);
  return { ok: true, passi: await db.passiRecenti(env, utente.id, 14) };
}

/* ------------------------------------------------------------------ */
/* Spuntare un pasto                                                   */
/* ------------------------------------------------------------------ */

/**
 * «Questo l'ho fatto», «questo l'ho saltato», «mi ero sbagliato».
 *
 * È il gesto su cui poggia tutta l'aderenza, quindi deve costare un tocco e
 * deve essere reversibile: chi spunta per errore e non può tornare indietro
 * smette di spuntare.
 */
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

  // Il pasto deve esistere nella dieta di quel giorno, o si accumulerebbero
  // spunte che puntano a niente e falserebbero l'aderenza.
  const esiste = giornoDi(ctx.dieta, indiceGiorno(giorno))?.pasti.some((p) => p.id === pastoId);
  if (!esiste) throw new ErroreHttp(404, 'Quel pasto non è previsto in questo giorno.');

  await db.segnaPasto(env, utente.id, giorno, pastoId, stato);
  return { ok: true, stato };
}

/* ------------------------------------------------------------------ */
/* Cambiare un pasto intero                                            */
/* ------------------------------------------------------------------ */

/**
 * «Oggi non ho voglia di questo pranzo, dammene un altro.»
 *
 * I pasti proposti vengono dagli ALTRI GIORNI della sua stessa dieta, entro il
 * 15% di scostamento calorico. Non passa dal professionista, ed è difendibile
 * proprio per questo: non si sta concedendo niente di nuovo, si sta permettendo
 * al cliente di mangiare giovedì quello che avrebbe mangiato sabato.
 */
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

/**
 * Applica lo scambio: gli alimenti del pasto scelto prendono il posto di quelli
 * di oggi, uno per uno, come tante sostituzioni.
 *
 * Si registrano come variazioni normali — quindi il professionista le vede — ma
 * non serve la sua approvazione perché il piatto nuovo è comunque suo.
 */
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

  // Si sostituisce posizione per posizione. Se il pasto nuovo ha più alimenti
  // dell'attuale, quelli in più non entrano: aggiungere righe a un pasto è
  // scrivere dieta, e quello resta del professionista.
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
        // Dentro il piano, sempre: questo pasto l'ha scritto il professionista
        // per questo cliente, si sta solo spostando di giorno. Contarlo come
        // deviazione significherebbe far scendere l'aderenza a chi mangia
        // giovedì quello che il suo nutrizionista gli aveva messo sabato.
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
      // `inline`: si apre nel visualizzatore del telefono, non si scarica in
      // una cartella dove il cliente non lo ritroverà.
      'content-disposition': `inline; filename="${encodeURIComponent(file.nome)}"`,
      'cache-control': 'no-store',
    },
  });
}
