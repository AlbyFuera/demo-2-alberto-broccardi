import type { Env } from './types.ts';

/** Quanto dura la finestra. Passata, il conteggio riparte da zero. */
const FINESTRA_MS = 15 * 60 * 1000;

/** Tentativi falliti ammessi nella finestra, per email e per IP. */
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

/** Registra un tentativo fallito e dice se il limite è superato. */
export async function segnaFallimento(
  env: Env,
  chiave: string,
  massimo: number,
): Promise<EsitoLimite> {
  const adesso = Date.now();
  const inizioFinestra = new Date(adesso - FINESTRA_MS).toISOString();

  // Una sola query: in due, tentativi simultanei conterebbero come uno.
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

/** Il limite è già superato? Va controllato prima della password. */
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

/** Controlla il limite prima della verifica della password, che è costosa. */
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

/** Il messaggio mostrato quando il limite scatta. */
export function messaggioLimite(attendi: number): string {
  const minuti = Math.ceil(attendi / 60);
  return (
    `Troppi tentativi. Riprova tra ${minuti === 1 ? 'un minuto' : `${minuti} minuti`}. ` +
    `Se hai dimenticato la password, chiedila al tuo nutrizionista.`
  );
}

/** Limite sulle iscrizioni. */
export const MASSIMO_ISCRIZIONI = 25;

export async function controllaIscrizione(env: Env, request: Request): Promise<EsitoLimite> {
  return await giaBloccato(env, `reg:${indirizzoDi(request)}`, MASSIMO_ISCRIZIONI);
}

export async function iscrizioneFatta(env: Env, request: Request): Promise<void> {
  await segnaFallimento(env, `reg:${indirizzoDi(request)}`, MASSIMO_ISCRIZIONI);
}
