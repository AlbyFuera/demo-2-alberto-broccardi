/**
 * Ingresso unico del prodotto.
 *
 * Una schermata sola per due mestieri: professionista e cliente entrano dallo
 * stesso form e, in base al ruolo che sta scritto in `users`, finiscono in due
 * applicazioni diverse. Il ruolo non arriva mai dal browser — nemmeno alla
 * registrazione, dove il valore inviato viene accettato solo se è uno dei due
 * ammessi e non viene mai più riletto dal client.
 *
 * Il routing sta davanti agli asset statici (`run_worker_first`): se i file
 * rispondessero per primi, chiunque conoscesse l'URL scaricherebbe la
 * schermata dello studio senza aver fatto accesso. Il file arriva solo dopo il
 * controllo.
 */

import {
  CREDENZIALI_FINTE,
  ErroreHttp,
  apriSessione,
  chiudiSessione,
  cookieDiSessione,
  cookieScaduto,
  esigi,
  inHttps,
  leggiCookie,
  passwordDebole,
  ruoloValido,
  utenteCorrente,
  verifyPassword,
} from './auth.ts';
import * as db from './db.ts';
import * as limite from './limite.ts';
import * as cliente from './api-cliente.ts';
import * as studio from './api-studio.ts';
import type { Env, Utente } from './types.ts';

/* ------------------------------------------------------------------ */
/* Risposte                                                            */
/* ------------------------------------------------------------------ */

const SICUREZZA = {
  // Nessuno script esterno, nessun frame: l'applicazione è tutta di prima parte.
  'content-security-policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; " +
    "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'x-frame-options': 'DENY',
};

function json(dati: unknown, stato = 200, intestazioni: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(dati), {
    status: stato,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // I dati di una dieta non si mettono in cache da nessuna parte.
      'cache-control': 'no-store',
      ...SICUREZZA,
      ...intestazioni,
    },
  });
}

function errore(e: unknown): Response {
  if (e instanceof ErroreHttp) {
    return json({ errore: e.message, ...(e.codice ? { codice: e.codice } : {}) }, e.status);
  }
  console.error('errore non previsto:', e);
  // Il messaggio interno non esce: direbbe a un estraneo com'è fatto il sistema.
  return json({ errore: 'Errore interno. Riprova.' }, 500);
}

async function corpo(request: Request): Promise<any> {
  if (request.method !== 'POST') return null;

  const testo = await request.text();
  if (!testo) return null;
  if (testo.length > 1_200_000) throw new ErroreHttp(413, 'Richiesta troppo grande.');

  try {
    return JSON.parse(testo);
  } catch {
    throw new ErroreHttp(400, 'Corpo della richiesta non valido.');
  }
}

/** Serve una pagina dagli asset. Il controllo di accesso è già avvenuto. */
async function pagina(env: Env, request: Request, file: string): Promise<Response> {
  if (!env.ASSETS) return new Response('Asset non configurati.', { status: 500 });

  const url = new URL(request.url);
  url.pathname = `/${file}`;
  const risposta = await env.ASSETS.fetch(new Request(url, { headers: request.headers }));

  const intestazioni = new Headers(risposta.headers);
  for (const [k, v] of Object.entries(SICUREZZA)) intestazioni.set(k, v);
  intestazioni.set('cache-control', 'no-store');

  return new Response(risposta.body, { status: risposta.status, headers: intestazioni });
}

/** Le intestazioni di sicurezza anche sulle risposte che non sono JSON. */
function conSicurezza(risposta: Response): Response {
  const intestazioni = new Headers(risposta.headers);
  for (const [k, v] of Object.entries(SICUREZZA)) intestazioni.set(k, v);
  return new Response(risposta.body, { status: risposta.status, headers: intestazioni });
}

function vaiA(percorso: string): Response {
  return new Response(null, { status: 302, headers: { location: percorso, ...SICUREZZA } });
}

/** La pagina che spetta al ruolo: è l'unico posto che lo decide. */
function paginaDi(utente: Utente): string {
  return utente.ruolo === 'nutrizionista' ? '/studio' : '/cliente';
}

/**
 * Ritardo fisso su ogni tentativo di accesso fallito.
 *
 * Non è un limitatore di frequenza serio — quello richiede uno stato condiviso
 * (Durable Object o KV) e va aggiunto prima di aprire il servizio al pubblico.
 * Qui rende non conveniente provare password a raffica su una connessione, e
 * soprattutto rende il tempo di risposta indipendente dal fatto che l'email
 * esista: senza, la differenza di durata rivelerebbe quali indirizzi hanno un
 * account.
 */
