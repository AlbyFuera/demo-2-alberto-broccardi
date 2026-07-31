/**
 * Tipi del livello Cloudflare.
 *
 * Restano separati da `src/types.ts`: quello descrive una dieta e non deve
 * sapere che esistono utenti, sessioni o database. Il motore è portabile e
 * testabile senza un database proprio perché non conosce nulla di tutto questo.
 */

export type Ruolo = 'nutrizionista' | 'cliente';

export interface Env {
  /** Database D1. */
  DB: D1Database;
  /**
   * Workers AI. La quota gratuita del piano Free copre l'uso di uno studio
   * senza carta di credito; se il binding manca, l'assistente resta
   * deterministico invece di spegnersi.
   */
  AI?: Ai;
  /** Modello da usare, per poterlo cambiare senza toccare il codice. */
  MODELLO_AI?: string;
  ASSETS?: Fetcher;
}

export interface Utente {
  id: string;
  email: string;
  ruolo: Ruolo;
  /** Vuoto finché non lo mette dalle impostazioni. */
  nome: string;
  /** Obiettivo dichiarato, per i clienti. */
  obiettivo: string | null;
}

/** Il nome da mostrare quando l'utente non l'ha ancora messo. */
export const nomeDi = (u: { nome: string; email: string }): string =>
  u.nome.trim() || u.email.split('@')[0];
