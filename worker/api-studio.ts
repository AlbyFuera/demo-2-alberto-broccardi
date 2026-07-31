/**
 * API dello studio (nutrizionista).
 *
 * Quattro lavori, in ordine di frequenza reale:
 *
 *   1. guardare cosa hanno cambiato o chiesto i clienti   → cruscotto()
 *   2. accettare chi chiede di essere seguito             → decidi()
 *   3. scrivere la dieta, giorno per giorno               → salvaDieta()
 *   4. completare gli alimenti che il motore non conosce  → salvaAlimento()
 *
 * Il primo è quello che apre ogni mattina, e per questo è l'unico che deve
 * stare in una schermata sola senza scorrere.
 *
 * REGOLA VALIDA OVUNQUE: prima di toccare i dati di un cliente si verifica che
 * esista un collegamento ATTIVO. Ricevere una richiesta non è essere il suo
 * nutrizionista — e un cliente che ha rifiutato o si è scollegato non deve
 * restare leggibile.
 */

import {
  BASI,
  dietaVuota,
  type Alternativa,
  type BaseSostituzione,
  type Dieta,
  type Giorno,
  type Pasto,
  type Unita,
} from '../src/types.ts';
import {
  alimentiDaCompletare,
  dietaVuotaDavvero,
  nomeGiorno,
  scriviQuantita,
  totaleGiorno,
  totalePasto,
  totaleSettimana,
} from '../src/core/dieta.ts';
import { composizioneDi, normalizza } from '../src/core/composizione.ts';
import { calcolaAderenza, giorniPrima } from '../src/core/aderenza.ts';

import * as db from './db.ts';
import { conNome } from './nomi.ts';
import * as ai from './ai.ts';
import { ErroreHttp } from './auth.ts';
import { conSostituzioni, sostituzioniAttive } from './sovrapposizione.ts';
import { LIMITE_PDF, dietaDaLettura, leggiPdf } from './pdf.ts';
import { nomeDi, type Env, type Utente } from './types.ts';

/* ------------------------------------------------------------------ */
/* Il cruscotto                                                        */
/* ------------------------------------------------------------------ */

export async function cruscotto(env: Env, utente: Utente) {
  const [collegamenti, variazioni, domande] = await Promise.all([
    db.collegamentiDelloStudio(env, utente.id),
    db.variazioniDelloStudio(env, utente.id, { limite: 40 }),
    db.domandeDelloStudio(env, utente.id),
  ]);

  const richieste = collegamenti.filter((c) => c.stato === 'in-attesa');
  const attivi = collegamenti.filter((c) => c.stato === 'attivo');

  // Una query per cliente sarebbe una N+1 che su D1 si paga in latenza a ogni
  // caricamento: le diete dei clienti attivi si leggono in un colpo solo.
  const diete = await dietePerClienti(env, utente.id, attivi.map((c) => c.clienteId));
  const aderenze = await aderenzePerClienti(
    env,
    attivi.map((c) => c.clienteId),
    diete,
    variazioni,
  );
  const daLeggere = await db.messaggiDaLeggere(env, utente.id);

  return {
    io: { nome: utente.nome, email: utente.email },
    richieste: richieste.map((c) => ({
      linkId: c.id,
      clienteId: c.clienteId,
      nome: nomeDi({ nome: c.clienteNome, email: c.clienteEmail }),
      email: c.clienteEmail,
      messaggio: c.messaggio,
      richiestoIl: c.richiestoIl,
    })),
    clienti: attivi.map((c) => {
      const dieta = diete.get(c.clienteId);
      return {
        linkId: c.id,
        id: c.clienteId,
        nome: nomeDi({ nome: c.clienteNome, email: c.clienteEmail }),
        email: c.clienteEmail,
        seguitoDa: c.richiestoIl,
        dieta: dieta
          ? { id: dieta.id, titolo: dieta.titolo, stato: dieta.stato, vuota: dietaVuotaDavvero(dieta.dieta) }
          : null,
        // Il numero che il professionista guarda per primo, accanto al nome.
        aderenza: aderenze.get(c.clienteId) ?? null,
        variazioniNuove: variazioni.filter((v) => v.clienteId === c.clienteId && v.stato === 'nuova').length,
        domandeAperte: domande.filter((d) => d.clienteId === c.clienteId && d.stato === 'aperta').length,
        /** L'assistente risponde per lui a questo cliente, oppure no. */
        automazione: c.automazione,
        /** Messaggi che il cliente ha scritto e nessuno ha ancora letto. */
        messaggiDaLeggere: daLeggere.get(c.clienteId) ?? 0,
      };
    }),
    variazioni: variazioni.map(conNome),
    domande: domande.map(conNome),
    conteggi: {
      richieste: richieste.length,
      clienti: attivi.length,
      variazioniNuove: variazioni.filter((v) => v.stato === 'nuova').length,
      domandeAperte: domande.filter((d) => d.stato === 'aperta').length,
      messaggi: [...daLeggere.values()].reduce((s, n) => s + n, 0),
    },
    ai: ai.stato(env),
  };
}

