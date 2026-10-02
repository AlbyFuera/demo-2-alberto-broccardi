// Ogni query: parametri, filtro sul proprietario, collegamento attivo.

import type { Dieta } from '../src/types.ts';
import { normalizza } from '../src/core/composizione.ts';
import type { Libreria, VoceLibreria } from '../src/core/composizione.ts';
import type { Env, Ruolo } from './types.ts';
import { hashPassword, type PasswordHash } from './auth.ts';

const oraISO = () => new Date().toISOString();

/** Identificativi con prefisso leggibile. */
function nuovoId(prefisso: string): string {
  return `${prefisso}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

/** Email normalizzate per il confronto. */
export const normEmail = (email: string) => email.trim().toLowerCase();

// Utenti

export interface RigaCredenziali extends PasswordHash {
  id: string;
  role: Ruolo;
  name: string;
  email: string;
}

export async function credenzialiPerEmail(
  env: Env,
  email: string,
): Promise<RigaCredenziali | null> {
  const riga = await env.DB.prepare(
    `SELECT id, email, role, name, password_hash, password_salt, iterations
       FROM users WHERE email = ?`,
  )
    .bind(normEmail(email))
    .first<{
      id: string;
      email: string;
      role: Ruolo;
      name: string;
      password_hash: string;
      password_salt: string;
      iterations: number;
    }>();

  if (!riga) return null;
  return {
    id: riga.id,
    email: riga.email,
    role: riga.role,
    name: riga.name,
    hash: riga.password_hash,
    salt: riga.password_salt,
    iterations: riga.iterations,
  };
}

/** Crea un account. */
export async function creaUtente(
  env: Env,
  dati: { email: string; password: string; ruolo: Ruolo },
): Promise<string> {
  const id = nuovoId(dati.ruolo === 'nutrizionista' ? 'nut' : 'cli');
  const pw = await hashPassword(dati.password);

  await env.DB.prepare(
    `INSERT INTO users (id, email, role, name, password_hash, password_salt, iterations, created_at)
     VALUES (?, ?, ?, '', ?, ?, ?, ?)`,
  )
    .bind(id, normEmail(dati.email), dati.ruolo, pw.hash, pw.salt, pw.iterations, oraISO())
    .run();

  return id;
}

export async function aggiornaProfilo(
  env: Env,
  userId: string,
  dati: { nome?: string; obiettivo?: string | null },
): Promise<void> {
  await env.DB.prepare(
    `UPDATE users
        SET name = COALESCE(?, name),
            goal = COALESCE(?, goal)
      WHERE id = ?`,
  )
    .bind(dati.nome ?? null, dati.obiettivo ?? null, userId)
    .run();
}

export async function segnaAccesso(env: Env, userId: string): Promise<void> {
  await env.DB.prepare(`UPDATE users SET last_login = ? WHERE id = ?`)
    .bind(oraISO(), userId)
    .run();
}

export async function cambiaPassword(env: Env, userId: string, password: string): Promise<void> {
  const pw = await hashPassword(password);
  await env.DB.prepare(
    `UPDATE users SET password_hash = ?, password_salt = ?, iterations = ? WHERE id = ?`,
  )
    .bind(pw.hash, pw.salt, pw.iterations, userId)
    .run();

  // Cambiata la password, le altre sessioni vengono chiuse.
  await env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(userId).run();
}

export async function eliminaAccount(env: Env, userId: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(userId).run();
}

// Collegamenti

export type StatoCollegamento = 'in-attesa' | 'attivo' | 'rifiutato';

export interface Collegamento {
  id: string;
  clienteId: string;
  clienteNome: string;
  clienteEmail: string;
  studioId: string;
  studioNome: string;
  studioEmail: string;
  stato: StatoCollegamento;
  messaggio: string | null;
  richiestoIl: string;
  /** L'assistente risponde da solo al cliente, oppure scrive il professionista. */
  automazione: boolean;
}

/** Cerca un professionista per email esatta; restituisce solo il nome. */
export async function studioPerEmail(
  env: Env,
  email: string,
): Promise<{ id: string; nome: string; email: string } | null> {
  return await env.DB.prepare(
    `SELECT id, name AS nome, email
       FROM users WHERE email = ? AND role = 'nutrizionista'`,
  )
    .bind(normEmail(email))
    .first<{ id: string; nome: string; email: string }>();
}

/** Richiesta di collegamento: se già esiste viene aggiornata. */
export async function chiediCollegamento(
  env: Env,
  clienteId: string,
  studioId: string,
  messaggio: string | null,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO links (id, client_id, nutritionist_id, status, message, requested_at)
     VALUES (?, ?, ?, 'in-attesa', ?, ?)
     ON CONFLICT(client_id, nutritionist_id) DO UPDATE SET
       status       = 'in-attesa',
       message      = excluded.message,
       requested_at = excluded.requested_at,
       decided_at   = NULL
     WHERE links.status <> 'attivo'`,
  )
    .bind(nuovoId('lnk'), clienteId, studioId, messaggio, oraISO())
    .run();
}

export async function decidiCollegamento(
  env: Env,
  studioId: string,
  linkId: string,
  accetta: boolean,
): Promise<boolean> {
  const esito = await env.DB.prepare(
    `UPDATE links SET status = ?, decided_at = ?
      WHERE id = ? AND nutritionist_id = ? AND status = 'in-attesa'`,
  )
    .bind(accetta ? 'attivo' : 'rifiutato', oraISO(), linkId, studioId)
    .run();

  return (esito.meta.changes ?? 0) > 0;
}

