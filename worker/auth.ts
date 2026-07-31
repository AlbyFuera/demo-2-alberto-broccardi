/**
 * Accesso, sessioni, ruoli.
 *
 * Una schermata sola per due mestieri: professionista e cliente entrano dallo
 * stesso form e finiscono in due applicazioni diverse. Il ruolo NON viene mai
 * dal client — arriva dalla riga in `users`, che il client non può toccare.
 *
 * Scelte di sicurezza, tutte deliberate:
 *
 *  · password: PBKDF2-SHA256, 600.000 iterazioni effettive, sale casuale per
 *    utente. WebCrypto è l'unica primitiva disponibile nel runtime dei Worker
 *    (niente scrypt, niente argon2), e le iterazioni sono salvate per utente
 *    così alzarle domani non invalida le password di oggi.
 *  · sessione: token casuale da 256 bit consegnato in un cookie HttpOnly +
 *    Secure + SameSite=Lax. In tabella finisce solo il suo SHA-256: chi legge
 *    il database non può impersonare nessuno.
 *  · confronti: `crypto.subtle.timingSafeEqual` dove disponibile, altrimenti
 *    confronto a tempo costante scritto a mano.
 *  · errori di accesso: un messaggio unico. Distinguere "email sconosciuta" da
 *    "password sbagliata" regala a chi prova un elenco di clienti dello studio.
 */

import type { Env, Ruolo, Utente } from './types.ts';

/**
 * Il tetto di WebCrypto nei Worker: oltre le 100.000 iterazioni per singola
 * chiamata, `deriveBits` rifiuta con `NotSupportedError`.
 *
 * ATTENZIONE, è un difetto trovato in produzione e invisibile in sviluppo: il
 * runtime locale di wrangler accetta valori più alti, quello vero no. Un numero
 * più grande qui non fallisce in fase di collaudo — fallisce quando si iscrive
 * il primo utente.
 */
const TETTO_PER_CHIAMATA = 100_000;

/**
 * Iterazioni effettive. Le 100.000 di una chiamata sola sono sotto le
 * raccomandazioni correnti per PBKDF2-SHA256, e qui si custodiscono password
 * legate a dati sanitari: si arriva a 600.000 concatenando i giri.
 */
const ITERAZIONI = 600_000;

const DURATA_SESSIONE_MS = 12 * 60 * 60 * 1000; // 12 ore
const COOKIE = 'sessione';

/* ------------------------------------------------------------------ */
/* Password                                                            */
/* ------------------------------------------------------------------ */

const b64 = (buf: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(buf)));

const fromB64 = (s: string): Uint8Array =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/**
 * PBKDF2 a giri concatenati.
 *
 * Ogni giro fa al massimo `TETTO_PER_CHIAMATA` iterazioni e prende come
 * ingresso l'uscita del giro precedente. Non è una costruzione inventata: è
 * PBKDF2 applicato più volte, quindi il fattore di lavoro si somma e non si
 * indebolisce nulla — chi vuole provare una password deve rifare tutti i giri
 * nell'ordine, senza scorciatoie.
 *
 * `iterazioniTotali` si legge dalla riga dell'utente, non da questa costante:
 * è ciò che permette di alzare il numero domani senza invalidare le password
 * salvate oggi, e di verificare quelle salvate con valori diversi.
 */
async function pbkdf2(
  password: string,
  salt: Uint8Array,
  iterazioniTotali: number,
): Promise<string> {
  let materiale: Uint8Array = new TextEncoder().encode(password);
  let restanti = Math.max(1, iterazioniTotali);
  let bits: ArrayBuffer | null = null;

  while (restanti > 0) {
    const giro = Math.min(restanti, TETTO_PER_CHIAMATA);
    const key = await crypto.subtle.importKey(
      'raw',
      materiale as BufferSource,
      'PBKDF2',
      false,
      ['deriveBits'],
    );
    bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: giro },
      key,
      256,
    );
    materiale = new Uint8Array(bits);
    restanti -= giro;
  }

  return b64(bits!);
}

export interface PasswordHash {
  hash: string;
  salt: string;
  iterations: number;
}

export async function hashPassword(password: string): Promise<PasswordHash> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return {
    hash: await pbkdf2(password, salt, ITERAZIONI),
    salt: b64(salt.buffer as ArrayBuffer),
    iterations: ITERAZIONI,
  };
}

/** Confronto a tempo costante: la durata non deve dipendere dal contenuto. */
function equalConstantTime(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyPassword(
  password: string,
  stored: PasswordHash,
): Promise<boolean> {
  const candidate = await pbkdf2(password, fromB64(stored.salt), stored.iterations);
  return equalConstantTime(candidate, stored.hash);
}

/**
 * Requisiti minimi della password.
 *
 * Lunghezza sopra ogni altra regola: 10 caratteri battono "una maiuscola e un
 * numero" su ogni misura reale, e non spingono l'utente verso Password1!.
 */
export function passwordDebole(password: string): string | null {
  if (password.length < 10) return 'La password deve avere almeno 10 caratteri.';
  if (/^\d+$/.test(password)) return 'Una password di soli numeri non va bene.';
  if (/^(.)\1+$/.test(password)) return 'Scegli una password meno prevedibile.';
  return null;
}

/* ------------------------------------------------------------------ */
/* Sessioni                                                           */
/* ------------------------------------------------------------------ */

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return b64(buf);
}

function nuovoToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface Sessione {
  token: string;
  expiresAt: string;
}