async function dietePerClienti(
  env: Env,
  studioId: string,
  clienti: string[],
): Promise<Map<string, db.DietaRiga>> {
  const per = new Map<string, db.DietaRiga>();
  if (clienti.length === 0) return per;

  for (const clienteId of clienti) {
    const diete = await db.dieteDelCliente(env, studioId, clienteId);
    // Quella pubblicata se c'è, altrimenti la bozza più recente: è quella su
    // cui il professionista sta lavorando.
    const attuale = diete.find((d) => d.stato === 'pubblicata') ?? diete.find((d) => d.stato === 'bozza');
    if (attuale) per.set(clienteId, attuale);
  }
  return per;
}

/**
 * L'aderenza di ogni cliente, in un colpo solo.
 *
 * Si legge dalle spunte degli ultimi otto giorni. Chi non ha una dieta o non ha
 * mai spuntato niente non ha un'aderenza: ha `null`, che l'interfaccia mostra
 * come «nessun dato» e non come zero. È la distinzione che cambia la telefonata
 * che il professionista gli farà.
 */
async function aderenzePerClienti(
  env: Env,
  clienti: string[],
  diete: Map<string, db.DietaRiga>,
  variazioni: db.VariazioneRiga[],
): Promise<Map<string, ReturnType<typeof calcolaAderenza>>> {
  const per = new Map<string, ReturnType<typeof calcolaAderenza>>();
  const oggi = new Date().toISOString().slice(0, 10);

  for (const clienteId of clienti) {
    const dieta = diete.get(clienteId);
    if (!dieta) continue;

    const spunte = await db.spunteRecenti(env, clienteId, giorniPrima(oggi, 8));
    per.set(
      clienteId,
      calcolaAderenza(
        dieta.dieta,
        spunte,
        oggi,
        7,
        sostituzioniAttive(variazioni.filter((v) => v.clienteId === clienteId)),
      ),
    );
  }
  return per;
}

/** Sondaggio leggero: solo i numeri, per il pallino sulle notifiche. */
export async function novita(env: Env, utente: Utente) {
  const [variazioni, domande, collegamenti, messaggi] = await Promise.all([
    db.contaVariazioniNuove(env, utente.id),
    db.domandeDelloStudio(env, utente.id, true),
    db.collegamentiDelloStudio(env, utente.id),
    db.messaggiDaLeggere(env, utente.id),
  ]);

  return {
    variazioniNuove: variazioni,
    domandeAperte: domande.length,
    richieste: collegamenti.filter((c) => c.stato === 'in-attesa').length,
    // I messaggi dei clienti entrano nel pallino: un cliente che scrive a un
    // professionista che ha spento l'automazione sta aspettando lui, e se
    // l'avviso non arriva l'interruttore diventa un modo di non rispondere.
    messaggi: [...messaggi.values()].reduce((s, n) => s + n, 0),
  };
}

/* ------------------------------------------------------------------ */
/* Collegamenti                                                        */
/* ------------------------------------------------------------------ */

export async function decidi(env: Env, utente: Utente, body: any) {
  const linkId = String(body?.link ?? '');
  const accetta = body?.accetta === true;
  if (!linkId) throw new ErroreHttp(400, 'Manca la richiesta.');

  const fatto = await db.decidiCollegamento(env, utente.id, linkId, accetta);
  if (!fatto) throw new ErroreHttp(404, 'Richiesta non trovata o già decisa.');

  return { ok: true, accettata: accetta };
}

