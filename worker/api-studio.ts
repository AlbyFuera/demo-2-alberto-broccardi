// Prima di toccare i dati di un cliente serve un collegamento attivo.

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
import { FINESTRA_ADERENZA, calcolaAderenza, giorniPrima, statoDiOggi } from '../src/core/aderenza.ts';
import type { Aderenza, StatoOggi } from '../src/core/aderenza.ts';
import { attenzioniDellaDieta } from '../src/core/allergeni.ts';
import { diario, giorniSenzaSpunte } from '../src/core/diario.ts';

import * as db from './db.ts';
import { conNome } from './nomi.ts';
import * as ai from './ai.ts';
import { ErroreHttp } from './auth.ts';
import { conSostituzioni, sostituzioniAttive } from './sovrapposizione.ts';
import { LIMITE_PDF, dietaDaLettura, leggiPdf } from './pdf.ts';
import { nomeDi, type Env, type Utente } from './types.ts';

// Il cruscotto

export async function cruscotto(env: Env, utente: Utente) {
  const [collegamenti, variazioni, domande, schede] = await Promise.all([
    db.collegamentiDelloStudio(env, utente.id),
    db.variazioniDelloStudio(env, utente.id, { limite: 40 }),
    db.domandeDelloStudio(env, utente.id),
    db.schedeDelloStudio(env, utente.id),
  ]);

  const richieste = collegamenti.filter((c) => c.stato === 'in-attesa');
  const attivi = collegamenti.filter((c) => c.stato === 'attivo');

  const diete = await dietePerClienti(env, utente.id, attivi.map((c) => c.clienteId));
  const aderenze = await aderenzePerClienti(
    env,
    attivi.map((c) => c.clienteId),
    diete,
    variazioni,
  );
  const daLeggere = await db.messaggiDaLeggere(env, utente.id);

  const clienti = attivi.map((c) => {
    const dieta = diete.get(c.clienteId);
    const suoi = aderenze.get(c.clienteId);
    return {
      linkId: c.id,
      id: c.clienteId,
      nome: nomeDi({ nome: c.clienteNome, email: c.clienteEmail }),
      email: c.clienteEmail,
      seguitoDa: c.richiestoIl,
      dieta: dieta
        ? { id: dieta.id, titolo: dieta.titolo, stato: dieta.stato, vuota: dietaVuotaDavvero(dieta.dieta) }
        : null,
      aderenza: suoi?.aderenza ?? null,
      oggi: suoi?.oggi ?? null,
      /** Giorni dall'ultima spunta negli ultimi 30; null se nessuna. */
      senzaSpunte: suoi?.senzaSpunte ?? null,
      prossimaVisita: schede.get(c.clienteId)?.prossimaVisita ?? null,
      variazioniNuove: variazioni.filter((v) => v.clienteId === c.clienteId && v.stato === 'nuova').length,
      domandeAperte: domande.filter((d) => d.clienteId === c.clienteId && d.stato === 'aperta').length,
      /** L'assistente risponde al posto del professionista, oppure no. */
      automazione: c.automazione,
      /** Messaggi che il cliente ha scritto e nessuno ha ancora letto. */
      messaggiDaLeggere: daLeggere.get(c.clienteId) ?? 0,
    };
  });

  const conAderenza = clienti.filter((c) => c.aderenza?.percentuale != null);

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
    clienti,
    daSeguire: daSeguire(clienti),
    statistiche: {
      clienti: clienti.length,
      aderenzaMedia: conAderenza.length
        ? Math.round(conAderenza.reduce((t, c) => t + c.aderenza!.percentuale!, 0) / conAderenza.length)
        : null,
      visiteSettimana: clienti.filter((c) => entroGiorni(c.prossimaVisita, 7)).length,
    },
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
    // La pubblicata se c'è, altrimenti la bozza più recente.
    const attuale = diete.find((d) => d.stato === 'pubblicata') ?? diete.find((d) => d.stato === 'bozza');
    if (attuale) per.set(clienteId, attuale);
  }
  return per;
}

