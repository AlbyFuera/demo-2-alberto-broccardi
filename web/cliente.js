/**
 * L'applicazione del cliente.
 *
 * La schermata principale è la DASHBOARD: cosa mangi oggi, come stai andando,
 * quanti passi ti mancano. La conversazione è una linguetta, non l'ingresso —
 * si apre quando hai una domanda, e una domanda non ce l'hai tutti i giorni.
 *
 * Due gesti reggono tutto il resto:
 *
 *   la SPUNTA su un pasto  → da lì esce l'aderenza che vede il nutrizionista
 *   il CAMBIO di un pasto  → prende un pasto di un altro giorno della sua dieta
 *
 * Nessun numero viene da questa pagina: arrivano tutti dal server.
 */

import {
  $,
  GIORNI,
  apriCambioPassword,
  avvia,
  delta,
  esc,
  esci,
  invia,
  leggi,
  quando,
  vuoto,
} from '/comune.js';

const stato = {
  io: null,
  situazione: null,
  dati: null,
  scheda: null,
  tab: 'oggi',
  occupato: false,
  filo: [],
  /** L'assistente risponde, oppure risponde il nutrizionista. Lo decide lui. */
  automazione: true,
};

const contenuto = () => $('contenuto');
const arrotonda = (n) => Math.round(Number(n) || 0);

/* ------------------------------------------------------------------ */
/* Primo passo: trovare il proprio nutrizionista                       */
/* ------------------------------------------------------------------ */

function disegnaIngresso() {
  const p = stato.situazione.professionista;
  $('ingresso').hidden = false;
  $('app').hidden = true;

  $('ingresso-nome').textContent = stato.io.nome || 'Il tuo account';
  $('ingresso-email').textContent = stato.io.email;

  if (p?.stato === 'in-attesa') {
    $('primo-passo').innerHTML =
      `<p class="grande" aria-hidden="true">→</p>` +
      `<h1>Richiesta inviata</h1>` +
      `<p class="muto">Hai chiesto a <strong>${esc(p.nome)}</strong> (${esc(p.email)}) ` +
      `di seguirti, ${esc(quando(p.richiestoIl))}. Appena accetta, qui trovi la tua dieta.</p>` +
      `<div class="fila sopra"><button class="btn neutra" id="ritira">Annulla la richiesta</button>` +
      `<button class="btn" id="ricarica">Controlla adesso</button></div>`;

    $('ritira').addEventListener('click', async () => {
      await invia('/api/cliente/scollega', { link: p.linkId });
      inizia();
    });
    $('ricarica').addEventListener('click', () => inizia());
    return;
  }

  $('primo-passo').innerHTML =
    `<p class="grande" aria-hidden="true">+</p>` +
    `<h1>Aggiungi il tuo nutrizionista</h1>` +
    `<p class="muto">Scrivi l'email con cui si è iscritto. Gli arriva una richiesta e, ` +
    `appena la accetta, vedi qui la dieta che ti scrive.</p>` +
    `<form id="form-studio" novalidate>` +
    `<label><span>Email del nutrizionista</span>` +
    `<input id="email-studio" type="email" autocapitalize="none" spellcheck="false" required></label>` +
    `<div id="trovato"></div>` +
    `<button class="btn larga" id="cerca" type="submit">Cerca</button>` +
    `</form>` +
    `<div id="esito-studio" class="esito"></div>`;

  $('form-studio').addEventListener('submit', (e) => {
    e.preventDefault();
    cercaStudio();
  });
  $('email-studio').focus();
}

async function cercaStudio() {
  const email = $('email-studio').value.trim();
  if (!email) return;

  $('cerca').disabled = true;
  $('esito-studio').innerHTML = '';

  try {
    const esito = await leggi('/api/cliente/cerca-studio', new URLSearchParams({ email }));

    if (!esito.trovato) {
      $('trovato').innerHTML = '';
      $('esito-studio').innerHTML =
        `<div class="avviso attenzione"><span class="segno" aria-hidden="true">!</span><span>` +
        `Nessun nutrizionista iscritto con questa email. Controlla che sia quella giusta — ` +
        `deve essersi registrato anche lui.</span></div>`;
      $('cerca').disabled = false;
      $('email-studio').focus();
      $('email-studio').select();
      return;
    }

    const s = esito.studio;
    $('trovato').innerHTML =
      `<div class="avviso ok sotto"><span class="segno" aria-hidden="true">✓</span><span>` +
      `Trovato: <strong>${esc(s.nome)}</strong></span></div>` +
      `<label><span>Due parole per lui <span class="aiuto">facoltativo</span></span>` +
      `<input id="messaggio" type="text" placeholder="Sono Mario, ci siamo visti giovedì."></label>`;

    $('cerca').textContent = 'Manda la richiesta';
    $('cerca').disabled = false;

    // Il bottone cambia mestiere: si sostituisce il gestore invece di
    // aggiungerne uno, o al secondo clic partirebbero due richieste identiche.
    const nuovo = $('cerca').cloneNode(true);
    $('cerca').replaceWith(nuovo);
    nuovo.addEventListener('click', async (e) => {
      e.preventDefault();
      nuovo.disabled = true;
      try {
        await invia('/api/cliente/richiedi', {
          email: s.email,
          messaggio: $('messaggio')?.value.trim() || null,
        });
        inizia();
      } catch (err) {
        $('esito-studio').innerHTML =
          `<div class="avviso grave"><span class="segno" aria-hidden="true">!</span>` +
          `<span>${esc(err.message)}</span></div>`;
        nuovo.disabled = false;
      }
    });
  } catch (e) {
    $('esito-studio').innerHTML =
      `<div class="avviso grave"><span class="segno" aria-hidden="true">!</span>` +
      `<span>${esc(e.message)}</span></div>`;
    $('cerca').disabled = false;
  }
}

