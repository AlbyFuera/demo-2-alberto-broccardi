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
} from '/comune.js';
import {
  anello,
  applicaMisure,
  avatar,
  avviso,
  barra,
  barre,
  caricamento,
  collegaSegmenti,
  dataBreve,
  dataLunga,
  dataOra,
  foglio,
  ico,
  linea,
  notifica,
  rigaDiario,
  numero,
  segmenti,
  stampaDieta,
} from '/grafica.js';

const stato = {
  io: null,
  situazione: null,
  dati: null,
  scheda: null,
  diario: null,
  tab: 'oggi',
  /** Sotto-sezione del piano: settimana, indicazioni, spesa. */
  vista: 'settimana',
  occupato: false,
  filo: [],
  automazione: true,
};

const contenuto = () => $('contenuto');
const primoNome = (n) => String(n ?? '').trim().split(/\s+/)[0] ?? '';
/** Un bicchiere d'acqua. */
const BICCHIERE = 250;

function testata({ titolo, sopra = '', sotto = '', destra = '' }) {
  $('testa').innerHTML =
    `<div class="testa-titoli">` +
    (sopra ? `<p class="testa-sopra">${esc(sopra)}</p>` : '') +
    `<h1>${esc(titolo)}</h1>` +
    (sotto ? `<p class="testa-sotto">${esc(sotto)}</p>` : '') +
    `</div><div class="testa-azioni">${destra}</div>`;
}

async function prova(azione, messaggioOk) {
  try {
    const r = await azione();
    if (messaggioOk) notifica(messaggioOk);
    return r;
  } catch (e) {
    notifica(e.message, 'grave');
    return null;
  }
}

// Primo passo: trovare il proprio nutrizionista

function disegnaIngresso() {
  const p = stato.situazione.professionista;
  $('ingresso').hidden = false;
  $('app').hidden = true;

  const marchio =
    `<div class="marchio"><span class="segno" aria-hidden="true">P</span>` +
    `<div><div class="nome">Pianificatore</div><div class="sotto">${esc(stato.io.email)}</div></div>` +
    `<button class="btn testo piccolo spinge" id="ingresso-esci" type="button">Esci</button></div>`;

  if (p?.stato === 'in-attesa') {
    $('primo-passo').innerHTML =
      marchio +
      `<h1>Richiesta inviata</h1>` +
      `<p class="muto">Hai chiesto a <strong>${esc(p.nome)}</strong> (${esc(p.email)}) di seguirti, ` +
      `${esc(quando(p.richiestoIl))}. Appena accetta, qui trovi la tua dieta.</p>` +
      `<div class="fila sopra"><button class="btn secondario" id="ritira">Annulla la richiesta</button>` +
      `<button class="btn" id="ricarica">Controlla adesso</button></div>`;

    $('ritira').addEventListener('click', async () => {
      await invia('/api/cliente/scollega', { link: p.linkId });
      inizia();
    });
    $('ricarica').addEventListener('click', () => inizia());
  } else {
    $('primo-passo').innerHTML =
      marchio +
      `<h1>${esc(primoNome(stato.io.nome) ? `Benvenuto, ${primoNome(stato.io.nome)}` : 'Benvenuto')}</h1>` +
      `<p class="muto sotto">Aggiungi il tuo nutrizionista con l'email con cui si è iscritto. ` +
      `Riceve una richiesta e, appena la accetta, qui vedi la dieta che ti scrive.</p>` +
      `<form id="form-studio" novalidate>` +
      `<label class="campo"><span>Email del nutrizionista</span>` +
      `<input id="email-studio" type="email" autocapitalize="none" spellcheck="false" required></label>` +
      `<div id="trovato"></div>` +
      `<button class="btn larga" id="cerca" type="submit">Cerca</button>` +
      `</form><div id="esito-studio" class="sopra"></div>`;

    $('form-studio').addEventListener('submit', (e) => {
      e.preventDefault();
      cercaStudio();
    });
    $('email-studio').focus();
  }
  $('ingresso-esci').addEventListener('click', esci);
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
      $('esito-studio').innerHTML = avviso(
        'attenzione',
        'Nessun nutrizionista iscritto con questa email. Controlla che sia quella giusta: deve essersi già registrato.',
      );
      $('cerca').disabled = false;
      $('email-studio').select();
      return;
    }

    const s = esito.studio;
    $('trovato').innerHTML =
      avviso('ok', `Trovato: <strong>${esc(s.nome)}</strong>`, true) +
      `<label class="campo sopra"><span>Un messaggio <span class="aiuto">facoltativo</span></span>` +
      `<input id="messaggio" type="text" placeholder="Sono Mario, ci siamo visti giovedì."></label>`;

    const bottone = $('cerca').cloneNode(true);
    bottone.textContent = 'Manda la richiesta';
    bottone.disabled = false;
    $('cerca').replaceWith(bottone);
    bottone.addEventListener('click', async (e) => {
      e.preventDefault();
      bottone.disabled = true;
      try {
        await invia('/api/cliente/richiedi', { email: s.email, messaggio: $('messaggio')?.value.trim() || null });
        inizia();
      } catch (err) {
        $('esito-studio').innerHTML = avviso('grave', err.message);
        bottone.disabled = false;
      }
    });
  } catch (e) {
    $('esito-studio').innerHTML = avviso('grave', e.message);
    $('cerca').disabled = false;
  }
}

// Oggi