/** L'aderenza di ogni cliente, più i pasti di oggi che l'aderenza esclude. */
async function aderenzePerClienti(
  env: Env,
  clienti: string[],
  diete: Map<string, db.DietaRiga>,
  variazioni: db.VariazioneRiga[],
): Promise<Map<string, { aderenza: Aderenza; oggi: StatoOggi; senzaSpunte: number | null }>> {
  const per = new Map<string, { aderenza: Aderenza; oggi: StatoOggi; senzaSpunte: number | null }>();
  const oggi = new Date().toISOString().slice(0, 10);

  for (const clienteId of clienti) {
    const dieta = diete.get(clienteId);
    if (!dieta) continue;

    const spunte = await db.spunteRecenti(env, clienteId, giorniPrima(oggi, 30));
    per.set(clienteId, {
      senzaSpunte: giorniSenzaSpunte(spunte, oggi),
      aderenza: calcolaAderenza(
        dieta.dieta,
        spunte,
        oggi,
        FINESTRA_ADERENZA,
        sostituzioniAttive(variazioni.filter((v) => v.clienteId === clienteId)),
      ),
      oggi: statoDiOggi(dieta.dieta, spunte, oggi),
    });
  }
  return per;
}

/** Vero se la data ISO cade fra adesso e i prossimi `giorni`. */
function entroGiorni(iso: string | null, giorni: number): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  const adesso = Date.now();
  // Da inizio giornata: una visita di stamattina è ancora "in settimana".
  return t >= adesso - 12 * 3_600_000 && t <= adesso + giorni * 86_400_000;
}

interface Segnale {
  tipo: 'messaggi' | 'domande' | 'variazioni' | 'aderenza' | 'silenzio' | 'dieta' | 'visita';
  testo: string;
  /** 0 = più urgente. */
  peso: number;
}

/** I clienti a cui guardare per primi, con il motivo. */
function daSeguire(
  clienti: {
    id: string;
    nome: string;
    email: string;
    dieta: { stato: string } | null;
    aderenza: Aderenza | null;
    senzaSpunte: number | null;
    prossimaVisita: string | null;
    variazioniNuove: number;
    domandeAperte: number;
    messaggiDaLeggere: number;
  }[],
) {
  const lista = clienti
    .map((c) => {
      const segnali: Segnale[] = [];
      const plurale = (n: number, uno: string, tanti: string) => `${n} ${n === 1 ? uno : tanti}`;

      if (c.messaggiDaLeggere > 0) {
        segnali.push({ tipo: 'messaggi', peso: 0, testo: plurale(c.messaggiDaLeggere, 'messaggio da leggere', 'messaggi da leggere') });
      }
      if (c.domandeAperte > 0) {
        segnali.push({ tipo: 'domande', peso: 0, testo: plurale(c.domandeAperte, 'domanda girata a te', 'domande girate a te') });
      }
      if (!c.dieta || c.dieta.stato !== 'pubblicata') {
        segnali.push({ tipo: 'dieta', peso: 1, testo: c.dieta ? 'Dieta in bozza, non pubblicata' : 'Nessuna dieta' });
      } else {
        if (c.senzaSpunte === null || c.senzaSpunte >= 3) {
          segnali.push({
            tipo: 'silenzio',
            peso: 1,
            testo: c.senzaSpunte === null ? 'Non ha mai segnato un pasto' : `Non segna i pasti da ${c.senzaSpunte} giorni`,
          });
        }
        const a = c.aderenza;
        if (a?.percentuale != null && a.livello !== 'buona') {
          segnali.push({ tipo: 'aderenza', peso: a.livello === 'scarsa' ? 1 : 2, testo: `Aderenza al ${a.percentuale}%` });
        }
      }
      if (c.variazioniNuove > 0) {
        segnali.push({ tipo: 'variazioni', peso: 3, testo: plurale(c.variazioniNuove, 'sostituzione nuova', 'sostituzioni nuove') });
      }
      if (entroGiorni(c.prossimaVisita, 7)) {
        const quando = new Date(c.prossimaVisita!).toLocaleDateString('it-IT', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          timeZone: 'Europe/Rome',
        });
        segnali.push({ tipo: 'visita', peso: 2, testo: `Visita ${quando}` });
      }

      segnali.sort((x, y) => x.peso - y.peso);
      return { id: c.id, nome: c.nome, email: c.email, segnali };
    })
    .filter((c) => c.segnali.length > 0);

  return lista.sort((x, y) => x.segnali[0].peso - y.segnali[0].peso || y.segnali.length - x.segnali.length);
}