export async function scollega(env: Env, utente: Utente, body: any) {
  const linkId = String(body?.link ?? '');
  if (!linkId) throw new ErroreHttp(400, 'Manca il collegamento.');

  await db.sciogliCollegamento(env, utente.id, linkId);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Il cliente visto dallo studio                                       */
/* ------------------------------------------------------------------ */

/** Nessuna lettura su un cliente senza collegamento attivo. Nessuna eccezione. */
async function esigiCliente(env: Env, studioId: string, clienteId: string) {
  if (!clienteId) throw new ErroreHttp(400, 'Manca il cliente.');
  if (!(await db.collegamentoAttivo(env, studioId, clienteId))) {
    throw new ErroreHttp(403, 'Non segui questo cliente.');
  }
}

export async function cliente(env: Env, utente: Utente, params: URLSearchParams) {
  const clienteId = String(params.get('cliente') ?? '');
  await esigiCliente(env, utente.id, clienteId);

  const [collegamenti, diete, variazioni, domande, libreria, filo] = await Promise.all([
    db.collegamentiDelloStudio(env, utente.id),
    db.dieteDelCliente(env, utente.id, clienteId),
    db.variazioniDelCliente(env, clienteId, 60),
    db.domandeDelloStudio(env, utente.id),
    db.libreriaDelloStudio(env, utente.id),
    db.filoMessaggi(env, clienteId, utente.id),
  ]);

  const collegamento = collegamenti.find((c) => c.clienteId === clienteId);
  const attuale = diete.find((d) => d.stato === 'pubblicata') ?? diete.find((d) => d.stato === 'bozza');

  // Aprire la scheda è leggere: i messaggi del cliente smettono di essere «da
  // leggere» qui, non quando lui riceve una risposta.
  await db.segnaMessaggiLetti(env, clienteId, utente.id, 'studio');

  return {
    cliente: {
      id: clienteId,
      nome: nomeDi({
        nome: collegamento?.clienteNome ?? '',
        email: collegamento?.clienteEmail ?? '',
      }),
      email: collegamento?.clienteEmail ?? '',
      linkId: collegamento?.id ?? null,
      seguitoDa: collegamento?.richiestoIl ?? null,
      /** L'assistente risponde al posto suo, oppure scrive lui. */
      automazione: collegamento?.automazione ?? true,
    },
    conversazione: filo,
    diete: diete.map((d) => ({
      id: d.id,
      titolo: d.titolo,
      stato: d.stato,
      aggiornataIl: d.aggiornataIl,
      pubblicataIl: d.pubblicataIl,
      vuota: dietaVuotaDavvero(d.dieta),
    })),
    dietaAttuale: attuale ? riepilogoDieta(attuale, libreria, variazioni) : null,
    aderenza: attuale
      ? calcolaAderenza(
          attuale.dieta,
          await db.spunteRecenti(env, clienteId, giorniPrima(new Date().toISOString().slice(0, 10), 15)),
          new Date().toISOString().slice(0, 10),
          14,
          sostituzioniAttive(variazioni),
        )
      : null,
    passi: await db.passiRecenti(env, clienteId, 14),
    variazioni: variazioni.map(conNome),
    domande: domande.filter((d) => d.clienteId === clienteId).map(conNome),
  };
}

function riepilogoDieta(riga: db.DietaRiga, libreria: any, variazioni: db.VariazioneRiga[]) {
  // Quello che il cliente sta seguendo davvero: la dieta con le sue
  // sostituzioni sopra. È l'unica versione che conta quando lo si giudica.
  const { dieta: seguita, applicate } = conSostituzioni(riga.dieta, variazioni);
  const { media, giorniScritti, totale } = totaleSettimana(seguita, libreria);

  return {
    id: riga.id,
    titolo: riga.titolo,
    stato: riga.stato,
    aggiornataIl: riga.aggiornataIl,
    pubblicataIl: riga.pubblicataIl,
    obiettivi: riga.dieta.obiettivi,
    indicazioni: riga.dieta.indicazioni,
    giorniScritti,
    mediaKcal: Math.round(media.kcal),
    mediaProteine: Math.round(media.proteine),
    mediaCarboidrati: Math.round(media.carboidrati),
    mediaGrassi: Math.round(media.grassi),
    parziale: totale.mancanti.length > 0,
    sostituzioniAttive: applicate.length,
    giorni: seguita.giorni.map((g) => {
      const t = totaleGiorno(g, libreria);
      return {
        indice: g.indice,
        nome: nomeGiorno(g.indice),
        allenamento: g.allenamento === true,
        kcal: Math.round(t.kcal),
        parziale: t.mancanti.length > 0,
        pasti: g.pasti.map((p) => ({
          id: p.id,
          nome: p.nome,
          kcal: Math.round(totalePasto(p, libreria).kcal),
          alimenti: p.alimenti.map((a, i) => ({
            nome: a.nome,
            quantita: scriviQuantita(a),
            cambiato: applicate.some(
              (s) => s.giorno === g.indice && s.pastoId === p.id && s.indice === i,
            ),
          })),
        })),
      };
    }),
  };
}

/* ------------------------------------------------------------------ */
/* Scrivere la dieta                                                   */
/* ------------------------------------------------------------------ */

export async function nuovaDieta(env: Env, utente: Utente, body: any) {
  const clienteId = String(body?.cliente ?? '');
  await esigiCliente(env, utente.id, clienteId);

  const titolo = String(body?.titolo ?? '').trim() || 'Dieta';
  if (titolo.length > 80) throw new ErroreHttp(400, 'Titolo troppo lungo.');

  const dieta = dietaVuota(db.nuovoId('die'), titolo);

  // Da una dieta esistente: la maggior parte delle diete nuove è la precedente
  // con due o tre cose cambiate, e riscriverla da zero è il modo più veloce di
  // far smettere un professionista di usare lo strumento.
  const daId = String(body?.da ?? '');
  if (daId) {
    const precedente = await db.dietaDelloStudio(env, utente.id, daId);
    if (precedente && precedente.clienteId === clienteId) {
      Object.assign(dieta, {
        indicazioni: precedente.dieta.indicazioni,
        obiettivi: precedente.dieta.obiettivi,
        giorni: rigeneraId(precedente.dieta.giorni),
      });
    }
  }

  await db.creaDieta(env, utente.id, clienteId, dieta);
  return { ok: true, id: dieta.id, dieta };
}

/** Copiando una dieta gli id dei pasti si rifanno: le vecchie variazioni non devono agganciarsi. */
function rigeneraId(giorni: Giorno[]): Giorno[] {
  return giorni.map((g) => ({
    ...g,
    pasti: g.pasti.map((p) => ({ ...p, id: db.nuovoId('pas') })),
  }));
}

export async function apriDieta(env: Env, utente: Utente, params: URLSearchParams) {
  const id = String(params.get('dieta') ?? '');
  const riga = await db.dietaDelloStudio(env, utente.id, id);
  if (!riga) throw new ErroreHttp(404, 'Dieta non trovata.');

  const libreria = await db.libreriaDelloStudio(env, utente.id);
  const { media, giorniScritti, totale } = totaleSettimana(riga.dieta, libreria);

  return {
    id: riga.id,
    clienteId: riga.clienteId,
    stato: riga.stato,
    aggiornataIl: riga.aggiornataIl,
    dieta: riga.dieta,
    conti: {
      giorniScritti,
      mediaKcal: Math.round(media.kcal),
      mediaProteine: Math.round(media.proteine),
      mediaCarboidrati: Math.round(media.carboidrati),
      mediaGrassi: Math.round(media.grassi),
      parziale: totale.mancanti.length > 0,
      giorni: riga.dieta.giorni.map((g) => {
        const t = totaleGiorno(g, libreria);
        return {
          indice: g.indice,
          kcal: Math.round(t.kcal),
          proteine: Math.round(t.proteine),
          carboidrati: Math.round(t.carboidrati),
          grassi: Math.round(t.grassi),
          parziale: t.mancanti.length > 0,
          pasti: g.pasti.map((p) => ({
            id: p.id,
            kcal: Math.round(totalePasto(p, libreria).kcal),
          })),
        };
      }),
    },
    // Gli alimenti che il motore non conosce: finché restano, i totali sono
    // incompleti e il professionista lo vede scritto sopra la dieta.
    daCompletare: alimentiDaCompletare(riga.dieta, libreria),
  };
}

/**
 * Salva la dieta.
 *
 * Si riscrive intera a ogni salvataggio, e va bene così: una dieta pesa pochi
 * kilobyte e salvare per campi significherebbe inventare un protocollo di
 * modifiche parziali per risparmiare byte che nessuno sta contando.
 *
 * Ogni pasto senza id ne riceve uno: gli id li fa il server, mai il browser.
 * Ci puntano le variazioni dei clienti, e un id scelto dal client sarebbe un
 * modo per far agganciare una vecchia sostituzione a un pasto nuovo.
 */
export async function salvaDieta(env: Env, utente: Utente, body: any) {
  const id = String(body?.id ?? '');
  const riga = await db.dietaDelloStudio(env, utente.id, id);
  if (!riga) throw new ErroreHttp(404, 'Dieta non trovata.');
  if (riga.stato === 'archiviata') throw new ErroreHttp(409, 'Questa dieta è archiviata.');

  const dieta = leggiDieta(body?.dieta, riga.dieta);
  const salvata = await db.salvaDieta(env, utente.id, id, dieta);
  if (!salvata) throw new ErroreHttp(409, 'Non è stato possibile salvare.');

  const libreria = await db.libreriaDelloStudio(env, utente.id);
  return {
    ok: true,
    dieta,
    daCompletare: alimentiDaCompletare(dieta, libreria),
    conti: (await apriDieta(env, utente, new URLSearchParams({ dieta: id }))).conti,
  };
}

const UNITA_AMMESSE = new Set(['g', 'ml', 'pz']);

/**
 * Il piano a sostituzione di un alimento, come arriva dall'editor.
 *
 * Massimo otto alternative per alimento: non è un limite tecnico, è che un
 * elenco più lungo il cliente non lo legge — sceglie fra le prime tre e le
 * altre cinque sono lavoro buttato per chi le ha scritte.
 *
 * I campi si restituiscono `undefined` quando sono vuoti invece di stringhe e
 * array vuoti: la dieta viaggia come JSON in una colonna, e trenta alimenti con
 * tre campi vuoti ciascuno sono peso morto in ogni lettura.
 */
function leggiPiano(a: any): { alternative?: Alternativa[]; base?: BaseSostituzione; gruppo?: string } {
  const alternative: Alternativa[] = (Array.isArray(a?.alternative) ? a.alternative : [])
    .slice(0, 8)
    .map((x: any) => {
      const nome = String(x?.nome ?? '').trim().slice(0, 80);
      const q = Number(x?.quantita);
      const quantita = Number.isFinite(q) && q > 0 ? q : undefined;
      return {
        nome,
        // La quantità è facoltativa: quando manca la calcola il motore
        // pareggiando secondo la base scelta. Uno zero salvato per sbaglio
        // metterebbe nel piatto del cliente «0 g di ricotta».
        ...(quantita !== undefined ? { quantita } : {}),
        ...(quantita !== undefined && UNITA_AMMESSE.has(x?.unita) ? { unita: x.unita as Unita } : {}),
      };
    })
    .filter((x: Alternativa) => x.nome.length > 0);

  /*
   * Nomi ripetuti fuori, e anche l'alimento stesso.
   *
   * Capita scrivendo — si aggiunge una riga, si dimentica di averla già messa —
   * e il cliente si troverebbe l'elenco con due volte la stessa cosa, o con
   * «al posto del pollo puoi mettere il pollo». Il confronto è quello del
   * motore: minuscole, senza accenti.
   */
  const visti = new Set([normalizza(String(a?.nome ?? ''))]);
  const uniche = alternative.filter((x: Alternativa) => {
    const chiave = normalizza(x.nome);
    if (visti.has(chiave)) return false;
    visti.add(chiave);
    return true;
  });

  const base = BASI.includes(a?.base) ? (a.base as BaseSostituzione) : undefined;
  const gruppo = String(a?.gruppo ?? '').trim().slice(0, 40);

  return {
    ...(uniche.length ? { alternative: uniche } : {}),
    ...(base && base !== 'auto' ? { base } : {}),
    ...(gruppo ? { gruppo } : {}),
  };
}

/** Legge e ripulisce la dieta che arriva dal browser. Niente entra senza passare di qui. */
function leggiDieta(grezza: any, precedente: Dieta): Dieta {
  const testo = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

  const numero = (v: unknown): number | undefined => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };

  const giorni: Giorno[] = [0, 1, 2, 3, 4, 5, 6].map((indice) => {
    const g = (Array.isArray(grezza?.giorni) ? grezza.giorni : []).find(
      (x: any) => Number(x?.indice) === indice,
    );

    const pasti: Pasto[] = (Array.isArray(g?.pasti) ? g.pasti : [])
      .slice(0, 12)
      .map((p: any): Pasto => ({
        id: typeof p?.id === 'string' && /^pas_[a-z0-9]+$/.test(p.id) ? p.id : db.nuovoId('pas'),
        nome: testo(p?.nome, 40) || 'Pasto',
        orario: testo(p?.orario, 10) || undefined,
        nota: testo(p?.nota, 300) || undefined,
        alimenti: (Array.isArray(p?.alimenti) ? p.alimenti : [])
          .slice(0, 30)
          .map((a: any) => {
            const libera = a?.libera === true;
            const q = numero(a?.quantita);
            return {
              nome: testo(a?.nome, 80),
              quantita: libera ? null : (q ?? null),
              unita: (UNITA_AMMESSE.has(a?.unita) ? a.unita : 'g') as Unita,
              libera: libera || q === undefined,
              nota: testo(a?.nota, 120) || undefined,
              ...leggiPiano(a),
            };
          })
          .filter((a: any) => a.nome.length > 0),
      }))
      .filter((p: Pasto) => p.nome.length > 0);

    return {
      indice,
      pasti,
      allenamento: g?.allenamento === true,
      nota: testo(g?.nota, 300) || undefined,
    };
  });

  return {
    id: precedente.id,
    titolo: testo(grezza?.titolo, 80) || precedente.titolo,
    indicazioni: (Array.isArray(grezza?.indicazioni) ? grezza.indicazioni : [])
      .slice(0, 30)
      .map((r: unknown) => testo(r, 300))
      .filter(Boolean),
    obiettivi: {
      kcal: numero(grezza?.obiettivi?.kcal),
      proteine: numero(grezza?.obiettivi?.proteine),
      carboidrati: numero(grezza?.obiettivi?.carboidrati),
      grassi: numero(grezza?.obiettivi?.grassi),
      acqua: numero(grezza?.obiettivi?.acqua),
      passi: numero(grezza?.obiettivi?.passi),
    },
    giorni,
  };
}

