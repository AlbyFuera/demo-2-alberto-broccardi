export type Ruolo = 'nutrizionista' | 'cliente';

export interface Env {
  /** Database D1. */
  DB: D1Database;
  /** Workers AI. Se manca, l'assistente resta deterministico. */
  AI?: Ai;
  /** Modello da usare, per poterlo cambiare senza toccare il codice. */
  MODELLO_AI?: string;
  ASSETS?: Fetcher;
  /**
   * Solo in locale, da .dev.vars: email degli account demo separate da virgola.
   * Attiva la pagina di scelta account su localhost. Mai in produzione.
   */
  ACCOUNT_DEMO?: string;
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
