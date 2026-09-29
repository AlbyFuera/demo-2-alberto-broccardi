import { nomeDi } from './types.ts';

/** Sostituisce `clienteNome` con qualcosa di leggibile, quando è vuoto. */
export function conNome<T extends { clienteNome: string; clienteEmail: string }>(riga: T): T {
  return { ...riga, clienteNome: nomeDi({ nome: riga.clienteNome, email: riga.clienteEmail }) };
}
