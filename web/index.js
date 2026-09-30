import { $, esc, invia, leggi } from '/comune.js';

function mostraErrore(messaggio) {
  $('errore-testo').textContent = messaggio;
  $('errore').hidden = false;
}

function riga(a, attuale) {
  const suo = attuale?.email === a.email;
  return (
    `<div class="riga"><div class="corpo">` +
    `<div class="titolo">${esc(a.nome || a.email.split('@')[0])}` +
    (suo ? ` <span class="tag ok">sei dentro</span>` : '') +
    `</div><div class="piccolo muto">${esc(a.email)}</div></div>` +
    (a.ruolo
      ? `<button class="btn mini" data-entra="${esc(a.email)}">${suo ? 'Apri' : 'Entra'}</button>`
      : `<span class="tag">non esiste</span>`) +
    `</div>`
  );
}

async function disegna() {
  let dati;
  try {
    dati = await leggi('/api/demo');
  } catch {
    // Demo non attiva: si va all'accesso normale.
    window.location.href = '/accedi';
    return;
  }

  if (dati.attuale) {
    $('attuale').textContent = `Ora sei dentro come ${dati.attuale.email}. Scegli un altro account per cambiare.`;
  }

  // Un account che manca nel database locale finisce fra i clienti, segnato.
  $('nutrizionisti').innerHTML = dati.account
    .filter((a) => a.ruolo === 'nutrizionista')
    .map((a) => riga(a, dati.attuale))
    .join('');
  $('clienti').innerHTML = dati.account
    .filter((a) => a.ruolo !== 'nutrizionista')
    .map((a) => riga(a, dati.attuale))
    .join('');

  for (const b of document.querySelectorAll('[data-entra]')) {
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        const esito = await invia('/api/demo/entra', { email: b.dataset.entra });
        window.location.href = esito.pagina;
      } catch (e) {
        mostraErrore(e.message);
        b.disabled = false;
      }
    });
  }
}

disegna();
