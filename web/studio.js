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
  barre,
  caricamento,
  collegaSegmenti,
  dataBreve,
  dataLunga,
  dataOra,
  eta,
  foglio,
  ico,
  linea,
  notifica,
  numero,
  rigaDiario,
  segmenti,
  stampaDieta,
} from '/grafica.js';

const stato = {
  io: null,
  /** La pagina da cui si è aperto il cliente, per il "torna indietro". */
  provenienza: null,
  filtroVariazioni: null,
  dati: null,
  tab: 'cruscotto',
  /** La scheda del cliente aperto, o null per l'elenco. */
  cliente: null,
  /** La sezione aperta nella scheda del cliente. */
  sezione: 'panoramica',
  /** Finestra dell'aderenza nella panoramica: '7' o '30'. */
  periodo: '7',
  /** La dieta in scrittura: { id, dieta, conti, daCompletare, scarti, attenzioni, giorno, sporca }. */
  editor: null,
};

const contenuto = () => $('contenuto');

const BASI_DIETA = [
  ['auto', 'sul nutriente principale di ogni alimento'],
  ['kcal', 'isocalorica: stesse calorie'],
  ['proteine', 'isoproteica: stesse proteine'],
  ['carboidrati', 'isoglucidica: stessi carboidrati'],
  ['grassi', 'isolipidica: stessi grassi'],
];

const nomeBaseDieta = () => {
  const b = stato.editor?.dieta?.base ?? 'auto';
  return { auto: 'sul nutriente principale', kcal: 'isocalorica', proteine: 'isoproteica', carboidrati: 'isoglucidica', grassi: 'isolipidica' }[b];
};

const primoNome = (n) => String(n ?? '').trim().split(/\s+/)[0] ?? '';

function testata({ titolo, sopra = '', sotto = '', indietro = null, destra = '' }) {
  $('testa').innerHTML =
    `<div class="testa-titoli">` +
    (indietro ? `<button class="testa-indietro" id="indietro" type="button">${ico('indietro')}${esc(indietro)}</button>` : '') +
    (sopra ? `<p class="testa-sopra">${esc(sopra)}</p>` : '') +
    `<h1>${esc(titolo)}</h1>` +
    (sotto ? `<p class="testa-sotto">${sotto}</p>` : '') +
    `</div><div class="testa-azioni">${destra}</div>`;
}

async function prova(azione, messaggioOk) {
  try {
    const r = await azione();
    if (messaggioOk) notifica(messaggioOk);
    return r ?? true;
  } catch (e) {
    notifica(e.message, 'grave');
    return null;
  }
}

// Ricarica e novità

async function ricarica() {
  stato.dati = await leggi('/api/studio/cruscotto');
  aggiornaPallino();
  disegna();
}

/** Un pallino per sezione; su telefono "Altro" raccoglie quelli delle voci nascoste. */
function aggiornaPallino(c = stato.dati?.conteggi) {
  if (!c) return;
  const metti = (id, n) => {
    $(id).hidden = !n;
    $(id).textContent = String(n);
  };
  metti('pallino-clienti', c.richieste);
  metti('pallino-messaggi', c.messaggi ?? 0);
  metti('pallino-sostituzioni', c.variazioniNuove);
  metti('pallino-altro', c.variazioniNuove);
}

/** Le voci che sul telefono stanno sotto "Altro". */
const IN_ALTRO = new Set(['agenda', 'sostituzioni', 'diete', 'libreria', 'conto']);

const NOMI_SEZIONE = {
  cruscotto: 'Home',
  clienti: 'Clienti',
  messaggi: 'Messaggi',
  agenda: 'Agenda',
  sostituzioni: 'Sostituzioni',
  diete: 'Diete',
};

// Elementi ricorrenti

function chipAderenza(a) {
  if (!a || a.percentuale === null) return `<span class="chip">nessun dato</span>`;
  const tono = a.livello === 'buona' ? 'ok' : a.livello === 'parziale' ? 'attenzione' : 'grave';
  return `<span class="chip ${tono}" title="${esc(a.descrizione)}">${a.percentuale}%</span>`;
}

const TONO_SEGNALE = {
  messaggi: 'blu',
  domande: 'blu',
  aderenza: 'attenzione',
  silenzio: 'grave',
  dieta: 'attenzione',
  variazioni: 'ok',
  visita: '',
};

function rigaVariazione(v, conCliente = true) {
  return (
    `<div class="variazione${v.stato === 'nuova' ? ' nuova' : ''}${v.stato === 'annullata' ? ' annullata' : ''}">` +
    `<div class="variazione-testa"><div class="corpo">` +
    `<div class="cambio-testo"><span class="via">${esc(v.daNome)} ${esc(v.daQuantita)}</span>` +
    `${ico('avanti')}<strong>${esc(v.aNome)} ${esc(v.aQuantita)}</strong></div>` +
    `<small class="muto">${conCliente ? `${esc(v.clienteNome)} · ` : ''}${esc(GIORNI[v.giorno])} · ${esc(v.pastoNome)} · ${esc(quando(v.at))}</small>` +
    `</div>${delta(v.kcalDelta)}</div>` +
    `<div class="variazione-dati">` +
    (v.base === 'pasto-intero'
      ? `<span>pasto di un altro giorno</span>`
      : `<span>pareggio ${v.base === 'nessuno' ? 'sulle calorie' : `su ${esc(v.base)}`}</span>` +
        `<span>P ${v.proteineDelta >= 0 ? '+' : ''}${Math.round(v.proteineDelta)} g</span>` +
        `<span>C ${v.carboidratiDelta >= 0 ? '+' : ''}${Math.round(v.carboidratiDelta)} g</span>` +
        `<span>G ${v.grassiDelta >= 0 ? '+' : ''}${Math.round(v.grassiDelta)} g</span>`) +
    (v.nelPiano ? `<span class="chip ok">prevista dal piano</span>` : '') +
    `</div>` +
    (v.avvisi.length ? `<p class="variazione-avviso">${esc(v.avvisi.join(' · '))}</p>` : '') +
    (v.stato === 'annullata'
      ? `<p class="muto piccolo">${v.nota?.startsWith('Annullata') ? esc(v.nota) : `Annullata${v.nota ? `: «${esc(v.nota)}»` : ''}`}</p>`
      : `<div class="fila variazione-azioni">` +
        `<button class="btn testo piccolo rosso" data-annulla="${esc(v.id)}">Annulla</button>` +
        (conCliente ? `<button class="btn testo piccolo" data-apri-cliente="${esc(v.clienteId)}">Apri ${esc(primoNome(v.clienteNome))}</button>` : '') +
        `</div>`) +
    `</div>`
  );
}

function collegaVariazioni(radice = contenuto()) {
  for (const el of radice.querySelectorAll('[data-annulla]')) {
    el.addEventListener('click', () => chiediAnnullamento(el.dataset.annulla));
  }
  for (const el of radice.querySelectorAll('[data-apri-cliente]')) {
    el.addEventListener('click', () => apriCliente(el.dataset.apriCliente));
  }
}

function chiediAnnullamento(id) {
  const { corpo, chiudi } = foglio({ titolo: 'Annulla la sostituzione' });
  corpo.innerHTML =
    `<p class="muto sotto">Il piatto torna quello che hai prescritto. Il cliente vede la motivazione.</p>` +
    `<label class="campo"><span>Perché <span class="aiuto">facoltativo</span></span>` +
    `<textarea id="motivo-annullo" placeholder="Per esempio: troppo sale per la tua pressione."></textarea></label>` +
    `<div class="fila"><button class="btn pericolo" id="conferma-annullo">Annulla la sostituzione</button>` +
    `<button class="btn secondario" data-chiudi-foglio>Lascia stare</button></div>`;
  $('motivo-annullo').focus();

  $('conferma-annullo').addEventListener('click', async (e) => {
    e.target.disabled = true;
    const ok = await prova(
      () => invia('/api/studio/annulla-variazione', { id, nota: $('motivo-annullo').value.trim() || null }),
      'Sostituzione annullata',
    );
    if (!ok) {
      e.target.disabled = false;
      return;
    }
    chiudi();
    stato.dati = await leggi('/api/studio/cruscotto');
    aggiornaPallino();
    if (stato.cliente) await apriCliente(stato.cliente.cliente.id, stato.sezione);
    else disegna();
  });
}

function collegaRichieste() {
  for (const el of contenuto().querySelectorAll('[data-accetta], [data-rifiuta]')) {
    el.addEventListener('click', async () => {
      el.disabled = true;
      const accetta = el.dataset.accetta !== undefined;
      const ok = await prova(
        () => invia('/api/studio/decidi', { link: el.dataset.accetta ?? el.dataset.rifiuta, accetta }),
        accetta ? 'Richiesta accettata' : 'Richiesta rifiutata',
      );
      if (ok) await ricarica();
      else el.disabled = false;
    });
  }
}

function cardRichieste() {
  const richieste = stato.dati.richieste;
  if (!richieste.length) return '';
  return (
    `<section class="card lista richieste"><div class="lista-testa"><h2 class="card-titolo">Richieste</h2>` +
    `<span class="chip attenzione">${richieste.length}</span></div>` +
    richieste
      .map(
        (r) =>
          `<div class="riga">${avatar(r.nome, '', r.email)}<span class="corpo"><strong>${esc(r.nome)}</strong>` +
          `<small class="muto">${esc(r.email)} · ${esc(quando(r.richiestoIl))}</small>` +
          (r.messaggio ? `<small>«${esc(r.messaggio)}»</small>` : '') +
          `</span><div class="fila-stretta"><button class="btn secondario piccolo" data-rifiuta="${esc(r.linkId)}">Rifiuta</button>` +
          `<button class="btn piccolo" data-accetta="${esc(r.linkId)}">Accetta</button></div></div>`,
      )
      .join('') +
    `</section>`
  );
}

// Home

function disegnaCruscotto() {
  const d = stato.dati;
  const ora = new Date().getHours();
  const saluto = ora < 13 ? 'Buongiorno' : ora < 18 ? 'Buon pomeriggio' : 'Buonasera';
  const nome = d.io.nome || d.io.email.split('@')[0];

  testata({ sopra: dataLunga(), titolo: `${saluto}, ${nome}` });

  const s = d.statistiche;
  const nuove = d.variazioni.filter((v) => v.stato === 'nuova');

  const statistica = (icona, titolo, valore, sotto, classe = '') =>
    `<section class="card tessera ${classe}"><div class="tessera-testa">${ico(icona)}<span>${esc(titolo)}</span></div>` +
    `<div class="tessera-valore">${valore}</div><div class="tessera-sotto">${esc(sotto)}</div></section>`;

  const daSeguire = d.daSeguire.length
    ? d.daSeguire
        .map((c) => {
          const cliente = d.clienti.find((x) => x.id === c.id);
          return (
            `<button class="riga riga-link" type="button" data-apri-cliente="${esc(c.id)}">` +
            avatar(c.nome, '', c.email) +
            `<span class="corpo"><strong>${esc(c.nome)}</strong><span class="segnali">` +
            c.segnali.map((x) => `<span class="chip ${TONO_SEGNALE[x.tipo] ?? ''}">${esc(x.testo)}</span>`).join('') +
            `</span></span>${cliente ? chipAderenza(cliente.aderenza) : ''}${ico('avanti')}</button>`
          );
        })
        .join('')
    : `<div class="vuoto">${ico('spunta')}<strong>Tutto in ordine</strong><span>Nessun cliente ha bisogno di te adesso.</span></div>`;

  contenuto().innerHTML =
    (d.ai.attivo ? '' : `<div class="sotto">${avviso('neutro', d.ai.motivo)}</div>`) +
    `<div class="tessere quattro">` +
    statistica('persone', 'Clienti', numero(s.clienti), s.clienti === 1 ? 'seguito' : 'seguiti') +
    statistica('grafico', 'Aderenza media', s.aderenzaMedia == null ? '—' : `${s.aderenzaMedia}<small>%</small>`, 'ultimi 7 giorni') +
    statistica('campana', 'Da seguire', numero(d.daSeguire.length), d.daSeguire.length === 1 ? 'cliente' : 'clienti', 'arancio') +
    statistica('calendario', 'Visite', numero(s.visiteSettimana), 'nei prossimi 7 giorni', 'blu') +
    `</div>` +
    `<div class="colonne larga-stretta sopra">` +
    `<div class="pila"><section class="card lista"><div class="lista-testa"><h2 class="card-titolo">Da seguire</h2></div>${daSeguire}</section></div>` +
    `<div class="pila">${cardRichieste()}` +
    `<section class="card"><div class="card-testa"><h2 class="card-titolo">Ultime sostituzioni</h2>` +
    (nuove.length ? `<span class="chip blu">${nuove.length} nuove</span>` : '') +
    `<button class="btn testo piccolo" data-vai="sostituzioni">Tutte</button></div>` +
    (d.variazioni.length
      ? `<div class="lista-variazioni">${d.variazioni.slice(0, 4).map((v) => rigaVariazione(v)).join('')}</div>`
      : `<p class="muto">Quando un cliente sostituisce un alimento lo trovi qui, con la grammatura equivalente.</p>`) +
    `</section></div></div>`;

  collegaVai();
  collegaVariazioni();
  collegaRichieste();
}

