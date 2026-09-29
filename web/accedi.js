const $ = (id) => document.getElementById(id);

function mostraErrore(messaggio) {
  $('errore-testo').textContent = messaggio;
  $('errore').hidden = false;
}

function nascondiErrore() {
  $('errore').hidden = true;
}

$('form').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  nascondiErrore();

  const email = $('email').value.trim();
  const password = $('password').value;

  if (!email || !password) {
    mostraErrore('Inserisci email e password.');
    return;
  }

  $('invia').disabled = true;
  $('invia').textContent = 'Un momento…';
  let bloccato = false;

  try {
    const risposta = await fetch('/api/accedi', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const dati = await risposta.json();

    if (!risposta.ok) {
      mostraErrore(dati.errore ?? 'Accesso non riuscito.');

      if (dati.codice === 'troppi-tentativi') {
        bloccato = true;
        return;
      }

      $('password').value = '';
      $('password').focus();
      return;
    }

    window.location.href = dati.pagina;
  } catch {
    mostraErrore('Connessione non disponibile. Riprova.');
  } finally {
    $('invia').disabled = bloccato;
    $('invia').textContent = bloccato ? 'Riprova più tardi' : 'Entra';
  }
});

$('email').focus();