const ritardoCostante = () => new Promise((r) => setTimeout(r, 400));

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

async function api(
  request: Request,
  env: Env,
  percorso: string,
  params: URLSearchParams,
): Promise<Response> {
  const body = await corpo(request);
  const utente = await utenteCorrente(env, request);
  const https = inHttps(request);

  /* ---------- accesso ---------- */

  if (percorso === '/api/chi-sono') {
    if (!utente) return json({ autenticato: false });
    return json({
      autenticato: true,
      ruolo: utente.ruolo,
      nome: utente.nome,
      email: utente.email,
      obiettivo: utente.obiettivo,
      /** Vuoto alla registrazione: l'interfaccia lo chiede, ma non blocca. */
      profiloDaCompletare: utente.nome.trim().length === 0,
      pagina: paginaDi(utente),
    });
  }

  if (percorso === '/api/accedi') {
    const email = db.normEmail(String(body?.email ?? ''));
    const password = String(body?.password ?? '');

    // PRIMA il limite, POI la verifica: verificare una password costa 600.000
    // iterazioni di PBKDF2, e chi prova a raffica non deve poter comprare tutto
    // quel lavoro a ogni tentativo.
    const blocco = await limite.controllaAccesso(env, email, request);
    if (blocco.superato) {
      throw new ErroreHttp(429, limite.messaggioLimite(blocco.attendi), 'troppi-tentativi');
    }

    const credenziali = await db.credenzialiPerEmail(env, email);
    // Si verifica la password anche quando l'utente non esiste, contro un hash
    // finto: altrimenti la risposta immediata rivela che l'email è sconosciuta.
    const valida = credenziali
      ? await verifyPassword(password, credenziali)
      : await verifyPassword(password, CREDENZIALI_FINTE);

    if (!credenziali || !valida) {
      const superato = await limite.accessoFallito(env, email, request);
      await ritardoCostante();

      if (superato.superato) {
        throw new ErroreHttp(429, limite.messaggioLimite(superato.attendi), 'troppi-tentativi');
      }
      // Un messaggio unico: distinguere i due casi regala l'elenco degli iscritti.
      throw new ErroreHttp(401, 'Email o password non corretti.');
    }

    // Riuscito: il conteggio di quell'email si azzera, così chi ha solo
    // sbagliato a digitare non si porta dietro i tentativi di ieri.
    await limite.accessoRiuscito(env, email);

    const sessione = await apriSessione(
      env,
      credenziali.id,
      request.headers.get('user-agent'),
      new Date(),
    );
    await db.segnaAccesso(env, credenziali.id);

    return json(
      {
        ok: true,
        ruolo: credenziali.role,
        pagina: credenziali.role === 'nutrizionista' ? '/studio' : '/cliente',
      },
      200,
      { 'set-cookie': cookieDiSessione(sessione, https) },
    );
  }

  if (percorso === '/api/registrati') {
    const email = String(body?.email ?? '').trim();
    const password = String(body?.password ?? '');
    const ruolo = body?.ruolo;

    if (!ruoloValido(ruolo)) {
      throw new ErroreHttp(400, 'Scegli se sei un professionista o un cliente.');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      throw new ErroreHttp(400, 'Indirizzo email non valido.');
    }

    const debole = passwordDebole(password);
    if (debole) throw new ErroreHttp(400, debole);

    if (await db.credenzialiPerEmail(env, email)) {
      throw new ErroreHttp(409, 'Esiste già un account con questa email.');
    }

    // La registrazione è aperta, non illimitata: dieci account per indirizzo di
    // rete in un quarto d'ora bastano a uno studio e non bastano a chi vuole
    // riempire la tabella degli utenti.
    const troppe = await limite.controllaIscrizione(env, request);
    if (troppe.superato) {
      throw new ErroreHttp(429, limite.messaggioLimite(troppe.attendi), 'troppi-tentativi');
    }

    const id = await db.creaUtente(env, { email, password, ruolo });
    await limite.iscrizioneFatta(env, request);
    const sessione = await apriSessione(env, id, request.headers.get('user-agent'), new Date());

    return json({ ok: true, ruolo, pagina: ruolo === 'nutrizionista' ? '/studio' : '/cliente' }, 200, {
      'set-cookie': cookieDiSessione(sessione, https),
    });
  }

  if (percorso === '/api/esci') {
    const token = leggiCookie(request);
    if (token) await chiudiSessione(env, token);
    return json({ ok: true }, 200, { 'set-cookie': cookieScaduto(https) });
  }

  if (percorso === '/api/cambia-password') {
    const mio = esigi(utente);
    const attuale = String(body?.attuale ?? '');
    const nuova = String(body?.nuova ?? '');

    const blocco = await limite.controllaAccesso(env, mio.email, request);
    if (blocco.superato) {
      throw new ErroreHttp(429, limite.messaggioLimite(blocco.attendi), 'troppi-tentativi');
    }

    const credenziali = await db.credenzialiPerEmail(env, mio.email);
    if (!credenziali || !(await verifyPassword(attuale, credenziali))) {
      await limite.accessoFallito(env, mio.email, request);
      await ritardoCostante();
      throw new ErroreHttp(401, 'La password attuale non è corretta.');
    }
    await limite.accessoRiuscito(env, mio.email);

    const debole = passwordDebole(nuova);
    if (debole) throw new ErroreHttp(400, debole);
    if (nuova === attuale) {
      throw new ErroreHttp(400, 'La nuova password è identica a quella vecchia.');
    }

    await db.cambiaPassword(env, mio.id, nuova);

    // `cambiaPassword` chiude tutte le sessioni, compresa questa: se ne apre
    // una nuova, o l'utente si troverebbe fuori subito dopo aver obbedito.
    const sessione = await apriSessione(env, mio.id, request.headers.get('user-agent'), new Date());
    return json({ ok: true }, 200, { 'set-cookie': cookieDiSessione(sessione, https) });
  }

  if (percorso === '/api/elimina-account') {
    const mio = esigi(utente);
    // La password si richiede sempre: cancellare un account è irreversibile e
    // una sessione lasciata aperta su un computer altrui non deve bastare.
    const credenziali = await db.credenzialiPerEmail(env, mio.email);
    if (!credenziali || !(await verifyPassword(String(body?.password ?? ''), credenziali))) {
      await ritardoCostante();
      throw new ErroreHttp(401, 'La password non è corretta.');
    }

    await db.eliminaAccount(env, mio.id);
    return json({ ok: true }, 200, { 'set-cookie': cookieScaduto(https) });
  }

  /* ---------- cliente ---------- */

  if (percorso.startsWith('/api/cliente/')) {
    const mio = esigi(utente, 'cliente');
    const azione = percorso.slice('/api/cliente/'.length);

    if (azione === 'stato') return json(await cliente.stato(env, mio));
    if (azione === 'dashboard') return json(await cliente.dashboard(env, mio));
    if (azione === 'passi') return json(await cliente.passi(env, mio, body));
    if (azione === 'spunta') return json(await cliente.spunta(env, mio, body));
    if (azione === 'cambio-pasto') return json(await cliente.cambiaPasto(env, mio, params));
    if (azione === 'applica-cambio') return json(await cliente.applicaCambioPasto(env, mio, body));
    // Il PDF esce come file, non come JSON: ha una risposta sua.
    if (azione === 'pdf') return conSicurezza(await cliente.pdf(env, mio));
    if (azione === 'cerca-studio') return json(await cliente.cercaStudio(env, mio, params));
    if (azione === 'richiedi') return json(await cliente.richiedi(env, mio, body));
    if (azione === 'scollega') return json(await cliente.scollega(env, mio, body));
    if (azione === 'scheda') return json(await cliente.scheda(env, mio));
    if (azione === 'alternative') return json(await cliente.alternative(env, mio, params));
    if (azione === 'verifica') return json(await cliente.verifica(env, mio, body));
    if (azione === 'applica') return json(await cliente.applica(env, mio, body));
    if (azione === 'annulla') return json(await cliente.annulla(env, mio, body));
    if (azione === 'saltato') return json(await cliente.saltato(env, mio, body));
    if (azione === 'chat') return json(await cliente.chat(env, mio, body));
    if (azione === 'messaggi') return json(await cliente.messaggi(env, mio));
    if (azione === 'impostazioni') return json(await cliente.impostazioni(env, mio, body));
  }

  /* ---------- studio ---------- */

  if (percorso.startsWith('/api/studio/')) {
    const mio = esigi(utente, 'nutrizionista');
    const azione = percorso.slice('/api/studio/'.length);

    if (azione === 'cruscotto') return json(await studio.cruscotto(env, mio));
    if (azione === 'novita') return json(await studio.novita(env, mio));
    if (azione === 'decidi') return json(await studio.decidi(env, mio, body));
    if (azione === 'scollega') return json(await studio.scollega(env, mio, body));
    if (azione === 'cliente') return json(await studio.cliente(env, mio, params));
    if (azione === 'nuova-dieta') return json(await studio.nuovaDieta(env, mio, body));
    if (azione === 'dieta') return json(await studio.apriDieta(env, mio, params));
    if (azione === 'salva-dieta') return json(await studio.salvaDieta(env, mio, body));
    if (azione === 'pubblica') return json(await studio.pubblica(env, mio, body));
    if (azione === 'ritira') return json(await studio.ritira(env, mio, body));
    if (azione === 'elimina-dieta') return json(await studio.eliminaDieta(env, mio, body));
    if (azione === 'carica-pdf') return json(await studio.caricaPdf(env, mio, body));
    if (azione === 'info-pdf') return json(await studio.infoPdf(env, mio, params));
    if (azione === 'pdf') return conSicurezza(await studio.scaricaPdf(env, mio, params));
    if (azione === 'libreria') return json(await studio.libreria(env, mio));
    if (azione === 'salva-alimento') return json(await studio.salvaAlimento(env, mio, body));
    if (azione === 'elimina-alimento') return json(await studio.eliminaAlimento(env, mio, body));
    if (azione === 'conosci') return json(await studio.conosci(env, mio, params));
    if (azione === 'viste') return json(await studio.segnaViste(env, mio, body));
    if (azione === 'annulla-variazione') return json(await studio.annullaVariazione(env, mio, body));
    if (azione === 'rispondi') return json(await studio.rispondi(env, mio, body));
    if (azione === 'automazione') return json(await studio.automazione(env, mio, body));
    if (azione === 'scrivi') return json(await studio.scrivi(env, mio, body));
    if (azione === 'conversazione') return json(await studio.conversazione(env, mio, params));
    if (azione === 'impostazioni') return json(await studio.impostazioni(env, mio, body));
  }

  throw new ErroreHttp(404, `Endpoint sconosciuto: ${percorso}`);
}