/** Solo i numeri, per il pallino delle notifiche. */
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
    // Anche i messaggi dei clienti contano nel pallino.
    messaggi: [...messaggi.values()].reduce((s, n) => s + n, 0),
  };
}

// Collegamenti

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

// Il cliente visto dallo studio

/** Nessuna lettura su un cliente senza collegamento attivo. */
async function esigiCliente(env: Env, studioId: string, clienteId: string) {
  if (!clienteId) throw new ErroreHttp(400, 'Manca il cliente.');
  if (!(await db.collegamentoAttivo(env, studioId, clienteId))) {
    throw new ErroreHttp(403, 'Non segui questo cliente.');
  }
}

export async function cliente(env: Env, utente: Utente, params: URLSearchParams) {
  const clienteId = String(params.get('cliente') ?? '');
  await esigiCliente(env, utente.id, clienteId);

  const [collegamenti, diete, variazioni, domande, libreria, filo, cartella, misure, note, acqua] =
    await Promise.all([
      db.collegamentiDelloStudio(env, utente.id),
      db.dieteDelCliente(env, utente.id, clienteId),
      db.variazioniDelCliente(env, clienteId, 60),
      db.domandeDelloStudio(env, utente.id),
      db.libreriaDelloStudio(env, utente.id),
      db.filoMessaggi(env, clienteId, utente.id),
      db.schedaClinica(env, utente.id, clienteId),
      db.misure(env, clienteId, 60),
      db.noteDelCliente(env, utente.id, clienteId),
      db.acquaRecente(env, clienteId, 14),
    ]);

  const collegamento = collegamenti.find((c) => c.clienteId === clienteId);
  const attuale = diete.find((d) => d.stato === 'pubblicata') ?? diete.find((d) => d.stato === 'bozza');

  // Aprire la scheda segna i messaggi come letti.
  await db.segnaMessaggiLetti(env, clienteId, utente.id, 'studio');

  const oggi = new Date().toISOString().slice(0, 10);
  const spunte = attuale ? await db.spunteRecenti(env, clienteId, giorniPrima(oggi, 31)) : [];
  const passi = await db.passiRecenti(env, clienteId, 30);
  const utenteObiettivo = await db.obiettivoDelCliente(env, clienteId);
  const aderenzaSu = (giorni: number) =>
    attuale ? calcolaAderenza(attuale.dieta, spunte, oggi, giorni, sostituzioniAttive(variazioni)) : null;

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
      /** Risponde l'assistente, oppure il professionista di persona. */
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
    /** Stessa finestra del cliente e dell'elenco; i 30 giorni solo per confronto. */
    aderenza: aderenzaSu(FINESTRA_ADERENZA),
    aderenza30: aderenzaSu(30),
    /** L'aderenza esclude oggi: questo lo mostra in tempo reale. */
    oggi: attuale ? statoDiOggi(attuale.dieta, spunte, oggi) : null,
    passi,
    acqua,
    cartella,
    /** Alimenti della dieta attuale che toccano le allergie segnate. */
    attenzioni: attuale ? attenzioniDellaDieta(attuale.dieta, cartella.allergie) : [],
    misure,
    note,
    diario: attuale ? diario(attuale.dieta, spunte, oggi, { passi, acqua, misure }, 14) : [],
    obiettivo: utenteObiettivo,
    variazioni: variazioni.map(conNome),
    domande: domande.filter((d) => d.clienteId === clienteId).map(conNome),
  };
}