export async function apriSessione(
  env: Env,
  userId: string,
  userAgent: string | null,
  ora: Date,
): Promise<Sessione> {
  const token = nuovoToken();
  const expiresAt = new Date(ora.getTime() + DURATA_SESSIONE_MS).toISOString();

  await env.DB.prepare(
    `INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(await sha256(token), userId, ora.toISOString(), expiresAt, userAgent?.slice(0, 200) ?? null)
    .run();

  // Pulizia opportunistica: senza un cron, le sessioni scadute le raccoglie
  // chi passa. Costa una DELETE per accesso e tiene la tabella onesta.
  await env.DB.prepare(`DELETE FROM sessions WHERE expires_at < ?`)
    .bind(ora.toISOString())
    .run();

  return { token, expiresAt };
}

export async function chiudiSessione(env: Env, token: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?`)
    .bind(await sha256(token))
    .run();
}

/* ------------------------------------------------------------------ */
/* Cookie                                                             */
/* ------------------------------------------------------------------ */

export function leggiCookie(request: Request): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;

  for (const parte of header.split(';')) {
    const [nome, ...resto] = parte.trim().split('=');
    if (nome === COOKIE) return resto.join('=') || null;
  }
  return null;
}

export function cookieDiSessione(sessione: Sessione, sicuro: boolean): string {
  const attributi = [
    `${COOKIE}=${sessione.token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${new Date(sessione.expiresAt).toUTCString()}`,
  ];
  // In sviluppo locale il Worker gira su http://localhost: con Secure il
  // browser scarterebbe il cookie e l'accesso non funzionerebbe mai.
  if (sicuro) attributi.push('Secure');
  return attributi.join('; ');
}

export function cookieScaduto(sicuro: boolean): string {
  const attributi = [`${COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (sicuro) attributi.push('Secure');
  return attributi.join('; ');
}

/* ------------------------------------------------------------------ */
/* Chi sta chiamando                                                  */
/* ------------------------------------------------------------------ */

interface RigaUtente {
  id: string;
  email: string;
  role: Ruolo;
  name: string;
  goal: string | null;
}

/**
 * L'utente della richiesta, o null.
 *
 * Una sola query con JOIN: la sessione da sola non basta, serve il ruolo, e
 * leggerli in due passaggi apre la porta a una sessione valida per un utente
 * cancellato.
 */
export async function utenteCorrente(env: Env, request: Request): Promise<Utente | null> {
  const token = leggiCookie(request);
  if (!token) return null;

  const riga = await env.DB.prepare(
    `SELECT u.id, u.email, u.role, u.name, u.goal
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(await sha256(token), new Date().toISOString())
    .first<RigaUtente>();

  if (!riga) return null;

  return {
    id: riga.id,
    email: riga.email,
    ruolo: riga.role,
    nome: riga.name,
    obiettivo: riga.goal,
  };
}

export class ErroreHttp extends Error {
  status: number;
  /**
   * Codice leggibile dal browser.
   *
   * Serve a distinguere i due 401 che significano cose opposte: «la tua
   * sessione è finita, torna all'accesso» e «la password che hai appena
   * scritto è sbagliata, riprova qui». Senza, l'interfaccia butterebbe fuori
   * chi ha solo sbagliato a digitare.
   */
  codice?: string;

  constructor(status: number, message: string, codice?: string) {
    super(message);
    this.status = status;
    this.codice = codice;
  }
}

export const SESSIONE_SCADUTA = 'sessione-scaduta';

/**
 * Credenziali finte con cui verificare la password di un'email inesistente.
 *
 * Serve a far costare lo stesso i due casi: senza, la risposta immediata su
 * un'email sconosciuta direbbe a chi prova quali indirizzi hanno un account.
 * Il numero di iterazioni viene da qui e non è scritto a mano nel chiamante,
 * o al primo cambio i due percorsi tornerebbero a durare tempi diversi.
 */
export const CREDENZIALI_FINTE: PasswordHash = {
  hash: 'x'.repeat(44),
  salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
  iterations: ITERAZIONI,
};

/** Richiede un utente autenticato con uno dei ruoli indicati. */
export function esigi(utente: Utente | null, ...ruoli: Ruolo[]): Utente {
  if (!utente) throw new ErroreHttp(401, 'Sessione scaduta. Accedi di nuovo.', SESSIONE_SCADUTA);
  if (ruoli.length > 0 && !ruoli.includes(utente.ruolo)) {
    throw new ErroreHttp(403, 'Questa parte non è accessibile con il tuo profilo.');
  }
  return utente;
}

/* ------------------------------------------------------------------ */
/* Registrazione                                                       */
/* ------------------------------------------------------------------ */

/**
 * La registrazione è APERTA, per entrambi i ruoli, con sola email e password.
 *
 * Non c'è più un codice di attivazione, ed è una scelta, non una dimenticanza:
 * la barriera non sta all'ingresso ma nel COLLEGAMENTO. Un account appena
 * creato — di qualunque ruolo — non vede i dati di nessuno. Un cliente resta
 * davanti a una schermata vuota finché un professionista non lo accetta; un
 * professionista non ha clienti finché non ne accetta uno.
 *
 * Mettere una barriera all'iscrizione avrebbe protetto un elenco di account
 * vuoti, al prezzo di un codice da distribuire a ogni paziente.
 */
export function ruoloValido(valore: unknown): valore is Ruolo {
  return valore === 'nutrizionista' || valore === 'cliente';
}

/** True se la richiesta arriva su HTTPS: decide l'attributo Secure del cookie. */
export function inHttps(request: Request): boolean {
  return new URL(request.url).protocol === 'https:';
}