/** Chiude un collegamento attivo. Lo possono fare entrambi. */
export async function sciogliCollegamento(
  env: Env,
  userId: string,
  linkId: string,
): Promise<void> {
  await env.DB.prepare(
    `DELETE FROM links WHERE id = ? AND (client_id = ? OR nutritionist_id = ?)`,
  )
    .bind(linkId, userId, userId)
    .run();
}

const SELECT_COLLEGAMENTO = `
  SELECT l.id, l.status, l.message, l.requested_at, l.auto_chat,
         l.client_id, c.name AS client_name, c.email AS client_email,
         l.nutritionist_id, n.name AS nut_name, n.email AS nut_email
    FROM links l
    JOIN users c ON c.id = l.client_id
    JOIN users n ON n.id = l.nutritionist_id`;

interface RigaCollegamento {
  id: string;
  status: StatoCollegamento;
  message: string | null;
  requested_at: string;
  auto_chat: number;
  client_id: string;
  client_name: string;
  client_email: string;
  nutritionist_id: string;
  nut_name: string;
  nut_email: string;
}

const daRigaCollegamento = (r: RigaCollegamento): Collegamento => ({
  id: r.id,
  clienteId: r.client_id,
  clienteNome: r.client_name,
  clienteEmail: r.client_email,
  studioId: r.nutritionist_id,
  studioNome: r.nut_name,
  studioEmail: r.nut_email,
  stato: r.status,
  messaggio: r.message,
  richiestoIl: r.requested_at,
  // !== 0 di proposito: con NULL l'automazione resta accesa.
  automazione: r.auto_chat !== 0,
});

/** Accende o spegne l'assistente per un cliente. */
export async function impostaAutomazione(
  env: Env,
  studioId: string,
  clienteId: string,
  attiva: boolean,
): Promise<boolean> {
  const esito = await env.DB.prepare(
    `UPDATE links SET auto_chat = ?
      WHERE nutritionist_id = ? AND client_id = ? AND status = 'attivo'`,
  )
    .bind(attiva ? 1 : 0, studioId, clienteId)
    .run();

  return (esito.meta.changes ?? 0) > 0;
}

/** Il collegamento del cliente: quello attivo, altrimenti l'ultima richiesta. */
export async function collegamentoDelCliente(
  env: Env,
  clienteId: string,
): Promise<Collegamento | null> {
  const riga = await env.DB.prepare(
    `${SELECT_COLLEGAMENTO}
      WHERE l.client_id = ?
      ORDER BY CASE l.status WHEN 'attivo' THEN 0 WHEN 'in-attesa' THEN 1 ELSE 2 END,
               l.requested_at DESC
      LIMIT 1`,
  )
    .bind(clienteId)
    .first<RigaCollegamento>();

  return riga ? daRigaCollegamento(riga) : null;
}

export async function collegamentiDelloStudio(
  env: Env,
  studioId: string,
): Promise<Collegamento[]> {
  const { results } = await env.DB.prepare(
    `${SELECT_COLLEGAMENTO}
      WHERE l.nutritionist_id = ? AND l.status IN ('in-attesa', 'attivo')
      ORDER BY CASE l.status WHEN 'in-attesa' THEN 0 ELSE 1 END,
               l.requested_at DESC`,
  )
    .bind(studioId)
    .all<RigaCollegamento>();

  return results.map(daRigaCollegamento);
}

/** Il professionista segue davvero quel cliente? */
export async function collegamentoAttivo(
  env: Env,
  studioId: string,
  clienteId: string,
): Promise<boolean> {
  const riga = await env.DB.prepare(
    `SELECT 1 AS c FROM links
      WHERE nutritionist_id = ? AND client_id = ? AND status = 'attivo'`,
  )
    .bind(studioId, clienteId)
    .first<{ c: number }>();
  return riga !== null;
}

// Diete

export type StatoDieta = 'bozza' | 'pubblicata' | 'archiviata';

export interface DietaRiga {
  id: string;
  clienteId: string;
  studioId: string;
  titolo: string;
  stato: StatoDieta;
  dieta: Dieta;
  creataIl: string;
  aggiornataIl: string;
  pubblicataIl: string | null;
}

function daRigaDieta(r: {
  id: string;
  client_id: string;
  nutritionist_id: string;
  title: string;
  status: StatoDieta;
  diet_json: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}): DietaRiga {
  return {
    id: r.id,
    clienteId: r.client_id,
    studioId: r.nutritionist_id,
    titolo: r.title,
    stato: r.status,
    dieta: JSON.parse(r.diet_json) as Dieta,
    creataIl: r.created_at,
    aggiornataIl: r.updated_at,
    pubblicataIl: r.published_at,
  };
}

const SELECT_DIETA = `SELECT id, client_id, nutritionist_id, title, status, diet_json,
                             created_at, updated_at, published_at FROM diets`;