function riepilogoDieta(riga: db.DietaRiga, libreria: any, variazioni: db.VariazioneRiga[]) {
  // La dieta con le sostituzioni applicate.
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
          orario: p.orario ?? null,
          nota: p.nota ?? null,
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

// Scrivere la dieta

export async function nuovaDieta(env: Env, utente: Utente, body: any) {
  const clienteId = String(body?.cliente ?? '');
  await esigiCliente(env, utente.id, clienteId);

  const titolo = String(body?.titolo ?? '').trim() || 'Dieta';
  if (titolo.length > 80) throw new ErroreHttp(400, 'Titolo troppo lungo.');

  const dieta = dietaVuota(db.nuovoId('die'), titolo);

  // Copia da una dieta esistente.
  const daId = String(body?.da ?? '');
  if (daId) {
    const precedente = await db.dietaDelloStudio(env, utente.id, daId);
    // Qualsiasi dieta dello studio fa da modello, anche di un altro cliente.
    if (precedente) {
      Object.assign(dieta, {
        indicazioni: precedente.dieta.indicazioni,
        obiettivi: precedente.dieta.obiettivi,
        ...(precedente.dieta.base ? { base: precedente.dieta.base } : {}),
        giorni: rigeneraId(precedente.dieta.giorni),
      });
    }
  }

  await db.creaDieta(env, utente.id, clienteId, dieta);
  return { ok: true, id: dieta.id, dieta };
}

/** Nuovi id ai pasti, così le vecchie variazioni non si agganciano. */
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
    // Alimenti che il motore non conosce.
    daCompletare: alimentiDaCompletare(riga.dieta, libreria),
    scarti: scartiDagliObiettivi(riga.dieta, libreria),
    attenzioni: attenzioniDellaDieta(
      riga.dieta,
      (await db.schedaClinica(env, utente.id, riga.clienteId)).allergie,
    ),
  };
}

/** Salva la dieta intera. Gli id dei pasti li genera il server. */
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
    scarti: scartiDagliObiettivi(dieta, libreria),
    conti: (await apriDieta(env, utente, new URLSearchParams({ dieta: id }))).conti,
  };
}

const UNITA_AMMESSE = new Set(['g', 'ml', 'pz']);

/** Piano a sostituzione di un alimento; i campi vuoti diventano undefined. */
function leggiPiano(a: any): { alternative?: Alternativa[]; base?: BaseSostituzione; gruppo?: string } {
  const alternative: Alternativa[] = (Array.isArray(a?.alternative) ? a.alternative : [])
    .slice(0, 8)
    .map((x: any) => {
      const nome = String(x?.nome ?? '').trim().slice(0, 80);
      const q = Number(x?.quantita);
      const quantita = Number.isFinite(q) && q > 0 ? q : undefined;
      return {
        nome,
        // Quantità facoltativa: se manca la calcola il motore.
        ...(quantita !== undefined ? { quantita } : {}),
        ...(quantita !== undefined && UNITA_AMMESSE.has(x?.unita) ? { unita: x.unita as Unita } : {}),
      };
    })
    .filter((x: Alternativa) => x.nome.length > 0);

  // Toglie i nomi ripetuti e l'alimento stesso.
  const visti = new Set([normalizza(String(a?.nome ?? ''))]);
  const uniche = alternative.filter((x: Alternativa) => {
    const chiave = normalizza(x.nome);
    if (visti.has(chiave)) return false;
    visti.add(chiave);
    return true;
  });

  // Assente vuol dire come da dieta; 'auto' esplicito si conserva.
  const base = BASI.includes(a?.base) ? (a.base as BaseSostituzione) : undefined;
  const gruppo = String(a?.gruppo ?? '').trim().slice(0, 40);

  return {
    ...(uniche.length ? { alternative: uniche } : {}),
    ...(base ? { base } : {}),
    ...(gruppo ? { gruppo } : {}),
  };
}