// Elenco clienti

function disegnaClienti() {
  const clienti = stato.dati.clienti;

  testata({
    titolo: 'Clienti',
    sotto: `${clienti.length} client${clienti.length === 1 ? 'e' : 'i'}`,
    destra: `<button class="btn piccolo" id="aggiungi-cliente">${ico('piu')} Aggiungi</button>`,
  });

  const riga = (c) => {
    const segnali = [
      c.messaggiDaLeggere ? `<span class="chip blu">${c.messaggiDaLeggere} ${c.messaggiDaLeggere === 1 ? 'messaggio' : 'messaggi'}</span>` : '',
      c.variazioniNuove ? `<span class="chip ok">${c.variazioniNuove} sostituzion${c.variazioniNuove === 1 ? 'e' : 'i'}</span>` : '',
      !c.dieta ? `<span class="chip attenzione">senza dieta</span>` : c.dieta.stato !== 'pubblicata' ? `<span class="chip attenzione">bozza</span>` : '',
      c.prossimaVisita ? `<span class="chip">${ico('calendario')} ${esc(dataBreve(c.prossimaVisita.slice(0, 10)))}</span>` : '',
    ].join('');
    return (
      `<button class="riga riga-link riga-cliente" type="button" data-apri-cliente="${esc(c.id)}" data-cerca="${esc(`${c.nome} ${c.email}`.toLowerCase())}">` +
      avatar(c.nome, '', c.email) +
      `<span class="corpo"><strong>${esc(c.nome)}</strong><small class="muto">${esc(c.email)}</small></span>` +
      `<span class="segnali da-largo">${segnali}</span>` +
      `<span class="colonna-aderenza">${chipAderenza(c.aderenza)}</span>${ico('avanti')}</button>`
    );
  };

  contenuto().innerHTML =
    (cardRichieste() ? `<div class="sotto">${cardRichieste()}</div>` : '') +
    `<label class="ricerca sotto"><span class="nascosto">Cerca</span>${ico('cerca')}` +
    `<input id="cerca-clienti" type="search" placeholder="Cerca per nome o email" autocomplete="off"></label>` +
    (clienti.length
      ? `<section class="card lista" id="elenco-clienti">${clienti.map(riga).join('')}</section>` +
        `<p class="vuoto" id="nessun-risultato" hidden>Nessun cliente corrisponde alla ricerca.</p>`
      : `<section class="card vuoto">${ico('persone')}<strong>Nessun cliente ancora</strong>` +
        `<span>I clienti si iscrivono e ti aggiungono con la tua email: la richiesta arriva qui.</span></section>`);

  collegaRichieste();
  collegaVariazioni();

  $('cerca-clienti').addEventListener('input', () => {
    const q = $('cerca-clienti').value.trim().toLowerCase();
    let visibili = 0;
    for (const r of contenuto().querySelectorAll('#elenco-clienti .riga')) {
      r.hidden = Boolean(q) && !r.dataset.cerca.includes(q);
      if (!r.hidden) visibili++;
    }
    if ($('nessun-risultato')) $('nessun-risultato').hidden = visibili > 0;
  });

  $('aggiungi-cliente').addEventListener('click', () => {
    const { corpo } = foglio({ titolo: 'Aggiungere un cliente' });
    corpo.innerHTML =
      `<p class="sotto">Il cliente si iscrive come "Seguo una dieta" e ti cerca con questa email:</p>` +
      `<div class="copia"><code id="email-studio">${esc(stato.dati.io.email)}</code>` +
      `<button class="btn secondario piccolo" id="copia-email">Copia</button></div>` +
      `<p class="muto piccolo sopra">La sua richiesta compare in Home e in Clienti: la accetti e puoi scrivergli la dieta.</p>`;
    $('copia-email').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(stato.dati.io.email);
        notifica('Email copiata');
      } catch {
        notifica('Copia non riuscita: selezionala a mano.', 'attenzione');
      }
    });
  });
}

// Scheda del cliente

async function apriCliente(id, sezione = null) {
  // Il "torna indietro" riporta alla pagina da cui si è aperto il cliente.
  if (stato.tab !== 'clienti' && !stato.cliente) stato.provenienza = stato.tab;
  stato.tab = 'clienti';
  stato.editor = null;
  if (stato.cliente?.cliente.id !== id) stato.sezione = sezione ?? 'panoramica';
  else if (sezione) stato.sezione = sezione;
  evidenziaScheda();
  contenuto().innerHTML = caricamento();

  try {
    stato.cliente = await leggi('/api/studio/cliente', new URLSearchParams({ cliente: id }));
    disegnaCliente();
  } catch (e) {
    stato.cliente = null;
    disegna();
    notifica(e.message, 'grave');
  }
}

const SEZIONI = [
  ['panoramica', 'Panoramica'],
  ['dieta', 'Dieta'],
  ['misure', 'Misure'],
  ['scheda', 'Scheda'],
  ['note', 'Note'],
  ['messaggi', 'Messaggi'],
];

