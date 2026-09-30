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

  // Lo stesso controllo del server, per dire subito cosa non va.
  if (!email) return mostraErrore('Scrivi la tua email.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return mostraErrore('L’email non sembra scritta bene: controlla che ci sia la @ e il dominio (es. nome@gmail.com).');
  }
  if (!password) return mostraErrore('Scegli una password.');
  if (password.length < 10) return mostraErrore('La password deve avere almeno 10 caratteri.');

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