/* ------------------------------------------------------------------ */
/* Oggi — la schermata principale                                      */
/* ------------------------------------------------------------------ */

/** Un riquadro con una cifra grande e, se serve, una barra sotto. */
function riquadro(etichetta, cifra, sotto, avanzamento) {
  const barra = avanzamento
    ? `<div class="barra-avanzamento ${avanzamento.tono ?? ''}">` +
      `<i style-width="${avanzamento.percentuale}"></i></div>`
    : '';
  return (
    `<div class="riquadro"><div class="etichetta">${esc(etichetta)}</div>` +
    `<div class="cifra">${esc(cifra)}</div>` +
    (sotto ? `<div class="sotto-cifra">${esc(sotto)}</div>` : '') +
    barra +
    `</div>`
  );
}

function disegnaOggi() {
  const d = stato.dati;
  const o = d.oggi;

  const obiettivoKcal = d.dieta.obiettivi?.kcal ?? o.kcalPreviste;
  const quotaKcal = obiettivoKcal ? Math.min(100, (o.kcalConsumate / obiettivoKcal) * 100) : 0;

  const passiFatti = d.passi.oggi;
  const quotaPassi = d.passi.obiettivo && passiFatti
    ? Math.min(100, (passiFatti / d.passi.obiettivo) * 100)
    : 0;

  const a = d.aderenza;

  const riquadri =
    riquadro(
      'Mangiato oggi',
      `${o.kcalConsumate}`,
      `su ${obiettivoKcal} kcal previste${o.parziale ? ' (conto parziale)' : ''}`,
      { percentuale: quotaKcal },
    ) +
    riquadro(
      'Pasti fatti',
      `${o.pastiFatti}/${o.pastiTotali}`,
      o.pastiSaltati ? `${o.pastiSaltati} saltati` : 'segna quelli che fai',
      { percentuale: o.pastiTotali ? (o.pastiFatti / o.pastiTotali) * 100 : 0 },
    ) +
    riquadro(
      'Passi',
      passiFatti === null ? '—' : `${passiFatti}`,
      d.passi.obiettivo ? `obiettivo ${d.passi.obiettivo}` : 'nessun obiettivo fissato',
      d.passi.obiettivo ? { percentuale: quotaPassi } : null,
    ) +
    riquadro(
      'Giorni di fila',
      d.serie.giorni === 0 ? '—' : `${d.serie.giorni}`,
      d.serie.descrizione,
      null,
    ) +
    riquadro(
      'Stai seguendo la dieta',
      a.percentuale === null ? '—' : `${a.percentuale}%`,
      a.percentuale === null
        ? 'segna i pasti per saperlo'
        : // Quando ha usato le sostituzioni previste glielo si dice qui, sotto
          // il numero: è il posto dove sta guardando quando si chiede se
          // cambiare un alimento gli è costato qualcosa.
          a.pastiConSostituzioniAmmesse
          ? `${a.pastiConSostituzioniAmmesse} pasti cambiati restando nelle sostituzioni previste`
          : a.pastiFuoriPiano
            ? `${a.pastiFuoriPiano} pasti fuori dalle sostituzioni previste`
            : `ultimi ${a.giorniConDati} giorni`,
      a.percentuale === null
        ? null
        : {
            percentuale: a.percentuale,
            tono: a.livello === 'buona' ? '' : a.livello === 'parziale' ? 'attenzione' : 'grave',
          },
    );

  const pasti = o.pasti.length
    ? o.pasti.map(pastoDiOggi).join('')
    : vuoto('—', `${o.nome} il tuo nutrizionista non ha scritto nulla`);

  contenuto().innerHTML =
    `<div class="sezione-testa"><h2>${esc(o.nome)}</h2>` +
    (o.allenamento ? `<span class="tag ok">allenamento</span>` : '') +
    `<button class="btn mini neutra spinge" id="segna-passi">Segna i passi</button></div>` +
    `<div class="riquadri">${riquadri}</div>` +
    (o.nota ? `<div class="avviso neutro sotto"><span class="segno" aria-hidden="true">i</span><span>${esc(o.nota)}</span></div>` : '') +
    `<div class="pila">${pasti}</div>`;

  // Le larghezze delle barre non stanno negli attributi `style` — la
  // Content-Security-Policy li ignora — quindi si mettono qui.
  for (const i of contenuto().querySelectorAll('.barra-avanzamento i')) {
    i.style.width = `${Math.max(0, Math.min(100, Number(i.getAttribute('style-width')) || 0))}%`;
  }

  $('segna-passi').addEventListener('click', apriPassi);
  collegaPasti();
}