function disegnaCliente() {
  const d = stato.cliente;
  const c = d.cartella;
  const anni = eta(c.nascita);
  const meta = [
    anni != null ? `${anni} anni` : '',
    c.sesso === 'F' ? 'donna' : c.sesso === 'M' ? 'uomo' : '',
    c.altezza ? `${numero(c.altezza)} cm` : '',
    esc(d.cliente.email),
  ].filter(Boolean);

  testata({
    indietro: NOMI_SEZIONE[stato.provenienza] ?? 'Clienti',
    titolo: d.cliente.nome,
    sotto: meta.join(' · '),
    destra:
      `<button class="btn-icona" id="vai-messaggi" aria-label="Messaggi">${ico('chat')}</button>` +
      `<button class="btn-icona" id="apri-menu" aria-label="Altre azioni">${ico('puntini')}</button>`,
  });

  const allergie = c.allergie
    .split(/[,;\n]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  contenuto().innerHTML =
    (allergie.length
      ? `<div class="fila sotto allergie">${ico('allerta')}<span class="muto piccolo">Allergie e intolleranze:</span>` +
        allergie.map((a) => `<span class="chip grave">${esc(a)}</span>`).join('') +
        `</div>`
      : '') +
    segmenti('sezioni-cliente', SEZIONI, stato.sezione) +
    `<div id="sezione" class="sopra"></div>`;

  collegaSegmenti('sezioni-cliente', (v) => {
    stato.sezione = v;
    disegnaSezione();
  });

  $('indietro').addEventListener('click', () => {
    stato.cliente = null;
    stato.tab = stato.provenienza ?? 'clienti';
    stato.provenienza = null;
    disegna();
    window.scrollTo(0, 0);
  });
  $('vai-messaggi').addEventListener('click', () => vaiASezione('messaggi'));
  $('apri-menu').addEventListener('click', apriMenuCliente);

  disegnaSezione();
}

function vaiASezione(sezione) {
  stato.sezione = sezione;
  for (const b of $('sezioni-cliente').querySelectorAll('button')) {
    b.setAttribute('aria-pressed', String(b.dataset.valore === sezione));
  }
  disegnaSezione();
}

function apriMenuCliente() {
  const d = stato.cliente;
  const { corpo, chiudi } = foglio({ titolo: d.cliente.nome });
  corpo.innerHTML =
    `<section class="card lista piatta">` +
    `<button class="riga riga-link" id="menu-scheda" type="button">${ico('cartella')}<span class="corpo">Scheda clinica</span>${ico('avanti')}</button>` +
    `<button class="riga riga-link" id="menu-stampa" type="button"${d.dietaAttuale ? '' : ' disabled'}>${ico('stampa')}<span class="corpo">Stampa la dieta</span>${ico('avanti')}</button>` +
    `</section>` +
    `<div class="sopra"><button class="btn testo rosso" id="scollega">Smetti di seguire ${esc(primoNome(d.cliente.nome))}</button></div>`;

  $('menu-scheda').addEventListener('click', () => {
    chiudi();
    vaiASezione('scheda');
  });
  $('menu-stampa').addEventListener('click', () => {
    chiudi();
    stampa();
  });
  $('scollega').addEventListener('click', async () => {
    const b = $('scollega');
    if (!b.dataset.confermato) {
      b.dataset.confermato = '1';
      b.textContent = 'Confermi? Non vedrà più la dieta';
      return;
    }
    if (await prova(() => invia('/api/studio/scollega', { link: d.cliente.linkId }), 'Collegamento sciolto')) {
      chiudi();
      stato.cliente = null;
      await ricarica();
    }
  });
}

function stampa() {
  const d = stato.cliente;
  const dieta = d.dietaAttuale;
  if (!dieta) return;
  stampaDieta({
    titolo: dieta.titolo,
    autore: stato.dati.io.nome || stato.dati.io.email,
    cliente: d.cliente.nome,
    indicazioni: dieta.indicazioni,
    obiettivi: dieta.obiettivi,
    giorni: dieta.giorni,
  });
}

function disegnaSezione() {
  const zona = $('sezione');
  const sezioni = {
    panoramica: sezionePanoramica,
    dieta: sezioneDieta,
    misure: sezioneMisure,
    scheda: sezioneScheda,
    note: sezioneNote,
    messaggi: sezioneMessaggi,
  };
  (sezioni[stato.sezione] ?? sezionePanoramica)(zona, stato.cliente);
  applicaMisure(zona);
}

/* Panoramica */

function sezionePanoramica(zona, d) {
  const a = stato.periodo === '30' ? d.aderenza30 : d.aderenza;
  const tono = !a || a.percentuale === null ? '' : a.livello === 'buona' ? '' : a.livello === 'parziale' ? 'tono-attenzione' : 'tono-grave';

  const media = (lista, chiave) => {
    const valori = lista.map((x) => x[chiave]).filter((v) => v != null);
    return valori.length ? valori.reduce((s, v) => s + v, 0) / valori.length : null;
  };
  const passi7 = d.passi.slice(0, 7);
  const acqua7 = d.acqua.slice(0, 7);
  const obiettivi = d.dietaAttuale?.obiettivi ?? {};
  const pesate = d.misure.filter((m) => m.peso != null);
  const ultimo = pesate.at(-1);
  const variazione = pesate.length > 1 ? ultimo.peso - pesate[0].peso : null;

  const serie14 = (lista, chiave) =>
    [...Array(14)].map((_, i) => {
      const g = new Date();
      g.setUTCDate(g.getUTCDate() - (13 - i));
      const giorno = g.toISOString().slice(0, 10);
      return { etichetta: dataBreve(giorno), valore: lista.find((x) => x.giorno === giorno)?.[chiave] ?? null };
    });

  const bassa = a && a.percentuale !== null && a.livello !== 'buona';

  zona.innerHTML =
    (bassa
      ? `<div class="sotto">${avviso(
          'attenzione',
          `${esc(primoNome(d.cliente.nome))} sta seguendo poco il piano. <button class="btn testo piccolo" id="manda-avviso">Scrivigli</button>`,
          true,
        )}</div>`
      : '') +
    `<div class="tessere quattro">` +
    `<section class="card tessera ${tono}"><div class="tessera-testa">${ico('grafico')}<span>Aderenza</span></div>` +
    `<div class="tessera-anello">${anello(a?.percentuale ?? null, a?.percentuale == null ? '—' : `${a.percentuale}%`, '', 'piccolo')}` +
    `<p class="tessera-sotto">${esc(a?.descrizione ?? 'Nessuna dieta pubblicata.')}</p></div>` +
    `<div class="tessera-piede">${segmenti('periodo-aderenza', [['7', '7 giorni'], ['30', '30 giorni']], stato.periodo)}</div></section>` +
    `<section class="card tessera passi"><div class="tessera-testa">${ico('scarpa')}<span>Passi</span></div>` +
    `<div class="tessera-valore">${numero(media(passi7, 'passi'))}</div>` +
    `<div class="tessera-sotto">media 7 giorni${obiettivi.passi ? ` · obiettivo ${numero(obiettivi.passi)}` : ''}</div>` +
    `<div class="tessera-piede">${barre(serie14(d.passi, 'passi'), obiettivi.passi ?? null)}</div></section>` +
    `<section class="card tessera acqua"><div class="tessera-testa">${ico('goccia')}<span>Acqua</span></div>` +
    `<div class="tessera-valore">${media(acqua7, 'ml') == null ? '—' : `${numero(media(acqua7, 'ml') / 1000, 1)}<small> L</small>`}</div>` +
    `<div class="tessera-sotto">media 7 giorni${obiettivi.acqua ? ` · obiettivo ${numero(obiettivi.acqua, 1)} L` : ''}</div>` +
    `<div class="tessera-piede blu">${barre(serie14(d.acqua, 'ml'), obiettivi.acqua ? obiettivi.acqua * 1000 : null)}</div></section>` +
    `<section class="card tessera peso"><div class="tessera-testa">${ico('bilancia')}<span>Peso</span></div>` +
    `<div class="tessera-valore">${ultimo ? `${numero(ultimo.peso, 1)}<small> kg</small>` : '—'}</div>` +
    `<div class="tessera-sotto">${variazione != null ? `${variazione > 0 ? '+' : ''}${numero(variazione, 1)} kg dal ${dataBreve(pesate[0].giorno)}` : ultimo ? `il ${dataBreve(ultimo.giorno)}` : 'nessuna misura'}</div>` +
    `<div class="tessera-piede">${pesate.length > 1 ? `<div class="mini-linea">${linea(pesate.map((m) => ({ etichetta: dataBreve(m.giorno), valore: m.peso })), { unita: 'kg', assi: false })}</div>` : ''}</div></section>` +
    `</div>` +
    `<div class="colonne larga-stretta sopra">` +
    `<div class="pila"><section class="card lista"><div class="lista-testa"><h2 class="card-titolo">Ultimi 14 giorni</h2></div>` +
    (d.diario.length ? d.diario.map(rigaDiario).join('') : `<p class="vuoto">Senza una dieta non c'è niente da segnare.</p>`) +
    `</section></div>` +
    `<div class="pila">` +
    `<section class="card"><h2 class="card-titolo">In breve</h2><ul class="lista-icone">` +
    `<li>${ico('stella')}<span>${d.obiettivo ? `Obiettivo: «${esc(d.obiettivo)}»` : '<span class="muto">Non ha scritto un obiettivo</span>'}</span></li>` +
    `<li>${ico('calendario')}<span>${d.cartella.prossimaVisita ? `Prossima visita ${esc(dataOra(d.cartella.prossimaVisita))}` : '<span class="muto">Nessuna visita fissata</span>'}</span></li>` +
    `<li>${ico('documento')}<span>${d.dietaAttuale ? `${esc(d.dietaAttuale.titolo)} · ${esc(d.dietaAttuale.stato)}` : '<span class="muto">Nessuna dieta</span>'}</span></li>` +
    `</ul>` +
    (d.note.length
      ? `<div class="divisore"></div><p class="muto piccolo">Ultima nota, ${esc(quando(d.note[0].at))}</p><p class="nota-breve">${esc(d.note[0].testo)}</p>`
      : '') +
    `</section>` +
    `<section class="card"><h2 class="card-titolo">Sostituzioni</h2>` +
    (d.variazioni.length
      ? `<div class="lista-variazioni">${d.variazioni.slice(0, 6).map((v) => rigaVariazione(v, false)).join('')}</div>`
      : `<p class="muto">Non ha ancora cambiato nulla.</p>`) +
    `</section></div></div>`;

  collegaSegmenti('periodo-aderenza', (v) => {
    stato.periodo = v;
    disegnaSezione();
  });
  collegaVariazioni(zona);
  $('manda-avviso')?.addEventListener('click', () => {
    vaiASezione('messaggi');
    $('testo-studio').value =
      `Ciao ${primoNome(d.cliente.nome)}, ho visto che ultimamente stai seguendo poco il piano. Come va? ` +
      `Se c'è qualcosa che non ti torna ne parliamo e lo sistemiamo insieme.`;
    $('testo-studio').focus();
  });
}

/* Dieta */

function sezioneDieta(zona, d) {
  const dieta = d.dietaAttuale;
  const storiche = d.diete.filter((x) => !dieta || x.id !== dieta.id);
  const bozze = dieta?.stato === 'pubblicata' ? storiche.filter((x) => x.stato === 'bozza') : [];

  const attenzioni = d.attenzioni.length
    ? `<div class="sotto">${avviso(
        'grave',
        `<strong>Allergie:</strong> nella dieta ci sono alimenti da controllare. ` +
          d.attenzioni.map((x) => `${esc(x.alimento)} (${esc(x.allergene)}; ${esc(x.dove.slice(0, 3).join(', '))}${x.dove.length > 3 ? '…' : ''})`).join(' · '),
        true,
      )}</div>`
    : '';

  const piano = dieta
    ? `<section class="card"><div class="card-testa"><h2 class="card-titolo">${esc(dieta.titolo)}</h2>` +
      `<span class="chip ${dieta.stato === 'pubblicata' ? 'ok' : 'attenzione'}">${esc(dieta.stato)}</span></div>` +
      `<div class="valori-griglia">` +
      [
        ['Calorie', `${numero(dieta.mediaKcal)} kcal`],
        ['Proteine', `${numero(dieta.mediaProteine)} g`],
        ['Carboidrati', `${numero(dieta.mediaCarboidrati)} g`],
        ['Grassi', `${numero(dieta.mediaGrassi)} g`],
      ]
        .map(([n, v]) => `<div><span>${n}</span><strong>${v}</strong></div>`)
        .join('') +
      `</div><p class="muto piccolo sopra">Media di ${dieta.giorniScritti} giorni scritti${dieta.parziale ? ', conto parziale' : ''}` +
      `${dieta.pubblicataIl ? ` · pubblicata ${esc(quando(dieta.pubblicataIl))}` : ''}</p>` +
      `<div class="fila sopra">` +
      `<button class="btn" data-modifica="${esc(dieta.id)}">${ico('matita')} Modifica</button>` +
      (dieta.stato === 'pubblicata'
        ? `<button class="btn secondario" data-ritira="${esc(dieta.id)}">Ritira</button>`
        : `<button class="btn secondario" data-pubblica="${esc(dieta.id)}">Pubblica</button>`) +
      `<button class="btn secondario" id="nuova-dieta">${ico('piu')} Nuova dieta</button>` +
      `<button class="btn secondario" id="stampa-dieta">${ico('stampa')} Stampa</button>` +
      `<a class="btn secondario" id="apri-pdf" hidden href="/api/studio/pdf?dieta=${encodeURIComponent(dieta.id)}" target="_blank" rel="noopener">${ico('pdf')} PDF</a>` +
      `<button class="btn testo rosso spinge" id="elimina-dieta">Elimina</button>` +
      `</div></section>`
    : `<section class="card vuoto">${ico('documento')}<strong>Nessuna dieta</strong>` +
      `<span>Finché non ne pubblichi una, ${esc(primoNome(d.cliente.nome))} entra e non vede niente.</span>` +
      `<div class="fila sopra"><button class="btn" id="nuova-dieta">${ico('piu')} Nuova dieta</button></div></section>`;

  const settimana = dieta
    ? `<h2 class="sezione-titolo">La settimana come la segue</h2><div class="settimana-griglia">` +
      dieta.giorni
        .map(
          (g) =>
            `<section class="card giorno-studio"><div class="card-testa"><h3>${esc(g.nome)}</h3>` +
            (g.allenamento ? `<span class="chip">allenamento</span>` : '') +
            `<span class="muto piccolo spinge">${g.parziale ? '≈ ' : ''}${numero(g.kcal)} kcal</span></div>` +
            (g.pasti.length
              ? g.pasti
                  .map(
                    (p) =>
                      `<div class="giorno-pasto"><div class="giorno-pasto-testa"><strong>${esc(p.nome)}</strong>` +
                      (g.indice === d.oggi?.indice && d.oggi.fatti.includes(p.id)
                        ? `<span class="chip ok">fatto oggi</span>`
                        : g.indice === d.oggi?.indice && d.oggi.saltati.includes(p.id)
                          ? `<span class="chip attenzione">saltato oggi</span>`
                          : `<span class="muto">${numero(p.kcal)} kcal</span>`) +
                      `</div><ul>` +
                      p.alimenti
                        .map(
                          (a) =>
                            `<li${a.cambiato ? ' class="cambiato" title="sostituito dal cliente"' : ''}><span>${esc(a.nome)}</span>` +
                            `<span class="muto">${esc(a.quantita)}</span></li>`,
                        )
                        .join('') +
                      `</ul></div>`,
                  )
                  .join('')
              : `<p class="muto piccolo">Niente scritto.</p>`) +
            `</section>`,
        )
        .join('') +
      `</div>`
    : '';

  zona.innerHTML =
    bozze
      .map(
        (x) =>
          `<div class="sotto">${avviso(
            'attenzione',
            `Bozza in corso, non ancora pubblicata: <strong>${esc(x.titolo)}</strong> (${esc(quando(x.aggiornataIl))}). ` +
              `<button class="btn testo piccolo" data-modifica="${esc(x.id)}">Continua</button>`,
            true,
          )}</div>`,
      )
      .join('') +
    attenzioni +
    piano +
    settimana +
    (storiche.length
      ? `<h2 class="sezione-titolo">Altre diete</h2><section class="card lista">` +
        storiche
          .map(
            (x) =>
              `<div class="riga"><span class="corpo"><strong>${esc(x.titolo)}</strong>` +
              `<small class="muto">${esc(x.stato)} · aggiornata ${esc(quando(x.aggiornataIl))}</small></span>` +
              `<button class="btn secondario piccolo" data-modifica="${esc(x.id)}">Apri</button>` +
              `<button class="btn testo piccolo rosso" data-elimina-dieta="${esc(x.id)}">Elimina</button></div>`,
          )
          .join('') +
        `</section>`
      : '');

  for (const el of zona.querySelectorAll('[data-modifica]')) {
    el.addEventListener('click', () => apriEditor(el.dataset.modifica));
  }
  for (const el of zona.querySelectorAll('[data-pubblica]')) {
    el.addEventListener('click', () => pubblica(el.dataset.pubblica));
  }
  for (const el of zona.querySelectorAll('[data-ritira]')) {
    el.addEventListener('click', async () => {
      if (await prova(() => invia('/api/studio/ritira', { id: el.dataset.ritira }), 'Dieta ritirata: il cliente non la vede più')) {
        await apriCliente(d.cliente.id, 'dieta');
      }
    });
  }
  for (const el of zona.querySelectorAll('[data-elimina-dieta]')) {
    el.addEventListener('click', () => confermaElimina(el.dataset.eliminaDieta));
  }
  $('elimina-dieta')?.addEventListener('click', () => confermaElimina(dieta.id));
  $('nuova-dieta').addEventListener('click', () => apriNuovaDieta(d.cliente.id));
  $('stampa-dieta')?.addEventListener('click', stampa);

  if (dieta) {
    leggi('/api/studio/info-pdf', new URLSearchParams({ dieta: dieta.id }))
      .then((r) => {
        if (r.pdf && $('apri-pdf')) $('apri-pdf').hidden = false;
      })
      .catch(() => {});
  }
}

function confermaElimina(dietaId) {
  const d = stato.cliente;
  const dieta = d.diete.find((x) => x.id === dietaId);
  const { corpo, chiudi } = foglio({ titolo: 'Eliminare la dieta?' });
  corpo.innerHTML =
    `<p class="sotto">«${esc(dieta?.titolo ?? '')}» sparisce anche per ${esc(primoNome(d.cliente.nome))}. Non si può annullare.</p>` +
    `<div class="fila"><button class="btn pericolo" id="conferma-elimina">Elimina</button>` +
    `<button class="btn secondario" data-chiudi-foglio>Annulla</button></div>`;
  $('conferma-elimina').addEventListener('click', async () => {
    if (await prova(() => invia('/api/studio/elimina-dieta', { id: dietaId }), 'Dieta eliminata')) {
      chiudi();
      await apriCliente(d.cliente.id, 'dieta');
    }
  });
}

async function apriNuovaDieta(clienteId) {
  const { corpo, chiudi } = foglio({ titolo: 'Nuova dieta' });
  corpo.innerHTML =
    `<section class="card lista piatta">` +
    `<button class="riga riga-link" id="da-zero" type="button">${ico('documento')}<span class="corpo"><strong>Vuota</strong><small class="muto">Sette giorni da scrivere</small></span>${ico('avanti')}</button>` +
    `<button class="riga riga-link" id="da-pdf" type="button">${ico('pdf')}<span class="corpo"><strong>Da un PDF</strong><small class="muto">La leggo e preparo una bozza da controllare</small></span>${ico('avanti')}</button>` +
    `</section>` +
    `<input type="file" id="file-pdf" accept="application/pdf" hidden>` +
    `<h3 class="sezione-titolo">Parti da una dieta che hai già scritto</h3>` +
    `<div id="modelli">${caricamento()}</div>`;

  $('da-zero').addEventListener('click', async () => {
    chiudi();
    await nuovaDieta(clienteId, '');
  });
  $('da-pdf').addEventListener('click', () => $('file-pdf').click());
  $('file-pdf').addEventListener('change', () => {
    const file = $('file-pdf').files[0];
    chiudi();
    if (file) caricaPdf(clienteId, file);
  });

  try {
    const { diete } = await leggi('/api/studio/modelli');
    $('modelli').innerHTML = diete.length
      ? `<section class="card lista piatta">` +
        diete
          .map(
            (x) =>
              `<button class="riga riga-link" type="button" data-modello="${esc(x.id)}"><span class="corpo"><strong>${esc(x.titolo)}</strong>` +
              `<small class="muto">${esc(x.cliente)} · ${esc(x.stato)} · ${esc(quando(x.aggiornataIl))}</small></span>${ico('avanti')}</button>`,
          )
          .join('') +
        `</section>`
      : `<p class="muto piccolo">Non hai ancora altre diete.</p>`;
    for (const el of $('modelli').querySelectorAll('[data-modello]')) {
      el.addEventListener('click', async () => {
        chiudi();
        await nuovaDieta(clienteId, el.dataset.modello);
      });
    }
  } catch (e) {
    $('modelli').innerHTML = avviso('grave', e.message);
  }
}

async function nuovaDieta(clienteId, daId) {
  const titolo = `Dieta di ${new Date().toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })}`;
  const esito = await prova(() => invia('/api/studio/nuova-dieta', { cliente: clienteId, titolo, da: daId ?? '' }));
  if (esito) await apriEditor(esito.id);
}

async function pubblica(dietaId) {
  const p = await prova(() => invia('/api/studio/pubblica', { id: dietaId }));
  if (!p) return;
  if (p.avviso) notifica(p.avviso, 'attenzione');
  else notifica('Pubblicata: il cliente la vede da adesso');
  await apriCliente(stato.cliente.cliente.id, 'dieta');
}

/* Misure */

function sezioneMisure(zona, d) {
  const pesate = d.misure.filter((m) => m.peso != null);
  const oggi = new Date().toISOString().slice(0, 10);
  const cella = (v, decimali = 1) => (v == null ? '<span class="muto">—</span>' : numero(v, decimali));

  zona.innerHTML =
    `<div class="colonne larga-stretta">` +
    `<div class="pila">` +
    `<section class="card"><div class="card-testa"><h2 class="card-titolo">Peso</h2>` +
    (pesate.length ? `<span class="muto piccolo">${pesate.length} misure</span>` : '') +
    `</div>` +
    (pesate.length > 1
      ? linea(pesate.map((m) => ({ etichetta: dataBreve(m.giorno), valore: m.peso })), { unita: 'kg' })
      : `<p class="muto">Servono almeno due pesate per vedere l'andamento. Le scrive anche il cliente dall'app.</p>`) +
    `</section>` +
    `<section class="card lista"><div class="lista-testa"><h2 class="card-titolo">Storico</h2></div>` +
    (d.misure.length
      ? `<div class="scorri"><table class="tabella"><thead><tr><th>Data</th><th class="num">Peso</th><th class="num">Vita</th>` +
        `<th class="num">Fianchi</th><th class="num">Grasso</th><th>Da</th><th></th></tr></thead><tbody>` +
        d.misure
          .slice()
          .reverse()
          .map(
            (m) =>
              `<tr><td>${esc(dataBreve(m.giorno))}</td><td class="num">${cella(m.peso)}</td><td class="num">${cella(m.vita)}</td>` +
              `<td class="num">${cella(m.fianchi)}</td><td class="num">${m.grasso == null ? cella(null) : `${numero(m.grasso, 1)}%`}</td>` +
              `<td class="muto">${m.autore === 'cliente' ? 'cliente' : 'studio'}</td>` +
              `<td><button class="btn-icona piccolo" data-elimina-misura="${esc(m.giorno)}" aria-label="Elimina la misura del ${esc(dataBreve(m.giorno))}">${ico('cestino')}</button></td></tr>`,
          )
          .join('') +
        `</tbody></table></div>`
      : `<p class="vuoto">Nessuna misura.</p>`) +
    `</section></div>` +
    `<section class="card"><h2 class="card-titolo">Nuova misura</h2>` +
    `<form id="form-misura" novalidate>` +
    `<label class="campo"><span>Data</span><input id="mis-giorno" type="date" value="${oggi}" max="${oggi}"></label>` +
    `<div class="campi">` +
    `<label class="campo"><span>Peso (kg)</span><input id="mis-peso" type="text" inputmode="decimal" placeholder="72,4"></label>` +
    `<label class="campo"><span>Massa grassa (%)</span><input id="mis-grasso" type="text" inputmode="decimal" placeholder="22"></label>` +
    `<label class="campo"><span>Vita (cm)</span><input id="mis-vita" type="text" inputmode="decimal" placeholder="84"></label>` +
    `<label class="campo"><span>Fianchi (cm)</span><input id="mis-fianchi" type="text" inputmode="decimal" placeholder="98"></label>` +
    `</div><button class="btn larga" type="submit">Salva misura</button></form></section></div>`;

  $('form-misura').addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await prova(
      () =>
        invia('/api/studio/misura', {
          cliente: d.cliente.id,
          giorno: $('mis-giorno').value,
          peso: $('mis-peso').value.trim(),
          vita: $('mis-vita').value.trim(),
          fianchi: $('mis-fianchi').value.trim(),
          grasso: $('mis-grasso').value.trim(),
        }),
      'Misura salvata',
    );
    if (r) {
      d.misure = r.misure;
      disegnaSezione();
    }
  });
  for (const el of zona.querySelectorAll('[data-elimina-misura]')) {
    el.addEventListener('click', async () => {
      const r = await prova(() => invia('/api/studio/elimina-misura', { cliente: d.cliente.id, giorno: el.dataset.eliminaMisura }), 'Misura eliminata');
      if (r) {
        d.misure = r.misure;
        disegnaSezione();
      }
    });
  }
}

