/**
 * Quel poco che studio e cliente condividono davvero.
 *
 * Non è una libreria: sono le quattro cose che, scritte due volte, prima o poi
 * divergono — l'escape dell'HTML, la lettura degli errori dell'API, il cambio
 * password obbligatorio e il modo di scrivere uno scostamento calorico.
 *
 * Tutto il resto resta separato di proposito. Lo studio e il cliente non sono
 * due viste dello stesso schermo: sono due prodotti che condividono un server.
 */

export const $ = (id) => document.getElementById(id);

export const GIORNI = [
  'Lunedì',
  'Martedì',
  'Mercoledì',
  'Giovedì',
  'Venerdì',
  'Sabato',
  'Domenica',
];

export const oggiIndice = () => (new Date().getDay() + 6) % 7;

/**
 * Escape di ogni testo che finisce in `innerHTML`.
 *
 * Nomi di alimenti, note del professionista e domande dei clienti sono testo
 * libero scritto da qualcun altro: passano tutti di qui. Non è teorico — il
 * nome di un cliente arriva dal modulo di un altro utente.
 */
export const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

/* ------------------------------------------------------------------ */
/* Chiamate                                                            */
/* ------------------------------------------------------------------ */

/**
 * Una chiamata all'API.
 *
 * Il messaggio d'errore del server arriva all'utente così com'è: è scritto in
 * italiano per essere letto («Il tuo nutrizionista non ti ha ancora assegnato
 * un piano»), e sostituirlo con un generico "errore" butterebbe via l'unica
 * informazione utile.
 *
 * Il ritorno all'accesso avviene solo sul codice `sessione-scaduta`, non su
 * ogni 401: «la password attuale non è corretta» è anch'essa un 401, e
 * buttare fuori chi ha solo sbagliato a digitare sarebbe assurdo.
 */
async function chiamata(percorso, opzioni) {
  let risposta;
  try {
    risposta = await fetch(percorso, opzioni);
  } catch {
    throw new Error('Connessione non disponibile. Riprova tra un momento.');
  }

  const dati = await risposta.json().catch(() => ({}));

  if (!risposta.ok) {
    if (dati.codice === 'sessione-scaduta') {
      window.location.href = '/';
    }
    throw new Error(dati.errore ?? 'Errore imprevisto.');
  }
  return dati;
}

export const leggi = (percorso, params) =>
  chiamata(params ? `${percorso}?${params}` : percorso);

export const invia = (percorso, corpo) =>
  chiamata(percorso, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo ?? {}),
  });

export const chiSono = () => leggi('/api/chi-sono');

export async function esci() {
  await invia('/api/esci').catch(() => {});
  window.location.href = '/';
}

/* ------------------------------------------------------------------ */
/* Presentazione dei numeri                                            */
/* ------------------------------------------------------------------ */

export const arrotonda = (n) => Math.round(Number(n) * 10) / 10;

/**
 * Lo scostamento calorico, con il segno sempre esplicito.
 *
 * `parziale` non è un dettaglio: quando la composizione di un alimento non è
 * nota il conto è una stima, e presentarla come esatta è il modo più veloce di
 * perdere la fiducia di chi il piano lo firma. La tilde lo dichiara sempre.
 */
export function delta(kcal, parziale = false) {
  const n = Math.round(Number(kcal) || 0);
  const verso = n > 0 ? 'su' : n < 0 ? 'giu' : 'pari';
  return (
    `<span class="delta ${verso}${parziale ? ' parziale' : ''}">` +
    `${n > 0 ? '+' : ''}${n} kcal</span>`
  );
}

/** "3 minuti fa", "ieri", "12 marzo": la precisione che serve, non di più. */
export function quando(iso) {
  if (!iso) return '—';
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '—';

  const minuti = Math.round((Date.now() - data.getTime()) / 60000);
  if (minuti < 1) return 'adesso';
  if (minuti < 60) return `${minuti} min fa`;
  if (minuti < 60 * 24) return `${Math.round(minuti / 60)} h fa`;
  if (minuti < 60 * 24 * 2) return 'ieri';

  return data.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });
}