/* ------------------------------------------------------------------ */
/* Pagine                                                              */
/* ------------------------------------------------------------------ */

async function pagine(request: Request, env: Env, percorso: string): Promise<Response | null> {
  const utente = await utenteCorrente(env, request);

  if (percorso === '/' || percorso === '/accedi') {
    // Chi è già dentro non rivede il form: va dove gli spetta.
    return utente ? vaiA(paginaDi(utente)) : await pagina(env, request, 'accedi.html');
  }

  if (percorso === '/registrazione') {
    return utente ? vaiA(paginaDi(utente)) : await pagina(env, request, 'registrazione.html');
  }

  if (percorso === '/studio') {
    if (!utente) return vaiA('/');
    // Un cliente che digita /studio non riceve un errore: riceve la sua pagina.
    if (utente.ruolo !== 'nutrizionista') return vaiA('/cliente');
    return await pagina(env, request, 'studio.html');
  }

  if (percorso === '/cliente') {
    if (!utente) return vaiA('/');
    if (utente.ruolo !== 'cliente') return vaiA('/studio');
    return await pagina(env, request, 'cliente.html');
  }

  return null;
}

/** Solo i file che l'applicazione usa davvero: nessuna directory da esplorare. */
const STATICI = new Set([
  '/ui.css',
  '/comune.js',
  '/accedi.js',
  '/registrazione.js',
  '/studio.js',
  '/cliente.js',
  '/favicon.ico',
]);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const percorso = url.pathname.replace(/\/+$/, '') || '/';

    try {
      if (percorso.startsWith('/api/')) {
        if (request.method !== 'GET' && request.method !== 'POST') {
          throw new ErroreHttp(405, 'Metodo non ammesso.');
        }
        return await api(request, env, percorso, url.searchParams);
      }

      const risposta = await pagine(request, env, percorso);
      if (risposta) return risposta;

      if (STATICI.has(percorso)) return await pagina(env, request, percorso.slice(1));

      return new Response('Pagina non trovata.', { status: 404, headers: SICUREZZA });
    } catch (e) {
      return errore(e);
    }
  },
};