/* Scheda clinica */

function sezioneScheda(zona, d) {
  const c = d.cartella;
  const ultimo = d.misure.filter((m) => m.peso != null).at(-1);
  const bmi = ultimo && c.altezza ? ultimo.peso / (c.altezza / 100) ** 2 : null;

  zona.innerHTML =
    `<div class="colonne larga-stretta">` +
    `<section class="card"><form id="form-scheda" novalidate>` +
    `<h2 class="card-titolo">Dati personali</h2>` +
    `<div class="campi">` +
    `<label class="campo"><span>Data di nascita</span><input id="sc-nascita" type="date" value="${esc(c.nascita ?? '')}"></label>` +
    `<label class="campo"><span>Sesso</span><select id="sc-sesso">` +
    [['', '—'], ['F', 'Donna'], ['M', 'Uomo']].map(([v, t]) => `<option value="${v}"${(c.sesso ?? '') === v ? ' selected' : ''}>${t}</option>`).join('') +
    `</select></label>` +
    `<label class="campo"><span>Altezza (cm)</span><input id="sc-altezza" type="number" min="50" max="250" value="${c.altezza ?? ''}"></label>` +
    `</div>` +
    `<h2 class="card-titolo sopra">Salute</h2>` +
    `<label class="campo"><span>Allergie e intolleranze <span class="aiuto">separate da virgole, es. lattosio, frutta a guscio</span></span>` +
    `<input id="sc-allergie" type="text" value="${esc(c.allergie)}"></label>` +
    `<label class="campo"><span>Patologie e condizioni</span><textarea id="sc-patologie">${esc(c.patologie)}</textarea></label>` +
    `<label class="campo"><span>Farmaci e integratori</span><input id="sc-farmaci" type="text" value="${esc(c.farmaci)}"></label>` +
    `<label class="campo"><span>Preferenze e abitudini <span class="aiuto">cosa non mangia, orari, sport</span></span>` +
    `<textarea id="sc-preferenze">${esc(c.preferenze)}</textarea></label>` +
    `<h2 class="card-titolo sopra">Prossima visita <span class="aiuto">la vede anche il cliente</span></h2>` +
    `<label class="campo"><span>Data e ora</span><input id="sc-visita" type="datetime-local" value="${esc(c.prossimaVisita ?? '')}"></label>` +
    `<div class="fila"><button class="btn" type="submit">Salva la scheda</button>` +
    (c.aggiornataIl ? `<span class="muto piccolo">aggiornata ${esc(quando(c.aggiornataIl))}</span>` : '') +
    `</div></form></section>` +
    `<div class="pila">` +
    `<section class="card"><h2 class="card-titolo">Calcolati</h2><div class="valori-griglia due">` +
    `<div><span>Età</span><strong>${eta(c.nascita) ?? '—'}</strong></div>` +
    `<div><span>BMI</span><strong>${bmi ? numero(bmi, 1) : '—'}</strong></div>` +
    `<div><span>Ultimo peso</span><strong>${ultimo ? `${numero(ultimo.peso, 1)} kg` : '—'}</strong></div>` +
    `<div><span>Altezza</span><strong>${c.altezza ? `${numero(c.altezza)} cm` : '—'}</strong></div>` +
    `</div>${bmi ? '' : `<p class="muto piccolo sopra">Il BMI compare con altezza e almeno una pesata.</p>`}</section>` +
    `<section class="card"><h2 class="card-titolo">Il suo obiettivo</h2>` +
    `<p>${d.obiettivo ? `«${esc(d.obiettivo)}»` : '<span class="muto">Non l’ha ancora scritto nel suo profilo.</span>'}</p></section>` +
    `<p class="muto piccolo">Allergie, patologie, farmaci e preferenze li vedi solo tu. Le allergie servono anche a ` +
    `segnalarti gli alimenti da controllare nell'editor e a togliere quelli rischiosi dalle sostituzioni proposte al cliente.</p>` +
    `</div></div>`;

  $('form-scheda').addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await prova(
      () =>
        invia('/api/studio/cartella', {
          cliente: d.cliente.id,
          nascita: $('sc-nascita').value,
          sesso: $('sc-sesso').value,
          altezza: $('sc-altezza').value,
          allergie: $('sc-allergie').value,
          patologie: $('sc-patologie').value,
          farmaci: $('sc-farmaci').value,
          preferenze: $('sc-preferenze').value,
          prossimaVisita: $('sc-visita').value,
        }),
      'Scheda salvata',
    );
    if (r) await apriCliente(d.cliente.id, 'scheda');
  });
}

/* Note */

function sezioneNote(zona, d) {
  zona.innerHTML =
    `<div class="colonne larga-stretta">` +
    `<div class="pila">` +
    (d.note.length
      ? d.note
          .map(
            (n) =>
              `<section class="card nota"><div class="card-testa"><span class="muto piccolo">${esc(dataOra(n.at))}</span>` +
              `<button class="btn-icona piccolo spinge" data-elimina-nota="${esc(n.id)}" aria-label="Elimina la nota">${ico('cestino')}</button></div>` +
              `<p>${esc(n.testo)}</p></section>`,
          )
          .join('')
      : `<section class="card vuoto">${ico('nota')}<strong>Nessuna nota</strong><span>Appunti di visita, impressioni, cose da ricordare.</span></section>`) +
    `</div>` +
    `<section class="card"><h2 class="card-titolo">Nuova nota</h2>` +
    `<textarea id="testo-nota" placeholder="Cosa è emerso nella visita di oggi?"></textarea>` +
    `<p class="muto piccolo sopra sotto-poco">Le note sono private: il cliente non le vede.</p>` +
    `<button class="btn larga" id="salva-nota">Salva nota</button></section></div>`;

  $('salva-nota').addEventListener('click', async () => {
    const testo = $('testo-nota').value.trim();
    if (!testo) return;
    const r = await prova(() => invia('/api/studio/nota', { cliente: d.cliente.id, testo }), 'Nota salvata');
    if (r) {
      d.note = r.note;
      disegnaSezione();
    }
  });
  for (const el of zona.querySelectorAll('[data-elimina-nota]')) {
    el.addEventListener('click', async () => {
      if (!el.dataset.confermato) {
        el.dataset.confermato = '1';
        el.classList.add('conferma');
        el.setAttribute('aria-label', 'Tocca ancora per eliminare');
        notifica('Tocca ancora per eliminare la nota', 'attenzione');
        return;
      }
      if (await prova(() => invia('/api/studio/elimina-nota', { id: el.dataset.eliminaNota }), 'Nota eliminata')) {
        d.note = d.note.filter((n) => n.id !== el.dataset.eliminaNota);
        disegnaSezione();
      }
    });
  }
}

/* Messaggi */