export function vuoto(segno, titolo, spiegazione = '') {
  return (
    `<div class="vuoto"><p class="grande">${esc(segno)}</p><p>${esc(titolo)}</p>` +
    (spiegazione ? `<p class="piccolo muto">${esc(spiegazione)}</p>` : '') +
    `</div>`
  );
}

/* ------------------------------------------------------------------ */
/* Cambio password                                                     */
/* ------------------------------------------------------------------ */

/**
 * Cambio password.
 *
 * Ogni utente sceglie la propria all'iscrizione, quindi non esiste più un
 * cambio obbligatorio al primo accesso: `obbligatorio` resta per il caso in cui
 * servisse forzarlo (una password compromessa), e in quel caso il pannello NON
 * si chiude — nessuna schermata dietro deve essere raggiungibile prima.
 */
export function apriCambioPassword(obbligatorio = false) {
  if ($('cambio-pw')) return;

  const velo = document.createElement('div');
  velo.className = 'velo';
  velo.id = 'cambio-pw';

  velo.innerHTML =
    `<div class="centrata">` +
    `<div class="scheda accesso">` +
    `<h1>Cambia password</h1>` +
    `<p class="muto piccolo sotto-molto">` +
    `Cambiandola verranno chiusi tutti gli altri accessi aperti.` +
    `</p>` +
    `<div class="avviso grave sotto" id="cpw-errore" hidden>` +
    `<span class="segno" aria-hidden="true">!</span><span id="cpw-errore-testo"></span></div>` +
    `<form id="cpw-form" novalidate>` +
    `<label><span>Password attuale</span>` +
    `<input id="cpw-attuale" type="password" autocomplete="current-password" required></label>` +
    `<label><span>Nuova password <span class="aiuto">almeno 10 caratteri</span></span>` +
    `<input id="cpw-nuova" type="password" autocomplete="new-password" required></label>` +
    `<button class="btn larga" id="cpw-invia" type="submit">Salva</button>` +
    (obbligatorio
      ? ''
      : `<button class="btn neutra larga sopra" id="cpw-annulla" type="button">Annulla</button>`) +
    `</form></div></div>`;

  document.body.appendChild(velo);
  $('cpw-attuale').focus();

  const errore = (messaggio) => {
    $('cpw-errore-testo').textContent = messaggio;
    $('cpw-errore').hidden = false;
  };

  $('cpw-form').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    $('cpw-errore').hidden = true;
    $('cpw-invia').disabled = true;

    try {
      await invia('/api/cambia-password', {
        attuale: $('cpw-attuale').value,
        nuova: $('cpw-nuova').value,
      });
      // Il server ha chiuso ogni sessione e ne ha aperta una nuova: si ricarica
      // per ripartire con quella, senza stati residui in memoria.
      window.location.reload();
    } catch (e) {
      errore(e.message);
      $('cpw-invia').disabled = false;
    }
  });

  if (!obbligatorio) {
    $('cpw-annulla').addEventListener('click', () => velo.remove());
  }
}

/* ------------------------------------------------------------------ */
/* Avvio comune                                                        */
/* ------------------------------------------------------------------ */

/**
 * Chi sta guardando la pagina, con i controlli che non si possono dimenticare.
 *
 * Il server già rifiuta un cliente su /studio e un professionista su /cliente:
 * questo è il secondo controllo, quello che evita di disegnare mezza schermata
 * prima di accorgersene.
 */
export async function avvia(ruoloAtteso) {
  const io = await chiSono();

  if (!io.autenticato) {
    window.location.href = '/';
    return null;
  }
  if (io.ruolo !== ruoloAtteso) {
    window.location.href = io.pagina;
    return null;
  }
  return io;
}