function disegnaOggi() {
  const d = stato.dati;
  const o = d.oggi;

  testata({
    sopra: dataLunga() + (o.allenamento ? ' · allenamento' : ''),
    titolo: primoNome(stato.io.nome) ? `Ciao, ${primoNome(stato.io.nome)}` : 'Ciao',
    destra: `<button class="avatar-bottone" id="vai-profilo" aria-label="Il tuo profilo">${avatar(stato.io.nome || stato.io.email, '', stato.io.email)}</button>`,
  });

  // Le kcal di riferimento sono quelle dei pasti di oggi, non l'obiettivo dichiarato.
  const previste = o.kcalPreviste;
  const quotaKcal = previste ? Math.min(100, (o.kcalConsumate / previste) * 100) : 0;

  const riepilogo =
    `<section class="card riepilogo">` +
    anello(quotaKcal, numero(o.kcalConsumate), 'kcal') +
    `<div class="riepilogo-testo"><h2>Mangiato oggi</h2>` +
    `<p class="grande-num">${numero(o.kcalConsumate)} <span>di ${numero(previste)} kcal${o.parziale ? ' circa' : ''}</span></p>` +
    `<div class="macro-righe">` +
    [
      ['Proteine', o.proteine],
      ['Carboidrati', o.carboidrati],
      ['Grassi', o.grassi],
    ]
      .map(([n, v]) => `<div><span>${n}</span><strong>${numero(v)} g</strong></div>`)
      .join('') +
    `</div></div></section>`;

  const a = d.aderenza;

  const tessere =
    `<div class="tessere">` +
    tessera({
      icona: 'goccia',
      titolo: 'Acqua',
      classe: 'acqua',
      valore: `${numero(d.acqua.oggi / 1000, 2)}<small> L</small>`,
      sotto: d.acqua.obiettivo ? `di ${numero(d.acqua.obiettivo, 1)} L` : `${Math.round(d.acqua.oggi / BICCHIERE)} bicchieri`,
      piede:
        `<div class="fila-stretta"><button class="btn-icona piccolo" id="acqua-meno" aria-label="Un bicchiere in meno"${d.acqua.oggi ? '' : ' disabled'}>${ico('meno')}</button>` +
        (d.acqua.obiettivo ? barra(Math.min(100, (d.acqua.oggi / (d.acqua.obiettivo * 1000)) * 100), 'blu') : '<span class="spinge"></span>') +
        `<button class="btn-icona piccolo pieno" id="acqua-piu" aria-label="Un bicchiere in più">${ico('piu')}</button></div>`,
    }) +
    tessera({
      icona: 'scarpa',
      titolo: 'Passi',
      classe: 'passi',
      valore: d.passi.oggi === null ? '—' : numero(d.passi.oggi),
      sotto: d.passi.obiettivo ? `obiettivo ${numero(d.passi.obiettivo)}` : 'oggi',
      piede: `<button class="btn secondario piccolo larga" id="segna-passi">${d.passi.oggi === null ? 'Segna i passi' : 'Aggiorna'}</button>`,
    }) +
    `</div>`;

  // Aderenza e serie stanno nei Progressi: qui solo un rimando.
  const progressi =
    `<button class="card riga-card riga-link" id="vai-progressi" type="button">${ico('grafico')}` +
    `<div class="corpo"><strong>Stai seguendo la dieta${a.percentuale === null ? '' : ` al ${a.percentuale}%`}</strong>` +
    `<span class="muto piccolo">${d.serie.giorni ? `${d.serie.giorni} giorni di fila · ` : ''}peso, passi e diario nei Progressi</span></div>` +
    `${ico('avanti')}</button>`;

  const visita = d.prossimaVisita
    ? `<div class="avviso neutro">${ico('calendario')}<div>Prossima visita con ${esc(d.professionista.nome)}: <strong>${esc(dataOra(d.prossimaVisita))}</strong></div></div>`
    : '';

  const pasti = o.pasti.length
    ? o.pasti.map(pastoDiOggi).join('')
    : `<div class="card vuoto"><p>Per ${esc(o.nome.toLowerCase())} il tuo nutrizionista non ha scritto pasti.</p></div>`;

  contenuto().innerHTML =
    `<div class="oggi-griglia">` +
    `<div class="oggi-riepilogo">${riepilogo}${visita}${o.nota ? avviso('neutro', o.nota) : ''}</div>` +
    `<div class="oggi-pasti"><h2 class="sezione-titolo">Pasti di oggi</h2>${pasti}</div>` +
    `<div class="oggi-extra"><h2 class="sezione-titolo">Acqua e passi</h2>${tessere}${progressi}</div>` +
    `</div>`;

  applicaMisure(contenuto());

  $('vai-profilo').addEventListener('click', () => vaiA('conto'));
  $('segna-passi').addEventListener('click', apriPassi);
  $('vai-progressi').addEventListener('click', () => vaiA('progressi'));
  $('acqua-piu').addEventListener('click', () => cambiaAcqua(BICCHIERE));
  $('acqua-meno').addEventListener('click', () => cambiaAcqua(-BICCHIERE));
  collegaPasti();
}

function tessera({ icona, titolo, valore, sotto = '', piede = '', classe = '' }) {
  return (
    `<section class="card tessera ${classe}">` +
    `<div class="tessera-testa">${ico(icona)}<span>${esc(titolo)}</span></div>` +
    `<div class="tessera-valore">${valore}</div>` +
    `<div class="tessera-sotto">${esc(sotto)}</div>` +
    `<div class="tessera-piede">${piede}</div></section>`
  );
}