function sezioneMessaggi(zona, d) {
  const auto = d.cliente.automazione;
  const aperte = d.domande.filter((x) => x.stato === 'aperta');

  const messaggi = d.conversazione.length
    ? d.conversazione
        .map(
          (m) =>
            `<div class="msg ${m.autore === 'studio' ? 'io' : 'lui'}"><div class="bolla">${esc(m.testo)}</div>` +
            `<div class="fonte">${m.autore === 'cliente' ? esc(primoNome(d.cliente.nome)) : m.autore === 'studio' ? 'tu' : 'assistente'} · ${esc(quando(m.at))}</div></div>`,
        )
        .join('')
    : `<p class="vuoto">Nessun messaggio. Quando ${esc(primoNome(d.cliente.nome))} scrive, la conversazione compare qui.</p>`;

  zona.innerHTML =
    `<div class="colonne larga-stretta">` +
    `<section class="chat studio-chat"><div class="filo" id="filo-studio">${messaggi}</div><div></div>` +
    `<form class="scrivi" id="scrivi-cliente"><input id="testo-studio" type="text" autocomplete="off" placeholder="Scrivi a ${esc(primoNome(d.cliente.nome))}" aria-label="Scrivi al cliente">` +
    `<button class="btn-icona pieno" type="submit" aria-label="Invia">${ico('invia')}</button></form></section>` +
    `<div class="pila">` +
    `<section class="card"><h2 class="card-titolo">Chi risponde</h2>` +
    `<label class="interruttore"><input type="checkbox" id="automazione"${auto ? ' checked' : ''}>` +
    `<span>Risponde l'assistente quando scrive</span></label>` +
    `<p class="muto piccolo sopra">${auto
      ? `L'assistente risponde da solo con i dati della dieta. Tu leggi tutto qui e puoi intervenire: il tuo messaggio si distingue sempre.`
      : `Risposte automatiche spente: quello che scrive aspetta te.`}</p></section>` +
    (aperte.length
      ? `<section class="card"><h2 class="card-titolo">Domande girate a te</h2>` +
        aperte
          .map(
            (q) =>
              `<div class="domanda"><p><strong>«${esc(q.domanda)}»</strong></p><p class="muto piccolo">${esc(q.motivo)} · ${esc(quando(q.at))}</p>` +
              `<div class="fila sopra"><button class="btn secondario piccolo" data-rispondi="${esc(q.id)}">Rispondi</button>` +
              `<button class="btn testo piccolo grigio" data-chiudi-domanda="${esc(q.id)}">Segna come risolta</button></div></div>`,
          )
          .join('') +
        `</section>`
      : '') +
    `</div></div>`;

  const filo = $('filo-studio');
  filo.scrollTop = filo.scrollHeight;

  $('automazione').addEventListener('change', async (e) => {
    const attiva = e.target.checked;
    const ok = await prova(
      () => invia('/api/studio/automazione', { cliente: d.cliente.id, attiva }),
      attiva ? 'Risponde l’assistente' : 'Rispondi tu di persona',
    );
    if (ok) await apriCliente(d.cliente.id, 'messaggi');
    else e.target.checked = !attiva;
  });

  $('scrivi-cliente').addEventListener('submit', async (e) => {
    e.preventDefault();
    const testo = $('testo-studio').value.trim();
    if (!testo) return;
    $('testo-studio').disabled = true;
    const domanda = $('testo-studio').dataset.domanda;
    const ok = await prova(() => invia('/api/studio/scrivi', { cliente: d.cliente.id, testo }));
    // Una risposta a una domanda girata la chiude anche.
    if (ok && domanda) await prova(() => invia('/api/studio/rispondi', { id: domanda, risposta: testo }));
    if (ok && domanda) {
      await apriCliente(d.cliente.id, 'messaggi');
      return;
    }
    if (ok) {
      const { messaggi: nuovi } = await leggi('/api/studio/conversazione', new URLSearchParams({ cliente: d.cliente.id }));
      d.conversazione = nuovi;
      disegnaSezione();
      $('testo-studio').focus();
    } else {
      $('testo-studio').disabled = false;
    }
  });

  for (const el of zona.querySelectorAll('[data-rispondi]')) {
    el.addEventListener('click', () => {
      const q = aperte.find((x) => x.id === el.dataset.rispondi);
      $('testo-studio').value = `Sulla tua domanda «${q.domanda}»: `;
      $('testo-studio').focus();
      $('testo-studio').dataset.domanda = q.id;
    });
  }
  for (const el of zona.querySelectorAll('[data-chiudi-domanda]')) {
    el.addEventListener('click', async () => {
      if (await prova(() => invia('/api/studio/rispondi', { id: el.dataset.chiudiDomanda, risposta: 'Risolta in conversazione.' }), 'Domanda risolta')) {
        await apriCliente(d.cliente.id, 'messaggi');
      }
    });
  }
}

// Editor della dieta

async function apriEditor(dietaId) {
  contenuto().innerHTML = caricamento();
  const d = await leggi('/api/studio/dieta', new URLSearchParams({ dieta: dietaId }));

  stato.editor = {
    id: d.id,
    clienteId: d.clienteId,
    statoDieta: d.stato,
    dieta: d.dieta,
    conti: d.conti,
    daCompletare: d.daCompletare,
    scarti: d.scarti ?? [],
    attenzioni: d.attenzioni ?? [],
    giorno: (new Date().getDay() + 6) % 7,
    /** Il pannello delle sostituzioni aperto, come "pasto.alimento". */
    pianoAperto: null,
    sporca: false,
  };
  stato.tab = 'clienti';
  evidenziaScheda();
  disegnaEditor();
}

function disegnaEditor() {
  const e = stato.editor;
  const giorno = e.dieta.giorni.find((g) => g.indice === e.giorno);
  const conti = e.conti.giorni.find((g) => g.indice === e.giorno) ?? { kcal: 0, proteine: 0, carboidrati: 0, grassi: 0, parziale: false };
  const o = e.dieta.obiettivi ?? {};
  const scarto = o.kcal ? Math.round(conti.kcal - o.kcal) : null;
  const nomeCliente = stato.cliente?.cliente.id === e.clienteId ? stato.cliente.cliente.nome : null;

  testata({
    indietro: nomeCliente ?? 'Cliente',
    titolo: e.dieta.titolo,
    sotto: `<span class="chip ${e.statoDieta === 'pubblicata' ? 'ok' : 'attenzione'}">${esc(e.statoDieta)}</span>` +
      (e.statoDieta === 'pubblicata' ? ' Le modifiche salvate le vede subito il cliente.' : ' Il cliente non la vede finché non la pubblichi.'),
    destra:
      `<button class="btn secondario" id="salva">Salva</button>` +
      `<button class="btn" id="pubblica-editor">${e.statoDieta === 'pubblicata' ? 'Salva' : 'Pubblica'}</button>`,
  });
  if (e.statoDieta === 'pubblicata') $('salva').hidden = true;

  contenuto().innerHTML =
    `<div id="avvisi-editor" class="pila sotto">` +
    (e.daCompletare.length
      ? avviso(
          'attenzione',
          `${e.daCompletare.length} aliment${e.daCompletare.length === 1 ? 'o' : 'i'} senza valori nutrizionali: ` +
            `${esc(e.daCompletare.map((x) => x.nome).slice(0, 4).join(', '))}. Finché mancano, i totali sono parziali. ` +
            `<button class="btn testo piccolo" id="completa">Completali</button>`,
          true,
        )
      : '') +
    (e.scarti.length
      ? avviso('attenzione', `La settimana si discosta dagli obiettivi: ${e.scarti.join(', ')}. Il cliente vede i totali dei pasti.`)
      : '') +
    (e.attenzioni.length
      ? avviso(
          'grave',
          `<strong>Allergie del cliente:</strong> ` +
            e.attenzioni.map((x) => `${esc(x.alimento)} (${esc(x.allergene)})`).join(', ') +
            `. Le righe interessate sono segnate in rosso.`,
          true,
        )
      : '') +
    `</div>` +
    `<div class="colonne editor-colonne">` +
    `<section class="card"><h2 class="card-titolo">Impostazioni</h2>` +
    `<label class="campo"><span>Titolo</span><input id="titolo" type="text" value="${esc(e.dieta.titolo)}"></label>` +
    `<div class="campi">` +
    `<label class="campo"><span>Kcal al giorno <span class="aiuto">facoltativo</span></span><input id="ob-kcal" type="number" min="0" value="${o.kcal ?? ''}"></label>` +
    `<label class="campo"><span>Proteine g</span><input id="ob-proteine" type="number" min="0" value="${o.proteine ?? ''}"></label>` +
    `<label class="campo"><span>Carboidrati g</span><input id="ob-carboidrati" type="number" min="0" value="${o.carboidrati ?? ''}"></label>` +
    `<label class="campo"><span>Grassi g</span><input id="ob-grassi" type="number" min="0" value="${o.grassi ?? ''}"></label>` +
    `<label class="campo"><span>Acqua litri</span><input id="ob-acqua" type="number" min="0" step="0.1" value="${o.acqua ?? ''}"></label>` +
    `<label class="campo"><span>Passi al giorno</span><input id="ob-passi" type="number" min="0" step="500" value="${o.passi ?? ''}"></label>` +
    `<label class="campo"><span>Pasti liberi a settimana</span><input id="ob-liberi" type="number" min="0" max="7" value="${o.pastiLiberi ?? ''}" placeholder="0"></label>` +
    `</div>` +
    `<label class="campo"><span>Le sostituzioni si pareggiano <span class="aiuto">per tutta la dieta</span></span><select id="base-dieta">` +
    BASI_DIETA.map(([v, t]) => `<option value="${v}"${(e.dieta.base ?? 'auto') === v ? ' selected' : ''}>${esc(t)}</option>`).join('') +
    `</select></label></section>` +
    `<section class="card"><h2 class="card-titolo">Indicazioni per il cliente</h2>` +
    `<label class="campo"><span>Una per riga</span><textarea id="indicazioni" rows="7">${esc(e.dieta.indicazioni.join('\n'))}</textarea></label></section>` +
    `</div>` +
    `<div class="editor-giorni sopra">` +
    `<div class="giorni-nav" id="giorni-nav">` +
    e.dieta.giorni
      .map((g) => {
        const vuotoGiorno = !g.pasti.some((p) => p.alimenti.length > 0);
        const kcal = e.conti.giorni.find((x) => x.indice === g.indice)?.kcal ?? 0;
        return (
          `<button data-giorno="${g.indice}" aria-pressed="${g.indice === e.giorno}"${vuotoGiorno ? ' class="vuoto-giorno"' : ''}>` +
          `<strong>${esc(GIORNI[g.indice].slice(0, 3))}</strong><span>${vuotoGiorno ? '—' : numero(kcal)}</span></button>`
        );
      })
      .join('') +
    `</div></div>` +
    `<section class="card conta-giorno sopra">` +
    `<div><span class="muto piccolo">${esc(GIORNI[e.giorno])}</span><strong>${conti.parziale ? '≈ ' : ''}${numero(conti.kcal)} kcal</strong></div>` +
    `<div class="macro-mini"><span>P <strong>${numero(conti.proteine)}</strong></span><span>C <strong>${numero(conti.carboidrati)}</strong></span><span>G <strong>${numero(conti.grassi)}</strong> g</span></div>` +
    (scarto !== null ? `<div>${delta(scarto)} <span class="muto piccolo">sull'obiettivo</span></div>` : '') +
    `<label class="interruttore spinge"><input type="checkbox" id="allenamento"${giorno.allenamento ? ' checked' : ''}> Allenamento</label>` +
    `<button class="btn secondario piccolo" id="copia-da">Copia da…</button>` +
    `</section>` +
    `<div id="pasti" class="pila sopra">${giorno.pasti.map(disegnaPasto).join('')}</div>` +
    `<button class="btn secondario sopra" id="aggiungi-pasto">${ico('piu')} Aggiungi un pasto</button>`;

  collegaEditor();
}

function disegnaPasto(pasto, i) {
  return (
    `<section class="card editor-pasto" data-pasto="${i}">` +
    `<div class="editor-pasto-testa">` +
    `<input class="nome-pasto" type="text" value="${esc(pasto.nome)}" placeholder="Colazione" data-campo="nome" aria-label="Nome del pasto">` +
    `<input class="orario" type="text" value="${esc(pasto.orario ?? '')}" placeholder="13:00" data-campo="orario" aria-label="Orario">` +
    `<button class="btn-icona piccolo" data-togli-pasto="${i}" aria-label="Togli il pasto">${ico('cestino')}</button>` +
    `</div>` +
    `<div class="righe-alimenti">${pasto.alimenti.map((a, j) => disegnaAlimento(a, i, j)).join('')}</div>` +
    `<input class="nota-pasto" type="text" value="${esc(pasto.nota ?? '')}" placeholder="Preparazione o nota per il cliente (facoltativa)" data-campo="nota" aria-label="Nota del pasto">` +
    `<button class="btn testo piccolo" data-aggiungi-alimento="${i}">${ico('piu')} Alimento</button>` +
    `</section>`
  );
}