/**
 * Pubblica: da qui in poi il cliente la vede.
 *
 * Si rifiuta di pubblicare una dieta vuota. Non è pedanteria: un cliente che
 * apre l'applicazione e trova sette giorni senza niente pensa che lo strumento
 * sia rotto, non che il suo nutrizionista non abbia ancora scritto.
 */
export async function pubblica(env: Env, utente: Utente, body: any) {
  const id = String(body?.id ?? '');
  const riga = await db.dietaDelloStudio(env, utente.id, id);
  if (!riga) throw new ErroreHttp(404, 'Dieta non trovata.');

  await esigiCliente(env, utente.id, riga.clienteId);

  if (dietaVuotaDavvero(riga.dieta)) {
    throw new ErroreHttp(409, 'Questa dieta è vuota: scrivi almeno un pasto prima di pubblicarla.');
  }

  await db.pubblicaDieta(env, utente.id, id, riga.clienteId);

  const libreria = await db.libreriaDelloStudio(env, utente.id);
  const mancanti = alimentiDaCompletare(riga.dieta, libreria);

  return {
    ok: true,
    // Non blocca la pubblicazione: una dieta con un alimento non in tabella è
    // comunque una dieta valida. Il cliente vedrà il conto dichiarato parziale.
    avviso:
      mancanti.length > 0
        ? `Pubblicata. ${mancanti.length} alimenti non hanno valori nutrizionali: ` +
          `finché non li completi, i totali del cliente restano parziali.`
        : null,
  };
}

