/**
 * Limitazione dei tentativi di accesso.
 *
 * Il ritardo fisso di 400 ms su ogni tentativo fallito serve a un'altra cosa —
 * rendere il tempo di risposta indipendente dal fatto che l'email esista — e
 * non ferma nessuno: quattrocento millisecondi per tentativo sono duecentomila
 * tentativi al giorno su una connessione sola.
 *
 * DUE CHIAVI, perché proteggono da due attacchi diversi:
 *
 *   email:…   un singolo account preso di mira, provato con mille password;
 *   ip:…      una password comune provata su mille indirizzi diversi.
 *
 * Un limite sulla sola email lascia passare il secondo caso, uno sul solo IP
 * lascia passare il primo quando arriva da una rete grande.
 *
 * DUE COSE CHE QUESTO MODULO NON FA, per scelta:
 *
 *  · non blocca per sempre. La finestra è mobile e scade: un utente che sbaglia
 *    la password cinque volte deve poter rientrare, non scrivere a un supporto
 *    che non esiste;
 *  · non dice mai se l'email esisteva. La risposta al superamento del limite è
 *    identica in entrambi i casi, o il limite diventa un modo per scoprire chi
 *    è iscritto.
 */

import type { Env } from './types.ts';

/** Quanto dura la finestra. Passata, il conteggio riparte da zero. */
const FINESTRA_MS = 15 * 60 * 1000;

/**
 * Tentativi falliti ammessi nella finestra.
 *
 * Otto per email: chi sbaglia a digitare ne usa due o tre, chi prova a
 * indovinare ne vuole migliaia. Sessanta per indirizzo di rete, che è largo
 * perché dietro un solo IP può esserci lo studio intero — o una scuola.
 */
const MASSIMO = { email: 8, ip: 60 } as const;

export interface EsitoLimite {
  superato: boolean;
  /** Secondi da attendere, quando è superato. */
  attendi: number;
}

const oraISO = () => new Date().toISOString();

/** L'indirizzo di chi chiama, come lo dichiara Cloudflare. */
export function indirizzoDi(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'sconosciuto'
  );
}

/**
 * Registra un tentativo FALLITO e dice se il limite è stato superato.
 *
 * Si chiama SOLO sui fallimenti: un accesso riuscito non consuma nulla, e chi
 * usa il prodotto normalmente non incontra mai questo codice.
 */
export async function segnaFallimento(
  env: Env,
  chiave: string,
  massimo: number,
): Promise<EsitoLimite> {
  const adesso = Date.now();
  const inizioFinestra = new Date(adesso - FINESTRA_MS).toISOString();

  // Una sola istruzione: legge, azzera se la finestra è scaduta, incrementa.
  // Farlo in due query aprirebbe una corsa in cui due tentativi simultanei
  // contano come uno.
  await env.DB.prepare(
    `INSERT INTO attempts (key, count, window_from) VALUES (?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET
       count       = CASE WHEN attempts.window_from < ? THEN 1 ELSE attempts.count + 1 END,
       window_from = CASE WHEN attempts.window_from < ? THEN ? ELSE attempts.window_from END`,
  )
    .bind(chiave, oraISO(), inizioFinestra, inizioFinestra, oraISO())
    .run();

  const riga = await env.DB.prepare(`SELECT count, window_from FROM attempts WHERE key = ?`)
    .bind(chiave)
    .first<{ count: number; window_from: string }>();

  if (!riga || riga.count <= massimo) return { superato: false, attendi: 0 };

  const finisce = new Date(riga.window_from).getTime() + FINESTRA_MS;
  return { superato: true, attendi: Math.max(1, Math.ceil((finisce - adesso) / 1000)) };
}

/** Il limite è già stato superato? Si controlla PRIMA di verificare la password. */
export async function giaBloccato(
  env: Env,
  chiave: string,
  massimo: number,
): Promise<EsitoLimite> {
  const riga = await env.DB.prepare(`SELECT count, window_from FROM attempts WHERE key = ?`)
    .bind(chiave)
    .first<{ count: number; window_from: string }>();

  if (!riga) return { superato: false, attendi: 0 };

  const finisce = new Date(riga.window_from).getTime() + FINESTRA_MS;
  const adesso = Date.now();

  // Finestra scaduta: la riga è vecchia e non conta più.
  if (finisce <= adesso) return { superato: false, attendi: 0 };
  if (riga.count <= massimo) return { superato: false, attendi: 0 };

  return { superato: true, attendi: Math.max(1, Math.ceil((finisce - adesso) / 1000)) };
}

/** Un accesso riuscito ripulisce il conteggio di quell'email. */
export async function azzera(env: Env, chiave: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM attempts WHERE key = ?`).bind(chiave).run();
}

/**
 * I due controlli di un tentativo di accesso, nell'ordine giusto.
 *
 * Prima si guarda se è già bloccato — così una raffica non costa una verifica
 * di password ciascuna, che è la parte cara (600.000 iterazioni di PBKDF2).
 */
export async function controllaAccesso(
  env: Env,
  email: string,
  request: Request,
): Promise<EsitoLimite> {
  const perEmail = await giaBloccato(env, `email:${email}`, MASSIMO.email);
  if (perEmail.superato) return perEmail;

  return await giaBloccato(env, `ip:${indirizzoDi(request)}`, MASSIMO.ip);
}

/** Dopo un tentativo fallito: si segna su entrambe le chiavi. */
export async function accessoFallito(
  env: Env,
  email: string,
  request: Request,
): Promise<EsitoLimite> {
  const [perEmail, perIp] = await Promise.all([
    segnaFallimento(env, `email:${email}`, MASSIMO.email),
    segnaFallimento(env, `ip:${indirizzoDi(request)}`, MASSIMO.ip),
  ]);

  return perEmail.superato ? perEmail : perIp;
}

export async function accessoRiuscito(env: Env, email: string): Promise<void> {
  await azzera(env, `email:${email}`);
}

/**
 * Il messaggio mostrato quando il limite scatta.
 *
 * Non dice se l'email esisteva, e dice quanto aspettare: un blocco senza durata
 * indicata sembra definitivo, e chi lo incontra pensa di aver perso l'account.
 */
export function messaggioLimite(attendi: number): string {
  const minuti = Math.ceil(attendi / 60);
  return (
    `Troppi tentativi. Riprova tra ${minuti === 1 ? 'un minuto' : `${minuti} minuti`}. ` +
    `Se hai dimenticato la password, chiedila al tuo nutrizionista.`
  );
}

/**
 * Limite sulle iscrizioni, per non farsi riempire la tabella degli utenti.
 *
 * Venticinque per quarto d'ora, non dieci. Dieci sembrava prudente e si è
 * rivelato stretto: durante il collaudo ha bloccato la macchina che stava
 * provando il prodotto, e la stessa cosa capiterebbe a chi mostra
 * l'applicazione creando qualche account di prova, o a uno studio che iscrive
 * la famiglia da una sola connessione. Chi vuole riempire la tabella degli
 * utenti resta fermato comunque.
 */
export const MASSIMO_ISCRIZIONI = 25;

export async function controllaIscrizione(env: Env, request: Request): Promise<EsitoLimite> {
  return await giaBloccato(env, `reg:${indirizzoDi(request)}`, MASSIMO_ISCRIZIONI);
}

export async function iscrizioneFatta(env: Env, request: Request): Promise<void> {
  await segnaFallimento(env, `reg:${indirizzoDi(request)}`, MASSIMO_ISCRIZIONI);
}