function disegnaAlimento(a, i, j) {
  const e = stato.editor;
  const ignoto = e.daCompletare.some((x) => x.nome.toLowerCase() === a.nome.toLowerCase());
  const allergene = e.attenzioni.some((x) => x.alimento.toLowerCase() === a.nome.toLowerCase());
  const quante = (a.alternative ?? []).filter((x) => (x.nome ?? '').trim()).length;
  const aperto = e.pianoAperto === `${i}.${j}`;

  return (
    `<div class="riga-alimento${ignoto ? ' ignoto' : ''}${allergene ? ' allergene' : ''}" data-alimento="${i}.${j}">` +
    `<input type="text" value="${esc(a.nome)}" placeholder="petto di pollo" data-campo="nome" aria-label="Alimento">` +
    `<input type="number" min="0" step="1" value="${a.quantita ?? ''}" placeholder="q.b." data-campo="quantita" aria-label="Quantità">` +
    `<select data-campo="unita" aria-label="Unità">` +
    ['g', 'ml', 'pz'].map((u) => `<option value="${u}"${a.unita === u ? ' selected' : ''}>${u}</option>`).join('') +
    `</select>` +
    `<button class="btn-icona piccolo${quante ? ' attivo' : ''}" data-piano="${i}.${j}" aria-expanded="${aperto}" title="Sostituzioni ammesse">` +
    `${ico('scambia')}${quante ? `<span class="conto">${quante}</span>` : ''}</button>` +
    `<button class="btn-icona piccolo" data-togli-alimento="${i}.${j}" aria-label="Togli">${ico('croce')}</button>` +
    `</div>` +
    (aperto ? disegnaPiano(a, i, j) : '')
  );
}

function disegnaPiano(a, i, j) {
  const righe = (a.alternative ?? [])
    .map(
      (alt, k) =>
        `<div class="riga-alternativa" data-alternativa="${k}">` +
        `<input type="text" value="${esc(alt.nome ?? '')}" placeholder="merluzzo" data-alt="nome" aria-label="Alternativa">` +
        `<input type="number" min="0" step="1" value="${alt.quantita ?? ''}" placeholder="auto" data-alt="quantita" title="Vuoto: la calcolo io">` +
        `<select data-alt="unita">` +
        ['g', 'ml', 'pz'].map((u) => `<option value="${u}"${(alt.unita ?? a.unita) === u ? ' selected' : ''}>${u}</option>`).join('') +
        `</select>` +
        `<button class="btn-icona piccolo" data-togli-alternativa="${i}.${j}.${k}" aria-label="Togli">${ico('croce')}</button>` +
        `</div>`,
    )
    .join('');

  return (
    `<div class="piano-alimento" data-piano-di="${i}.${j}">` +
    `<div class="campi">` +
    `<label class="campo"><span>Nome della voce <span class="aiuto">lo legge il cliente</span></span>` +
    `<input type="text" value="${esc(a.gruppo ?? '')}" placeholder="fonte proteica" data-piano-campo="gruppo"></label>` +
    `<label class="campo"><span>Pareggio per questo alimento</span><select data-piano-campo="base">` +
    [['', `come la dieta: ${nomeBaseDieta()}`], ...BASI_DIETA]
      .map(([v, t]) => `<option value="${v}"${(a.base ?? '') === v ? ' selected' : ''}>${esc(t)}</option>`)
      .join('') +
    `</select></label></div>` +
    (righe || `<p class="muto piccolo">Nessuna sostituzione ammessa: il cliente può chiederne una, ma conta come deviazione.</p>`) +
    `<div class="fila sopra"><button class="btn testo piccolo" data-aggiungi-alternativa="${i}.${j}">${ico('piu')} Sostituzione</button>` +
    `<button class="btn testo piccolo grigio spinge" data-chiudi-piano="1">Chiudi</button></div></div>`
  );
}

function leggiGiorno() {
  const e = stato.editor;
  const giorno = e.dieta.giorni.find((g) => g.indice === e.giorno);

  giorno.allenamento = $('allenamento').checked;
  giorno.pasti = [...contenuto().querySelectorAll('.editor-pasto')].map((nodo, i) => {
    const vecchio = giorno.pasti[i] ?? {};
    return {
      id: vecchio.id,
      nome: nodo.querySelector('[data-campo="nome"]').value.trim() || 'Pasto',
      orario: nodo.querySelector('[data-campo="orario"]').value.trim() || undefined,
      nota: nodo.querySelector('.nota-pasto').value.trim() || undefined,
      alimenti: [...nodo.querySelectorAll('.riga-alimento')].map((riga, j) => {
        const q = riga.querySelector('[data-campo="quantita"]').value;
        const vecchioAlimento = vecchio.alimenti?.[j] ?? {};
        const pannello = nodo.querySelector(`[data-piano-di="${i}.${j}"]`);
        return {
          nome: riga.querySelector('[data-campo="nome"]').value.trim(),
          quantita: q === '' ? null : Number(q),
          unita: riga.querySelector('[data-campo="unita"]').value,
          libera: q === '',
          nota: vecchioAlimento.nota,
          ...(pannello ? leggiPannelloPiano(pannello) : pianoDi(vecchioAlimento)),
        };
      }),
    };
  });

  e.dieta.titolo = $('titolo').value.trim() || e.dieta.titolo;
  e.dieta.base = $('base-dieta').value;
  e.dieta.indicazioni = $('indicazioni').value.split('\n').map((r) => r.trim()).filter(Boolean);

  const num = (id) => {
    const v = $(id).value;
    return v === '' ? undefined : Number(v);
  };
  e.dieta.obiettivi = {
    kcal: num('ob-kcal'),
    proteine: num('ob-proteine'),
    carboidrati: num('ob-carboidrati'),
    grassi: num('ob-grassi'),
    acqua: num('ob-acqua'),
    passi: num('ob-passi'),
    pastiLiberi: num('ob-liberi'),
  };
}

/** Il piano di un alimento che non si sta modificando: si porta avanti com'è. */
const pianoDi = (a) => ({ alternative: a.alternative, base: a.base, gruppo: a.gruppo });

function leggiPannelloPiano(pannello) {
  const campo = (nome) => pannello.querySelector(`[data-piano-campo="${nome}"]`)?.value ?? '';
  // Le righe senza nome le scarta il server al salvataggio.
  const alternative = [...pannello.querySelectorAll('.riga-alternativa')].map((riga) => {
    const q = riga.querySelector('[data-alt="quantita"]').value;
    return {
      nome: riga.querySelector('[data-alt="nome"]').value.trim(),
      // Vuoto: la calcola il motore, non zero.
      quantita: q === '' ? undefined : Number(q),
      unita: riga.querySelector('[data-alt="unita"]').value,
    };
  });
  // Vuoto vuol dire come la dieta: non forzare 'auto'.
  return { alternative, base: campo('base'), gruppo: campo('gruppo').trim() };
}

function collegaEditor() {
  const e = stato.editor;
  const giorno = () => e.dieta.giorni.find((g) => g.indice === e.giorno);
  const ridisegna = () => {
    e.sporca = true;
    disegnaEditor();
  };

  $('indietro').addEventListener('click', () =>
    chiediUscita(async () => {
      stato.editor = null;
      await apriCliente(e.clienteId, 'dieta');
    }),
  );

  $('base-dieta').addEventListener('change', () => {
    e.dieta.base = $('base-dieta').value;
    e.sporca = true;
    for (const o of contenuto().querySelectorAll('[data-piano-campo="base"] option[value=""]')) {
      o.textContent = `come la dieta: ${nomeBaseDieta()}`;
    }
  });

  for (const b of $('giorni-nav').querySelectorAll('button')) {
    b.addEventListener('click', () => {
      leggiGiorno();
      e.giorno = Number(b.dataset.giorno);
      e.pianoAperto = null;
      disegnaEditor();
    });
  }

  $('aggiungi-pasto').addEventListener('click', () => {
    leggiGiorno();
    giorno().pasti.push({ nome: nomeSuggerito(giorno().pasti.length), alimenti: [{ nome: '', quantita: null, unita: 'g' }] });
    ridisegna();
  });

  for (const el of contenuto().querySelectorAll('[data-aggiungi-alimento]')) {
    el.addEventListener('click', () => {
      leggiGiorno();
      giorno().pasti[Number(el.dataset.aggiungiAlimento)].alimenti.push({ nome: '', quantita: null, unita: 'g' });
      ridisegna();
      const righe = contenuto().querySelectorAll(`[data-pasto="${el.dataset.aggiungiAlimento}"] .riga-alimento input[data-campo="nome"]`);
      righe[righe.length - 1]?.focus();
    });
  }

  for (const el of contenuto().querySelectorAll('[data-togli-pasto]')) {
    el.addEventListener('click', () => {
      leggiGiorno();
      giorno().pasti.splice(Number(el.dataset.togliPasto), 1);
      ridisegna();
    });
  }

  for (const el of contenuto().querySelectorAll('[data-togli-alimento]')) {
    el.addEventListener('click', () => {
      leggiGiorno();
      const [i, j] = el.dataset.togliAlimento.split('.').map(Number);
      giorno().pasti[i].alimenti.splice(j, 1);
      e.pianoAperto = null;
      ridisegna();
    });
  }

  for (const el of contenuto().querySelectorAll('[data-piano]')) {
    el.addEventListener('click', () => {
      leggiGiorno();
      e.pianoAperto = e.pianoAperto === el.dataset.piano ? null : el.dataset.piano;
      disegnaEditor();
    });
  }

  for (const el of contenuto().querySelectorAll('[data-chiudi-piano]')) {
    el.addEventListener('click', () => {
      leggiGiorno();
      e.pianoAperto = null;
      disegnaEditor();
    });
  }

  for (const el of contenuto().querySelectorAll('[data-aggiungi-alternativa]')) {
    el.addEventListener('click', () => {
      leggiGiorno();
      const [i, j] = el.dataset.aggiungiAlternativa.split('.').map(Number);
      const alimento = giorno().pasti[i].alimenti[j];
      alimento.alternative = [...(alimento.alternative ?? []), { nome: '', unita: alimento.unita }];
      ridisegna();
    });
  }

  for (const el of contenuto().querySelectorAll('[data-togli-alternativa]')) {
    el.addEventListener('click', () => {
      leggiGiorno();
      const [i, j, k] = el.dataset.togliAlternativa.split('.').map(Number);
      giorno().pasti[i].alimenti[j].alternative?.splice(k, 1);
      ridisegna();
    });
  }

  for (const campo of contenuto().querySelectorAll('input, select, textarea')) {
    campo.addEventListener('input', () => {
      e.sporca = true;
    });
  }

  $('copia-da').addEventListener('click', copiaGiorno);
  $('salva').addEventListener('click', () => salva(false));
  $('pubblica-editor').addEventListener('click', () => salva(e.statoDieta !== 'pubblicata'));
  $('completa')?.addEventListener('click', apriCompletamento);
}

const NOMI_SUGGERITI = ['Colazione', 'Spuntino', 'Pranzo', 'Merenda', 'Cena', 'Spuntino serale'];
const nomeSuggerito = (i) => NOMI_SUGGERITI[i] ?? `Pasto ${i + 1}`;

function chiediUscita(prosegui) {
  if (!stato.editor?.sporca) {
    prosegui();
    return;
  }
  const { corpo, chiudi } = foglio({ titolo: 'Modifiche non salvate' });
  corpo.innerHTML =
    `<p class="sotto">Hai modificato questa dieta senza salvare.</p>` +
    `<div class="fila"><button class="btn" id="salva-esci">Salva ed esci</button>` +
    `<button class="btn testo rosso" id="esci-comunque">Esci senza salvare</button>` +
    `<button class="btn secondario spinge" data-chiudi-foglio>Resta</button></div>`;

  $('esci-comunque').addEventListener('click', () => {
    stato.editor.sporca = false;
    chiudi();
    prosegui();
  });
  $('salva-esci').addEventListener('click', async () => {
    chiudi();
    await salva(false);
    if (!stato.editor?.sporca) prosegui();
  });
}

function copiaGiorno() {
  const e = stato.editor;
  const { corpo, chiudi } = foglio({ titolo: `Copia in ${GIORNI[e.giorno].toLowerCase()} i pasti di` });
  const sorgenti = e.dieta.giorni.filter((g) => g.indice !== e.giorno && g.pasti.some((p) => p.alimenti.length));
  corpo.innerHTML = sorgenti.length
    ? `<section class="card lista piatta">` +
      sorgenti
        .map((g) => `<button class="riga riga-link" type="button" data-copia="${g.indice}"><span class="corpo">${esc(GIORNI[g.indice])}</span>${ico('avanti')}</button>`)
        .join('') +
      `</section><p class="muto piccolo sopra">I pasti di ${esc(GIORNI[e.giorno].toLowerCase())} vengono sostituiti.</p>`
    : `<p class="muto">Non ci sono altri giorni scritti da copiare.</p>`;

  for (const b of corpo.querySelectorAll('[data-copia]')) {
    b.addEventListener('click', () => {
      leggiGiorno();
      const sorgente = e.dieta.giorni.find((g) => g.indice === Number(b.dataset.copia));
      // Gli id dei pasti non si copiano: li rigenera il server.
      giorniCorrente().pasti = sorgente.pasti.map((p) => ({
        nome: p.nome,
        orario: p.orario,
        nota: p.nota,
        alimenti: p.alimenti.map((a) => ({ ...a })),
      }));
      chiudi();
      e.sporca = true;
      disegnaEditor();
    });
  }
}