export async function creaDieta(
  env: Env,
  studioId: string,
  clienteId: string,
  dieta: Dieta,
): Promise<string> {
  const id = dieta.id;
  const ora = oraISO();

  await env.DB.prepare(
    `INSERT INTO diets (id, client_id, nutritionist_id, title, status, diet_json,
                        created_at, updated_at)
     VALUES (?, ?, ?, ?, 'bozza', ?, ?, ?)`,
  )
    .bind(id, clienteId, studioId, dieta.titolo, JSON.stringify(dieta), ora, ora)
    .run();

  return id;
}

export async function salvaDieta(
  env: Env,
  studioId: string,
  dietaId: string,
  dieta: Dieta,
): Promise<boolean> {
  const esito = await env.DB.prepare(
    `UPDATE diets SET diet_json = ?, title = ?, updated_at = ?
      WHERE id = ? AND nutritionist_id = ? AND status <> 'archiviata'`,
  )
    .bind(JSON.stringify(dieta), dieta.titolo, oraISO(), dietaId, studioId)
    .run();

  return (esito.meta.changes ?? 0) > 0;
}

/** Pubblica una dieta e archivia la precedente. */
export async function pubblicaDieta(
  env: Env,
  studioId: string,
  dietaId: string,
  clienteId: string,
): Promise<void> {
  const ora = oraISO();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE diets SET status = 'archiviata', updated_at = ?
        WHERE client_id = ? AND nutritionist_id = ? AND status = 'pubblicata' AND id <> ?`,
    ).bind(ora, clienteId, studioId, dietaId),
    env.DB.prepare(
      `UPDATE diets SET status = 'pubblicata', published_at = ?, updated_at = ?
        WHERE id = ? AND nutritionist_id = ?`,
    ).bind(ora, ora, dietaId, studioId),
  ]);
}

export async function ritiraDieta(env: Env, studioId: string, dietaId: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE diets SET status = 'bozza', updated_at = ?
      WHERE id = ? AND nutritionist_id = ? AND status = 'pubblicata'`,
  )
    .bind(oraISO(), dietaId, studioId)
    .run();
}

export async function eliminaDieta(env: Env, studioId: string, dietaId: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM diets WHERE id = ? AND nutritionist_id = ?`)
    .bind(dietaId, studioId)
    .run();
}

/** La dieta pubblicata del cliente, mai una bozza. */
export async function dietaDelCliente(env: Env, clienteId: string): Promise<DietaRiga | null> {
  const riga = await env.DB.prepare(
    `${SELECT_DIETA} WHERE client_id = ? AND status = 'pubblicata' LIMIT 1`,
  )
    .bind(clienteId)
    .first<Parameters<typeof daRigaDieta>[0]>();

  return riga ? daRigaDieta(riga) : null;
}

export async function dietaDelloStudio(
  env: Env,
  studioId: string,
  dietaId: string,
): Promise<DietaRiga | null> {
  const riga = await env.DB.prepare(`${SELECT_DIETA} WHERE id = ? AND nutritionist_id = ?`)
    .bind(dietaId, studioId)
    .first<Parameters<typeof daRigaDieta>[0]>();

  return riga ? daRigaDieta(riga) : null;
}

export async function dieteDelCliente(
  env: Env,
  studioId: string,
  clienteId: string,
): Promise<DietaRiga[]> {
  const { results } = await env.DB.prepare(
    `${SELECT_DIETA} WHERE client_id = ? AND nutritionist_id = ? ORDER BY updated_at DESC`,
  )
    .bind(clienteId, studioId)
    .all<Parameters<typeof daRigaDieta>[0]>();

  return results.map(daRigaDieta);
}

// Libreria degli alimenti

export async function libreriaDelloStudio(env: Env, studioId: string): Promise<Libreria> {
  const { results } = await env.DB.prepare(
    `SELECT key, label, protein, carbs, fat, per FROM foods WHERE nutritionist_id = ?`,
  )
    .bind(studioId)
    .all<{
      key: string;
      label: string;
      protein: number;
      carbs: number;
      fat: number;
      per: 'g100' | 'pz';
    }>();

  const libreria: Libreria = new Map();
  for (const r of results) {
    libreria.set(r.key, {
      chiave: r.key,
      nome: r.label,
      proteine: r.protein,
      carboidrati: r.carbs,
      grassi: r.fat,
      per: r.per,
    });
  }
  return libreria;
}

export async function salvaAlimento(
  env: Env,
  studioId: string,
  voce: Omit<VoceLibreria, 'chiave'>,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO foods (nutritionist_id, key, label, protein, carbs, fat, per, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(nutritionist_id, key, per) DO UPDATE SET
       label = excluded.label, protein = excluded.protein, carbs = excluded.carbs,
       fat = excluded.fat, updated_at = excluded.updated_at`,
  )
    .bind(
      studioId,
      normalizza(voce.nome),
      voce.nome.trim(),
      voce.proteine,
      voce.carboidrati,
      voce.grassi,
      voce.per,
      oraISO(),
    )
    .run();
}

export async function eliminaAlimento(
  env: Env,
  studioId: string,
  chiave: string,
  per: string,
): Promise<void> {
  await env.DB.prepare(
    `DELETE FROM foods WHERE nutritionist_id = ? AND key = ? AND per = ?`,
  )
    .bind(studioId, chiave, per)
    .run();
}