function pastoDiOggi(p) {
  const fatto = p.stato === 'fatto';
  const saltato = p.stato === 'saltato';

  /*
   * Ogni alimento è toccabile, ed è il gesto principale del prodotto: «questo
   * non lo mangio, cosa ci metto?». Quelli per cui il nutrizionista ha scritto
   * delle sostituzioni si vedono da fuori — bordo pieno e il simbolo ⇄ — perché
   * lì la risposta è già pronta e non costa niente all'aderenza.
   */
  const alimenti = p.alimenti
    .map(
      (a) =>
        `<button class="alimento-scelta${a.piano ? ' con-piano' : ''}" ` +
        `data-slot="${esc(p.id)}.${a.indice}" ` +
        `title="${a.piano ? `Scegli la tua ${esc(a.piano.gruppo)}` : 'Cambia questo alimento'}">` +
        `<span>${esc(a.nome)}</span><span class="peso">${esc(a.quantita)}</span>` +
        `<span class="segno" aria-hidden="true">⇄</span></button>`,
    )
    .join('');

  return (
    `<div class="pasto-oggi ${fatto ? 'fatto' : saltato ? 'saltato' : ''}">` +
    `<button class="spunta" data-spunta="${esc(p.id)}" aria-pressed="${fatto}" ` +
    `title="${fatto ? 'Fatto' : 'Segna come fatto'}">✓</button>` +
    `<div><div class="nome-pasto-oggi">${esc(p.nome)}` +
    (p.orario ? ` <span class="muto piccolo">${esc(p.orario)}</span>` : '') +
    `</div><div class="dettaglio">${alimenti || 'niente scritto'}</div>` +
    (p.nota ? `<div class="dettaglio">${esc(p.nota)}</div>` : '') +
    `</div>` +
    `<div class="kcal-pasto">${p.parziale ? '≈' : ''}${p.kcal} kcal</div>` +
    `<div class="azioni-pasto">` +
    `<button class="btn mini neutra" data-cambia="${esc(p.id)}">Cambia questo pasto</button>` +
    (saltato
      ? `<button class="btn mini neutra" data-annulla-spunta="${esc(p.id)}">Non l'ho saltato</button>`
      : `<button class="btn mini neutra" data-salta="${esc(p.id)}">L'ho saltato</button>`) +
    `</div></div>`
  );
}

function collegaPasti() {
  for (const el of contenuto().querySelectorAll('[data-slot]')) {
    el.addEventListener('click', () => {
      const [pastoId, indice] = el.dataset.slot.split('.');
      apriScelta(pastoId, Number(indice));
    });
  }
  for (const el of contenuto().querySelectorAll('[data-spunta]')) {
    el.addEventListener('click', () =>
      spunta(el.dataset.spunta, el.getAttribute('aria-pressed') === 'true' ? null : 'fatto'),
    );
  }
  for (const el of contenuto().querySelectorAll('[data-salta]')) {
    el.addEventListener('click', () => spunta(el.dataset.salta, 'saltato'));
  }
  for (const el of contenuto().querySelectorAll('[data-annulla-spunta]')) {
    el.addEventListener('click', () => spunta(el.dataset.annullaSpunta, null));
  }
  for (const el of contenuto().querySelectorAll('[data-cambia]')) {
    el.addEventListener('click', () => apriCambioPasto(el.dataset.cambia));
  }
}

async function spunta(pastoId, nuovoStato) {
  try {
    await invia('/api/cliente/spunta', { pasto: pastoId, stato: nuovoStato });
    await ricarica();
  } catch (e) {
    avvisa(e.message, 'grave');
  }
}

/* ------------------------------------------------------------------ */
/* Passi                                                               */
/* ------------------------------------------------------------------ */

function apriPassi() {
  const d = stato.dati;
  const massimo = Math.max(d.passi.obiettivo ?? 0, ...d.passi.storico.map((s) => s.passi), 1);

  const barre = d.passi.storico
    .map(
      (s) =>
        `<i class="${d.passi.obiettivo && s.passi >= d.passi.obiettivo ? 'raggiunto' : ''}" ` +
        `style-height="${(s.passi / massimo) * 100}" title="${esc(s.giorno)}: ${s.passi}"></i>`,
    )
    .join('');

  const zona = document.createElement('div');
  zona.className = 'scheda accesso stretto sotto';
  zona.id = 'modulo-passi';
  zona.innerHTML =
    `<h2 class="sotto-poco">Quanti passi hai fatto oggi?</h2>` +
    `<p class="piccolo muto sotto">Leggilo dal telefono — una pagina web non può ` +
    `chiederlo ad Apple Salute da sola.</p>` +
    `<label><span>Passi</span><input id="quanti-passi" type="number" min="0" max="200000" ` +
    `inputmode="numeric" value="${d.passi.oggi ?? ''}" placeholder="8000"></label>` +
    (d.passi.storico.length ? `<div class="barre">${barre}</div>` : '') +
    `<div class="fila sopra"><button class="btn" id="salva-passi">Salva</button>` +
    `<button class="btn neutra" id="chiudi-passi">Chiudi</button></div>`;

  contenuto().prepend(zona);
  for (const i of zona.querySelectorAll('.barre i')) {
    i.style.height = `${Math.max(4, Number(i.getAttribute('style-height')) || 0)}%`;
  }
  $('quanti-passi').focus();

  $('chiudi-passi').addEventListener('click', () => zona.remove());
  $('salva-passi').addEventListener('click', async () => {
    const n = Number($('quanti-passi').value);
    if (!Number.isFinite(n) || n < 0) return;
    $('salva-passi').disabled = true;
    try {
      await invia('/api/cliente/passi', { passi: n });
      await ricarica();
    } catch (e) {
      avvisa(e.message, 'grave');
    }
  });
}

/* ------------------------------------------------------------------ */
/* Scegliere dentro il piano a sostituzione                            */
/* ------------------------------------------------------------------ */

const NOME_BASE = {
  auto: 'come l’ha scritta lui',
  kcal: 'stesse calorie',
  proteine: 'stesse proteine',
  carboidrati: 'stessi carboidrati',
  grassi: 'stessi grassi',
};

/**
 * «Cosa posso mettere al posto di questo?»
 *
 * Due elenchi, e la differenza fra i due è tutto il valore della schermata:
 *
 *   SOPRA   quello che il nutrizionista ha già ammesso, con la porzione
 *           pronta. Sceglierlo non toglie niente all'aderenza, e c'è scritto;
 *   SOTTO   il resto, calcolato. Si può fare, ma è una deviazione, e anche
 *           questo c'è scritto — prima di toccare, non dopo.
 *
 * Chi non ha un piano scritto dal suo professionista vede solo il secondo
 * elenco, che è il prodotto di prima e continua a funzionare uguale.
 */