export async function ritira(env: Env, utente: Utente, body: any) {
  const id = String(body?.id ?? '');
  if (!id) throw new ErroreHttp(400, 'Manca la dieta.');

  await db.ritiraDieta(env, utente.id, id);
  return { ok: true };
}

export async function eliminaDieta(env: Env, utente: Utente, body: any) {
  const id = String(body?.id ?? '');
  if (!id) throw new ErroreHttp(400, 'Manca la dieta.');

  await db.eliminaDieta(env, utente.id, id);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Libreria degli alimenti                                             */
/* ------------------------------------------------------------------ */

export async function libreria(env: Env, utente: Utente) {
  return { alimenti: await db.elencoLibreria(env, utente.id) };
}

/**
 * Salva i valori di un alimento.
 *
 * I numeri li scrive il professionista. Non c'è una via in cui li proponga un
 * modello: un valore nutrizionale inventato entra in una dieta clinica e ci
 * resta, e nessuno saprebbe più da dove è arrivato.
 */
export async function salvaAlimento(env: Env, utente: Utente, body: any) {
  const nome = String(body?.nome ?? '').trim();
  if (nome.length < 2) throw new ErroreHttp(400, 'Serve il nome dell’alimento.');
  if (nome.length > 80) throw new ErroreHttp(400, 'Nome troppo lungo.');

  const macro = ['proteine', 'carboidrati', 'grassi'].map((k) => {
    const n = Number(body?.[k]);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      throw new ErroreHttp(400, `Il valore di ${k} deve stare tra 0 e 100 grammi.`);
    }
    return n;
  });

  const per = body?.per === 'pz' ? 'pz' : 'g100';

  // La somma dei tre macronutrienti non può superare 100 g su 100 g di
  // alimento: è un controllo aritmetico, non nutrizionale, e prende gli errori
  // di battitura prima che finiscano in una dieta.
  if (per === 'g100' && macro[0] + macro[1] + macro[2] > 100) {
    throw new ErroreHttp(
      400,
      `Proteine, carboidrati e grassi sommano a ${Math.round(macro[0] + macro[1] + macro[2])} g ` +
        `su 100 g di alimento: c'è un errore in uno dei tre.`,
    );
  }

  await db.salvaAlimento(env, utente.id, {
    nome,
    proteine: macro[0],
    carboidrati: macro[1],
    grassi: macro[2],
    per,
  });

  return { ok: true };
}