export async function elencoLibreria(
  env: Env,
  studioId: string,
): Promise<(VoceLibreria & { aggiornatoIl: string })[]> {
  const { results } = await env.DB.prepare(
    `SELECT key, label, protein, carbs, fat, per, updated_at
       FROM foods WHERE nutritionist_id = ? ORDER BY label COLLATE NOCASE`,
  )
    .bind(studioId)
    .all<{
      key: string;
      label: string;
      protein: number;
      carbs: number;
      fat: number;
      per: 'g100' | 'pz';
      updated_at: string;
    }>();

  return results.map((r) => ({
    chiave: r.key,
    nome: r.label,
    proteine: r.protein,
    carboidrati: r.carbs,
    grassi: r.fat,
    per: r.per,
    aggiornatoIl: r.updated_at,
  }));
}

// Variazioni

export interface VariazioneRiga {
  id: string;
  at: string;
  clienteId: string;
  clienteNome: string;
  clienteEmail: string;
  dietaId: string;
  giorno: number;
  pastoId: string;
  pastoNome: string;
  indice: number;
  daNome: string;
  daQuantita: string;
  aNome: string;
  aQuantita: string;
  base: string;
  kcalDelta: number;
  proteineDelta: number;
  carboidratiDelta: number;
  grassiDelta: number;
  avvisi: string[];
  stato: 'nuova' | 'vista' | 'annullata';
  nota: string | null;
  /** Era fra le alternative ammesse. Fissato alla scelta, non si ricalcola. */
  nelPiano: boolean;
}

export async function registraVariazione(
  env: Env,
  ctx: { clienteId: string; studioId: string; dietaId: string },
  v: Omit<VariazioneRiga, 'id' | 'at' | 'clienteId' | 'clienteNome' | 'clienteEmail' | 'dietaId' | 'stato' | 'nota'>,
): Promise<string> {
  const id = nuovoId('var');

  await env.DB.prepare(
    `INSERT INTO variations (
       id, client_id, nutritionist_id, diet_id, at,
       day, meal_id, meal_name, item_index,
       from_label, from_qty, to_label, to_qty,
       basis, kcal_delta, protein_delta, carbs_delta, fat_delta, warnings, status, in_plan)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'nuova', ?)`,
  )
    .bind(
      id,
      ctx.clienteId,
      ctx.studioId,
      ctx.dietaId,
      oraISO(),
      v.giorno,
      v.pastoId,
      v.pastoNome,
      v.indice,
      v.daNome,
      v.daQuantita,
      v.aNome,
      v.aQuantita,
      v.base,
      v.kcalDelta,
      v.proteineDelta,
      v.carboidratiDelta,
      v.grassiDelta,
      JSON.stringify(v.avvisi),
      v.nelPiano ? 1 : 0,
    )
    .run();

  return id;
}

interface RigaVariazioneSql {
  id: string;
  at: string;
  client_id: string;
  client_name: string;
  client_email: string;
  diet_id: string;
  day: number;
  meal_id: string;
  meal_name: string;
  item_index: number;
  from_label: string;
  from_qty: string;
  to_label: string;
  to_qty: string;
  basis: string;
  kcal_delta: number;
  protein_delta: number;
  carbs_delta: number;
  fat_delta: number;
  warnings: string;
  status: 'nuova' | 'vista' | 'annullata';
  note: string | null;
  in_plan: number;
}

function daRigaVariazione(r: RigaVariazioneSql): VariazioneRiga {
  let avvisi: string[] = [];
  try {
    const v = JSON.parse(r.warnings);
    if (Array.isArray(v)) avvisi = v.map(String);
  } catch {
    avvisi = [];
  }

  return {
    id: r.id,
    at: r.at,
    clienteId: r.client_id,
    clienteNome: r.client_name,
    clienteEmail: r.client_email,
    dietaId: r.diet_id,
    giorno: r.day,
    pastoId: r.meal_id,
    pastoNome: r.meal_name,
    indice: r.item_index,
    daNome: r.from_label,
    daQuantita: r.from_qty,
    aNome: r.to_label,
    aQuantita: r.to_qty,
    base: r.basis,
    kcalDelta: r.kcal_delta,
    proteineDelta: r.protein_delta,
    carboidratiDelta: r.carbs_delta,
    grassiDelta: r.fat_delta,
    avvisi,
    stato: r.status,
    nota: r.note,
    nelPiano: r.in_plan === 1,
  };
}

const SELECT_VARIAZIONE = `
  SELECT v.*, u.name AS client_name, u.email AS client_email
    FROM variations v JOIN users u ON u.id = v.client_id`;

export async function variazioniDelloStudio(
  env: Env,
  studioId: string,
  opzioni: { clienteId?: string; limite?: number } = {},
): Promise<VariazioneRiga[]> {
  const condizioni = ['v.nutritionist_id = ?'];
  const valori: unknown[] = [studioId];

  if (opzioni.clienteId) {
    condizioni.push('v.client_id = ?');
    valori.push(opzioni.clienteId);
  }
  valori.push(Math.min(opzioni.limite ?? 50, 200));

  const { results } = await env.DB.prepare(
    `${SELECT_VARIAZIONE} WHERE ${condizioni.join(' AND ')} ORDER BY v.at DESC LIMIT ?`,
  )
    .bind(...valori)
    .all<RigaVariazioneSql>();

  return results.map(daRigaVariazione);
}