async function apriScelta(pastoId, indice) {
  const giorno = stato.dati.oggi.indice;
  const zona = document.createElement('div');
  zona.className = 'scheda accesso stretto sotto';
  zona.id = 'scelta-alimento';
  zona.innerHTML = `<p class="muto">Guardo cosa puoi metterci…</p>`;

  const esistente = $('scelta-alimento');
  if (esistente) esistente.remove();
  contenuto().prepend(zona);
  // Il pannello nasce in cima alla schermata e il pasto toccato può essere il
  // quinto: senza questo, chi tocca la cena vede sparire il piatto e comparire
  // niente, e pensa che il tocco non sia servito.
  zona.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

  const parametri = new URLSearchParams({
    giorno: String(giorno),
    pasto: pastoId,
    indice: String(indice),
  });

  try {
    const v = await leggi('/api/cliente/alternative', parametri);
    const p = v.piano;

    /*
     * L'avviso sui valori indicativi vale per tutta la tabella interna, non per
     * la singola scelta: ripeterlo sotto ogni riga lo fa smettere di essere un
     * avviso e diventa sfondo. Si dice una volta, sotto l'elenco.
     */
    const generico = (a) => a.startsWith('Il conto usa valori');
    const indicativi = p.opzioni.some((o) => o.avvisi.some(generico));

    // La prescritta resta nell'elenco: tornare a quello che il nutrizionista
    // aveva scritto deve costare un tocco quanto allontanarsene.
    const previste = p.opzioni
      .map((o) => {
        const suo = o.avvisi.find((a) => !generico(a));
        return (
          `<button class="opzione prevista si${o.scelta ? ' scelta' : ''}" ` +
          `data-scegli="${esc(o.nome)}"${o.scelta || o.quantita === null ? ' disabled' : ''}>` +
          `<span class="marca" aria-hidden="true">${o.scelta ? '✓' : '·'}</span>` +
          `<span><strong>${esc(o.nome)}</strong>` +
          (o.prescritta ? ` <span class="muto piccolo">quello che c’è nella tua dieta</span>` : '') +
          (o.fissata && !o.prescritta
            ? ` <span class="muto piccolo">porzione scritta dal tuo nutrizionista</span>`
            : '') +
          (suo ? `<span class="motivo">${esc(suo)}</span>` : '') +
          `</span>` +
          `<span class="peso">${esc(o.etichetta)}</span></button>`
        );
      })
      .join('');

    const altre = v.proposte
      .map(
        (x) =>
          `<button class="opzione fuori" data-scegli="${esc(x.nome)}" data-fuori="1">` +
          `<span class="marca" aria-hidden="true">·</span>` +
          `<span>${esc(x.nome)}</span>` +
          // Porzione e scostamento in una cella sola: la griglia dell'opzione
          // ha tre colonne, e una quarta cosa finirebbe a capo sotto il nome.
          `<span class="fine"><span class="peso">${esc(x.etichetta)}</span>${delta(x.delta.kcal)}</span>` +
          `</button>`,
      )
      .join('');

    zona.innerHTML =
      `<h2 class="sotto-poco">${esc(p.libero ? `Al posto di ${p.prescritto.nome}` : `La tua ${p.gruppo}`)}</h2>` +
      (p.libero
        ? `<p class="piccolo muto sotto">Per questo alimento il tuo nutrizionista non ha scritto ` +
          `sostituzioni. Puoi comunque cambiarlo, ma vale come una deviazione dalla dieta.</p>`
        : `<p class="piccolo muto sotto">Queste le ha scelte il tuo nutrizionista per te: ` +
          `<strong>scegliere fra queste non fa scendere la tua aderenza</strong>. ` +
          `Le porzioni sono equivalenti — sostituzione ${esc(p.nomeBase)}, ` +
          `${esc(NOME_BASE[p.base] ?? '')}.</p>`) +
      /*
       * Qui c'erano i bottoni per guardare le porzioni isocaloriche o
       * isoproteiche a scelta. Sono stati tolti, e non per fare pulizia: la
       * base è una decisione clinica del nutrizionista, e mostrarla come una
       * scelta — anche solo in lettura — insegnava che si può scegliere.
       * L'unica regola in vigore è la sua, e la riga sopra la nomina.
       */
      (v.regola === 'alimento'
        ? `<p class="piccolo muto sotto">Per questo alimento il tuo nutrizionista ha chiesto ` +
          `una regola diversa dal resto della dieta.</p>`
        : '') +
      previste +
      (indicativi
        ? `<p class="piccolo muto sopra">Le porzioni si basano su valori di composizione ` +
          `indicativi, non confermati dal tuo nutrizionista.</p>`
        : '') +
      (altre
        ? `<h3 class="sotto-poco sopra">Altre, che il tuo nutrizionista non ha previsto qui</h3>` +
          `<p class="piccolo muto sotto">Sono alimenti che stanno nella tua dieta in altri giorni. ` +
          `Puoi sceglierli, ma il pasto conterà a metà nella tua aderenza.</p>` +
          altre
        : '') +
      `<button class="btn neutra sopra" data-chiudi="1">Lascia com'è</button>`;

    zona.querySelector('[data-chiudi]').addEventListener('click', () => zona.remove());

    for (const el of zona.querySelectorAll('[data-scegli]')) {
      el.addEventListener('click', async () => {
        el.disabled = true;
        try {
          // Niente `base` nel corpo: la decide il server leggendo la dieta, e
          // mandargliela da qui sarebbe solo un modo per farsela ignorare.
          await invia('/api/cliente/applica', {
            giorno,
            pasto: pastoId,
            indice,
            alimento: el.dataset.scegli,
          });
          zona.remove();
          await ricarica();
        } catch (e) {
          avvisa(e.message, 'grave');
          el.disabled = false;
        }
      });
    }
  } catch (e) {
    zona.innerHTML =
      `<div class="avviso grave"><span class="segno" aria-hidden="true">!</span>` +
      `<span>${esc(e.message)}</span></div>` +
      `<button class="btn neutra sopra" data-chiudi="1">Chiudi</button>`;
    zona.querySelector('[data-chiudi]').addEventListener('click', () => zona.remove());
  }
}