const giorniCorrente = () => stato.editor.dieta.giorni.find((g) => g.indice === stato.editor.giorno);

async function salva(anchePubblica) {
  const e = stato.editor;
  leggiGiorno();
  $('salva').disabled = true;
  $('pubblica-editor').disabled = true;

  try {
    const esito = await invia('/api/studio/salva-dieta', { id: e.id, dieta: e.dieta });
    e.dieta = esito.dieta;
    e.conti = esito.conti;
    e.daCompletare = esito.daCompletare;
    e.scarti = esito.scarti ?? [];
    e.sporca = false;

    if (anchePubblica) {
      const p = await invia('/api/studio/pubblica', { id: e.id });
      e.statoDieta = 'pubblicata';
      disegnaEditor();
      notifica(p.avviso ?? 'Pubblicata: il cliente la vede da adesso', p.avviso ? 'attenzione' : 'ok');
      return;
    }
    disegnaEditor();
    notifica(e.statoDieta === 'pubblicata' ? 'Salvata: il cliente vede già le modifiche' : 'Bozza salvata');
  } catch (err) {
    disegnaEditor();
    notifica(err.message, 'grave');
  }
}

function apriCompletamento() {
  const mancanti = stato.editor.daCompletare;
  const { corpo, chiudi } = foglio({ titolo: 'Valori mancanti', classe: 'largo' });
  corpo.innerHTML =
    `<p class="muto piccolo sotto">Grammi per 100 g di alimento (o per pezzo). Restano nella libreria del tuo studio e valgono per tutte le tue diete.</p>` +
    mancanti
      .map(
        (m, i) =>
          `<section class="card piatta sotto" data-mancante="${i}"><div class="card-testa"><h3 class="card-titolo">${esc(m.nome)}</h3>` +
          `<span class="muto piccolo">${esc(m.dove.slice(0, 2).join(', '))}</span></div>` +
          `<div class="campi">` +
          `<label class="campo"><span>Proteine</span><input type="number" min="0" max="100" step="0.1" data-v="proteine"></label>` +
          `<label class="campo"><span>Carboidrati</span><input type="number" min="0" max="100" step="0.1" data-v="carboidrati"></label>` +
          `<label class="campo"><span>Grassi</span><input type="number" min="0" max="100" step="0.1" data-v="grassi"></label>` +
          `</div><button class="btn secondario piccolo" data-salva-alimento="${i}">Salva</button></section>`,
      )
      .join('') +
    `<button class="btn larga" id="fine-completamento">Fatto</button>`;

  for (const b of corpo.querySelectorAll('[data-salva-alimento]')) {
    b.addEventListener('click', async () => {
      const i = Number(b.dataset.salvaAlimento);
      const blocco = corpo.querySelector(`[data-mancante="${i}"]`);
      const val = (nome) => Number(blocco.querySelector(`[data-v="${nome}"]`).value || 0);
      const ok = await prova(
        () =>
          invia('/api/studio/salva-alimento', {
            nome: mancanti[i].nome,
            per: mancanti[i].unita === 'pz' ? 'pz' : 'g100',
            proteine: val('proteine'),
            carboidrati: val('carboidrati'),
            grassi: val('grassi'),
          }),
        `${mancanti[i].nome} salvato`,
      );
      if (ok) {
        b.disabled = true;
        b.textContent = 'Salvato';
      }
    });
  }
  $('fine-completamento').addEventListener('click', async () => {
    chiudi();
    // I totali cambiano appena i valori esistono: si rilegge la dieta.
    const giorno = stato.editor.giorno;
    await apriEditor(stato.editor.id);
    stato.editor.giorno = giorno;
    disegnaEditor();
  });
}

// Caricare la dieta da un PDF

/** Oltre non entra in una riga del database. */
const LIMITE_PDF = 700 * 1024;

async function caricaPdf(clienteId, file) {
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
    notifica('Questo non è un PDF.', 'grave');
    return;
  }
  if (file.size > LIMITE_PDF) {
    notifica(`Il PDF pesa ${Math.round(file.size / 1024)} KB: il massimo è ${LIMITE_PDF / 1024} KB.`, 'grave');
    return;
  }

  contenuto().innerHTML = `<div class="vuoto">${caricamento()}<strong>Leggo il PDF…</strong><span>Può volerci qualche secondo.</span></div>`;

  try {
    const esito = await invia('/api/studio/carica-pdf', {
      cliente: clienteId,
      nome: file.name,
      titolo: file.name.replace(/\.pdf$/i, ''),
      contenuto: await inBase64(file),
    });
    await apriEditor(esito.id);

    const avvisi = $('avvisi-editor');
    const sostituisce = Boolean(stato.cliente?.dietaAttuale);
    const nota = sostituisce ? ' La dieta attuale resta in vigore finché non pubblichi questa.' : '';
    avvisi.insertAdjacentHTML(
      'afterbegin',
      esito.lettaAutomaticamente
        ? avviso('ok', `Letto dal PDF: ho preparato una bozza. Controllala riga per riga prima di pubblicarla.${nota}`)
        : avviso('attenzione', `${esito.motivo ?? 'Non sono riuscito a leggerlo.'} Il PDF resta allegato: la dieta va scritta a mano.${nota}`),
    );
    for (const a of esito.avvisi) avvisi.insertAdjacentHTML('beforeend', avviso('attenzione', a));
    if (!esito.lettaAutomaticamente && esito.testo) {
      avvisi.insertAdjacentHTML(
        'beforeend',
        `<details class="card"><summary>Il testo letto dal PDF</summary><pre class="testo-estratto">${esc(esito.testo)}</pre></details>`,
      );
    }
  } catch (e) {
    notifica(e.message, 'grave');
    await apriCliente(clienteId, 'dieta');
  }
}

function inBase64(file) {
  return new Promise((risolvi, rifiuta) => {
    const lettore = new FileReader();
    lettore.onerror = () => rifiuta(new Error('Non sono riuscito a leggere il file.'));
    lettore.onload = () => {
      // Serve solo la parte base64 dopo la virgola.
      const testo = String(lettore.result);
      risolvi(testo.slice(testo.indexOf(',') + 1));
    };
    lettore.readAsDataURL(file);
  });
}

// Libreria degli alimenti

async function disegnaLibreria() {
  testata({ titolo: 'Alimenti', sotto: 'I valori che hai scritto tu vincono su quelli interni' });
  contenuto().innerHTML = caricamento();
  const { alimenti } = await leggi('/api/studio/libreria');

  contenuto().innerHTML =
    `<div class="colonne larga-stretta">` +
    `<section class="card lista"><div class="lista-testa"><h2 class="card-titolo">La tua libreria</h2><span class="chip">${alimenti.length}</span></div>` +
    (alimenti.length
      ? `<div class="scorri"><table class="tabella"><thead><tr><th>Alimento</th><th>Base</th><th class="num">Prot.</th>` +
        `<th class="num">Carb.</th><th class="num">Grassi</th><th class="num">kcal</th><th></th></tr></thead><tbody>` +
        alimenti
          .map(
            (a) =>
              `<tr><td><strong>${esc(a.nome)}</strong></td><td class="muto">${a.per === 'pz' ? 'per pezzo' : '100 g'}</td>` +
              `<td class="num">${numero(a.proteine, 1)}</td><td class="num">${numero(a.carboidrati, 1)}</td><td class="num">${numero(a.grassi, 1)}</td>` +
              `<td class="num">${numero(a.proteine * 4 + a.carboidrati * 4 + a.grassi * 9)}</td>` +
              `<td><button class="btn-icona piccolo" data-elimina="${esc(a.chiave)}" data-per="${esc(a.per)}" aria-label="Elimina ${esc(a.nome)}">${ico('cestino')}</button></td></tr>`,
          )
          .join('') +
        `</tbody></table></div>`
      : `<div class="vuoto">${ico('foglia')}<strong>Nessun alimento tuo</strong>` +
        `<span>Quando scrivi una dieta e il motore non conosce un alimento, te lo chiede e finisce qui.</span></div>`) +
    `</section>` +
    `<section class="card"><h2 class="card-titolo">Aggiungi un alimento</h2>` +
    `<form id="form-alimento" novalidate>` +
    `<label class="campo"><span>Nome</span><input id="al-nome" type="text" placeholder="ricotta di pecora" required></label>` +
    `<label class="campo"><span>Valori riferiti a</span><select id="al-per"><option value="g100">100 g / ml</option><option value="pz">un pezzo</option></select></label>` +
    `<div class="campi">` +
    `<label class="campo"><span>Proteine g</span><input id="al-proteine" type="number" min="0" max="100" step="0.1" required></label>` +
    `<label class="campo"><span>Carboidrati g</span><input id="al-carboidrati" type="number" min="0" max="100" step="0.1" required></label>` +
    `<label class="campo"><span>Grassi g</span><input id="al-grassi" type="number" min="0" max="100" step="0.1" required></label>` +
    `</div><button class="btn larga" type="submit">Salva alimento</button></form></section></div>`;

  $('form-alimento').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const ok = await prova(
      () =>
        invia('/api/studio/salva-alimento', {
          nome: $('al-nome').value.trim(),
          per: $('al-per').value,
          proteine: Number($('al-proteine').value),
          carboidrati: Number($('al-carboidrati').value),
          grassi: Number($('al-grassi').value),
        }),
      'Alimento salvato',
    );
    if (ok) disegnaLibreria();
  });

  for (const el of contenuto().querySelectorAll('[data-elimina]')) {
    el.addEventListener('click', async () => {
      if (await prova(() => invia('/api/studio/elimina-alimento', { chiave: el.dataset.elimina, per: el.dataset.per }), 'Eliminato')) {
        disegnaLibreria();
      }
    });
  }
}

// Profilo

function apriEliminaAccount() {
  const { corpo } = foglio({ titolo: 'Elimina account' });
  corpo.innerHTML =
    `<p class="sotto">Cancella per sempre il tuo account e tutto ciò che è collegato: diete, schede, note, collegamenti. ` +
    `Non si può annullare. Per confermare scrivi la tua password.</p>` +
    `<form id="elimina-form" novalidate><label class="campo"><span>Password</span>` +
    `<input id="elimina-password" type="password" autocomplete="current-password" required></label>` +
    `<button class="btn pericolo larga" id="elimina-invia" type="submit">Elimina definitivamente</button></form>`;
  $('elimina-password').focus();

  $('elimina-form').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    $('elimina-invia').disabled = true;
    try {
      await invia('/api/elimina-account', { password: $('elimina-password').value });
      window.location.href = '/';
    } catch (e) {
      notifica(e.message, 'grave');
      $('elimina-invia').disabled = false;
    }
  });
}

function disegnaConto() {
  const io = stato.dati.io;
  testata({ titolo: 'Profilo' });

  contenuto().innerHTML =
    `<div class="stretta pila">` +
    `<section class="card profilo-testa">${avatar(io.nome || io.email, 'grande', io.email)}` +
    `<div><strong>${esc(io.nome || io.email)}</strong><span class="muto">${esc(io.email)}</span></div></section>` +
    `<h2 class="sezione-titolo">Come ti vedono i clienti</h2>` +
    `<section class="card"><label class="campo"><span>Nome professionale</span>` +
    `<input id="mio-nome" type="text" value="${esc(io.nome)}" placeholder="Dott.ssa Anna Rossi"></label>` +
    `<div class="fila"><button class="btn" id="salva-profilo">Salva</button></div></section>` +
    `<div>${avviso('neutro', `I clienti ti aggiungono cercando questa email: <strong>${esc(io.email)}</strong>.`, true)}</div>` +
    `<h2 class="sezione-titolo">Account</h2>` +
    `<section class="card lista">` +
    `<button class="riga riga-link" id="cambia-pw" type="button">${ico('lucchetto')}<span class="corpo">Cambia password</span>${ico('avanti')}</button>` +
    `<button class="riga riga-link" id="esci" type="button">${ico('esci')}<span class="corpo">Esci</span>${ico('avanti')}</button>` +
    `</section>` +
    `<div><button class="btn testo rosso" id="elimina-account-apri">Elimina account</button></div>` +
    `</div>`;

  $('salva-profilo').addEventListener('click', async () => {
    if (await prova(() => invia('/api/studio/impostazioni', { nome: $('mio-nome').value.trim() }), 'Salvato')) {
      await ricarica();
    }
  });
  $('cambia-pw').addEventListener('click', () => apriCambioPassword(false));
  $('esci').addEventListener('click', esci);
  $('elimina-account-apri').addEventListener('click', apriEliminaAccount);
}