export async function variazioniDelCliente(
  env: Env,
  clienteId: string,
  limite = 30,
): Promise<VariazioneRiga[]> {
  const { results } = await env.DB.prepare(
    `${SELECT_VARIAZIONE} WHERE v.client_id = ? ORDER BY v.at DESC LIMIT ?`,
  )
    .bind(clienteId, Math.min(limite, 100))
    .all<RigaVariazioneSql>();

  return results.map(daRigaVariazione);
}

export async function contaVariazioniNuove(env: Env, studioId: string): Promise<number> {
  const riga = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM variations WHERE nutritionist_id = ? AND status = 'nuova'`,
  )
    .bind(studioId)
    .first<{ n: number }>();
  return riga?.n ?? 0;
}

export async function segnaVariazioniViste(
  env: Env,
  studioId: string,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  const segnaposto = ids.map(() => '?').join(',');
  await env.DB.prepare(
    `UPDATE variations SET status = 'vista', seen_at = ?
      WHERE nutritionist_id = ? AND status = 'nuova' AND id IN (${segnaposto})`,
  )
    .bind(oraISO(), studioId, ...ids)
    .run();
}

/** Il professionista annulla una variazione del cliente. */
export async function annullaVariazione(
  env: Env,
  studioId: string,
  id: string,
  nota: string | null,
): Promise<VariazioneRiga | null> {
  const riga = await env.DB.prepare(
    `${SELECT_VARIAZIONE} WHERE v.id = ? AND v.nutritionist_id = ?`,
  )
    .bind(id, studioId)
    .first<RigaVariazioneSql>();

  if (!riga) return null;

  await env.DB.prepare(
    `UPDATE variations SET status = 'annullata', seen_at = ?, note = ?
      WHERE id = ? AND nutritionist_id = ?`,
  )
    .bind(oraISO(), nota, id, studioId)
    .run();

  return daRigaVariazione(riga);
}

// Domande girate allo studio

export interface DomandaRiga {
  id: string;
  clienteId: string;
  clienteNome: string;
  clienteEmail: string;
  at: string;
  domanda: string;
  motivo: string;
  stato: 'aperta' | 'chiusa';
  risposta: string | null;
}

export async function aggiungiDomanda(
  env: Env,
  ctx: { clienteId: string; studioId: string },
  domanda: string,
  motivo: string,
): Promise<void> {
  // Stessa domanda già aperta: non si duplica.
  const gia = await env.DB.prepare(
    `SELECT 1 AS c FROM questions WHERE client_id = ? AND status = 'aperta' AND question = ?`,
  )
    .bind(ctx.clienteId, domanda)
    .first<{ c: number }>();
  if (gia) return;

  await env.DB.prepare(
    `INSERT INTO questions (id, client_id, nutritionist_id, at, question, reason, status)
     VALUES (?, ?, ?, ?, ?, ?, 'aperta')`,
  )
    .bind(nuovoId('dom'), ctx.clienteId, ctx.studioId, oraISO(), domanda, motivo)
    .run();
}

const SELECT_DOMANDA = `
  SELECT q.id, q.client_id, q.at, q.question, q.reason, q.status, q.answer,
         u.name AS client_name, u.email AS client_email
    FROM questions q JOIN users u ON u.id = q.client_id`;

interface RigaDomandaSql {
  id: string;
  client_id: string;
  at: string;
  question: string;
  reason: string;
  status: 'aperta' | 'chiusa';
  answer: string | null;
  client_name: string;
  client_email: string;
}

const daRigaDomanda = (r: RigaDomandaSql): DomandaRiga => ({
  id: r.id,
  clienteId: r.client_id,
  clienteNome: r.client_name,
  clienteEmail: r.client_email,
  at: r.at,
  domanda: r.question,
  motivo: r.reason,
  stato: r.status,
  risposta: r.answer,
});

export async function domandeDelloStudio(
  env: Env,
  studioId: string,
  soloAperte = false,
): Promise<DomandaRiga[]> {
  const { results } = await env.DB.prepare(
    `${SELECT_DOMANDA} WHERE q.nutritionist_id = ?${soloAperte ? ` AND q.status = 'aperta'` : ''}
      ORDER BY q.at DESC LIMIT 100`,
  )
    .bind(studioId)
    .all<RigaDomandaSql>();

  return results.map(daRigaDomanda);
}

export async function domandeDelCliente(env: Env, clienteId: string): Promise<DomandaRiga[]> {
  const { results } = await env.DB.prepare(
    `${SELECT_DOMANDA} WHERE q.client_id = ? ORDER BY q.at DESC LIMIT 40`,
  )
    .bind(clienteId)
    .all<RigaDomandaSql>();

  return results.map(daRigaDomanda);
}

export async function rispondiDomanda(
  env: Env,
  studioId: string,
  id: string,
  risposta: string,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE questions SET status = 'chiusa', answer = ?, answered_at = ?
      WHERE id = ? AND nutritionist_id = ?`,
  )
    .bind(risposta, oraISO(), id, studioId)
    .run();
}

// Messaggi

export type Autore = 'cliente' | 'studio' | 'assistente';

export interface Messaggio {
  id: string;
  clienteId: string;
  at: string;
  autore: Autore;
  testo: string;
  /** Chi lo riceve l'ha già letto. */
  letto: boolean;
}