/* ------------------------------------------------------------------ */
/* Cambiare un pasto intero                                            */
/* ------------------------------------------------------------------ */

/**
 * I pasti proposti vengono dagli altri giorni della sua stessa dieta, entro il
 * 15% di scostamento calorico. Non serve l'approvazione del nutrizionista
 * perché non si sta concedendo niente di nuovo: si sta spostando di giorno un
 * pasto che lui aveva già scritto.
 */
async function apriCambioPasto(pastoId) {
  const giorno = stato.dati.oggi.indice;
  const zona = document.createElement('div');
  zona.className = 'scheda accesso stretto sotto';
  zona.innerHTML = `<p class="muto">Cerco un pasto che vada bene…</p>`;
  contenuto().prepend(zona);

  try {
    const v = await leggi(
      '/api/cliente/cambio-pasto',
      new URLSearchParams({ giorno: String(giorno), pasto: pastoId }),
    );

    if (v.nessuno) {
      zona.innerHTML =
        `<h2 class="sotto-poco">Al posto di ${esc(v.attuale.nome.toLowerCase())}</h2>` +
        `<div class="avviso attenzione"><span class="segno" aria-hidden="true">!</span><span>` +
        `Negli altri giorni della tua dieta non c'è un ${esc(v.attuale.nome.toLowerCase())} ` +
        `abbastanza simile a questo. Puoi però cambiare un singolo alimento: chiedilo ` +
        `all'assistente.</span></div>` +
        `<button class="btn neutra sopra" data-chiudi="1">Chiudi</button>`;
    } else {
      zona.innerHTML =
        `<h2 class="sotto-poco">Al posto di ${esc(v.attuale.nome.toLowerCase())}</h2>` +
        `<p class="piccolo muto sotto">Sono pasti che il tuo nutrizionista ha già scritto per te ` +
        `in altri giorni, con le stesse calorie a meno di poco.</p>` +
        v.alternativi
          .map(
            (x) =>
              `<button class="opzione si" data-scegli="${esc(x.pastoId)}">` +
              `<span class="marca">✓</span><span>` +
              `<strong>${esc(x.giornoNome)}</strong>: ` +
              esc(x.alimenti.map((a) => `${a.nome} ${a.quantita}`).join(', ')) +
              `</span>${delta(x.deltaKcal, x.parziale)}</button>`,
          )
          .join('') +
        `<button class="btn neutra sopra" data-chiudi="1">Lascia com'è</button>`;
    }

    zona.querySelector('[data-chiudi]').addEventListener('click', () => zona.remove());
    for (const el of zona.querySelectorAll('[data-scegli]')) {
      el.addEventListener('click', async () => {
        el.disabled = true;
        try {
          await invia('/api/cliente/applica-cambio', {
            giorno,
            pasto: pastoId,
            verso: el.dataset.scegli,
          });
          await ricarica();
        } catch (e) {
          avvisa(e.message, 'grave');
        }
      });
    }
  } catch (e) {
    zona.innerHTML =
      `<div class="avviso grave"><span class="segno" aria-hidden="true">!</span>` +
      `<span>${esc(e.message)}</span></div>` +
      `<button class="btn neutra sopra" data-chiudi="1">Chiudi</button>`;
    zona.querySelector('[data-chiudi]').addEventListener('click', () => zona.remove());
  }
}

/* ------------------------------------------------------------------ */
/* La settimana                                                        */
/* ------------------------------------------------------------------ */

async function disegnaSettimana() {
  contenuto().innerHTML = `<div class="vuoto"><p class="grande">·</p><p>Caricamento…</p></div>`;
  if (!stato.scheda) stato.scheda = await leggi('/api/cliente/scheda');
  const s = stato.scheda;

  const giorni = s.giorni
    .map((g) => {
      const oggi = g.indice === stato.dati.oggi.indice;
      const pasti = g.pasti.length
        ? g.pasti
            .map(
              (p) =>
                `<div class="pasto"><div class="pasto-nome">${esc(p.nome)}` +
                (p.orario ? ` · ${esc(p.orario)}` : '') +
                ` · ${p.parziale ? '≈' : ''}${p.kcal} kcal</div>` +
                `<div class="alimenti">` +
                p.alimenti
                  .map(
                    (a) =>
                      `<span class="alimento${a.cambiatoDa ? ' cambiato' : ''}"` +
                      (a.cambiatoDa
                        ? ` title="al posto di ${esc(a.cambiatoDa.nome)} ${esc(a.cambiatoDa.quantita)}"`
                        : '') +
                      `><span>${esc(a.nome)}</span>` +
                      `<span class="peso">${esc(a.quantita)}</span></span>`,
                  )
                  .join('') +
                `</div></div>`,
            )
            .join('')
        : `<div class="pasto-nota">niente scritto</div>`;

      return (
        `<article class="giorno${oggi ? ' oggi' : ''}">` +
        `<header class="giorno-testa"><span class="nome">${esc(GIORNI[g.indice])}` +
        `${oggi ? ' · oggi' : ''}</span>` +
        (g.allenamento ? `<span class="tag ok">allenamento</span>` : '') +
        `<span class="tag">${g.parziale ? '≈' : ''}${g.kcal} kcal</span></header>${pasti}</article>`
      );
    })
    .join('');

  contenuto().innerHTML =
    `<div class="riga sotto"><div class="corpo">` +
    `<div class="titolo">${s.settimana.mediaKcal} kcal al giorno</div>` +
    `<div class="piccolo muto">media sui ${s.settimana.giorniScritti} giorni scritti · ` +
    `P ${s.settimana.mediaProteine} · C ${s.settimana.mediaCarboidrati} · G ${s.settimana.mediaGrassi} g` +
    (s.settimana.parziale ? ' · conto parziale' : '') +
    `</div></div></div>` +
    `<div class="pila">${giorni}</div>` +
    `<div class="sezione"><div class="sezione-testa"><h2>La spesa della settimana</h2></div>` +
    `<div class="pila">` +
    s.spesa
      .map(
        (l) =>
          `<div class="riga"><div class="corpo"><div>${esc(l.nome)}</div>` +
          `<div class="piccolo muto">in ${l.ricorrenze} past${l.ricorrenze === 1 ? 'o' : 'i'}</div></div>` +
          `<span class="peso">${
            l.quantita === null
              ? 'q.b.'
              : `${Math.round(l.quantita * 10) / 10}${l.unita === 'pz' ? ' pz' : l.unita}`
          }</span></div>`,
      )
      .join('') +
    `</div></div>`;
}