function pastoDiOggi(p) {
  const fatto = p.stato === 'fatto';
  const libero = p.stato === 'libero';
  const saltato = p.stato === 'saltato';
  const pl = stato.dati.pastiLiberi;
  const puoLibero = pl.ammessi > 0 && pl.usati < pl.ammessi;

  const alimenti = p.alimenti
    .map(
      (a) =>
        `<button class="alimento${a.piano ? ' con-piano' : ''}${a.cambiatoDa ? ' cambiato' : ''}" data-slot="${esc(p.id)}.${a.indice}" ` +
        `title="${a.piano ? `Scegli la tua ${esc(a.piano.gruppo)}` : 'Cambia questo alimento'}">` +
        `<span class="nome">${esc(a.nome)}</span><span class="peso">${esc(a.quantita)}</span>` +
        (a.piano ? `<span class="scelte" aria-label="${a.piano.alternative} alternative">${ico('scambia')}</span>` : '') +
        `</button>`,
    )
    .join('');

  const etichetta = fatto ? 'Fatto' : libero ? 'Pasto libero' : saltato ? 'Saltato' : '';

  return (
    `<article class="card pasto${fatto || libero ? ' fatto' : ''}${saltato ? ' saltato' : ''}">` +
    `<header class="pasto-testa">` +
    `<button class="spunta" data-spunta="${esc(p.id)}" aria-pressed="${fatto || libero}" ` +
    `aria-label="${fatto || libero ? 'Togli il segno' : `Segna ${esc(p.nome)} come fatto`}">${ico('spunta')}</button>` +
    `<div class="pasto-nome"><strong>${esc(p.nome)}</strong>` +
    `<span>${[p.orario, etichetta].filter(Boolean).map(esc).join(' · ')}</span></div>` +
    `<span class="pasto-kcal">${p.parziale ? '≈ ' : ''}${numero(p.kcal)} kcal</span></header>` +
    (libero
      ? `<p class="muto piccolo">Pasto libero: conta come fatto. Gustatelo.</p>`
      : `<div class="alimenti">${alimenti || '<span class="muto piccolo">Niente scritto</span>'}</div>`) +
    (p.nota ? `<p class="pasto-nota">${esc(p.nota)}</p>` : '') +
    (fatto || libero
      ? ''
      : `<footer class="pasto-azioni">` +
        `<button class="btn testo piccolo" data-cambia="${esc(p.id)}">${ico('scambia')} Cambia pasto</button>` +
        (saltato
          ? `<button class="btn testo piccolo" data-annulla-spunta="${esc(p.id)}">Non l'ho saltato</button>`
          : `<button class="btn testo piccolo grigio" data-salta="${esc(p.id)}">L'ho saltato</button>`) +
        (puoLibero && !saltato
          ? `<button class="btn testo piccolo" data-libero="${esc(p.id)}">${ico('stella')} Pasto libero</button>`
          : '') +
        `</footer>`) +
    `</article>`
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
  for (const el of contenuto().querySelectorAll('[data-libero]')) {
    el.addEventListener('click', () => spunta(el.dataset.libero, 'libero'));
  }
  for (const el of contenuto().querySelectorAll('[data-annulla-spunta]')) {
    el.addEventListener('click', () => spunta(el.dataset.annullaSpunta, null));
  }
  for (const el of contenuto().querySelectorAll('[data-cambia]')) {
    el.addEventListener('click', () => apriCambioPasto(el.dataset.cambia));
  }
}

async function spunta(pastoId, nuovoStato) {
  const ok = await prova(() => invia('/api/cliente/spunta', { pasto: pastoId, stato: nuovoStato }));
  if (ok) await ricarica();
}

async function cambiaAcqua(ml) {
  const r = await prova(() => invia('/api/cliente/acqua', { aggiungi: ml }));
  if (r) {
    stato.dati.acqua.oggi = r.oggi;
    disegna();
  }
}

// Passi e peso

function apriPassi() {
  const d = stato.dati;
  const { corpo, chiudi } = foglio({ titolo: 'Passi di oggi' });
  const storico = d.passi.storico.map((s) => ({ etichetta: dataBreve(s.giorno), valore: s.passi }));

  corpo.innerHTML =
    `<p class="muto piccolo sotto">Leggili dall'app Salute o dal contapassi: una pagina web non può chiederli al telefono da sola.</p>` +
    `<label class="campo"><span>Passi</span><input id="quanti-passi" type="number" min="0" max="200000" ` +
    `inputmode="numeric" value="${d.passi.oggi ?? ''}" placeholder="8000"></label>` +
    (storico.length ? `<div class="sopra">${barre(storico, d.passi.obiettivo)}</div>` : '') +
    `<div class="fila sopra"><button class="btn larga" id="salva-passi">Salva</button></div>`;
  applicaMisure(corpo);
  $('quanti-passi').focus();

  $('salva-passi').addEventListener('click', async () => {
    const scritto = $('quanti-passi').value.trim();
    const n = Number(scritto);
    if (!scritto || !Number.isInteger(n) || n < 0 || n > 200000) {
      notifica('Scrivi quanti passi hai fatto oggi, per esempio 6500.', 'attenzione');
      return;
    }
    $('salva-passi').disabled = true;
    if (await prova(() => invia('/api/cliente/passi', { passi: n }), 'Passi salvati')) {
      chiudi();
      await ricarica();
    } else {
      $('salva-passi').disabled = false;
    }
  });
}

function apriPeso() {
  const p = stato.dati.peso;
  const { corpo, chiudi } = foglio({ titolo: 'Peso di oggi' });

  corpo.innerHTML =
    `<p class="muto piccolo sotto">Meglio sempre alla stessa ora, al mattino, prima di colazione. Lo vede anche il tuo nutrizionista.</p>` +
    `<label class="campo"><span>Peso in kg</span><input id="quanto-peso" type="text" inputmode="decimal" ` +
    `value="${p.oggi != null ? numero(p.oggi, 1) : ''}" placeholder="${p.ultimo ? numero(p.ultimo.peso, 1) : '70,0'}"></label>` +
    (p.storico.length > 1
      ? `<div class="sopra">${linea(p.storico.map((s) => ({ etichetta: dataBreve(s.giorno), valore: s.peso })), { unita: 'kg' })}</div>`
      : '') +
    `<div class="fila sopra"><button class="btn larga" id="salva-peso">Salva</button></div>`;
  applicaMisure(corpo);
  $('quanto-peso').focus();

  $('salva-peso').addEventListener('click', async () => {
    $('salva-peso').disabled = true;
    if (await prova(() => invia('/api/cliente/peso', { peso: $('quanto-peso').value.trim() }), 'Peso salvato')) {
      chiudi();
      await ricarica();
    } else {
      $('salva-peso').disabled = false;
    }
  });
}

// Scegliere dentro il piano a sostituzione

const NOME_BASE = {
  auto: 'sul nutriente principale',
  kcal: 'stesse calorie',
  proteine: 'stesse proteine',
  carboidrati: 'stessi carboidrati',
  grassi: 'stessi grassi',
};

async function apriScelta(pastoId, indice) {
  const giorno = stato.dati.oggi.indice;
  const { corpo, chiudi, foglio: f } = foglio({ titolo: 'Cambia alimento' });
  corpo.innerHTML = caricamento();

  try {
    const v = await leggi(
      '/api/cliente/alternative',
      new URLSearchParams({ giorno: String(giorno), pasto: pastoId, indice: String(indice) }),
    );
    const p = v.piano;
    f.querySelector('.foglio-testa h2').textContent = p.libero ? `Al posto di ${p.prescritto.nome}` : `La tua ${p.gruppo}`;

    const generico = (a) => a.startsWith('Il conto usa valori');
    const indicativi = p.opzioni.some((o) => o.avvisi.some(generico));

    const previste = p.opzioni
      .map((o) => {
        const suo = o.avvisi.find((a) => !generico(a));
        return (
          `<button class="opzione${o.scelta ? ' scelta' : ''}" data-scegli="${esc(o.nome)}"${o.scelta || o.quantita === null ? ' disabled' : ''}>` +
          `<span class="marca">${o.scelta ? ico('spunta') : ''}</span>` +
          `<span class="opzione-testo"><strong>${esc(o.nome)}</strong>` +
          (o.prescritta ? `<small>quello della tua dieta</small>` : '') +
          (o.fissata && !o.prescritta ? `<small>porzione scritta dal tuo nutrizionista</small>` : '') +
          (suo ? `<small class="motivo">${esc(suo)}</small>` : '') +
          `</span><span class="peso">${esc(o.etichetta)}</span></button>`
        );
      })
      .join('');

    const altre = v.proposte
      .map(
        (x) =>
          `<button class="opzione" data-scegli="${esc(x.nome)}">` +
          `<span class="marca"></span><span class="opzione-testo"><strong>${esc(x.nome)}</strong></span>` +
          `<span class="peso">${esc(x.etichetta)} ${delta(x.delta.kcal)}</span></button>`,
      )
      .join('');

    corpo.innerHTML =
      (p.libero
        ? `<p class="muto piccolo sotto">Per questo alimento il tuo nutrizionista non ha scritto sostituzioni. ` +
          `Puoi cambiarlo lo stesso: conta come una deviazione dalla dieta.</p>`
        : `<p class="muto piccolo sotto">Le ha scelte il tuo nutrizionista: scegliere fra queste <strong>non abbassa la tua aderenza</strong>. ` +
          `Porzioni equivalenti, ${esc(NOME_BASE[p.base] ?? p.nomeBase)}.</p>`) +
      (v.regola === 'alimento' ? `<p class="muto piccolo sotto">Per questo alimento vale una regola diversa dal resto della dieta.</p>` : '') +
      (previste ? `<div class="opzioni">${previste}</div>` : '') +
      (indicativi ? `<p class="muto piccolo sopra">Porzioni calcolate su valori di composizione indicativi.</p>` : '') +
      (altre
        ? `<h3 class="sezione-titolo sopra">Altre possibilità</h3>` +
          `<p class="muto piccolo sotto">Alimenti della tua dieta di altri giorni. Il pasto conterà a metà nella tua aderenza.</p>` +
          `<div class="opzioni">${altre}</div>`
        : '') +
      (v.nessuna
        ? `<div class="sopra">${avviso('attenzione', `Nella tua dieta non c'è un alimento abbastanza simile a ${p.prescritto.nome}. Chiedi nei messaggi con cosa vorresti cambiarlo.`)}</div>`
        : '');

    for (const el of corpo.querySelectorAll('[data-scegli]')) {
      el.addEventListener('click', async () => {
        el.disabled = true;
        const ok = await prova(
          () => invia('/api/cliente/applica', { giorno, pasto: pastoId, indice, alimento: el.dataset.scegli }),
          'Fatto: il tuo nutrizionista lo vede',
        );
        if (ok) {
          chiudi();
          await ricarica();
        } else {
          el.disabled = false;
        }
      });
    }
  } catch (e) {
    corpo.innerHTML = avviso('grave', e.message);
  }
}

// Cambiare un pasto intero

async function apriCambioPasto(pastoId) {
  const giorno = stato.dati.oggi.indice;
  const { corpo, chiudi, foglio: f } = foglio({ titolo: 'Cambia pasto' });
  corpo.innerHTML = caricamento();

  try {
    const v = await leggi('/api/cliente/cambio-pasto', new URLSearchParams({ giorno: String(giorno), pasto: pastoId }));
    f.querySelector('.foglio-testa h2').textContent = `Al posto di questo ${v.attuale.nome.toLowerCase()}`;

    corpo.innerHTML = v.nessuno
      ? avviso('attenzione', `Negli altri giorni non c'è un ${v.attuale.nome.toLowerCase()} abbastanza simile. Puoi cambiare un singolo alimento toccandolo.`)
      : `<p class="muto piccolo sotto">Pasti che il tuo nutrizionista ha scritto per te in altri giorni, con calorie simili. Non abbassano l'aderenza.</p>` +
        `<div class="opzioni">` +
        v.alternativi
          .map(
            (x) =>
              `<button class="opzione" data-scegli="${esc(x.pastoId)}"><span class="marca"></span>` +
              `<span class="opzione-testo"><strong>${esc(x.giornoNome)}</strong>` +
              `<small>${esc(x.alimenti.map((a) => `${a.nome} ${a.quantita}`).join(', '))}</small></span>` +
              `<span class="peso">${delta(x.deltaKcal, x.parziale)}</span></button>`,
          )
          .join('') +
        `</div>`;

    for (const el of corpo.querySelectorAll('[data-scegli]')) {
      el.addEventListener('click', async () => {
        el.disabled = true;
        if (await prova(() => invia('/api/cliente/applica-cambio', { giorno, pasto: pastoId, verso: el.dataset.scegli }), 'Pasto cambiato')) {
          chiudi();
          await ricarica();
        } else {
          el.disabled = false;
        }
      });
    }
  } catch (e) {
    corpo.innerHTML = avviso('grave', e.message);
  }
}

// Il piano: la settimana, le indicazioni, la spesa

async function disegnaPiano() {
  testata({ titolo: 'Il mio piano' });
  contenuto().innerHTML = caricamento();
  if (!stato.scheda) stato.scheda = await leggi('/api/cliente/scheda');
  const s = stato.scheda;

  testata({
    titolo: 'Il mio piano',
    sotto: `${s.dieta.titolo} · di ${s.professionista.nome}`,
    destra: `<button class="btn-icona" id="stampa-dieta" aria-label="Stampa la dieta">${ico('stampa')}</button>`,
  });

  contenuto().innerHTML =
    segmenti('viste-settimana', [['settimana', 'Settimana'], ['indicazioni', 'Indicazioni'], ['spesa', 'Spesa']], stato.vista) +
    `<div id="vista-settimana" class="sopra"></div>`;

  collegaSegmenti('viste-settimana', (v) => {
    stato.vista = v;
    disegnaVistaSettimana();
  });
  $('stampa-dieta').addEventListener('click', () =>
    stampaDieta({
      titolo: s.dieta.titolo,
      autore: s.professionista.nome,
      cliente: stato.io.nome,
      indicazioni: s.dieta.indicazioni,
      obiettivi: s.dieta.obiettivi,
      giorni: s.giorni,
    }),
  );
  disegnaVistaSettimana();
}

async function disegnaVistaSettimana() {
  const zona = $('vista-settimana');
  if (stato.vista === 'indicazioni') return disegnaIndicazioni(zona);
  if (stato.vista === 'spesa') return disegnaSpesa(zona);

  const s = stato.scheda;
  zona.innerHTML =
    `<p class="muto piccolo sotto">${numero(s.settimana.mediaKcal)} kcal al giorno in media${s.settimana.parziale ? ' (conto parziale)' : ''}.</p>` +
    `<section class="card macro-tre">` +
    [
      ['Proteine', s.settimana.mediaProteine],
      ['Carboidrati', s.settimana.mediaCarboidrati],
      ['Grassi', s.settimana.mediaGrassi],
    ]
      .map(([n, v]) => `<div><strong>${numero(v)} g</strong><span>${n}</span></div>`)
      .join('') +
    `</section>` +
    `<div class="lista-giorni sopra">` +
    s.giorni
      .map((g) => {
        const oggi = g.indice === stato.dati.oggi.indice;
        return (
          `<details class="card giorno${oggi ? ' oggi' : ''}"${oggi ? ' open' : ''}>` +
          `<summary><span class="giorno-nome">${esc(GIORNI[g.indice])}</span>` +
          (oggi ? `<span class="chip accento">oggi</span>` : '') +
          (g.allenamento ? `<span class="chip">allenamento</span>` : '') +
          `<span class="spinge muto">${g.parziale ? '≈ ' : ''}${numero(g.kcal)} kcal</span>${ico('avanti')}</summary>` +
          `<div class="giorno-corpo">` +
          (g.pasti.length
            ? g.pasti
                .map(
                  (p) =>
                    `<div class="giorno-pasto"><div class="giorno-pasto-testa"><strong>${esc(p.nome)}</strong>` +
                    `<span class="muto">${[p.orario, `${numero(p.kcal)} kcal`].filter(Boolean).map(esc).join(' · ')}</span></div>` +
                    `<ul>` +
                    p.alimenti
                      .map(
                        (a) =>
                          `<li${a.cambiatoDa ? ` class="cambiato" title="al posto di ${esc(a.cambiatoDa.nome)} ${esc(a.cambiatoDa.quantita)}"` : ''}>` +
                          `<span>${esc(a.nome)}</span><span class="muto">${esc(a.quantita)}</span></li>`,
                      )
                      .join('') +
                    `</ul>${p.nota ? `<p class="pasto-nota">${esc(p.nota)}</p>` : ''}</div>`,
                )
                .join('')
            : `<p class="muto">Niente scritto.</p>`) +
          `</div></details>`
        );
      })
      .join('') +
    `</div>`;
}

function disegnaSpesa(zona) {
  const s = stato.scheda;
  const chiave = `spesa:${s.dieta.id}`;
  let presi = [];
  try {
    presi = JSON.parse(localStorage.getItem(chiave) ?? '[]');
  } catch {
    presi = [];
  }

  const quantita = (l) =>
    l.quantita === null ? 'q.b.' : `${numero(Math.round(l.quantita))}${l.unita === 'pz' ? ' pz' : ` ${l.unita}`}`;
  const ORDINE = ['frutta e verdura', 'carne e pesce', 'latte e uova', 'pane e cereali', 'dispensa'];

  const disegnaLista = () => {
    zona.innerHTML =
      `<div class="fila sotto"><p class="muto piccolo">Quantità per tutta la settimana. Spunta quello che hai già preso.</p>` +
      (presi.length ? `<button class="btn testo piccolo spinge" id="spesa-azzera">Ricomincia</button>` : '') +
      `</div>` +
      ORDINE.map((reparto) => {
        const righe = s.spesa.filter((l) => (l.reparto ?? 'dispensa') === reparto);
        if (!righe.length) return '';
        return (
          `<h3 class="sezione-titolo">${esc(reparto.charAt(0).toUpperCase() + reparto.slice(1))}</h3>` +
          `<section class="card lista sotto">` +
          righe
            .map((l) => {
              const id = `${l.nome}|${l.unita}`;
              const preso = presi.includes(id);
              return (
                `<label class="riga spesa-riga${preso ? ' preso' : ''}"><input type="checkbox" data-spesa="${esc(id)}"${preso ? ' checked' : ''}>` +
                `<span class="corpo">${esc(l.nome)}<small class="muto">in ${l.ricorrenze} past${l.ricorrenze === 1 ? 'o' : 'i'}</small></span>` +
                `<span class="muto">${esc(quantita(l))}</span></label>`
              );
            })
            .join('') +
          `</section>`
        );
      }).join('');

    for (const el of zona.querySelectorAll('[data-spesa]')) {
      el.addEventListener('change', () => {
        presi = el.checked ? [...presi, el.dataset.spesa] : presi.filter((x) => x !== el.dataset.spesa);
        try {
          localStorage.setItem(chiave, JSON.stringify(presi));
        } catch {
          /* senza memoria locale la spunta vale solo finché la pagina è aperta */
        }
        el.closest('.spesa-riga').classList.toggle('preso', el.checked);
      });
    }
    $('spesa-azzera')?.addEventListener('click', () => {
      presi = [];
      try {
        localStorage.removeItem(chiave);
      } catch {
        /* niente */
      }
      disegnaLista();
    });
  };
  disegnaLista();
}

// Messaggi e assistente

async function disegnaAssistente() {
  const prof = stato.situazione.professionista;
  testata({
    titolo: 'Messaggi',
    sotto: stato.automazione === false ? `Ti risponde ${prof.nome} di persona` : `L'assistente risponde con i dati della tua dieta`,
    destra: avatar(prof.nome, '', prof.email),
  });

  contenuto().innerHTML =
    `<div class="chat">` +
    `<div class="filo" id="filo"></div>` +
    `<div class="suggerimenti" id="suggerimenti"></div>` +
    `<form class="scrivi" id="scrivi">` +
    `<input id="testo" type="text" placeholder="Scrivi un messaggio" autocomplete="off" aria-label="Scrivi un messaggio">` +
    `<button class="btn-icona pieno" id="invia" type="submit" aria-label="Invia">${ico('invia')}</button>` +
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
      html: `<div class="bolla">${esc(m.testo)}</div>` + fonte(m.autore, filo.professionista, m.at),
    }));
  } catch {
    // Senza il filo si può scrivere lo stesso: si perde lo storico.
  }

  for (const m of stato.filo) messaggio(m.chi, m.html, false);

  const nome = stato.dati.professionista.nome;
  $('testa').querySelector('.testa-sotto').textContent =
    stato.automazione === false ? `Ti risponde ${nome} di persona` : `L'assistente risponde con i dati della tua dieta`;

  if (stato.automazione === false) {
    $('testo').placeholder = `Scrivi a ${nome}`;
  } else {
    const frasi = [
      'Cosa mangio adesso?',
      'Ho saltato il pranzo, come sto messo?',
      'Posso bere un bicchiere di vino?',
      'Sono al ristorante, cosa prendo?',
      'Perché devo bere tanta acqua?',
    ];
    $('suggerimenti').innerHTML = frasi
      .map((t) => `<button class="chip-bottone" type="button">${esc(t)}</button>`)
      .join('');
    for (const b of $('suggerimenti').querySelectorAll('button')) {
      b.addEventListener('click', () => chiedi(b.textContent));
    }
  }

  if (stato.filo.length === 0) {
    messaggio(
      'lui',
      `<div class="bolla">` +
        (stato.automazione === false
          ? `Ciao. Scrivi pure qui: legge e risponde ${esc(nome)}, di persona.`
          : `Ciao. Chiedimi quello che vuoi sulla tua dieta: rispondo con i dati che ha scritto ${esc(nome)}.`) +
        `</div>`,
      false,
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

const fonte = (f, nomeStudio, at) => {
  const chi =
    f === 'studio' ? esc(nomeStudio ?? 'il tuo nutrizionista') : f === 'cliente' ? '' : f === 'motore' ? 'calcolo' : 'assistente';
  const tempo = at ? esc(quando(at)) : '';
  if (!chi && !tempo) return '';
  return `<div class="fonte">${[chi && `<span class="${f === 'studio' ? 'di-persona' : ''}">${chi}</span>`, tempo].filter(Boolean).join(' · ')}</div>`;
};

async function chiedi(testo) {
  if (stato.occupato || !testo.trim()) return;
  stato.occupato = true;
  $('invia').disabled = true;

  messaggio('io', `<div class="bolla">${esc(testo)}</div>`);
  $('testo').value = '';
  const punti = messaggio('lui', `<div class="bolla"><span class="attesa"><i></i><i></i><i></i></span></div>`, false);

  try {
    const dati = await invia('/api/cliente/chat', { domanda: testo });
    punti.remove();
    if (dati.automazione === false) stato.automazione = false;

    const pezzi = [`<div class="bolla">${esc(dati.risposta)}</div>`];
    for (const s of dati.schede ?? []) {
      pezzi.push(
        `<div class="bolla scheda-bolla"><strong>${esc(s.titolo)}</strong>` +
          (s.righe ?? []).map((r) => `<div class="riga-bolla"><span>${esc(r.nome)}</span><span>${esc(r.quantita)}</span></div>`).join('') +
          (s.testo ?? []).map((t) => `<p>${esc(t)}</p>`).join('') +
          `</div>`,
      );
    }
    if (dati.citazioni?.length) {
      pezzi.push(`<div class="citazioni">${dati.citazioni.map((c) => `<div>${esc(c)}</div>`).join('')}</div>`);
    }
    pezzi.push(fonte(dati.fonte, stato.dati.professionista.nome));
    messaggio('lui', pezzi.join(''));
  } catch (e) {
    punti.remove();
    messaggio('lui', `<div class="bolla errore">${esc(e.message)}</div>`);
  } finally {
    stato.occupato = false;
    $('invia').disabled = false;
    $('testo').focus();
  }
}

// Indicazioni: la giornata in media, le abitudini, il PDF

function disegnaIndicazioni(zona) {
  const d = stato.dati;
  const o = d.dieta.obiettivi ?? {};

  const giornata = [
    ['Calorie', `${numero(d.media.kcal)} kcal`],
    ['Proteine', `${numero(d.media.proteine)} g`],
    ['Carboidrati', `${numero(d.media.carboidrati)} g`],
    ['Grassi', `${numero(d.media.grassi)} g`],
  ];
  const abitudini = [
    o.acqua ? ['goccia', `${numero(o.acqua, 1)} litri d'acqua al giorno`] : null,
    o.passi ? ['scarpa', `${numero(o.passi)} passi al giorno`] : null,
    o.pastiLiberi ? ['stella', `${o.pastiLiberi} past${o.pastiLiberi === 1 ? 'o libero' : 'i liberi'} a settimana`] : null,
  ].filter(Boolean);

  zona.innerHTML =
    `<div class="colonne">` +
    `<div class="pila">` +
    `<section class="card"><h2 class="card-titolo">La tua giornata in media</h2>` +
    `<div class="valori-griglia">${giornata.map(([n, v]) => `<div><span>${n}</span><strong>${v}</strong></div>`).join('')}</div>` +
    (abitudini.length
      ? `<div class="divisore"></div><ul class="lista-icone">${abitudini.map(([i, t]) => `<li>${ico(i)}<span>${esc(t)}</span></li>`).join('')}</ul>`
      : '') +
    `</section>` +
    (d.prossimaVisita
      ? `<section class="card riga-card">${ico('calendario')}<div><span class="muto piccolo">Prossima visita</span><strong>${esc(dataOra(d.prossimaVisita))}</strong></div></section>`
      : '') +
    `</div><div class="pila">` +
    (d.dieta.indicazioni.length
      ? `<section class="card"><h2 class="card-titolo">Indicazioni del tuo nutrizionista</h2><ul class="elenco">` +
        d.dieta.indicazioni.map((t) => `<li>${esc(t)}</li>`).join('') +
        `</ul></section>`
      : '') +
    (d.dieta.haPdf
      ? `<section class="card lista"><a class="riga riga-link" href="/api/cliente/pdf" target="_blank" rel="noopener">${ico('pdf')}` +
        `<span class="corpo">Apri il PDF originale</span>${ico('avanti')}</a></section>` +
        `<p class="muto piccolo">Se qui vedi qualcosa di diverso dal PDF, fa fede il PDF: dillo al tuo nutrizionista.</p>`
      : '') +
    `</div></div>`;
}

// Progressi: costanza, peso, passi, acqua, diario, cambi

async function disegnaProgressi() {
  const d = stato.dati;
  testata({ titolo: 'Progressi' });
  contenuto().innerHTML = caricamento();
  if (!stato.diario) {
    try {
      stato.diario = await leggi('/api/cliente/diario');
    } catch (e) {
      contenuto().innerHTML = avviso('grave', e.message);
      return;
    }
  }
  const giorni = stato.diario.giorni;
  const a = d.aderenza;
  const tono = a.percentuale === null ? '' : a.livello === 'buona' ? '' : a.livello === 'parziale' ? 'tono-attenzione' : 'tono-grave';
  const p = d.peso;
  const variazione = p.storico.length > 1 ? p.storico.at(-1).peso - p.storico[0].peso : null;

  // Il diario arriva dal più recente: i grafici vanno dal più vecchio.
  const cronologia = giorni.slice().reverse();
  const serie = (chiave) => cronologia.map((g) => ({ etichetta: dataBreve(g.data), valore: g[chiave] }));
  const media = (chiave) => {
    const v = giorni.slice(0, 7).map((g) => g[chiave]).filter((x) => x != null);
    return v.length ? v.reduce((t, x) => t + x, 0) / v.length : null;
  };

  contenuto().innerHTML =
    `<div class="colonne">` +
    `<div class="pila">` +
    `<section class="card costanza-card ${tono}">` +
    anello(a.percentuale, a.percentuale === null ? '—' : `${a.percentuale}%`, '', 'medio') +
    `<div class="corpo"><h2 class="card-titolo">Stai seguendo la dieta</h2>` +
    `<p class="muto piccolo">${esc(a.percentuale === null ? 'Segna i pasti per saperlo.' : a.descrizione)}</p>` +
    `<div class="fila sopra"><span class="chip accento">${d.serie.giorni} giorni di fila</span>` +
    (d.serie.record > d.serie.giorni ? `<span class="chip">record ${d.serie.record}</span>` : '') +
    (d.pastiLiberi.ammessi
      ? `<span class="chip">${d.pastiLiberi.ammessi - d.pastiLiberi.usati} di ${d.pastiLiberi.ammessi} pasti liberi</span>`
      : '') +
    `</div></div></section>` +
    `<section class="card peso"><div class="card-testa"><h2 class="card-titolo">Peso</h2>` +
    `<button class="btn secondario piccolo" id="segna-peso">${p.oggi == null ? 'Segna' : 'Correggi'}</button></div>` +
    `<p class="grande-num">${p.ultimo ? `${numero(p.ultimo.peso, 1)} <span>kg</span>` : '—'}</p>` +
    `<p class="muto piccolo sotto">${variazione != null ? `${variazione > 0 ? '+' : ''}${numero(variazione, 1)} kg dal ${dataBreve(p.storico[0].giorno)}` : 'Pesati una volta a settimana, al mattino.'}</p>` +
    (p.storico.length > 1 ? linea(p.storico.map((x) => ({ etichetta: dataBreve(x.giorno), valore: x.peso })), { unita: 'kg' }) : '') +
    `</section>` +
    `<div class="tessere">` +
    `<section class="card tessera passi"><div class="tessera-testa">${ico('scarpa')}<span>Passi</span></div>` +
    `<div class="tessera-valore">${numero(media('passi'))}</div><div class="tessera-sotto">media 7 giorni</div>` +
    `<div class="tessera-piede">${barre(serie('passi'), d.passi.obiettivo)}</div></section>` +
    `<section class="card tessera acqua"><div class="tessera-testa">${ico('goccia')}<span>Acqua</span></div>` +
    `<div class="tessera-valore">${media('acqua') == null ? '—' : `${numero(media('acqua') / 1000, 1)}<small> L</small>`}</div><div class="tessera-sotto">media 7 giorni</div>` +
    `<div class="tessera-piede blu">${barre(serie('acqua'), d.acqua.obiettivo ? d.acqua.obiettivo * 1000 : null)}</div></section>` +
    `</div>` +
    `</div>` +
    `<div class="pila">` +
    `<section class="card lista"><div class="lista-testa"><h2 class="card-titolo">Diario</h2>` +
    `<span class="muto piccolo">ultime due settimane</span></div>${giorni.map((g) => rigaDiario(g)).join('')}</section>` +
    `<section class="card"><h2 class="card-titolo">I tuoi cambi</h2>` +
    (d.variazioni.length
      ? `<div class="lista-semplice">` +
        d.variazioni
          .map(
            (v) =>
              `<div class="cambio${v.stato === 'annullata' ? ' annullato' : ''}"><div class="corpo">` +
              `<div><span class="muto">${esc(v.daNome)} ${esc(v.daQuantita)}</span> → <strong>${esc(v.aNome)} ${esc(v.aQuantita)}</strong></div>` +
              `<small class="muto">${esc(GIORNI[v.giorno])} · ${esc(v.pastoNome)} · ${esc(quando(v.at))}</small>` +
              (v.stato === 'annullata'
                ? `<small class="tono-grave">Annullato da ${esc(d.professionista.nome)}${v.nota ? `: «${esc(v.nota)}»` : ''}</small>`
                : '') +
              `</div>${delta(v.kcalDelta)}</div>`,
          )
          .join('') +
        `</div>`
      : `<p class="muto">Non hai ancora cambiato nulla. Tocca un alimento nei pasti di oggi per vedere le alternative.</p>`) +
    `</section></div></div>`;

  applicaMisure(contenuto());
  $('segna-peso').addEventListener('click', apriPeso);
}

// Profilo

function disegnaConto() {
  const d = stato.dati;
  const prof = stato.situazione.professionista;

  testata({ titolo: 'Profilo' });

  contenuto().innerHTML =
    `<div class="stretta pila">` +
    `<section class="card profilo-testa">${avatar(stato.io.nome || stato.io.email, 'grande', stato.io.email)}` +
    `<div><strong>${esc(stato.io.nome || stato.io.email)}</strong><span class="muto">${esc(stato.io.email)}</span></div></section>` +
    `<h2 class="sezione-titolo">I tuoi dati</h2>` +
    `<section class="card">` +
    `<label class="campo"><span>Come vuoi che ti chiami l'assistente</span>` +
    `<input id="mio-nome" type="text" value="${esc(stato.io.nome ?? '')}"></label>` +
    `<label class="campo"><span>Il tuo obiettivo <span class="aiuto">lo legge il tuo nutrizionista</span></span>` +
    `<input id="mio-obiettivo" type="text" value="${esc(stato.io.obiettivo ?? '')}" placeholder="Per esempio: perdere 5 kg entro l'estate"></label>` +
    `<div class="fila"><button class="btn" id="salva-profilo">Salva</button></div></section>` +
    `<h2 class="sezione-titolo">Il tuo nutrizionista</h2>` +
    `<section class="card lista">` +
    `<div class="riga">${avatar(prof.nome, 'piccolo', prof.email)}<span class="corpo"><strong>${esc(d.professionista.nome)}</strong>` +
    `<small class="muto">${esc(prof.email)}</small></span>` +
    `<button class="btn testo piccolo rosso" id="scollega" type="button">Scollegati</button></div></section>` +
    (d.ai.attivo ? '' : avviso('neutro', d.ai.motivo ?? '')) +
    `<h2 class="sezione-titolo">Account</h2>` +
    `<section class="card lista">` +
    `<button class="riga riga-link" id="cambia-pw" type="button">${ico('lucchetto')}<span class="corpo">Cambia password</span>${ico('avanti')}</button>` +
    `<button class="riga riga-link" id="esci" type="button">${ico('esci')}<span class="corpo">Esci</span>${ico('avanti')}</button>` +
    `</section></div>`;

  $('salva-profilo').addEventListener('click', async () => {
    const ok = await prova(
      () => invia('/api/cliente/impostazioni', { nome: $('mio-nome').value.trim(), obiettivo: $('mio-obiettivo').value.trim() }),
      'Salvato',
    );
    if (ok) {
      stato.io.nome = $('mio-nome').value.trim();
      stato.io.obiettivo = $('mio-obiettivo').value.trim();
      disegnaConto();
    }
  });

  $('scollega').addEventListener('click', async () => {
    const b = $('scollega');
    if (!b.dataset.confermato) {
      b.dataset.confermato = '1';
      b.textContent = 'Sicuro? Non vedrai più la dieta';
      return;
    }
    await invia('/api/cliente/scollega', { link: d.professionista.linkId });
    window.location.reload();
  });

  $('cambia-pw').addEventListener('click', () => apriCambioPassword(false));
  $('esci').addEventListener('click', esci);
}

// Impalcatura

function disegna() {
  document.body.classList.toggle('in-chat', stato.tab === 'assistente');
  for (const b of $('schede').querySelectorAll('button')) {
    if (b.dataset.tab === stato.tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }

  if (stato.tab === 'oggi') disegnaOggi();
  else if (stato.tab === 'piano') disegnaPiano();
  else if (stato.tab === 'progressi') disegnaProgressi();
  else if (stato.tab === 'assistente') disegnaAssistente();
  else disegnaConto();
}

function vaiA(tab) {
  stato.tab = tab;
  disegna();
  window.scrollTo(0, 0);
}

for (const b of $('schede').querySelectorAll('button')) {
  b.addEventListener('click', () => vaiA(b.dataset.tab));
}

async function ricarica() {
  stato.dati = await leggi('/api/cliente/dashboard');
  // Settimana e diario si rileggono alla prossima apertura: le spunte li hanno cambiati.
  stato.scheda = null;
  stato.diario = null;
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

  try {
    stato.dati = await leggi('/api/cliente/dashboard');
  } catch (e) {
    testata({ titolo: 'La mia dieta', sotto: `Ti segue ${p.nome}` });
    $('schede').hidden = true;
    contenuto().innerHTML = `<div class="card vuoto">${ico('documento')}<p>${esc(e.message)}</p></div>`;
    return;
  }

  disegna();
}

inizia();