/** Scrive un messaggio nel filo, anche quelli dell'assistente. */
export async function scriviMessaggio(
  env: Env,
  ctx: { clienteId: string; studioId: string },
  autore: Autore,
  testo: string,
): Promise<Messaggio> {
  const id = nuovoId('msg');
  const at = oraISO();

  await env.DB.prepare(
    `INSERT INTO messages (id, client_id, nutritionist_id, at, author, body, read_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL)`,
  )
    .bind(id, ctx.clienteId, ctx.studioId, at, autore, testo)
    .run();

  return { id, clienteId: ctx.clienteId, at, autore, testo, letto: false };
}

interface RigaMessaggio {
  id: string;
  client_id: string;
  at: string;
  author: Autore;
  body: string;
  read_at: string | null;
}

const daRigaMessaggio = (r: RigaMessaggio): Messaggio => ({
  id: r.id,
  clienteId: r.client_id,
  at: r.at,
  autore: r.author,
  testo: r.body,
  letto: r.read_at !== null,
});

/** Il filo di un cliente, dal più vecchio. Filtra su cliente e studio. */
export async function filoMessaggi(
  env: Env,
  clienteId: string,
  studioId: string,
  limite = 100,
): Promise<Messaggio[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, client_id, at, author, body, read_at FROM messages
      WHERE client_id = ? AND nutritionist_id = ?
      ORDER BY at DESC LIMIT ?`,
  )
    .bind(clienteId, studioId, Math.min(limite, 200))
    .all<RigaMessaggio>();

  return results.map(daRigaMessaggio).reverse();
}

/** Segna come letti i messaggi scritti dall'altra parte. */
export async function segnaMessaggiLetti(
  env: Env,
  clienteId: string,
  studioId: string,
  chiLegge: 'cliente' | 'studio',
): Promise<void> {
  const autori = chiLegge === 'cliente' ? `('studio', 'assistente')` : `('cliente')`;

  await env.DB.prepare(
    `UPDATE messages SET read_at = ?
      WHERE client_id = ? AND nutritionist_id = ? AND read_at IS NULL
        AND author IN ${autori}`,
  )
    .bind(oraISO(), clienteId, studioId)
    .run();
}

/** Quanti messaggi dei clienti aspettano una risposta, per cliente. */
export async function messaggiDaLeggere(
  env: Env,
  studioId: string,
): Promise<Map<string, number>> {
  const { results } = await env.DB.prepare(
    `SELECT client_id, COUNT(*) AS n FROM messages
      WHERE nutritionist_id = ? AND author = 'cliente' AND read_at IS NULL
      GROUP BY client_id`,
  )
    .bind(studioId)
    .all<{ client_id: string; n: number }>();

  return new Map(results.map((r) => [r.client_id, r.n]));
}

/** Quanti messaggi non letti ha il cliente, per il pallino sulla linguetta. */
export async function messaggiNonLettiDelCliente(
  env: Env,
  clienteId: string,
  studioId: string,
): Promise<number> {
  const riga = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM messages
      WHERE client_id = ? AND nutritionist_id = ? AND read_at IS NULL
        AND author IN ('studio', 'assistente')`,
  )
    .bind(clienteId, studioId)
    .first<{ n: number }>();

  return riga?.n ?? 0;
}

/** Un identificativo nuovo, per chi crea diete e pasti. */
export { nuovoId };

// Passi

export async function salvaPassi(
  env: Env,
  clienteId: string,
  giorno: string,
  passi: number,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO steps (client_id, day, steps, at) VALUES (?, ?, ?, ?)
     ON CONFLICT(client_id, day) DO UPDATE SET steps = excluded.steps, at = excluded.at`,
  )
    .bind(clienteId, giorno, Math.max(0, Math.round(passi)), oraISO())
    .run();
}

/** I passi degli ultimi giorni, dal più recente. */
export async function passiRecenti(
  env: Env,
  clienteId: string,
  quanti = 14,
): Promise<{ giorno: string; passi: number }[]> {
  const { results } = await env.DB.prepare(
    `SELECT day AS giorno, steps AS passi FROM steps
      WHERE client_id = ? ORDER BY day DESC LIMIT ?`,
  )
    .bind(clienteId, quanti)
    .all<{ giorno: string; passi: number }>();
  return results;
}

// Pasti spuntati

export type StatoPasto = 'fatto' | 'saltato' | 'libero';

export async function segnaPasto(
  env: Env,
  clienteId: string,
  giorno: string,
  pastoId: string,
  stato: StatoPasto | null,
): Promise<void> {
  // null toglie la spunta.
  if (stato === null) {
    await env.DB.prepare(
      `DELETE FROM meal_log WHERE client_id = ? AND day = ? AND meal_id = ?`,
    )
      .bind(clienteId, giorno, pastoId)
      .run();
    return;
  }

  await env.DB.prepare(
    `INSERT INTO meal_log (client_id, day, meal_id, state, at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(client_id, day, meal_id) DO UPDATE SET state = excluded.state, at = excluded.at`,
  )
    .bind(clienteId, giorno, pastoId, stato, oraISO())
    .run();
}

export async function pastiDelGiorno(
  env: Env,
  clienteId: string,
  giorno: string,
): Promise<Record<string, StatoPasto>> {
  const { results } = await env.DB.prepare(
    `SELECT meal_id, state FROM meal_log WHERE client_id = ? AND day = ?`,
  )
    .bind(clienteId, giorno)
    .all<{ meal_id: string; state: StatoPasto }>();

  return Object.fromEntries(results.map((r) => [r.meal_id, r.state]));
}

/** Le spunte degli ultimi giorni, per calcolare l'aderenza. */
export async function spunteRecenti(
  env: Env,
  clienteId: string,
  daGiorno: string,
): Promise<{ giorno: string; pastoId: string; stato: StatoPasto }[]> {
  const { results } = await env.DB.prepare(
    `SELECT day AS giorno, meal_id AS pastoId, state AS stato FROM meal_log
      WHERE client_id = ? AND day >= ? ORDER BY day DESC`,
  )
    .bind(clienteId, daGiorno)
    .all<{ giorno: string; pastoId: string; stato: StatoPasto }>();
  return results;
}

// PDF della dieta

export async function salvaPdf(
  env: Env,
  dietaId: string,
  nome: string,
  base64: string,
  dimensione: number,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO diet_files (diet_id, name, content, size, uploaded_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(diet_id) DO UPDATE SET
       name = excluded.name, content = excluded.content,
       size = excluded.size, uploaded_at = excluded.uploaded_at`,
  )
    .bind(dietaId, nome, base64, dimensione, oraISO())
    .run();
}