/* ------------------------------------------------------------------ */
/* Assistente                                                          */
/* ------------------------------------------------------------------ */

/**
 * La conversazione.
 *
 * Chi risponde non lo decide il cliente: lo decide il suo nutrizionista, con un
 * interruttore sulla sua schermata. Qui la differenza si vede subito e sempre —
 * l'intestazione, il segnaposto del campo, l'etichetta sotto ogni bolla — perché
 * scrivere a un modello credendo di scrivere a una persona, o il contrario, è la
 * cosa peggiore che possa succedere in questa pagina.
 *
 * Il filo arriva dal server: la conversazione con il proprio nutrizionista non
 * è una cosa che vive finché la scheda resta aperta.
 */
async function disegnaAssistente() {
  contenuto().innerHTML =
    `<div class="chat-incassata">` +
    `<div class="filo" id="filo"></div>` +
    `<div class="suggerimenti" id="suggerimenti"></div>` +
    `<form class="scrivi" id="scrivi">` +
    `<input id="testo" type="text" placeholder="Scrivi…" autocomplete="off" ` +
    `aria-label="Scrivi un messaggio">` +
    `<button class="btn invia" id="invia" type="submit" aria-label="Invia">↑</button>` +
    `</form></div>`;

  $('scrivi').addEventListener('submit', (e) => {
    e.preventDefault();
    chiedi($('testo').value.trim());
  });

  try {
    const filo = await leggi('/api/cliente/messaggi');
    stato.automazione = filo.automazione;
    stato.filo = filo.messaggi.map((m) => ({
      chi: m.autore === 'cliente' ? 'io' : 'lui',
      html: `<div class="bolla">${esc(m.testo)}</div>` + fonte(m.autore, filo.professionista),
    }));
  } catch {
    // Senza il filo la chat funziona lo stesso: si perde lo storico, non la
    // possibilità di scrivere.
  }

  for (const m of stato.filo) messaggio(m.chi, m.html, false);

  const nome = stato.dati.professionista.nome;

  if (stato.automazione === false) {
    $('testo').placeholder = `Scrivi a ${nome}…`;
    $('suggerimenti').innerHTML =
      `<div class="avviso neutro"><span class="segno" aria-hidden="true">i</span><span>` +
      `Qui scrivi direttamente a <strong>${esc(nome)}</strong>: le risposte automatiche ` +
      `sono spente, la risposta arriva di persona.</span></div>`;
  } else {
    $('testo').placeholder = 'Chiedimi quello che vuoi…';
    const frasi = [
      'Cosa mangio adesso?',
      'Ho saltato il pranzo, come recupero?',
      'Posso bere un bicchiere di vino stasera?',
      'Quante proteine dovrei mangiare?',
      'Sono al ristorante, cosa prendo?',
      'Perché devo bere tanta acqua?',
    ];
    $('suggerimenti').innerHTML = frasi
      .map((t) => `<button class="suggerimento" type="button">${esc(t)}</button>`)
      .join('');
    for (const b of $('suggerimenti').querySelectorAll('.suggerimento')) {
      b.addEventListener('click', () => chiedi(b.textContent));
    }
  }

  if (stato.filo.length === 0) {
    messaggio(
      'lui',
      `<div class="bolla">` +
        (stato.automazione === false
          ? `Ciao. Scrivi pure qui: legge e risponde ${esc(nome)}, di persona.`
          : `Ciao. Chiedimi quello che vuoi sulla tua dieta o sull'alimentazione in generale: ` +
            `ti rispondo come farebbe ${esc(nome)}.`) +
        `</div>` +
        fonte(stato.automazione === false ? 'studio' : 'motore', nome),
    );
  }
}

function messaggio(chi, html, ricorda = true) {
  const el = document.createElement('div');
  el.className = `msg ${chi}`;
  el.innerHTML = html;
  $('filo').appendChild(el);
  $('filo').scrollTop = $('filo').scrollHeight;
  if (ricorda) stato.filo.push({ chi, html });
  return el;
}

/**
 * Chi ha scritto la bolla, sotto la bolla.
 *
 * Quattro casi e tre etichette diverse: quello che scrive il professionista
 * porta il suo nome, quello che scrive il software dice che è software. Non è
 * una finezza: è l'unica cosa che permette al cliente di sapere se quello che
 * sta leggendo è un consiglio clinico o un conto.
 */