/** Legge e ripulisce la dieta che arriva dal browser. */
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

  // 'auto' non si salva: è il predefinito.
  const baseDieta = BASI.includes(grezza?.base) ? (grezza.base as BaseSostituzione) : undefined;

  return {
    id: precedente.id,
    titolo: testo(grezza?.titolo, 80) || precedente.titolo,
    ...(baseDieta && baseDieta !== 'auto' ? { base: baseDieta } : {}),
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
      pastiLiberi: (() => {
        const n = numero(grezza?.obiettivi?.pastiLiberi);
        return n === undefined ? undefined : Math.min(7, Math.round(n));
      })(),
    },
    giorni,
  };
}

/** Pubblica la dieta. Una dieta vuota viene rifiutata. */
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
  const scarti = scartiDagliObiettivi(riga.dieta, libreria);

  // Né gli alimenti senza valori né gli scarti bloccano la pubblicazione.
  const avvisi = [
    ...(mancanti.length > 0
      ? [
          `${mancanti.length} alimenti non hanno valori nutrizionali: ` +
            `finché non li completi, i totali del cliente restano parziali.`,
        ]
      : []),
    ...(scarti.length > 0
      ? [
          `La dieta scritta si discosta dagli obiettivi che hai indicato (${scarti.join(', ')}). ` +
            `Il cliente vede i totali dei pasti, non gli obiettivi: correggi le quantità o gli obiettivi.`,
        ]
      : []),
  ];

  return {
    ok: true,
    avviso: avvisi.length ? `Pubblicata. ${avvisi.join(' ')}` : null,
  };
}

/** Oltre questa differenza la media della settimana non corrisponde all'obiettivo. */
const TOLLERANZA_OBIETTIVI = 0.1;