// Impalcatura

function evidenziaScheda() {
  // Un cliente aperto da un'altra pagina tiene accesa quella pagina.
  const attiva = stato.tab === 'clienti' && stato.provenienza ? stato.provenienza : stato.tab;
  for (const b of $('schede').querySelectorAll('button')) {
    const accesa = b.dataset.tab === attiva || (b.dataset.tab === 'altro' && IN_ALTRO.has(attiva));
    if (accesa) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
}

function disegna() {
  evidenziaScheda();
  const pagine = {
    cruscotto: disegnaCruscotto,
    messaggi: disegnaMessaggi,
    agenda: disegnaAgenda,
    sostituzioni: disegnaSostituzioni,
    diete: disegnaDiete,
    libreria: disegnaLibreria,
    conto: disegnaConto,
    altro: disegnaAltro,
  };
  if (stato.tab === 'clienti') {
    if (stato.editor) disegnaEditor();
    else if (stato.cliente) disegnaCliente();
    else disegnaClienti();
  } else (pagine[stato.tab] ?? disegnaCruscotto)();
}

function vaiA(tab) {
  chiediUscita(() => {
    stato.tab = tab;
    stato.cliente = null;
    stato.editor = null;
    stato.provenienza = null;
    disegna();
    window.scrollTo(0, 0);
  });
}

/** I link interni alle pagine: data-vai="sostituzioni". */
function collegaVai(radice = contenuto()) {
  for (const el of radice.querySelectorAll('[data-vai]')) {
    el.addEventListener('click', () => vaiA(el.dataset.vai));
  }
}

for (const b of $('schede').querySelectorAll('button')) {
  b.addEventListener('click', () => vaiA(b.dataset.tab));
}

// Messaggi: tutte le conversazioni

async function disegnaMessaggi() {
  testata({ titolo: 'Messaggi', sotto: 'Le conversazioni con i tuoi clienti, dalla più recente' });
  contenuto().innerHTML = caricamento();
  let elenco;
  try {
    ({ conversazioni: elenco } = await leggi('/api/studio/conversazioni'));
  } catch (e) {
    contenuto().innerHTML = avviso('grave', e.message);
    return;
  }
  const aperte = stato.dati.domande.filter((q) => q.stato === 'aperta');

  contenuto().innerHTML =
    `<div class="colonne larga-stretta"><div class="pila">` +
    (elenco.length
      ? `<section class="card lista">` +
        elenco
          .map(
            (c) =>
              `<button class="riga riga-link conversazione${c.daLeggere ? ' da-leggere' : ''}" type="button" data-apri-chat="${esc(c.clienteId)}">` +
              avatar(c.nome, '', c.email) +
              `<span class="corpo"><span class="fila-stretta"><strong>${esc(c.nome)}</strong>` +
              `<small class="muto spinge">${esc(quando(c.at))}</small></span>` +
              `<small class="anteprima">${c.autore === 'studio' ? 'Tu: ' : c.autore === 'assistente' ? 'Assistente: ' : ''}${esc(c.testo)}</small></span>` +
              (c.daLeggere ? `<span class="pallino">${c.daLeggere}</span>` : '') +
              `</button>`,
          )
          .join('') +
        `</section>`
      : `<section class="card vuoto">${ico('chat')}<strong>Nessuna conversazione</strong><span>Quando un cliente scrive, la trovi qui.</span></section>`) +
    `</div><div class="pila">` +
    `<section class="card"><h2 class="card-titolo">Domande girate a te</h2>` +
    (aperte.length
      ? `<div class="lista-semplice">` +
        aperte
          .map(
            (q) =>
              `<button class="domanda-riga" type="button" data-apri-chat="${esc(q.clienteId)}"><strong>${esc(q.clienteNome)}</strong>` +
              `<span>«${esc(q.domanda)}»</span><small class="muto">${esc(quando(q.at))}</small></button>`,
          )
          .join('') +
        `</div>`
      : `<p class="muto">Nessuna. Quando l'assistente non sa rispondere, la domanda arriva qui.</p>`) +
    `</section></div></div>`;

  for (const el of contenuto().querySelectorAll('[data-apri-chat]')) {
    el.addEventListener('click', () => apriCliente(el.dataset.apriChat, 'messaggi'));
  }
}

// Agenda: le prossime visite

function disegnaAgenda() {
  testata({ titolo: 'Agenda', sotto: 'Le prossime visite dei tuoi clienti' });
  const adesso = Date.now() - 12 * 3_600_000;
  const conVisita = stato.dati.clienti
    .filter((c) => c.prossimaVisita && new Date(c.prossimaVisita).getTime() >= adesso)
    .sort((a, b) => a.prossimaVisita.localeCompare(b.prossimaVisita));
  const senza = stato.dati.clienti.filter((c) => !conVisita.includes(c));

  const perGiorno = new Map();
  for (const c of conVisita) {
    const giorno = c.prossimaVisita.slice(0, 10);
    perGiorno.set(giorno, [...(perGiorno.get(giorno) ?? []), c]);
  }

  contenuto().innerHTML =
    `<div class="colonne larga-stretta"><div class="pila">` +
    (conVisita.length
      ? [...perGiorno]
          .map(
            ([giorno, lista]) =>
              `<h2 class="sezione-titolo">${esc(dataLunga(giorno))}</h2><section class="card lista">` +
              lista
                .map(
                  (c) =>
                    `<button class="riga riga-link" type="button" data-apri-cliente="${esc(c.id)}">` +
                    `<span class="ora-visita">${esc(c.prossimaVisita.length > 10 ? c.prossimaVisita.slice(11, 16) : '—')}</span>` +
                    avatar(c.nome, 'piccolo', c.email) +
                    `<span class="corpo"><strong>${esc(c.nome)}</strong><small class="muto">${c.dieta ? esc(c.dieta.titolo) : 'senza dieta'}</small></span>` +
                    `${chipAderenza(c.aderenza)}${ico('avanti')}</button>`,
                )
                .join('') +
              `</section>`,
          )
          .join('')
      : `<section class="card vuoto">${ico('calendario')}<strong>Nessuna visita in programma</strong>` +
        `<span>La data della prossima visita si fissa nella scheda del cliente.</span></section>`) +
    `</div>` +
    (senza.length
      ? `<div class="pila"><section class="card lista"><div class="lista-testa"><h2 class="card-titolo">Senza visita fissata</h2></div>` +
        senza
          .map(
            (c) =>
              `<button class="riga riga-link" type="button" data-apri-scheda="${esc(c.id)}">${avatar(c.nome, 'piccolo', c.email)}` +
              `<span class="corpo"><strong>${esc(c.nome)}</strong></span><span class="btn testo piccolo">Fissa</span></button>`,
          )
          .join('') +
        `</section></div>`
      : '') +
    `</div>`;

  collegaVariazioni();
  for (const el of contenuto().querySelectorAll('[data-apri-scheda]')) {
    el.addEventListener('click', () => apriCliente(el.dataset.apriScheda, 'scheda'));
  }
}

// Sostituzioni: tutte, con il filtro sulle nuove

function disegnaSostituzioni() {
  const tutte = stato.dati.variazioni;
  const nuove = tutte.filter((v) => v.stato === 'nuova');
  if (!stato.filtroVariazioni) stato.filtroVariazioni = nuove.length ? 'nuove' : 'tutte';

  testata({
    titolo: 'Sostituzioni',
    sotto: 'Gli alimenti che i clienti hanno cambiato, con la grammatura equivalente',
    destra: nuove.length ? `<button class="btn secondario piccolo" id="segna-viste">Segna come viste</button>` : '',
  });

  const mostrate = stato.filtroVariazioni === 'nuove' ? nuove : stato.filtroVariazioni === 'annullate' ? tutte.filter((v) => v.stato === 'annullata') : tutte;

  contenuto().innerHTML =
    segmenti('filtro-variazioni', [['nuove', `Nuove (${nuove.length})`], ['tutte', 'Tutte'], ['annullate', 'Annullate']], stato.filtroVariazioni) +
    `<section class="card stretta-larga sopra">` +
    (mostrate.length
      ? `<div class="lista-variazioni">${mostrate.map((v) => rigaVariazione(v)).join('')}</div>`
      : `<p class="vuoto">${stato.filtroVariazioni === 'nuove' ? 'Nessuna sostituzione nuova: hai visto tutto.' : 'Niente da mostrare.'}</p>`) +
    `</section>`;

  collegaSegmenti('filtro-variazioni', (v) => {
    stato.filtroVariazioni = v;
    disegnaSostituzioni();
  });
  collegaVariazioni();
  $('segna-viste')?.addEventListener('click', async () => {
    if (await prova(() => invia('/api/studio/viste', { ids: nuove.map((v) => v.id) }), 'Segnate come viste')) {
      stato.filtroVariazioni = 'tutte';
      await ricarica();
    }
  });
}

// Diete: tutte quelle dello studio

async function disegnaDiete() {
  testata({ titolo: 'Diete', sotto: 'Tutte le diete che hai scritto. Ognuna può fare da modello per una nuova.' });
  contenuto().innerHTML = caricamento();
  let diete;
  try {
    ({ diete } = await leggi('/api/studio/modelli'));
  } catch (e) {
    contenuto().innerHTML = avviso('grave', e.message);
    return;
  }
  const gruppi = [
    ['pubblicata', 'Pubblicate'],
    ['bozza', 'Bozze'],
    ['archiviata', 'Archiviate'],
  ];

  contenuto().innerHTML = diete.length
    ? `<div class="stretta-larga">` +
      gruppi
        .map(([chiave, titolo]) => {
          const lista = diete.filter((d) => d.stato === chiave);
          if (!lista.length) return '';
          return (
            `<h2 class="sezione-titolo">${titolo}</h2><section class="card lista">` +
            lista
              .map(
                (d) =>
                  `<div class="riga">${ico('documento')}<span class="corpo"><strong>${esc(d.titolo)}</strong>` +
                  `<small class="muto">${esc(d.cliente)} · aggiornata ${esc(quando(d.aggiornataIl))}</small></span>` +
                  `<button class="btn testo piccolo" data-apri-cliente-dieta="${esc(d.clienteId)}">Cliente</button>` +
                  `<button class="btn secondario piccolo" data-modifica="${esc(d.id)}">Apri</button></div>`,
              )
              .join('') +
            `</section>`
          );
        })
        .join('') +
      `</div>`
    : `<section class="card vuoto">${ico('documento')}<strong>Nessuna dieta</strong><span>Le scrivi dalla scheda di ogni cliente.</span></section>`;

  for (const el of contenuto().querySelectorAll('[data-modifica]')) {
    el.addEventListener('click', () => {
      stato.provenienza = 'diete';
      apriEditor(el.dataset.modifica);
    });
  }
  for (const el of contenuto().querySelectorAll('[data-apri-cliente-dieta]')) {
    el.addEventListener('click', () => apriCliente(el.dataset.apriClienteDieta, 'dieta'));
  }
}

// Altro: sul telefono, le voci che non stanno nella barra

function disegnaAltro() {
  testata({ titolo: 'Altro' });
  const c = stato.dati.conteggi;
  const voce = (tab, icona, nome, nota = '', pallino = 0) =>
    `<button class="riga riga-link" type="button" data-vai="${tab}">${ico(icona)}<span class="corpo">${esc(nome)}` +
    (nota ? `<small class="muto">${esc(nota)}</small>` : '') +
    `</span>${pallino ? `<span class="pallino">${pallino}</span>` : ''}${ico('avanti')}</button>`;

  contenuto().innerHTML =
    `<div class="stretta pila">` +
    `<section class="card lista">` +
    voce('agenda', 'calendario', 'Agenda', 'Le prossime visite') +
    `</section>` +
    `<section class="card lista">` +
    voce('sostituzioni', 'scambia', 'Sostituzioni', 'Cosa hanno cambiato i clienti', c.variazioniNuove) +
    voce('diete', 'documento', 'Diete', 'Tutte le diete e i modelli') +
    voce('libreria', 'foglia', 'Alimenti', 'I valori nutrizionali del tuo studio') +
    `</section>` +
    `<section class="card lista">` +
    voce('conto', 'persona', 'Profilo', stato.dati.io.email) +
    `</section></div>`;
  collegaVai();
}

setInterval(async () => {
  if (document.hidden || !stato.dati) return;
  try {
    const n = await leggi('/api/studio/novita');
    aggiornaPallino({ variazioniNuove: n.variazioniNuove, richieste: n.richieste, messaggi: n.messaggi });
  } catch {
    /* la rete cade: il pallino resta com'era */
  }
}, 60_000);

window.addEventListener('beforeunload', (e) => {
  if (stato.editor?.sporca) e.preventDefault();
});

async function inizia() {
  stato.io = await avvia('nutrizionista');
  if (!stato.io) return;
  await ricarica();
}

inizia();