const fonte = (f, nomeStudio) => {
  if (f === 'studio') {
    return (
      `<div class="fonte"><span class="bollino">${esc(nomeStudio ?? 'il tuo nutrizionista')}</span>` +
      `<span>scritto di persona</span></div>`
    );
  }
  const ai = f === 'ai' || f === 'assistente';
  return (
    `<div class="fonte"><span class="bollino${ai ? ' ai' : ''}">` +
    `${ai ? 'assistente' : 'motore'}</span>` +
    `<span>i numeri della tua dieta vengono dal tuo nutrizionista</span></div>`
  );
};

async function chiedi(testo) {
  if (stato.occupato || !testo.trim()) return;
  stato.occupato = true;
  $('invia').disabled = true;
  $('testo').disabled = true;

  messaggio('io', `<div class="bolla">${esc(testo)}</div>`);
  $('testo').value = '';
  const punti = messaggio(
    'lui',
    `<div class="bolla"><span class="attesa"><i></i><i></i><i></i></span></div>`,
    false,
  );

  try {
    const dati = await invia('/api/cliente/chat', { domanda: testo });
    punti.remove();

    // La risposta può arrivare dal professionista solo dopo, quando la scrive
    // lui: quello che torna qui con l'automazione spenta è la ricevuta.
    if (dati.automazione === false) stato.automazione = false;

    const pezzi = [
      `<div class="bolla">${esc(dati.risposta)}</div>`,
      fonte(dati.fonte, stato.dati.professionista.nome),
    ];
    for (const s of dati.schede ?? []) {
      pezzi.push(
        `<div class="opzioni"><h3>${esc(s.titolo)}</h3>` +
          (s.righe ?? [])
            .map(
              (r) =>
                `<button class="opzione" disabled><span class="marca">·</span>` +
                `<span>${esc(r.nome)}</span><span class="peso">${esc(r.quantita)}</span></button>`,
            )
            .join('') +
          (s.testo ?? []).map((t) => `<div class="motivo">${esc(t)}</div>`).join('') +
          `</div>`,
      );
    }
    if (dati.citazioni?.length) {
      pezzi.push(
        `<div class="citazioni">${dati.citazioni.map((c) => `<div>· ${esc(c)}</div>`).join('')}</div>`,
      );
    }
    messaggio('lui', pezzi.join(''));
  } catch (e) {
    punti.remove();
    messaggio('lui', `<div class="bolla errore">${esc(e.message)}</div>`);
  } finally {
    stato.occupato = false;
    $('invia').disabled = false;
    $('testo').disabled = false;
    $('testo').focus();
  }
}

/* ------------------------------------------------------------------ */
/* La mia dieta                                                        */
/* ------------------------------------------------------------------ */

function disegnaDieta() {
  const d = stato.dati;
  const o = d.dieta.obiettivi ?? {};

  const obiettivi = [
    o.kcal ? `${o.kcal} kcal al giorno` : '',
    o.proteine ? `${o.proteine} g di proteine` : '',
    o.carboidrati ? `${o.carboidrati} g di carboidrati` : '',
    o.grassi ? `${o.grassi} g di grassi` : '',
    o.acqua ? `${o.acqua} litri d'acqua al giorno` : '',
    o.passi ? `${o.passi} passi al giorno` : '',
  ].filter(Boolean);

  contenuto().innerHTML =
    `<div class="riga sotto"><div class="corpo">` +
    `<div class="titolo">${esc(d.dieta.titolo)}</div>` +
    `<div class="piccolo muto">scritta da ${esc(d.professionista.nome)}</div></div>` +
    (d.dieta.haPdf
      ? `<a class="btn mini neutra" href="/api/cliente/pdf" target="_blank" rel="noopener">Apri il PDF</a>`
      : '') +
    `</div>` +
    (d.dieta.haPdf
      ? `<div class="avviso neutro sotto"><span class="segno" aria-hidden="true">i</span><span>` +
        `Il PDF è quello originale del tuo nutrizionista. Se qui vedi qualcosa di diverso da ` +
        `quello che c'è scritto lì, fa fede il PDF: diglielo.</span></div>`
      : '') +
    (obiettivi.length
      ? `<div class="sezione"><h3 class="sotto-poco">I tuoi obiettivi</h3><div class="pila">` +
        obiettivi.map((t) => `<div class="riga"><div class="corpo">${esc(t)}</div></div>`).join('') +
        `</div></div>`
      : '') +
    (d.dieta.indicazioni.length
      ? `<div class="sezione"><h3 class="sotto-poco">Indicazioni</h3><div class="pila">` +
        d.dieta.indicazioni
          .map((t) => `<div class="riga"><div class="corpo">${esc(t)}</div></div>`)
          .join('') +
        `</div></div>`
      : '') +
    `<div class="sezione"><h3 class="sotto-poco">I tuoi cambi</h3><div class="pila">` +
    (d.variazioni.length
      ? d.variazioni
          .map(
            (v) =>
              `<div class="variazione${v.stato === 'annullata' ? '' : ' nuova'}">` +
              `<div><div class="cambio"><span class="via">${esc(v.daNome)} ${esc(v.daQuantita)}</span>` +
              `<span class="freccia" aria-hidden="true">→</span>` +
              `<span class="nuovo">${esc(v.aNome)} ${esc(v.aQuantita)}</span></div>` +
              `<div class="dove">${esc(GIORNI[v.giorno])} · ${esc(v.pastoNome)} · ${esc(quando(v.at))}</div></div>` +
              `<div>${delta(v.kcalDelta)}</div>` +
              (v.stato === 'annullata'
                ? `<div class="numeri"><span>! ${esc(d.professionista.nome)} l'ha annullata` +
                  `${v.nota ? `: «${esc(v.nota)}»` : '.'}</span></div>`
                : '') +
              `</div>`,
          )
          .join('')
      : vuoto('—', 'Non hai ancora cambiato nulla')) +
    `</div></div>`;
}

