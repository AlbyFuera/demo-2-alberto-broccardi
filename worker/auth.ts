import type { Env, Ruolo, Utente } from './types.ts';

/** Oltre 100.000 `deriveBits` fallisce in produzione, non in locale. */
const TETTO_PER_CHIAMATA = 100_000;

const ITERAZIONI = 600_000;

const DURATA_SESSIONE_MS = 12 * 60 * 60 * 1000; // 12 ore
const COOKIE = 'sessione';

const b64 = (buf: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(buf)));

const fromB64 = (s: string): Uint8Array =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** PBKDF2 a giri concatenati; le iterazioni si leggono dalla riga utente. */
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

/** Confronto a tempo costante. */
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

/** Requisiti minimi della password. */
export function passwordDebole(password: string): string | null {
  if (password.length < 10) return 'La password deve avere almeno 10 caratteri.';
  if (/^\d+$/.test(password)) return 'Una password di soli numeri non va bene.';
  if (/^(.)\1+$/.test(password)) return 'Scegli una password meno prevedibile.';
  return null;
}

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

  // Pulizia delle sessioni scadute.
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
  // In locale si gira su http: con Secure il cookie verrebbe scartato.
  if (sicuro) attributi.push('Secure');
  return attributi.join('; ');
}

export function cookieScaduto(sicuro: boolean): string {
  const attributi = [`${COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (sicuro) attributi.push('Secure');
  return attributi.join('; ');
}

interface RigaUtente {
  id: string;
  email: string;
  role: Ruolo;
  name: string;
  goal: string | null;
}

/** L'utente della richiesta, o null. */
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
  /** Distingue la sessione scaduta dalla password sbagliata. */
  codice?: string;

  constructor(status: number, message: string, codice?: string) {
    super(message);
    this.status = status;
    this.codice = codice;
  }
}

export const SESSIONE_SCADUTA = 'sessione-scaduta';

/** Per far durare uguale il login di un'email inesistente. */
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

export function ruoloValido(valore: unknown): valore is Ruolo {
  return valore === 'nutrizionista' || valore === 'cliente';
}

/** True se la richiesta arriva su HTTPS. */
export function inHttps(request: Request): boolean {
  return new URL(request.url).protocol === 'https:';
}
