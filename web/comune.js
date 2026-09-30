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

/** Escape di ogni testo che finisce in `innerHTML`. */
export const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

/* Chiamate */

// Solo `sessione-scaduta` riporta all'accesso: anche la password errata è 401.
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

/* Presentazione dei numeri */

export const arrotonda = (n) => Math.round(Number(n) * 10) / 10;

/** Scostamento calorico, con il segno sempre esplicito. */
export function delta(kcal, parziale = false) {
  const n = Math.round(Number(kcal) || 0);
  const verso = n > 0 ? 'su' : n < 0 ? 'giu' : 'pari';
  return (
    `<span class="delta ${verso}${parziale ? ' parziale' : ''}">` +
    `${n > 0 ? '+' : ''}${n} kcal</span>`
  );
}

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

/* Cambio password */

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
      // Il server ha rinnovato la sessione: si ricarica la pagina.
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

/* Avvio comune */

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
  menuAccount(io);
  return io;
}

/** Il nome in alto apre un menu con l'uscita, per cambiare account. */
function menuAccount(io) {
  for (const chi of document.querySelectorAll('.barra .chi')) {
    chi.classList.add('cliccabile');
    chi.setAttribute('role', 'button');
    chi.setAttribute('tabindex', '0');
    chi.setAttribute('aria-haspopup', 'true');
    chi.setAttribute('aria-expanded', 'false');
    chi.title = 'Il tuo account';

    const menu = document.createElement('div');
    menu.className = 'menu-account';
    menu.hidden = true;
    menu.innerHTML =
      `<div class="piccolo muto">Hai fatto l'accesso come</div>` +
      `<div class="menu-email">${esc(io.email)}</div>` +
      `<div class="piccolo muto">${io.ruolo === 'nutrizionista' ? 'Nutrizionista' : 'Cliente'}</div>` +
      `<button class="btn mini pericolo" type="button">Esci e cambia account</button>`;
    chi.closest('.barra').appendChild(menu);
    menu.querySelector('button').addEventListener('click', esci);

    const chiudi = () => {
      menu.hidden = true;
      chi.setAttribute('aria-expanded', 'false');
    };
    const alterna = () => {
      menu.hidden = !menu.hidden;
      chi.setAttribute('aria-expanded', String(!menu.hidden));
      if (!menu.hidden) menu.querySelector('button').focus();
    };

    chi.addEventListener('click', (e) => {
      e.stopPropagation();
      alterna();
    });
    chi.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        alterna();
      }
    });
    document.addEventListener('click', (e) => {
      if (!menu.contains(e.target)) chiudi();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') chiudi();
    });
  }
}