export async function eliminaAlimento(env: Env, utente: Utente, body: any) {
  const chiave = String(body?.chiave ?? '');
  const per = String(body?.per ?? 'g100');
  if (!chiave) throw new ErroreHttp(400, 'Manca l’alimento.');

  await db.eliminaAlimento(env, utente.id, chiave, per);
  return { ok: true };
}

/**
 * Cosa sa il motore di un alimento, mentre il professionista lo sta scrivendo.
 *
 * Serve all'editor per dire subito «questo lo conosco» o «di questo mi servono
 * i valori», senza aspettare il salvataggio.
 */
export async function conosci(env: Env, utente: Utente, params: URLSearchParams) {
  const nome = String(params.get('nome') ?? '').trim();
  const unita = String(params.get('unita') ?? 'g');
  if (!nome) throw new ErroreHttp(400, 'Manca il nome.');

  const libreria = await db.libreriaDelloStudio(env, utente.id);
  const c = composizioneDi(nome, unita, libreria);

  return {
    nome,
    chiave: normalizza(nome),
    conosciuto: c !== null,
    composizione: c,
  };
}

/* ------------------------------------------------------------------ */
/* Variazioni e domande                                                */
/* ------------------------------------------------------------------ */

export async function segnaViste(env: Env, utente: Utente, body: any) {
  const ids = Array.isArray(body?.ids) ? body.ids.map(String).slice(0, 200) : [];
  await db.segnaVariazioniViste(env, utente.id, ids);
  return { ok: true };
}