/** Solo i metadati, senza il contenuto. */
export async function infoPdf(
  env: Env,
  dietaId: string,
): Promise<{ nome: string; dimensione: number; caricatoIl: string } | null> {
  return await env.DB.prepare(
    `SELECT name AS nome, size AS dimensione, uploaded_at AS caricatoIl
       FROM diet_files WHERE diet_id = ?`,
  )
    .bind(dietaId)
    .first<{ nome: string; dimensione: number; caricatoIl: string }>();
}

export async function contenutoPdf(
  env: Env,
  dietaId: string,
): Promise<{ nome: string; base64: string } | null> {
  return await env.DB.prepare(
    `SELECT name AS nome, content AS base64 FROM diet_files WHERE diet_id = ?`,
  )
    .bind(dietaId)
    .first<{ nome: string; base64: string }>();
}

// Scheda clinica

export interface SchedaClinica {
  nascita: string | null;
  sesso: 'F' | 'M' | null;
  altezza: number | null;
  allergie: string;
  patologie: string;
  farmaci: string;
  preferenze: string;
  prossimaVisita: string | null;
  aggiornataIl: string | null;
}

export const SCHEDA_VUOTA: SchedaClinica = {
  nascita: null,
  sesso: null,
  altezza: null,
  allergie: '',
  patologie: '',
  farmaci: '',
  preferenze: '',
  prossimaVisita: null,
  aggiornataIl: null,
};

/** La scheda che questo studio tiene sul cliente; vuota se non l'ha mai scritta. */
export async function schedaClinica(
  env: Env,
  studioId: string,
  clienteId: string,
): Promise<SchedaClinica> {
  const riga = await env.DB.prepare(
    `SELECT birth_date AS nascita, sex AS sesso, height_cm AS altezza, allergies AS allergie,
            conditions AS patologie, medications AS farmaci, preferences AS preferenze,
            next_visit AS prossimaVisita, updated_at AS aggiornataIl
       FROM client_profiles WHERE client_id = ? AND nutritionist_id = ?`,
  )
    .bind(clienteId, studioId)
    .first<SchedaClinica>();
  return riga ?? { ...SCHEDA_VUOTA };
}

/** Le schede di tutti i clienti dello studio, per il cruscotto. */
export async function schedeDelloStudio(
  env: Env,
  studioId: string,
): Promise<Map<string, SchedaClinica>> {
  const { results } = await env.DB.prepare(
    `SELECT client_id AS clienteId, birth_date AS nascita, sex AS sesso, height_cm AS altezza,
            allergies AS allergie, conditions AS patologie, medications AS farmaci,
            preferences AS preferenze, next_visit AS prossimaVisita, updated_at AS aggiornataIl
       FROM client_profiles WHERE nutritionist_id = ?`,
  )
    .bind(studioId)
    .all<SchedaClinica & { clienteId: string }>();
  return new Map(results.map(({ clienteId, ...s }) => [clienteId, s]));
}

export async function salvaSchedaClinica(
  env: Env,
  studioId: string,
  clienteId: string,
  s: Omit<SchedaClinica, 'aggiornataIl'>,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO client_profiles
       (client_id, nutritionist_id, birth_date, sex, height_cm, allergies, conditions,
        medications, preferences, next_visit, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(client_id, nutritionist_id) DO UPDATE SET
       birth_date = excluded.birth_date, sex = excluded.sex, height_cm = excluded.height_cm,
       allergies = excluded.allergies, conditions = excluded.conditions,
       medications = excluded.medications, preferences = excluded.preferences,
       next_visit = excluded.next_visit, updated_at = excluded.updated_at`,
  )
    .bind(
      clienteId,
      studioId,
      s.nascita,
      s.sesso,
      s.altezza,
      s.allergie,
      s.patologie,
      s.farmaci,
      s.preferenze,
      s.prossimaVisita,
      oraISO(),
    )
    .run();
}

// Peso e misure

export interface Misura {
  giorno: string;
  peso: number | null;
  vita: number | null;
  fianchi: number | null;
  grasso: number | null;
  autore: 'cliente' | 'studio';
}

/** Scrive le misure di un giorno; i campi assenti restano quelli già scritti. */
export async function salvaMisura(
  env: Env,
  clienteId: string,
  m: Misura,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO measurements (client_id, day, weight, waist, hips, body_fat, author, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(client_id, day) DO UPDATE SET
       weight = COALESCE(excluded.weight, weight),
       waist = COALESCE(excluded.waist, waist),
       hips = COALESCE(excluded.hips, hips),
       body_fat = COALESCE(excluded.body_fat, body_fat),
       author = excluded.author, at = excluded.at`,
  )
    .bind(clienteId, m.giorno, m.peso, m.vita, m.fianchi, m.grasso, m.autore, oraISO())
    .run();
}

