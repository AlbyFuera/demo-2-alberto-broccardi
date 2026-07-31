/**
 * Accesso.
 *
 * La destinazione la decide il SERVER: la risposta contiene la pagina che
 * spetta al ruolo. Il browser non sceglie e non sa scegliere — se decidesse
 * qui, cambiare una riga di JavaScript basterebbe a chiedere la dashboard
 * dello studio.
 */

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

      // Se il limite dei tentativi è scattato, non si invita a riprovare
      // subito: il campo resta com'è e il bottone spento. Riproporre il cursore
      // sulla password significherebbe far battere altri tentativi che il
      // server rifiuterà comunque.
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
    // Il bottone resta spento solo quando il server ha detto di aspettare: il
    // `finally` gira sempre, quindi la condizione va messa qui e non nel ramo.
    $('invia').disabled = bloccato;
    $('invia').textContent = bloccato ? 'Riprova più tardi' : 'Entra';
  }
});

$('email').focus();
