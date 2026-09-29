import { $, invia } from '/comune.js';

let ruolo = 'cliente';

for (const bottone of $('ruoli').querySelectorAll('.ruolo')) {
  bottone.addEventListener('click', () => {
    ruolo = bottone.dataset.ruolo;
    for (const b of $('ruoli').querySelectorAll('.ruolo')) {
      b.setAttribute('aria-pressed', String(b === bottone));
    }
  });
}

function mostraErrore(messaggio) {
  $('errore-testo').textContent = messaggio;
  $('errore').hidden = false;
}

$('form').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  $('errore').hidden = true;

  const email = $('email').value.trim();
  const password = $('password').value;

  if (!email || !password) {
    mostraErrore('Servono email e password.');
    return;
  }

  $('invia').disabled = true;
  $('invia').textContent = 'Un momento…';

  try {
    const esito = await invia('/api/registrati', { email, password, ruolo });
    window.location.href = esito.pagina;
  } catch (e) {
    mostraErrore(e.message);
    $('invia').disabled = false;
    $('invia').textContent = "Crea l'account";
  }
});

$('email').focus();