/* ------------------------------------------------------------------ */
/* Il mio conto                                                        */
/* ------------------------------------------------------------------ */

function disegnaConto() {
  const d = stato.dati;

  contenuto().innerHTML =
    `<div class="scheda accesso stretto">` +
    `<label><span>Come vuoi che ti chiami l'assistente</span>` +
    `<input id="mio-nome" type="text" value="${esc(stato.io.nome ?? '')}"></label>` +
    `<label><span>Il tuo obiettivo <span class="aiuto">lo legge il tuo nutrizionista</span></span>` +
    `<input id="mio-obiettivo" type="text" value="${esc(stato.io.obiettivo ?? '')}"></label>` +
    `<div class="fila"><button class="btn" id="salva-profilo">Salva</button>` +
    `<span id="esito-profilo" class="piccolo muto"></span></div></div>` +
    `<div class="sezione">` +
    (d.ai.attivo
      ? `<div class="avviso ok"><span class="segno" aria-hidden="true">✓</span><span>` +
        `L'assistente risponde in linguaggio naturale. I numeri della tua dieta restano ` +
        `quelli scritti dal tuo nutrizionista.</span></div>`
      : `<div class="avviso neutro"><span class="segno" aria-hidden="true">i</span>` +
        `<span>${esc(d.ai.motivo ?? '')}</span></div>`) +
    `</div>` +
    `<div class="sezione"><h3 class="sotto-poco">Il tuo nutrizionista</h3>` +
    `<div class="riga"><div class="corpo"><div class="titolo">${esc(d.professionista.nome)}</div>` +
    `<div class="piccolo muto">ti segue lui</div></div>` +
    `<button class="btn mini pericolo" id="scollega">Scollegati</button></div></div>` +
    `<div class="fila sopra">` +
    `<button class="btn neutra mini" id="cambia-pw">Cambia password</button>` +
    `<button class="btn neutra mini spinge" id="esci">Esci</button></div>`;

  $('salva-profilo').addEventListener('click', async () => {
    try {
      await invia('/api/cliente/impostazioni', {
        nome: $('mio-nome').value.trim(),
        obiettivo: $('mio-obiettivo').value.trim(),
      });
      stato.io.nome = $('mio-nome').value.trim();
      $('esito-profilo').textContent = 'Salvato.';
      $('chi-nome').textContent = stato.io.nome || stato.io.email;
    } catch (e) {
      $('esito-profilo').textContent = e.message;
    }
  });

  $('scollega').addEventListener('click', async () => {
    if (!$('scollega').dataset.confermato) {
      $('scollega').dataset.confermato = '1';
      $('scollega').textContent = 'Sicuro? Perdi la dieta';
      return;
    }
    await invia('/api/cliente/scollega', { link: d.professionista.linkId });
    window.location.reload();
  });

  $('cambia-pw').addEventListener('click', () => apriCambioPassword(false));
  $('esci').addEventListener('click', esci);
}

/* ------------------------------------------------------------------ */
/* Impalcatura                                                         */
/* ------------------------------------------------------------------ */

function avvisa(messaggio, tipo = 'attenzione') {
  contenuto().insertAdjacentHTML(
    'afterbegin',
    `<div class="avviso ${tipo} sotto"><span class="segno" aria-hidden="true">!</span>` +
      `<span>${esc(messaggio)}</span></div>`,
  );
}

function disegna() {
  for (const b of $('schede').querySelectorAll('button')) {
    b.setAttribute('aria-selected', String(b.dataset.tab === stato.tab));
  }

  if (stato.tab === 'oggi') disegnaOggi();
  else if (stato.tab === 'settimana') disegnaSettimana();
  else if (stato.tab === 'assistente') disegnaAssistente();
  else if (stato.tab === 'dieta') disegnaDieta();
  else disegnaConto();
}

for (const b of $('schede').querySelectorAll('button')) {
  b.addEventListener('click', () => {
    stato.tab = b.dataset.tab;
    disegna();
  });
}

$('ingresso-esci').addEventListener('click', esci);

async function ricarica() {
  stato.dati = await leggi('/api/cliente/dashboard');
  // La settimana si rilegge alla prossima apertura: le spunte l'hanno cambiata.
  stato.scheda = null;
  disegna();
}

async function inizia() {
  stato.io = stato.io ?? (await avvia('cliente'));
  if (!stato.io) return;

  stato.situazione = await leggi('/api/cliente/stato');
  stato.io = { ...stato.io, ...stato.situazione.io };

  const p = stato.situazione.professionista;
  if (!p || p.stato !== 'attivo') {
    disegnaIngresso();
    return;
  }

  $('ingresso').hidden = true;
  $('app').hidden = false;
  $('chi-nome').textContent = stato.io.nome || stato.io.email;

  try {
    stato.dati = await leggi('/api/cliente/dashboard');
  } catch (e) {
    // Collegato ma senza dieta pubblicata: non è un guasto, è un'attesa.
    $('chi-sotto').textContent = `seguito da ${p.nome}`;
    $('schede').hidden = true;
    contenuto().innerHTML = vuoto('—', e.message);
    return;
  }

  $('chi-sotto').textContent = `${stato.dati.dieta.titolo} · ${stato.dati.professionista.nome}`;
  disegna();
}

inizia();