/**
 * Il veto sulla variazione di un cliente.
 *
 * È il potere che rende lo strumento accettabile a chi firma la dieta:
 * l'ultima parola resta sua. Basta mettere la riga ad 'annullata' — la
 * sovrapposizione smette da sola di applicarla e il piatto torna quello
 * prescritto, senza una seconda scrittura che potrebbe fallire a metà.
 */
export async function annullaVariazione(env: Env, utente: Utente, body: any) {
  const id = String(body?.id ?? '');
  const nota = body?.nota ? String(body.nota).slice(0, 500) : null;
  if (!id) throw new ErroreHttp(400, 'Manca la variazione.');

  const riga = await db.annullaVariazione(env, utente.id, id, nota);
  if (!riga) throw new ErroreHttp(404, 'Variazione non trovata.');

  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* La conversazione con il cliente                                     */
/* ------------------------------------------------------------------ */

/**
 * L'interruttore dell'assistente, cliente per cliente.
 *
 * Spento, l'assistente smette di rispondere a QUEL cliente e i suoi messaggi
 * aspettano il professionista. È una decisione che si prende sul singolo
 * rapporto — al cliente autonomo si lascia l'assistente, a quello appena
 * operato si vuole rispondere di persona — e un interruttore unico per tutto
 * lo studio costringerebbe a scegliere il comportamento sbagliato per metà
 * delle persone.
 *
 * Quello che l'assistente ha già detto NON si cancella: resta nel filo, ed è
 * anzi la prima cosa che il professionista deve poter leggere quando prende in
 * mano una conversazione cominciata senza di lui.
 */
export async function automazione(env: Env, utente: Utente, body: any) {
  const clienteId = String(body?.cliente ?? '');
  await esigiCliente(env, utente.id, clienteId);

  const attiva = body?.attiva === true;
  const fatto = await db.impostaAutomazione(env, utente.id, clienteId, attiva);
  if (!fatto) throw new ErroreHttp(404, 'Collegamento non trovato.');

  // Il cliente deve sapere chi gli sta rispondendo da adesso in poi: senza
  // questa riga, l'assistente smetterebbe di parlare senza che nessuno glielo
  // dica, e lui penserebbe che l'applicazione si è rotta.
  await db.scriviMessaggio(
    env,
    { clienteId, studioId: utente.id },
    'studio',
    attiva
      ? 'Da adesso all’assistente puoi chiedere quello che vuoi: risponde lui, con i dati della tua dieta.'
      : 'Da adesso ti rispondo io di persona: scrivimi pure qui, leggo tutto.',
  );

  return { ok: true, automazione: attiva };
}

/** Il professionista scrive al cliente. */
export async function scrivi(env: Env, utente: Utente, body: any) {
  const clienteId = String(body?.cliente ?? '');
  await esigiCliente(env, utente.id, clienteId);

  const testo = String(body?.testo ?? '').trim();
  if (!testo) throw new ErroreHttp(400, 'Il messaggio è vuoto.');
  if (testo.length > 2000) throw new ErroreHttp(400, 'Messaggio troppo lungo.');

  const messaggio = await db.scriviMessaggio(
    env,
    { clienteId, studioId: utente.id },
    'studio',
    testo,
  );

  return { ok: true, messaggio };
}

/** Il filo di un cliente, per aggiornarlo senza ricaricare tutta la scheda. */
export async function conversazione(env: Env, utente: Utente, params: URLSearchParams) {
  const clienteId = String(params.get('cliente') ?? '');
  await esigiCliente(env, utente.id, clienteId);

  const filo = await db.filoMessaggi(env, clienteId, utente.id);
  await db.segnaMessaggiLetti(env, clienteId, utente.id, 'studio');

  return { messaggi: filo };
}

export async function rispondi(env: Env, utente: Utente, body: any) {
  const id = String(body?.id ?? '');
  const risposta = String(body?.risposta ?? '').trim();
  if (!id || !risposta) throw new ErroreHttp(400, 'Servono la domanda e la risposta.');
  if (risposta.length > 2000) throw new ErroreHttp(400, 'Risposta troppo lunga.');

  await db.rispondiDomanda(env, utente.id, id, risposta);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Impostazioni                                                        */
/* ------------------------------------------------------------------ */

export async function impostazioni(env: Env, utente: Utente, body: any) {
  const nome = body?.nome !== undefined ? String(body.nome).trim().slice(0, 80) : undefined;

  if (nome !== undefined && nome.length < 2) {
    throw new ErroreHttp(400, 'Il nome deve avere almeno due caratteri.');
  }

  await db.aggiornaProfilo(env, utente.id, { nome });
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Caricare la dieta come PDF                                          */
/* ------------------------------------------------------------------ */

/**
 * Il PDF diventa una dieta.
 *
 * Tre cose avvengono, nell'ordine: si conserva il file, si prova a leggerlo, e
 * si crea una BOZZA con quello che si è capito. La bozza il cliente non la vede
 * finché il professionista non la pubblica — ed è lì che deve controllare quello
 * che la lettura ha ricavato.
 *
 * Se la lettura non riesce, il PDF resta comunque allegato e la dieta si scrive
 * a mano: si perde l'automatismo, non il lavoro.
 */
export async function caricaPdf(env: Env, utente: Utente, body: any) {
  const clienteId = String(body?.cliente ?? '');
  await esigiCliente(env, utente.id, clienteId);

  const nome = String(body?.nome ?? 'dieta.pdf').slice(0, 120);
  const base64 = String(body?.contenuto ?? '');
  if (!base64) throw new ErroreHttp(400, 'Manca il file.');

  let dati: ArrayBuffer;
  try {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    dati = bytes.buffer as ArrayBuffer;
  } catch {
    throw new ErroreHttp(400, 'Il file non è leggibile.');
  }

  if (dati.byteLength > LIMITE_PDF) {
    throw new ErroreHttp(
      413,
      `Il PDF pesa ${Math.round(dati.byteLength / 1024)} KB: il massimo è ` +
        `${Math.round(LIMITE_PDF / 1024)} KB. Riesportalo a risoluzione più bassa.`,
    );
  }

  // Un PDF comincia sempre con %PDF-. Controllarlo evita di conservare un file
  // qualunque a cui è stata cambiata l'estensione.
  const testa = new TextDecoder().decode(new Uint8Array(dati).slice(0, 5));
  if (testa !== '%PDF-') throw new ErroreHttp(400, 'Questo non è un PDF.');

  const titolo =
    String(body?.titolo ?? '').trim().slice(0, 80) ||
    nome.replace(/\.pdf$/i, '').slice(0, 80) ||
    'Dieta';

  // L'ordine conta: PRIMA si conserva il file e si crea la bozza, POI si prova
  // a leggerlo. La lettura passa da un modello e può volerci troppo: se il
  // Worker viene terminato a metà, il professionista deve ritrovarsi comunque
  // il PDF caricato e una bozza vuota da compilare, non un errore e niente.
  const dietaId = db.nuovoId('die');
  await db.creaDieta(env, utente.id, clienteId, dietaVuota(dietaId, titolo));
  await db.salvaPdf(env, dietaId, nome, base64, dati.byteLength);

  let lettura: Awaited<ReturnType<typeof leggiPdf>>;
  try {
    lettura = await leggiPdf(env, nome, dati, () => db.nuovoId('pas'));
  } catch (e) {
    console.error('lettura del PDF interrotta:', e instanceof Error ? e.message : e);
    lettura = {
      ok: false,
      avvisi: [],
      motivo:
        'La lettura automatica non è riuscita a finire in tempo. Il PDF è caricato: ' +
        'la dieta va scritta a mano, oppure riprova a caricarlo.',
    };
  }

  if (lettura.ok) {
    await db.salvaDieta(env, utente.id, dietaId, dietaDaLettura(dietaId, titolo, lettura));
  }

  return {
    ok: true,
    id: dietaId,
    lettaAutomaticamente: lettura.ok,
    avvisi: lettura.avvisi,
    motivo: lettura.motivo ?? null,
    // Il testo estratto serve al professionista per confrontare: è la carta
    // accanto a quello che il software ha capito.
    testo: lettura.testo?.slice(0, 8000) ?? null,
  };
}

/** I metadati del PDF allegato a una dieta. */
export async function infoPdf(env: Env, utente: Utente, params: URLSearchParams) {
  const id = String(params.get('dieta') ?? '');
  const riga = await db.dietaDelloStudio(env, utente.id, id);
  if (!riga) throw new ErroreHttp(404, 'Dieta non trovata.');

  return { pdf: await db.infoPdf(env, id) };
}

/** Il PDF, per il professionista. Stesso file che vede il cliente. */
export async function scaricaPdf(
  env: Env,
  utente: Utente,
  params: URLSearchParams,
): Promise<Response> {
  const id = String(params.get('dieta') ?? '');
  const riga = await db.dietaDelloStudio(env, utente.id, id);
  if (!riga) throw new ErroreHttp(404, 'Dieta non trovata.');

  const file = await db.contenutoPdf(env, id);
  if (!file) throw new ErroreHttp(404, 'Nessun PDF allegato.');

  const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
  return new Response(bytes, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${encodeURIComponent(file.nome)}"`,
      'cache-control': 'no-store',
    },
  });
}