/** Le misure dalla più vecchia, per i grafici. */
export async function misure(env: Env, clienteId: string, quante = 60): Promise<Misura[]> {
  const { results } = await env.DB.prepare(
    `SELECT day AS giorno, weight AS peso, waist AS vita, hips AS fianchi,
            body_fat AS grasso, author AS autore
       FROM measurements WHERE client_id = ? ORDER BY day DESC LIMIT ?`,
  )
    .bind(clienteId, quante)
    .all<Misura>();
  return results.reverse();
}

export async function eliminaMisura(env: Env, clienteId: string, giorno: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM measurements WHERE client_id = ? AND day = ?`)
    .bind(clienteId, giorno)
    .run();
}

// Note private dello studio

export interface Nota {
  id: string;
  at: string;
  testo: string;
}

export async function scriviNota(
  env: Env,
  studioId: string,
  clienteId: string,
  testo: string,
): Promise<Nota> {
  const nota = { id: nuovoId('not'), at: oraISO(), testo };
  await env.DB.prepare(
    `INSERT INTO notes (id, client_id, nutritionist_id, at, body) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(nota.id, clienteId, studioId, nota.at, testo)
    .run();
  return nota;
}

export async function noteDelCliente(
  env: Env,
  studioId: string,
  clienteId: string,
): Promise<Nota[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, at, body AS testo FROM notes
      WHERE client_id = ? AND nutritionist_id = ? ORDER BY at DESC LIMIT 100`,
  )
    .bind(clienteId, studioId)
    .all<Nota>();
  return results;
}

export async function eliminaNota(env: Env, studioId: string, id: string): Promise<boolean> {
  const r = await env.DB.prepare(`DELETE FROM notes WHERE id = ? AND nutritionist_id = ?`)
    .bind(id, studioId)
    .run();
  return (r.meta.changes ?? 0) > 0;
}

// Acqua

export async function salvaAcqua(
  env: Env,
  clienteId: string,
  giorno: string,
  ml: number,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO water (client_id, day, ml, at) VALUES (?, ?, ?, ?)
     ON CONFLICT(client_id, day) DO UPDATE SET ml = excluded.ml, at = excluded.at`,
  )
    .bind(clienteId, giorno, Math.max(0, Math.round(ml)), oraISO())
    .run();
}

/** L'acqua degli ultimi giorni, dal più recente. */
export async function acquaRecente(
  env: Env,
  clienteId: string,
  quanti = 14,
): Promise<{ giorno: string; ml: number }[]> {
  const { results } = await env.DB.prepare(
    `SELECT day AS giorno, ml FROM water WHERE client_id = ? ORDER BY day DESC LIMIT ?`,
  )
    .bind(clienteId, quanti)
    .all<{ giorno: string; ml: number }>();
  return results;
}

/** Tutte le diete dello studio, per partire da una esistente. */
export async function dieteDelloStudio(
  env: Env,
  studioId: string,
): Promise<{ id: string; clienteId: string; titolo: string; stato: string; clienteNome: string; clienteEmail: string; aggiornataIl: string }[]> {
  const { results } = await env.DB.prepare(
    `SELECT d.id, d.client_id AS clienteId, d.title AS titolo, d.status AS stato, u.name AS clienteNome,
            u.email AS clienteEmail, d.updated_at AS aggiornataIl
       FROM diets d JOIN users u ON u.id = d.client_id
      WHERE d.nutritionist_id = ? ORDER BY d.updated_at DESC LIMIT 100`,
  )
    .bind(studioId)
    .all<{ id: string; clienteId: string; titolo: string; stato: string; clienteNome: string; clienteEmail: string; aggiornataIl: string }>();
  return results;
}

/** L'obiettivo che il cliente ha scritto nel suo profilo. */
export async function obiettivoDelCliente(env: Env, clienteId: string): Promise<string | null> {
  const r = await env.DB.prepare(`SELECT goal FROM users WHERE id = ?`)
    .bind(clienteId)
    .first<{ goal: string | null }>();
  return r?.goal ?? null;
}

/** L'ultimo messaggio di ogni conversazione dello studio, dalla più recente. */
export async function ultimiMessaggi(
  env: Env,
  studioId: string,
): Promise<{ clienteId: string; at: string; autore: Autore; testo: string }[]> {
  const { results } = await env.DB.prepare(
    `SELECT m.client_id AS clienteId, m.at, m.author AS autore, m.body AS testo
       FROM messages m
      WHERE m.nutritionist_id = ?
        AND m.at = (SELECT MAX(at) FROM messages
                     WHERE client_id = m.client_id AND nutritionist_id = m.nutritionist_id)
      ORDER BY m.at DESC`,
  )
    .bind(studioId)
    .all<{ clienteId: string; at: string; autore: Autore; testo: string }>();
  return results;
}