/** Le voci in cui la media dei giorni scritti è lontana dall'obiettivo dichiarato. */
export function scartiDagliObiettivi(dieta: Dieta, libreria: any): string[] {
  const { media, giorniScritti } = totaleSettimana(dieta, libreria);
  if (giorniScritti === 0) return [];

  const o = dieta.obiettivi;
  const voci: [string, number | undefined, number, string][] = [
    ['calorie', o.kcal, media.kcal, 'kcal'],
    ['proteine', o.proteine, media.proteine, 'g'],
    ['carboidrati', o.carboidrati, media.carboidrati, 'g'],
    ['grassi', o.grassi, media.grassi, 'g'],
  ];

  return voci
    .filter(([, obiettivo, reale]) => obiettivo && Math.abs(reale - obiettivo) / obiettivo > TOLLERANZA_OBIETTIVI)
    .map(([nome, obiettivo, reale, unita]) => `${nome} ${Math.round(reale)} ${unita} invece di ${obiettivo}`);
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

// Libreria degli alimenti

export async function libreria(env: Env, utente: Utente) {
  return { alimenti: await db.elencoLibreria(env, utente.id) };
}

/** Salva i valori di un alimento, inseriti dal professionista. */
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

  // Controllo aritmetico: i macro non superano 100 g su 100 g.
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

/** Cosa sa il motore di un alimento, per l'editor. */
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

// Variazioni e domande

export async function segnaViste(env: Env, utente: Utente, body: any) {
  const ids = Array.isArray(body?.ids) ? body.ids.map(String).slice(0, 200) : [];
  await db.segnaVariazioniViste(env, utente.id, ids);
  return { ok: true };
}

/** Annulla la variazione di un cliente: basta lo stato 'annullata'. */
export async function annullaVariazione(env: Env, utente: Utente, body: any) {
  const id = String(body?.id ?? '');
  const nota = body?.nota ? String(body.nota).slice(0, 500) : null;
  if (!id) throw new ErroreHttp(400, 'Manca la variazione.');

  const riga = await db.annullaVariazione(env, utente.id, id, nota);
  if (!riga) throw new ErroreHttp(404, 'Variazione non trovata.');

  return { ok: true };
}

// Conversazione con il cliente

/** Accende o spegne l'assistente per un cliente. */
export async function automazione(env: Env, utente: Utente, body: any) {
  const clienteId = String(body?.cliente ?? '');
  await esigiCliente(env, utente.id, clienteId);

  const attiva = body?.attiva === true;
  const fatto = await db.impostaAutomazione(env, utente.id, clienteId, attiva);
  if (!fatto) throw new ErroreHttp(404, 'Collegamento non trovato.');

  // Avvisa il cliente di chi risponde da adesso.
  await db.scriviMessaggio(
    env,
    { clienteId, studioId: utente.id },
    'studio',
    attiva
      ? 'Da adesso all’assistente puoi chiedere quello che vuoi: risponde con i dati della tua dieta.'
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

// Scheda clinica, misure e note

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function salvaCartella(env: Env, utente: Utente, body: any) {
  const clienteId = String(body?.cliente ?? '');
  await esigiCliente(env, utente.id, clienteId);

  const testo = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
  const nascita = testo(body?.nascita, 10);
  if (nascita && (!DATA_RE.test(nascita) || nascita > new Date().toISOString().slice(0, 10))) {
    throw new ErroreHttp(400, 'La data di nascita non è valida.');
  }
  const altezza = body?.altezza === '' || body?.altezza == null ? null : Number(body.altezza);
  if (altezza !== null && (!Number.isFinite(altezza) || altezza < 50 || altezza > 250)) {
    throw new ErroreHttp(400, 'L’altezza va in centimetri, fra 50 e 250.');
  }
  const visita = testo(body?.prossimaVisita, 16);
  if (visita && Number.isNaN(new Date(visita).getTime())) {
    throw new ErroreHttp(400, 'La data della prossima visita non è valida.');
  }

  await db.salvaSchedaClinica(env, utente.id, clienteId, {
    nascita: nascita || null,
    sesso: body?.sesso === 'F' || body?.sesso === 'M' ? body.sesso : null,
    altezza,
    allergie: testo(body?.allergie, 500),
    patologie: testo(body?.patologie, 1000),
    farmaci: testo(body?.farmaci, 500),
    preferenze: testo(body?.preferenze, 500),
    prossimaVisita: visita || null,
  });
  return { ok: true, cartella: await db.schedaClinica(env, utente.id, clienteId) };
}

/** Misure prese in visita: peso, circonferenze, massa grassa. */
export async function misura(env: Env, utente: Utente, body: any) {
  const clienteId = String(body?.cliente ?? '');
  await esigiCliente(env, utente.id, clienteId);

  const giorno = String(body?.giorno ?? '') || new Date().toISOString().slice(0, 10);
  if (!DATA_RE.test(giorno) || giorno > new Date().toISOString().slice(0, 10)) {
    throw new ErroreHttp(400, 'La data della misura non è valida.');
  }

  const valore = (k: string, min: number, max: number, nome: string) => {
    const grezzo = body?.[k];
    if (grezzo === '' || grezzo == null) return null;
    const n = Number(String(grezzo).replace(',', '.'));
    if (!Number.isFinite(n) || n < min || n > max) throw new ErroreHttp(400, `${nome} non valido.`);
    return Math.round(n * 10) / 10;
  };

  const m = {
    giorno,
    peso: valore('peso', 25, 350, 'Peso'),
    vita: valore('vita', 30, 250, 'Giro vita'),
    fianchi: valore('fianchi', 30, 250, 'Giro fianchi'),
    grasso: valore('grasso', 2, 70, 'Massa grassa'),
    autore: 'studio' as const,
  };
  if (m.peso === null && m.vita === null && m.fianchi === null && m.grasso === null) {
    throw new ErroreHttp(400, 'Scrivi almeno una misura.');
  }

  await db.salvaMisura(env, clienteId, m);
  return { ok: true, misure: await db.misure(env, clienteId, 60) };
}

export async function eliminaMisura(env: Env, utente: Utente, body: any) {
  const clienteId = String(body?.cliente ?? '');
  await esigiCliente(env, utente.id, clienteId);
  const giorno = String(body?.giorno ?? '');
  if (!DATA_RE.test(giorno)) throw new ErroreHttp(400, 'Manca il giorno.');

  await db.eliminaMisura(env, clienteId, giorno);
  return { ok: true, misure: await db.misure(env, clienteId, 60) };
}

export async function nota(env: Env, utente: Utente, body: any) {
  const clienteId = String(body?.cliente ?? '');
  await esigiCliente(env, utente.id, clienteId);

  const testo = String(body?.testo ?? '').trim();
  if (!testo) throw new ErroreHttp(400, 'La nota è vuota.');
  if (testo.length > 4000) throw new ErroreHttp(400, 'Nota troppo lunga.');

  await db.scriviNota(env, utente.id, clienteId, testo);
  return { ok: true, note: await db.noteDelCliente(env, utente.id, clienteId) };
}

export async function eliminaNota(env: Env, utente: Utente, body: any) {
  const id = String(body?.id ?? '');
  if (!id) throw new ErroreHttp(400, 'Manca la nota.');
  if (!(await db.eliminaNota(env, utente.id, id))) throw new ErroreHttp(404, 'Nota non trovata.');
  return { ok: true };
}

/** Le diete dello studio da cui partire per scriverne una nuova. */
export async function modelli(env: Env, utente: Utente) {
  const diete = await db.dieteDelloStudio(env, utente.id);
  return {
    diete: diete.map((d) => ({
      id: d.id,
      clienteId: d.clienteId,
      titolo: d.titolo,
      stato: d.stato,
      cliente: nomeDi({ nome: d.clienteNome, email: d.clienteEmail }),
      aggiornataIl: d.aggiornataIl,
    })),
  };
}

/** Le conversazioni dello studio: l'ultimo messaggio di ogni cliente seguito. */
export async function conversazioni(env: Env, utente: Utente) {
  const [ultimi, collegamenti, daLeggere] = await Promise.all([
    db.ultimiMessaggi(env, utente.id),
    db.collegamentiDelloStudio(env, utente.id),
    db.messaggiDaLeggere(env, utente.id),
  ]);
  const attivi = new Map(collegamenti.filter((c) => c.stato === 'attivo').map((c) => [c.clienteId, c]));

  return {
    conversazioni: ultimi
      .filter((m) => attivi.has(m.clienteId))
      .map((m) => {
        const c = attivi.get(m.clienteId)!;
        return {
          clienteId: m.clienteId,
          nome: nomeDi({ nome: c.clienteNome, email: c.clienteEmail }),
          email: c.clienteEmail,
          at: m.at,
          autore: m.autore,
          testo: m.testo.slice(0, 160),
          daLeggere: daLeggere.get(m.clienteId) ?? 0,
          automazione: c.automazione,
        };
      }),
  };
}

// Impostazioni

export async function impostazioni(env: Env, utente: Utente, body: any) {
  const nome = body?.nome !== undefined ? String(body.nome).trim().slice(0, 80) : undefined;

  if (nome !== undefined && nome.length < 2) {
    throw new ErroreHttp(400, 'Il nome deve avere almeno due caratteri.');
  }

  await db.aggiornaProfilo(env, utente.id, { nome });
  return { ok: true };
}

// Caricare la dieta come PDF

/** Dal PDF a una bozza di dieta. */
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

  // Controllo della firma %PDF-.
  const testa = new TextDecoder().decode(new Uint8Array(dati).slice(0, 5));
  if (testa !== '%PDF-') throw new ErroreHttp(400, 'Questo non è un PDF.');

  const titolo =
    String(body?.titolo ?? '').trim().slice(0, 80) ||
    nome.replace(/\.pdf$/i, '').slice(0, 80) ||
    'Dieta';

  // Prima si salvano file e bozza, poi la lettura, che può andare in timeout.
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

/** Il PDF, per il professionista. */
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
