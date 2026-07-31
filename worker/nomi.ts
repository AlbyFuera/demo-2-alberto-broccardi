/**
 * Il nome da mostrare, quando il nome non c'è.
 *
 * All'iscrizione si danno solo email e password: il nome si mette dalle
 * impostazioni, e c'è un intervallo — spesso il primo giorno — in cui non è
 * ancora stato messo. In quell'intervallo il professionista deve comunque poter
 * riconoscere chi ha davanti, e una riga di notifica con il nome vuoto non
 * serve a niente.
 *
 * La parte locale dell'email è il ripiego meno peggio: la sceglie la persona,
 * la riconosce, e non è un identificativo interno.
 */

import { nomeDi } from './types.ts';

/** Sostituisce `clienteNome` con qualcosa di leggibile, quando è vuoto. */
export function conNome<T extends { clienteNome: string; clienteEmail: string }>(riga: T): T {
  return { ...riga, clienteNome: nomeDi({ nome: riga.clienteNome, email: riga.clienteEmail }) };
}
