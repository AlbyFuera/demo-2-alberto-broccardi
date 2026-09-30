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
  dati: null,
  tab: 'cruscotto',
  /** Il cliente aperto, o null per l'elenco. */
  cliente: null,
  /** La dieta in scrittura: { id, dieta, conti, daCompletare, giorno, sporca }. */
  editor: null,
};

const contenuto = () => $('contenuto');

const BASI_DIETA = [
  ['auto', 'come viene: sul macronutriente principale'],
  ['kcal', 'isocalorica: stesse calorie'],
  ['proteine', 'isoproteica: stessi grammi di proteine'],
  ['carboidrati', 'isoglucidica: stessi carboidrati'],
  ['grassi', 'isolipidica: stessi grassi'],
];

/** Come si chiama, in breve, la regola in vigore sulla dieta aperta. */
const nomeBaseDieta = () => {
  const b = stato.editor?.dieta?.base ?? 'auto';
  return { auto: 'sul macronutriente principale', kcal: 'isocalorica', proteine: 'isoproteica', carboidrati: 'isoglucidica', grassi: 'isolipidica' }[b];
};

// Ricarica

async function ricarica() {
  stato.dati = await leggi('/api/studio/cruscotto');
  aggiornaTesta();
  disegna();
}

function aggiornaTesta() {
  const c = stato.dati.conteggi;
  const nuove = c.variazioniNuove + c.richieste + (c.messaggi ?? 0);

  $('chi-nome').textContent = stato.dati.io.nome || stato.dati.io.email;
  $('chi-sotto').textContent = `${c.clienti} client${c.clienti === 1 ? 'e' : 'i'}`;

  $('pallino').hidden = nuove === 0;
  $('pallino').textContent = String(nuove);
}

function avvisa(messaggio, tipo = 'attenzione') {
  contenuto().insertAdjacentHTML(
    'afterbegin',
    `<div class="avviso ${tipo} sotto"><span class="segno" aria-hidden="true">!</span>` +
      `<span>${esc(messaggio)}</span></div>`,
  );
}

// Cruscotto

function rigaVariazione(v) {
  const avvisi = v.avvisi.length
    ? `<div class="numeri"><span>! ${esc(v.avvisi.join(' · '))}</span></div>`
    : '';

  return (
    `<div class="variazione${v.stato === 'nuova' ? ' nuova' : ''}">` +
    `<div>` +
    `<div class="cambio"><span class="via">${esc(v.daNome)} ${esc(v.daQuantita)}</span>` +
    `<span class="freccia" aria-hidden="true">→</span>` +
    `<span class="nuovo">${esc(v.aNome)} ${esc(v.aQuantita)}</span></div>` +
    `<div class="dove"><strong>${esc(v.clienteNome)}</strong> · ${esc(GIORNI[v.giorno])} · ` +
    `${esc(v.pastoNome)} · ${esc(quando(v.at))}</div></div>` +
    `<div>${delta(v.kcalDelta)}</div>` +
    `<div class="numeri">` +
    `<span>pareggiato ${v.base === 'nessuno' ? 'sulle calorie' : `su ${esc(v.base)}`}</span>` +
    `<span>P ${v.proteineDelta >= 0 ? '+' : ''}${Math.round(v.proteineDelta)} g</span>` +
    `<span>C ${v.carboidratiDelta >= 0 ? '+' : ''}${Math.round(v.carboidratiDelta)} g</span>` +
    `<span>G ${v.grassiDelta >= 0 ? '+' : ''}${Math.round(v.grassiDelta)} g</span>` +
    `</div>` +
    avvisi +
    (v.stato === 'annullata'
      ? `<div class="numeri"><span>Annullata${v.nota ? `: «${esc(v.nota)}»` : '.'}</span></div>`
      : `<div class="azioni">` +
        `<button class="btn mini pericolo" data-annulla="${esc(v.id)}">Annulla la sostituzione</button>` +
        `<button class="btn mini neutra" data-apri-cliente="${esc(v.clienteId)}">Apri il cliente</button>` +
        `</div>`)
  ) + `</div>`;
}

function disegnaCruscotto() {
  const d = stato.dati;
  const nuove = d.variazioni.filter((v) => v.stato === 'nuova');

  const richieste = d.richieste.length
    ? `<div class="sezione"><div class="sezione-testa"><h2>Chi ti ha chiesto di seguirlo</h2>` +
      `<span class="tag attenzione">${d.richieste.length}</span></div><div class="pila">` +
      d.richieste
        .map(
          (r) =>
            `<div class="riga nuova"><div class="corpo">` +
            `<div class="titolo">${esc(r.nome)}</div>` +
            `<div class="piccolo muto">${esc(r.email)} · ${esc(quando(r.richiestoIl))}</div>` +
            (r.messaggio ? `<div class="piccolo sopra">«${esc(r.messaggio)}»</div>` : '') +
            `</div>` +
            `<button class="btn mini" data-accetta="${esc(r.linkId)}">Accetta</button>` +
            `<button class="btn mini neutra" data-rifiuta="${esc(r.linkId)}">Rifiuta</button>` +
            `</div>`,
        )
        .join('') +
      `</div></div>`
    : '';

  const ai = d.ai.attivo
    ? ''
    : `<div class="avviso neutro sotto"><span class="segno" aria-hidden="true">i</span>` +
      `<span>${esc(d.ai.motivo)}</span></div>`;

  const variazioni = d.variazioni.length
    ? d.variazioni.map(rigaVariazione).join('')
    : vuoto(
        '✓',
        'Nessuna variazione',
        'Quando un cliente sostituisce un alimento, la trovi qui con la grammatura equivalente e lo scostamento.',
      );

  contenuto().innerHTML =
    ai +
    richieste +
    `<div class="sezione"><div class="sezione-testa"><h2>Variazioni dei clienti</h2>` +
    (nuove.length
      ? `<span class="tag ok">${nuove.length} nuove</span>` +
        `<button class="btn mini neutra spinge" id="segna-viste">Segna tutte come viste</button>`
      : '') +
    `</div><div class="pila">${variazioni}</div></div>`;

  if (nuove.length) {
    $('segna-viste').addEventListener('click', async () => {
      await invia('/api/studio/viste', { ids: nuove.map((v) => v.id) });
      await ricarica();
    });
  }

  collegaAzioniComuni();

  for (const el of contenuto().querySelectorAll('[data-accetta], [data-rifiuta]')) {
    el.addEventListener('click', async () => {
      el.disabled = true;
      try {
        await invia('/api/studio/decidi', {
          link: el.dataset.accetta ?? el.dataset.rifiuta,
          accetta: el.dataset.accetta !== undefined,
        });
        await ricarica();
      } catch (e) {
        avvisa(e.message, 'grave');
        el.disabled = false;
      }
    });
  }
}

function collegaAzioniComuni() {
  for (const el of contenuto().querySelectorAll('[data-annulla]')) {
    el.addEventListener('click', () => chiediAnnullamento(el));
  }
  for (const el of contenuto().querySelectorAll('[data-apri-cliente]')) {
    el.addEventListener('click', () => apriCliente(el.dataset.apriCliente));
  }
}

function chiediAnnullamento(bottone) {
  if (bottone.dataset.aperto) return;
  bottone.dataset.aperto = '1';

  const zona = document.createElement('div');
  zona.className = 'pila intera';
  zona.innerHTML =
    `<textarea placeholder="Perché la annulli — il cliente lo legge."></textarea>` +
    `<div class="fila"><button class="btn mini pericolo" data-conferma="1">Annulla la sostituzione</button>` +
    `<button class="btn mini neutra" data-lascia="1">Lascia stare</button></div>`;
  bottone.closest('.variazione').appendChild(zona);

  zona.querySelector('[data-lascia]').addEventListener('click', () => {
    delete bottone.dataset.aperto;
    zona.remove();
  });

  zona.querySelector('[data-conferma]').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await invia('/api/studio/annulla-variazione', {
        id: bottone.dataset.annulla,
        nota: zona.querySelector('textarea').value.trim() || null,
      });
      await ricarica();
      if (stato.cliente) await apriCliente(stato.cliente.cliente.id);
    } catch (err) {
      avvisa(err.message, 'grave');
      e.target.disabled = false;
    }
  });
}

// Clienti

function scriviAderenza(a, oggi) {
  const diOggi = oggi?.pastiPrevisti
    ? `<div class="piccolo muto">oggi ${oggi.pastiFatti}/${oggi.pastiPrevisti}</div>`
    : '';
  if (!a || a.percentuale === null) {
    return (
      `<span class="aderenza ignota" title="Non ha ancora segnato nessun pasto nei giorni passati">— nessun dato</span>` +
      diOggi
    );
  }
  return (
    `<span class="aderenza ${esc(a.livello)}" title="${esc(a.descrizione)}">` +
    `<span class="pallina"></span>${a.percentuale}%</span>` +
    diOggi
  );
}

function disegnaClienti() {
  if (stato.editor) return disegnaEditor();
  if (stato.cliente) return disegnaCliente();

  const clienti = stato.dati.clienti;

  if (!clienti.length) {
    contenuto().innerHTML = vuoto(
      '—',
      'Nessun cliente ancora',
      'I clienti si iscrivono da soli e ti aggiungono con la tua email: ' +
        `${stato.dati.io.email}. Quando lo fanno, la richiesta arriva sul cruscotto.`,
    );
    return;
  }

  contenuto().innerHTML =
    `<div class="sezione"><div class="sezione-testa"><h2>I tuoi clienti</h2></div>` +
    `<div class="scorri"><table class="tabella"><thead><tr>` +
    `<th>Cliente</th><th>Segue la dieta</th><th>Dieta</th><th>Da guardare</th><th>Da</th><th></th>` +
    `</tr></thead><tbody>` +
    clienti
      .map(
        (c) =>
          `<tr class="cliccabile" data-riga-cliente="${esc(c.id)}">` +
          `<td><button class="link-nome" data-apri-cliente="${esc(c.id)}">${esc(c.nome)}</button>` +
          `<div class="piccolo muto">${esc(c.email)}</div></td>` +
          `<td>${scriviAderenza(c.aderenza, c.oggi)}</td>` +
          `<td>${
            c.dieta
              ? `<span class="tag ${c.dieta.stato === 'pubblicata' ? 'ok' : 'attenzione'}">` +
                `${esc(c.dieta.stato)}</span>`
              : '<span class="tag">nessuna dieta</span>'
          }</td>` +
          `<td>${[
            c.variazioniNuove ? `<span class="tag ok">${c.variazioniNuove} variazioni</span>` : '',
            c.messaggiDaLeggere ? `<span class="tag attenzione">${c.messaggiDaLeggere} messaggi</span>` : '',
            c.domandeAperte ? `<span class="tag attenzione">${c.domandeAperte} domande</span>` : '',
            c.automazione ? '' : '<span class="tag">rispondi tu</span>',
          ].filter(Boolean).join(' ')}</td>` +
          `<td class="piccolo muto">${esc(quando(c.seguitoDa))}</td>` +
          `<td><button class="btn mini neutra" data-apri-cliente="${esc(c.id)}">Apri</button></td></tr>`,
      )
      .join('') +
    `</tbody></table></div></div>`;

  collegaAzioniComuni();

  // Tutta la riga apre il cliente, non solo il bottone in fondo.
  for (const riga of contenuto().querySelectorAll('[data-riga-cliente]')) {
    riga.addEventListener('click', (e) => {
      if (e.target.closest('button, a')) return;
      apriCliente(riga.dataset.rigaCliente);
    });
  }
}

async function apriCliente(id) {
  stato.tab = 'clienti';
  stato.editor = null;
  contenuto().innerHTML = `<div class="vuoto"><p class="grande">·</p><p>Caricamento…</p></div>`;

  try {
    stato.cliente = await leggi('/api/studio/cliente', new URLSearchParams({ cliente: id }));
    disegna();
  } catch (e) {
    stato.cliente = null;
    disegna();
    avvisa(e.message, 'grave');
  }
}

function disegnaCliente() {
  const d = stato.cliente;
  const dieta = d.dietaAttuale;

  const settimana = dieta
    ? dieta.giorni
        .map(
          (g) =>
            `<article class="giorno"><header class="giorno-testa">` +
            `<span class="nome">${esc(g.nome)}</span>` +
            (g.allenamento ? `<span class="tag ok">allenamento</span>` : '') +
            `<span class="tag">${g.parziale ? '≈' : ''}${g.kcal} kcal</span></header>` +
            (g.pasti.length
              ? g.pasti
                  .map(
                    (p) =>
                      `<div class="pasto"><div class="pasto-nome">${esc(p.nome)} · ${p.kcal} kcal` +
                      (g.indice === d.oggi?.indice && d.oggi.fatti.includes(p.id)
                        ? ` <span class="tag ok">✓ fatto oggi</span>`
                        : g.indice === d.oggi?.indice && d.oggi.saltati.includes(p.id)
                          ? ` <span class="tag attenzione">saltato oggi</span>`
                          : '') +
                      `</div>` +
                      `<div class="alimenti">` +
                      p.alimenti
                        .map(
                          (a) =>
                            `<span class="alimento${a.cambiato ? ' cambiato' : ''}"` +
                            (a.cambiato ? ' title="sostituito dal cliente"' : '') +
                            `><span>${esc(a.nome)}</span>` +
                            `<span class="peso">${esc(a.quantita)}</span></span>`,
                        )
                        .join('') +
                      `</div></div>`,
                  )
                  .join('')
              : `<div class="pasto-nota">niente scritto</div>`) +
            `</article>`,
        )
        .join('')
    : '';

  const riepilogo = dieta
    ? `<div class="riga"><div class="corpo">` +
      `<div class="titolo">${esc(dieta.titolo)} ` +
      `<span class="tag ${dieta.stato === 'pubblicata' ? 'ok' : 'attenzione'}">${esc(dieta.stato)}</span></div>` +
      `<div class="piccolo muto">${dieta.mediaKcal} kcal al giorno su ${dieta.giorniScritti} giorni · ` +
      `P ${dieta.mediaProteine} · C ${dieta.mediaCarboidrati} · G ${dieta.mediaGrassi} g` +
      (dieta.parziale ? ' · conto parziale' : '') +
      (dieta.sostituzioniAttive
        ? ` · ${dieta.sostituzioniAttive} sostituzioni del cliente attive`
        : '') +
      `</div></div>` +
      `<button class="btn mini" data-modifica="${esc(dieta.id)}">Modifica</button>` +
      (dieta.stato === 'pubblicata'
        ? `<button class="btn mini neutra" data-ritira="${esc(dieta.id)}">Ritira</button>`
        : `<button class="btn mini" data-pubblica="${esc(dieta.id)}">Pubblica</button>`) +
      `</div>`
    : vuoto(
        '—',
        'Nessuna dieta',
        'Finché non gliene scrivi e pubblichi una, il cliente entra e non vede niente.',
      );

  const storiche = d.diete.filter((x) => !dieta || x.id !== dieta.id);
  // Una bozza nuova accanto a una dieta pubblicata non deve finire in fondo alla pagina.
  const bozzeInCorso = dieta?.stato === 'pubblicata' ? storiche.filter((x) => x.stato === 'bozza') : [];
  const avvisoBozze = bozzeInCorso.length
    ? `<div class="pila sotto">` +
      bozzeInCorso
        .map(
          (x) =>
            `<div class="avviso attenzione"><span class="segno" aria-hidden="true">!</span>` +
            `<span>Bozza in corso, non ancora pubblicata: <strong>${esc(x.titolo)}</strong> ` +
            `(aggiornata ${esc(quando(x.aggiornataIl))}).</span>` +
            `<button class="btn mini spinge" data-modifica="${esc(x.id)}">Continua la bozza</button></div>`,
        )
        .join('') +
      `</div>`
    : '';

  const passiMedi = d.passi.length
    ? Math.round(d.passi.reduce((s, p) => s + p.passi, 0) / d.passi.length)
    : null;

  contenuto().innerHTML =
    `<div class="fila sotto"><button class="btn mini neutra" id="indietro">← Tutti i clienti</button>` +
    `<button class="btn mini pericolo spinge" id="scollega">Smetti di seguirlo</button></div>` +
    `<div class="sezione"><div class="sezione-testa"><h2>${esc(d.cliente.nome)}</h2>` +
    `<span class="piccolo muto">${esc(d.cliente.email)}</span>` +
    `<button class="btn mini neutra spinge" id="carica-pdf">Carica un PDF</button>` +
    `<button class="btn mini" id="nuova-dieta">Nuova dieta</button></div>` +
    avvisoBozze +
    `<div class="riquadri">` +
    `<div class="riquadro"><div class="etichetta">Segue la dieta</div>` +
    `<div class="cifra">${d.aderenza?.percentuale ?? '—'}${d.aderenza?.percentuale != null ? '%' : ''}</div>` +
    `<div class="sotto-cifra">${esc(
      d.oggi?.pastiFatti || d.oggi?.pastiSaltati
        ? d.aderenza?.percentuale != null
          ? d.aderenza.descrizione
          : 'I giorni precedenti non hanno ancora dati: la percentuale arriva da domani.'
        : (d.aderenza?.descrizione ?? 'non ha ancora segnato nessun pasto'),
    )}</div>` +
    (d.oggi?.pastiPrevisti
      ? `<div class="sotto-cifra"><strong>Oggi: ${d.oggi.pastiFatti}/${d.oggi.pastiPrevisti} fatti</strong>` +
        (d.oggi.pastiSaltati ? ` · ${d.oggi.pastiSaltati} saltati` : '') +
        `</div>`
      : '') +
    `</div>` +
    `<div class="riquadro"><div class="etichetta">Passi al giorno</div>` +
    `<div class="cifra">${passiMedi ?? '—'}</div>` +
    `<div class="sotto-cifra">${passiMedi ? `media sugli ultimi ${d.passi.length} giorni segnati` : 'non li segna'}</div></div>` +
    `</div>` +
    riepilogo +
    (settimana ? `<div class="pila sopra">${settimana}</div>` : '') +
    `</div>` +
    (storiche.length
      ? `<div class="sezione"><div class="sezione-testa"><h2>Altre diete</h2></div><div class="pila">` +
        storiche
          .map(
            (x) =>
              `<div class="riga"><div class="corpo"><div class="titolo">${esc(x.titolo)} ` +
              `<span class="tag">${esc(x.stato)}</span></div>` +
              `<div class="piccolo muto">aggiornata ${esc(quando(x.aggiornataIl))}</div></div>` +
              `<button class="btn mini neutra" data-modifica="${esc(x.id)}">Apri</button>` +
              `<button class="btn mini pericolo" data-elimina-dieta="${esc(x.id)}">Elimina</button>` +
              `</div>`,
          )
          .join('') +
        `</div></div>`
      : '') +
    conversazione(d) +
    `<div class="sezione"><div class="sezione-testa"><h2>Le sue variazioni</h2></div>` +
    `<div class="pila">${
      d.variazioni.length
        ? d.variazioni.map(rigaVariazione).join('')
        : vuoto('—', 'Non ha ancora cambiato nulla')
    }</div></div>`;

  collegaConversazione(d.cliente.id);

  $('indietro').addEventListener('click', () => {
    stato.cliente = null;
    disegna();
  });

  $('nuova-dieta').addEventListener('click', () => nuovaDieta(d.cliente.id, dieta?.id));
  $('carica-pdf').addEventListener('click', () => apriCaricamentoPdf(d.cliente.id));

  $('scollega').addEventListener('click', async () => {
    if (!$('scollega').dataset.confermato) {
      $('scollega').dataset.confermato = '1';
      $('scollega').textContent = 'Sicuro? Non vedrà più la dieta';
      return;
    }
    await invia('/api/studio/scollega', { link: d.cliente.linkId });
    stato.cliente = null;
    await ricarica();
  });

  for (const el of contenuto().querySelectorAll('[data-modifica]')) {
    el.addEventListener('click', () => apriEditor(el.dataset.modifica));
  }
  for (const el of contenuto().querySelectorAll('[data-pubblica]')) {
    el.addEventListener('click', () => pubblica(el.dataset.pubblica));
  }
  for (const el of contenuto().querySelectorAll('[data-ritira]')) {
    el.addEventListener('click', async () => {
      await invia('/api/studio/ritira', { id: el.dataset.ritira });
      await apriCliente(d.cliente.id);
    });
  }
  for (const el of contenuto().querySelectorAll('[data-elimina-dieta]')) {
    el.addEventListener('click', async () => {
      if (!el.dataset.confermato) {
        el.dataset.confermato = '1';
        el.textContent = 'Sicuro?';
        return;
      }
      await invia('/api/studio/elimina-dieta', { id: el.dataset.eliminaDieta });
      await apriCliente(d.cliente.id);
    });
  }

  collegaAzioniComuni();
}

// La conversazione con il cliente

function conversazione(d) {
  const auto = d.cliente.automazione;
  const filo = d.conversazione ?? [];

  const messaggi = filo.length
    ? filo
        .map(
          (m) =>
            `<div class="msg ${m.autore === 'studio' ? 'io' : 'lui'}">` +
            `<div class="bolla">${esc(m.testo)}</div>` +
            `<div class="fonte"><span class="bollino${m.autore === 'assistente' ? ' ai' : ''}">` +
            `${m.autore === 'cliente' ? esc(d.cliente.nome) : m.autore === 'studio' ? 'tu' : 'assistente'}` +
            `</span><span>${esc(quando(m.at))}</span></div></div>`,
        )
        .join('')
    : vuoto('—', 'Nessun messaggio', 'Quando il cliente scrive, la conversazione compare qui.');

  return (
    `<div class="sezione"><div class="sezione-testa"><h2>Conversazione</h2>` +
    `<span class="tag ${auto ? 'ok' : 'attenzione'}">${auto ? 'risponde l’assistente' : 'rispondi tu'}</span>` +
    `<button class="btn mini neutra spinge" id="cambia-automazione">` +
    `${auto ? 'Disattiva le risposte automatiche' : 'Riattiva le risposte automatiche'}</button>` +
    `</div>` +
    `<div class="avviso neutro sotto"><span class="segno" aria-hidden="true">i</span><span>` +
    (auto
      ? `L'assistente risponde da solo alle domande di ${esc(d.cliente.nome)} usando i dati della ` +
        `sua dieta. Tu leggi tutto qui e puoi scrivergli quando vuoi: il tuo messaggio si distingue ` +
        `sempre da quello dell'assistente.`
      : `Le risposte automatiche sono spente per ${esc(d.cliente.nome)}: quello che scrive aspetta ` +
        `te, e nessuno risponde al posto tuo.`) +
    `</span></div>` +
    `<div class="filo incassato" id="filo-studio">${messaggi}</div>` +
    `<form class="scrivi" id="scrivi-cliente">` +
    `<input id="testo-studio" type="text" autocomplete="off" ` +
    `placeholder="Scrivi a ${esc(d.cliente.nome)}…" aria-label="Scrivi al cliente">` +
    `<button class="btn invia" type="submit" aria-label="Invia">↑</button>` +
    `</form></div>`
  );
}

function collegaConversazione(clienteId) {
  const filo = $('filo-studio');
  if (filo) filo.scrollTop = filo.scrollHeight;

  $('cambia-automazione')?.addEventListener('click', async (evento) => {
    evento.target.disabled = true;
    try {
      await invia('/api/studio/automazione', {
        cliente: clienteId,
        attiva: !stato.cliente.cliente.automazione,
      });
      await apriCliente(clienteId);
    } catch (e) {
      avvisa(e.message, 'grave');
      evento.target.disabled = false;
    }
  });

  $('scrivi-cliente')?.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const testo = $('testo-studio').value.trim();
    if (!testo) return;

    $('testo-studio').disabled = true;
    try {
      await invia('/api/studio/scrivi', { cliente: clienteId, testo });
      const { messaggi } = await leggi(
        '/api/studio/conversazione',
        new URLSearchParams({ cliente: clienteId }),
      );
      stato.cliente.conversazione = messaggi;
      disegnaCliente();
    } catch (e) {
      avvisa(e.message, 'grave');
      $('testo-studio').disabled = false;
    }
  });
}

async function nuovaDieta(clienteId, daId) {
  const titolo = `Dieta di ${new Date().toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })}`;
  const esito = await invia('/api/studio/nuova-dieta', {
    cliente: clienteId,
    titolo,
    da: daId ?? '',
  });
  await apriEditor(esito.id);
}

// Editor della dieta

async function apriEditor(dietaId) {
  contenuto().innerHTML = `<div class="vuoto"><p class="grande">·</p><p>Caricamento…</p></div>`;
  const d = await leggi('/api/studio/dieta', new URLSearchParams({ dieta: dietaId }));

  stato.editor = {
    id: d.id,
    clienteId: d.clienteId,
    statoDieta: d.stato,
    dieta: d.dieta,
    conti: d.conti,
    daCompletare: d.daCompletare,
    giorno: (new Date().getDay() + 6) % 7,
    /** Il pannello delle sostituzioni aperto, come "pasto.alimento". */
    pianoAperto: null,
    sporca: false,
  };
  stato.tab = 'clienti';
  disegna();
}

function disegnaEditor() {
  const e = stato.editor;
  const giorno = e.dieta.giorni.find((g) => g.indice === e.giorno);
  const conti = e.conti.giorni.find((g) => g.indice === e.giorno) ?? {
    kcal: 0,
    proteine: 0,
    carboidrati: 0,
    grassi: 0,
    parziale: false,
  };
  const o = e.dieta.obiettivi ?? {};

  const scarto = o.kcal ? Math.round(conti.kcal - o.kcal) : null;

  contenuto().innerHTML =
    `<div class="fila sotto">` +
    `<button class="btn mini neutra" id="chiudi-editor">← Torna al cliente</button>` +
    `<span class="tag${e.statoDieta === 'pubblicata' ? ' ok' : ' attenzione'}">${esc(e.statoDieta)}</span>` +
    `<button class="btn mini spinge" id="salva">Salva</button>` +
    `<button class="btn mini" id="pubblica-editor">Salva e pubblica</button>` +
    `</div>` +
    `<div id="esito-editor"></div>` +
    (e.daCompletare.length
      ? `<div class="avviso attenzione sotto"><span class="segno" aria-hidden="true">!</span><span>` +
        `${e.daCompletare.length} aliment${e.daCompletare.length === 1 ? 'o' : 'i'} senza valori ` +
        `nutrizionali: ${esc(e.daCompletare.map((x) => x.nome).slice(0, 4).join(', '))}. ` +
        `Finché mancano, i totali sono incompleti. ` +
        `<button class="btn mini neutra" id="completa">Completali</button></span></div>`
      : '') +
    `<div class="campi">` +
    `<label><span>Titolo della dieta</span>` +
    `<input id="titolo" type="text" value="${esc(e.dieta.titolo)}"></label>` +
    `<label><span>Obiettivo kcal al giorno <span class="aiuto">facoltativo</span></span>` +
    `<input id="ob-kcal" type="number" min="0" value="${o.kcal ?? ''}"></label>` +
    `</div>` +
    `<div class="campi">` +
    `<label><span>Proteine g</span><input id="ob-proteine" type="number" min="0" value="${o.proteine ?? ''}"></label>` +
    `<label><span>Carboidrati g</span><input id="ob-carboidrati" type="number" min="0" value="${o.carboidrati ?? ''}"></label>` +
    `<label><span>Grassi g</span><input id="ob-grassi" type="number" min="0" value="${o.grassi ?? ''}"></label>` +
    `<label><span>Acqua litri</span><input id="ob-acqua" type="number" min="0" step="0.1" value="${o.acqua ?? ''}"></label>` +
    `<label><span>Passi al giorno</span><input id="ob-passi" type="number" min="0" step="500" value="${o.passi ?? ''}"></label>` +
    `</div>` +
    `<label><span>Le sostituzioni si pareggiano <span class="aiuto">vale per tutta la dieta — il cliente non la può cambiare</span></span>` +
    `<select id="base-dieta">` +
    BASI_DIETA.map(
      ([v, t]) =>
        `<option value="${v}"${(e.dieta.base ?? 'auto') === v ? ' selected' : ''}>${esc(t)}</option>`,
    ).join('') +
    `</select></label>` +
    `<label><span>Indicazioni generali <span class="aiuto">una per riga — le legge il cliente</span></span>` +
    `<textarea id="indicazioni">${esc(e.dieta.indicazioni.join('\n'))}</textarea></label>` +
    `<div class="giorni-nav" id="giorni-nav">` +
    e.dieta.giorni
      .map((g) => {
        const vuotoGiorno = !g.pasti.some((p) => p.alimenti.length > 0);
        const kcal = e.conti.giorni.find((x) => x.indice === g.indice)?.kcal ?? 0;
        // aria-pressed e non aria-selected: sono interruttori, non tab.
        return (
          `<button data-giorno="${g.indice}" aria-pressed="${g.indice === e.giorno}"` +
          `${vuotoGiorno ? ' class="vuoto-giorno"' : ''}>` +
          `${esc(GIORNI[g.indice].slice(0, 3))}${vuotoGiorno ? '' : ` · ${kcal}`}</button>`
        );
      })
      .join('') +
    `</div>` +
    `<div class="conta-giorno">` +
    `<span class="grande">${conti.parziale ? '≈' : ''}${conti.kcal}</span><span>kcal</span>` +
    `<span class="macro">P ${conti.proteine} · C ${conti.carboidrati} · G ${conti.grassi} g</span>` +
    (scarto !== null
      ? `<span class="spinge">${delta(scarto)} <span class="muto piccolo">sull'obiettivo</span></span>`
      : '') +
    `</div>` +
    `<div class="fila sotto">` +
    `<label class="piccolo"><input type="checkbox" id="allenamento"${giorno.allenamento ? ' checked' : ''}> ` +
    `giorno di allenamento</label>` +
    `<button class="btn mini neutra spinge" id="copia-da">Copia da un altro giorno</button>` +
    `</div>` +
    `<div id="pasti">${giorno.pasti.map(disegnaPasto).join('')}</div>` +
    `<button class="btn neutra sopra" id="aggiungi-pasto">+ Aggiungi un pasto</button>`;

  collegaEditor();
}

function disegnaPasto(pasto, i) {
  return (
    `<div class="editor-pasto" data-pasto="${i}">` +
    `<div class="editor-pasto-testa">` +
    `<input class="nome-pasto" type="text" value="${esc(pasto.nome)}" placeholder="Colazione" ` +
    `data-campo="nome">` +
    `<input class="orario" type="text" value="${esc(pasto.orario ?? '')}" placeholder="13:00" ` +
    `data-campo="orario">` +
    `<button class="btn mini pericolo" data-togli-pasto="${i}" title="Togli il pasto">✕</button>` +
    `</div>` +
    pasto.alimenti.map((a, j) => disegnaAlimento(a, i, j)).join('') +
    `<button class="btn mini neutra sopra" data-aggiungi-alimento="${i}">+ alimento</button>` +
    `</div>`
  );
}

function disegnaAlimento(a, i, j) {
  const ignoto = stato.editor.daCompletare.some(
    (x) => x.nome.toLowerCase() === a.nome.toLowerCase(),
  );
  const quante = (a.alternative ?? []).filter((x) => (x.nome ?? '').trim()).length;
  const aperto = stato.editor.pianoAperto === `${i}.${j}`;

  return (
    `<div class="riga-alimento${ignoto ? ' ignoto' : ''}" data-alimento="${i}.${j}">` +
    `<input type="text" value="${esc(a.nome)}" placeholder="petto di pollo" data-campo="nome">` +
    `<input type="number" min="0" step="1" value="${a.quantita ?? ''}" placeholder="q.b." ` +
    `data-campo="quantita">` +
    `<select data-campo="unita">` +
    ['g', 'ml', 'pz']
      .map((u) => `<option value="${u}"${a.unita === u ? ' selected' : ''}>${u}</option>`)
      .join('') +
    `</select>` +
    `<button class="btn mini ${quante ? '' : 'neutra'}" data-piano="${i}.${j}" ` +
    `aria-expanded="${aperto}" title="Sostituzioni ammesse">⇄${quante ? ` ${quante}` : ''}</button>` +
    `<button class="btn mini pericolo" data-togli-alimento="${i}.${j}" title="Togli">✕</button>` +
    `</div>` +
    (aperto ? disegnaPiano(a, i, j) : '')
  );
}

function disegnaPiano(a, i, j) {
  const alternative = a.alternative ?? [];

  const righe = alternative
    .map(
      (alt, k) =>
        `<div class="riga-alternativa" data-alternativa="${k}">` +
        `<input type="text" value="${esc(alt.nome ?? '')}" placeholder="merluzzo" data-alt="nome">` +
        `<input type="number" min="0" step="1" value="${alt.quantita ?? ''}" ` +
        `placeholder="auto" data-alt="quantita" title="Lascia vuoto e la calcolo io">` +
        `<select data-alt="unita">` +
        ['g', 'ml', 'pz']
          .map(
            (u) =>
              `<option value="${u}"${(alt.unita ?? a.unita) === u ? ' selected' : ''}>${u}</option>`,
          )
          .join('') +
        `</select>` +
        `<button class="btn mini pericolo" data-togli-alternativa="${i}.${j}.${k}" title="Togli">✕</button>` +
        `</div>`,
    )
    .join('');

  return (
    `<div class="piano-alimento" data-piano-di="${i}.${j}">` +
    `<div class="campi">` +
    `<label><span>Come si chiama questo posto <span class="aiuto">lo legge il cliente</span></span>` +
    `<input type="text" value="${esc(a.gruppo ?? '')}" placeholder="fonte proteica" data-piano-campo="gruppo"></label>` +
    `<label><span>Solo per questo alimento</span><select data-piano-campo="base">` +
    [['', `come dice la dieta: ${nomeBaseDieta()}`], ...BASI_DIETA]
      .map(
        ([v, t]) => `<option value="${v}"${(a.base ?? '') === v ? ' selected' : ''}>${esc(t)}</option>`,
      )
      .join('') +
    `</select></label>` +
    `</div>` +
    (righe ||
      `<p class="piccolo muto">Nessuna sostituzione ammessa: il cliente può comunque chiederne una, ` +
        `ma gli conterà come deviazione dal piano.</p>`) +
    `<div class="fila sopra">` +
    `<button class="btn mini neutra" data-aggiungi-alternativa="${i}.${j}">+ sostituzione</button>` +
    `<button class="btn mini neutra spinge" data-chiudi-piano="1">Chiudi</button>` +
    `</div></div>`
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
      nota: vecchio.nota,
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
  e.dieta.indicazioni = $('indicazioni')
    .value.split('\n')
    .map((r) => r.trim())
    .filter(Boolean);

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
  };
}

/** Il piano di un alimento che non si sta modificando: si porta avanti com'è. */
const pianoDi = (a) => ({
  alternative: a.alternative,
  base: a.base,
  gruppo: a.gruppo,
});

/** Il piano come lo ha appena scritto il professionista nel pannello aperto. */
function leggiPannelloPiano(pannello) {
  const campo = (nome) => pannello.querySelector(`[data-piano-campo="${nome}"]`)?.value ?? '';

  // Non scartare qui le righe senza nome: lo fa il server al salvataggio.
  const alternative = [...pannello.querySelectorAll('.riga-alternativa')].map((riga) => {
    const q = riga.querySelector('[data-alt="quantita"]').value;
    return {
      nome: riga.querySelector('[data-alt="nome"]').value.trim(),
      // Vuoto significa calcolata dal motore: non convertire in zero.
      quantita: q === '' ? undefined : Number(q),
      unita: riga.querySelector('[data-alt="unita"]').value,
    };
  });

  return {
    alternative,
    // Vuoto significa come dice la dieta: non forzare 'auto'.
    base: campo('base'),
    gruppo: campo('gruppo').trim(),
  };
}

function collegaEditor() {
  const e = stato.editor;
  const giorno = () => e.dieta.giorni.find((g) => g.indice === e.giorno);

  $('chiudi-editor').addEventListener('click', () => {
    chiediUscita(async () => {
      stato.editor = null;
      await apriCliente(e.clienteId);
    });
  });

  $('base-dieta').addEventListener('change', () => {
    e.dieta.base = $('base-dieta').value;
    e.sporca = true;
    for (const o of contenuto().querySelectorAll('[data-piano-campo="base"] option[value=""]')) {
      o.textContent = `come dice la dieta: ${nomeBaseDieta()}`;
    }
  });

  for (const b of $('giorni-nav').querySelectorAll('button')) {
    b.addEventListener('click', () => {
      leggiGiorno();
      e.giorno = Number(b.dataset.giorno);
      disegnaEditor();
    });
  }

  $('aggiungi-pasto').addEventListener('click', () => {
    leggiGiorno();
    giorno().pasti.push({ nome: nomeSuggerito(giorno().pasti.length), alimenti: [] });
    e.sporca = true;
    disegnaEditor();
  });

  for (const el of contenuto().querySelectorAll('[data-aggiungi-alimento]')) {
    el.addEventListener('click', () => {
      leggiGiorno();
      giorno().pasti[Number(el.dataset.aggiungiAlimento)].alimenti.push({
        nome: '',
        quantita: null,
        unita: 'g',
      });
      e.sporca = true;
      disegnaEditor();
    });
  }

  for (const el of contenuto().querySelectorAll('[data-togli-pasto]')) {
    el.addEventListener('click', () => {
      leggiGiorno();
      giorno().pasti.splice(Number(el.dataset.togliPasto), 1);
      e.sporca = true;
      disegnaEditor();
    });
  }

  for (const el of contenuto().querySelectorAll('[data-togli-alimento]')) {
    el.addEventListener('click', () => {
      leggiGiorno();
      const [i, j] = el.dataset.togliAlimento.split('.').map(Number);
      giorno().pasti[i].alimenti.splice(j, 1);
      e.pianoAperto = null;
      e.sporca = true;
      disegnaEditor();
    });
  }

  // Piano a sostituzione

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
      e.sporca = true;
      disegnaEditor();
    });
  }

  for (const el of contenuto().querySelectorAll('[data-togli-alternativa]')) {
    el.addEventListener('click', () => {
      leggiGiorno();
      const [i, j, k] = el.dataset.togliAlternativa.split('.').map(Number);
      giorno().pasti[i].alimenti[j].alternative?.splice(k, 1);
      e.sporca = true;
      disegnaEditor();
    });
  }

  for (const campo of contenuto().querySelectorAll('input, select, textarea')) {
    campo.addEventListener('input', () => {
      e.sporca = true;
    });
  }

  $('copia-da').addEventListener('click', () => copiaGiorno());
  $('salva').addEventListener('click', () => salva(false));
  $('pubblica-editor').addEventListener('click', () => salva(true));

  if ($('completa')) $('completa').addEventListener('click', () => apriCompletamento());
}

const NOMI_SUGGERITI = ['Colazione', 'Spuntino', 'Pranzo', 'Merenda', 'Cena', 'Spuntino serale'];
const nomeSuggerito = (i) => NOMI_SUGGERITI[i] ?? `Pasto ${i + 1}`;

function chiediUscita(prosegui) {
  if (!stato.editor?.sporca) {
    prosegui();
    return;
  }
  if ($('conferma-uscita')) return;

  const zona = document.createElement('div');
  zona.id = 'conferma-uscita';
  zona.className = 'avviso attenzione sotto';
  zona.innerHTML =
    `<span class="segno" aria-hidden="true">!</span><span>` +
    `Hai modifiche non salvate su questa dieta. ` +
    `<button class="btn mini" data-salva-esci="1">Salva ed esci</button> ` +
    `<button class="btn mini pericolo" data-esci-comunque="1">Esci senza salvare</button> ` +
    `<button class="btn mini neutra" data-resta="1">Resta qui</button></span>`;

  contenuto().prepend(zona);
  zona.scrollIntoView({ block: 'nearest' });

  zona.querySelector('[data-resta]').addEventListener('click', () => zona.remove());

  zona.querySelector('[data-esci-comunque]').addEventListener('click', () => {
    stato.editor.sporca = false;
    prosegui();
  });

  zona.querySelector('[data-salva-esci]').addEventListener('click', async (e) => {
    e.target.disabled = true;
    await salva(false);
    // `salva` ridisegna l'editor, quindi la barra è già sparita da sé.
    if (!stato.editor.sporca) prosegui();
  });
}

function copiaGiorno() {
  const e = stato.editor;
  const zona = document.createElement('div');
  zona.className = 'avviso neutro sotto';
  zona.innerHTML =
    `<span class="segno" aria-hidden="true">+</span><span>Copia i pasti di: ` +
    e.dieta.giorni
      .filter((g) => g.indice !== e.giorno && g.pasti.some((p) => p.alimenti.length))
      .map((g) => `<button class="btn mini neutra" data-copia="${g.indice}">${esc(GIORNI[g.indice])}</button>`)
      .join(' ') +
    ` <button class="btn mini" data-chiudi-copia="1">annulla</button></span>`;

  contenuto().prepend(zona);

  for (const b of zona.querySelectorAll('[data-copia]')) {
    b.addEventListener('click', () => {
      leggiGiorno();
      const sorgente = e.dieta.giorni.find((g) => g.indice === Number(b.dataset.copia));
      const destinazione = e.dieta.giorni.find((g) => g.indice === e.giorno);
      // Gli id dei pasti non si copiano: li rigenera il server.
      destinazione.pasti = sorgente.pasti.map((p) => ({
        nome: p.nome,
        orario: p.orario,
        nota: p.nota,
        alimenti: p.alimenti.map((a) => ({ ...a })),
      }));
      e.sporca = true;
      disegnaEditor();
    });
  }
  zona.querySelector('[data-chiudi-copia]').addEventListener('click', () => zona.remove());
}

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
    e.sporca = false;

    if (anchePubblica) {
      const p = await invia('/api/studio/pubblica', { id: e.id });
      e.statoDieta = 'pubblicata';
      disegnaEditor();
      $('esito-editor').innerHTML =
        `<div class="avviso ok sotto"><span class="segno" aria-hidden="true">✓</span><span>` +
        `${esc(p.avviso ?? 'Pubblicata: il cliente la vede da adesso.')}</span></div>`;
      return;
    }

    disegnaEditor();
    $('esito-editor').innerHTML =
      `<div class="avviso ok sotto"><span class="segno" aria-hidden="true">✓</span><span>` +
      `Salvata${e.statoDieta === 'pubblicata' ? ' — il cliente vede già le modifiche.' : ' come bozza: il cliente non la vede ancora.'}` +
      `</span></div>`;
  } catch (err) {
    disegnaEditor();
    $('esito-editor').innerHTML =
      `<div class="avviso grave sotto"><span class="segno" aria-hidden="true">!</span>` +
      `<span>${esc(err.message)}</span></div>`;
  }
}

async function pubblica(dietaId) {
  try {
    const p = await invia('/api/studio/pubblica', { id: dietaId });
    await apriCliente(stato.cliente.cliente.id);
    if (p.avviso) avvisa(p.avviso, 'attenzione');
  } catch (e) {
    avvisa(e.message, 'grave');
  }
}

function apriCompletamento() {
  const mancanti = stato.editor.daCompletare;

  const zona = document.createElement('div');
  zona.className = 'scheda accesso stretto sotto';
  zona.innerHTML =
    `<h2 class="sotto-poco">Valori mancanti</h2>` +
    `<p class="piccolo muto sotto">Grammi per 100 g di alimento. Li scrivi una volta sola: ` +
    `restano nella libreria del tuo studio e valgono per tutte le tue diete.</p>` +
    mancanti
      .map(
        (m, i) =>
          `<div class="sezione" data-mancante="${i}">` +
          `<div class="titolo">${esc(m.nome)} <span class="piccolo muto">(${esc(m.unita)}) — ` +
          `${esc(m.dove.slice(0, 2).join(', '))}</span></div>` +
          `<div class="campi">` +
          `<label><span>Proteine</span><input type="number" min="0" max="100" step="0.1" data-v="proteine"></label>` +
          `<label><span>Carboidrati</span><input type="number" min="0" max="100" step="0.1" data-v="carboidrati"></label>` +
          `<label><span>Grassi</span><input type="number" min="0" max="100" step="0.1" data-v="grassi"></label>` +
          `</div>` +
          `<button class="btn mini" data-salva-alimento="${i}">Salva ${esc(m.nome)}</button>` +
          `<span class="piccolo muto" data-esito="${i}"></span>` +
          `</div>`,
      )
      .join('') +
    `<button class="btn neutra sopra" data-chiudi-completamento="1">Chiudi</button>`;

  contenuto().prepend(zona);

  for (const b of zona.querySelectorAll('[data-salva-alimento]')) {
    b.addEventListener('click', async () => {
      const i = Number(b.dataset.salvaAlimento);
      const blocco = zona.querySelector(`[data-mancante="${i}"]`);
      const val = (nome) => blocco.querySelector(`[data-v="${nome}"]`).value;
      const esito = blocco.querySelector(`[data-esito="${i}"]`);

      try {
        await invia('/api/studio/salva-alimento', {
          nome: mancanti[i].nome,
          per: mancanti[i].unita === 'pz' ? 'pz' : 'g100',
          proteine: Number(val('proteine') || 0),
          carboidrati: Number(val('carboidrati') || 0),
          grassi: Number(val('grassi') || 0),
        });
        esito.textContent = 'salvato';
        b.disabled = true;
      } catch (err) {
        esito.textContent = err.message;
      }
    });
  }

  zona.querySelector('[data-chiudi-completamento]').addEventListener('click', async () => {
    zona.remove();
    // I totali cambiano appena i valori esistono: si rilegge la dieta.
    await apriEditor(stato.editor.id);
  });
}

// Libreria degli alimenti

async function disegnaLibreria() {
  contenuto().innerHTML = `<div class="vuoto"><p class="grande">·</p><p>Caricamento…</p></div>`;
  const { alimenti } = await leggi('/api/studio/libreria');

  contenuto().innerHTML =
    `<div class="avviso neutro sotto"><span class="segno" aria-hidden="true">i</span><span>` +
    `Il motore conosce già gli alimenti comuni con valori indicativi. Quelli che scrivi qui ` +
    `sono <strong>tuoi</strong> e vincono sempre su quelli interni.</span></div>` +
    `<div class="sezione"><div class="sezione-testa"><h2>I tuoi alimenti</h2>` +
    `<span class="tag">${alimenti.length}</span></div>` +
    (alimenti.length
      ? `<div class="scorri"><table class="tabella"><thead><tr>` +
        `<th>Alimento</th><th>Base</th><th class="num">Proteine</th><th class="num">Carboidrati</th>` +
        `<th class="num">Grassi</th><th class="num">kcal</th><th></th></tr></thead><tbody>` +
        alimenti
          .map(
            (a) =>
              `<tr><td><strong>${esc(a.nome)}</strong></td>` +
              `<td class="piccolo muto">${a.per === 'pz' ? 'per pezzo' : 'per 100 g'}</td>` +
              `<td class="num">${a.proteine}</td><td class="num">${a.carboidrati}</td>` +
              `<td class="num">${a.grassi}</td>` +
              `<td class="num">${Math.round(a.proteine * 4 + a.carboidrati * 4 + a.grassi * 9)}</td>` +
              `<td><button class="btn mini pericolo" data-elimina="${esc(a.chiave)}" ` +
              `data-per="${esc(a.per)}">Elimina</button></td></tr>`,
          )
          .join('') +
        `</tbody></table></div>`
      : vuoto(
          '—',
          'Nessun alimento tuo',
          'Quando scrivi una dieta e il motore non conosce un alimento, te lo chiede e finisce qui.',
        )) +
    `</div>` +
    `<div class="sezione"><div class="sezione-testa"><h2>Aggiungine uno</h2></div>` +
    `<div class="scheda accesso stretto"><form id="form-alimento" novalidate>` +
    `<label><span>Nome</span><input id="al-nome" type="text" required></label>` +
    `<label><span>Base</span><select id="al-per">` +
    `<option value="g100">per 100 g / ml</option><option value="pz">per pezzo</option>` +
    `</select></label>` +
    `<div class="campi">` +
    `<label><span>Proteine g</span><input id="al-proteine" type="number" min="0" max="100" step="0.1" required></label>` +
    `<label><span>Carboidrati g</span><input id="al-carboidrati" type="number" min="0" max="100" step="0.1" required></label>` +
    `<label><span>Grassi g</span><input id="al-grassi" type="number" min="0" max="100" step="0.1" required></label>` +
    `</div>` +
    `<button class="btn" type="submit">Salva</button>` +
    `<div id="esito-alimento" class="esito"></div>` +
    `</form></div></div>`;

  $('form-alimento').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    try {
      await invia('/api/studio/salva-alimento', {
        nome: $('al-nome').value.trim(),
        per: $('al-per').value,
        proteine: Number($('al-proteine').value),
        carboidrati: Number($('al-carboidrati').value),
        grassi: Number($('al-grassi').value),
      });
      disegnaLibreria();
    } catch (e) {
      $('esito-alimento').innerHTML =
        `<div class="avviso grave"><span class="segno" aria-hidden="true">!</span>` +
        `<span>${esc(e.message)}</span></div>`;
    }
  });

  for (const el of contenuto().querySelectorAll('[data-elimina]')) {
    el.addEventListener('click', async () => {
      await invia('/api/studio/elimina-alimento', {
        chiave: el.dataset.elimina,
        per: el.dataset.per,
      });
      disegnaLibreria();
    });
  }
}

// Il mio studio

function disegnaConto() {
  const io = stato.dati.io;

  contenuto().innerHTML =
    `<div class="avviso neutro sotto"><span class="segno" aria-hidden="true">i</span><span>` +
    `I clienti ti aggiungono cercando questa email: <strong>${esc(io.email)}</strong>. ` +
    `Dagliela così com'è.</span></div>` +
    `<div class="sezione"><div class="sezione-testa"><h2>Come ti vedono i clienti</h2></div>` +
    `<div class="scheda accesso stretto">` +
    `<label><span>Nome e cognome</span><input id="mio-nome" type="text" value="${esc(io.nome)}"></label>` +
    `<div class="fila"><button class="btn" id="salva-profilo">Salva</button>` +
    `<span id="esito-profilo" class="piccolo muto"></span></div>` +
    `</div></div>` +
    `<div class="sezione"><div class="fila">` +
    `<button class="btn neutra" id="cambia-pw">Cambia password</button>` +
    `<button class="btn neutra spinge" id="esci">Esci</button>` +
    `</div></div>`;

  $('salva-profilo').addEventListener('click', async () => {
    try {
      await invia('/api/studio/impostazioni', { nome: $('mio-nome').value.trim() });
      await ricarica();
      stato.tab = 'conto';
      disegna();
      $('esito-profilo').textContent = 'Salvato.';
    } catch (e) {
      $('esito-profilo').textContent = e.message;
    }
  });

  $('cambia-pw').addEventListener('click', () => apriCambioPassword(false));
  $('esci').addEventListener('click', esci);
}

// Impalcatura

function disegna() {
  for (const b of $('schede').querySelectorAll('button')) {
    b.setAttribute('aria-selected', String(b.dataset.tab === stato.tab));
  }

  if (stato.tab === 'cruscotto') disegnaCruscotto();
  else if (stato.tab === 'clienti') disegnaClienti();
  else if (stato.tab === 'libreria') disegnaLibreria();
  else disegnaConto();
}

for (const b of $('schede').querySelectorAll('button')) {
  b.addEventListener('click', () => {
    chiediUscita(() => {
      stato.tab = b.dataset.tab;
      stato.cliente = null;
      stato.editor = null;
      disegna();
    });
  });
}

setInterval(async () => {
  if (document.hidden || !stato.dati) return;
  try {
    const n = await leggi('/api/studio/novita');
    const totale = n.variazioniNuove + n.richieste + (n.messaggi ?? 0);
    $('pallino').hidden = totale === 0;
    $('pallino').textContent = String(totale);
  } catch {
    /* la rete cade: il pallino resta com'era. */
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

// Caricare la dieta come PDF

function apriCaricamentoPdf(clienteId) {
  const zona = document.createElement('div');
  zona.className = 'scheda accesso stretto sotto';
  zona.id = 'caricamento-pdf';
  zona.innerHTML =
    `<h2 class="sotto-poco">Carica la dieta in PDF</h2>` +
    `<p class="piccolo muto sotto">La leggo e te la trascrivo nell'editor. ` +
    `<strong>Controllala prima di pubblicarla</strong>: la lettura automatica sbaglia, e ` +
    `una grammatura letta male finisce nel piatto di qualcuno.</p>` +
    `<label class="zona-pdf" id="zona-pdf">` +
    `<input type="file" id="file-pdf" accept="application/pdf">` +
    `<div class="cifra" aria-hidden="true">+</div>` +
    `<div id="nome-file">Trascina qui il PDF, o tocca per sceglierlo</div>` +
    `<div class="piccolo muto">massimo 700 KB</div>` +
    `</label>` +
    `<label><span>Titolo della dieta</span>` +
    `<input id="titolo-pdf" type="text" placeholder="Dieta di luglio"></label>` +
    `<div class="fila"><button class="btn" id="invia-pdf" disabled>Carica e leggi</button>` +
    `<button class="btn neutra" id="chiudi-pdf">Chiudi</button></div>` +
    `<div id="esito-pdf" class="esito"></div>`;

  contenuto().prepend(zona);

  let scelto = null;
  const area = $('zona-pdf');
  const campo = $('file-pdf');

  const prendi = (file) => {
    if (!file) return;
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      $('esito-pdf').innerHTML =
        `<div class="avviso grave"><span class="segno" aria-hidden="true">!</span>` +
        `<span>Questo non è un PDF.</span></div>`;
      return;
    }
    scelto = file;
    $('nome-file').textContent = `${file.name} — ${Math.round(file.size / 1024)} KB`;
    $('invia-pdf').disabled = false;
    if (!$('titolo-pdf').value) $('titolo-pdf').value = file.name.replace(/\.pdf$/i, '');
  };

  campo.addEventListener('change', () => prendi(campo.files[0]));

  for (const evento of ['dragenter', 'dragover']) {
    area.addEventListener(evento, (e) => {
      e.preventDefault();
      area.classList.add('sopra');
    });
  }
  for (const evento of ['dragleave', 'drop']) {
    area.addEventListener(evento, (e) => {
      e.preventDefault();
      area.classList.remove('sopra');
    });
  }
  area.addEventListener('drop', (e) => prendi(e.dataTransfer?.files?.[0]));

  // Se è stata creata una bozza, la scheda va ricaricata per mostrarla.
  let caricato = false;
  $('chiudi-pdf').addEventListener('click', () => {
    zona.remove();
    if (caricato) apriCliente(clienteId);
  });

  $('invia-pdf').addEventListener('click', async () => {
    if (!scelto) return;
    $('invia-pdf').disabled = true;
    $('invia-pdf').textContent = 'Leggo il PDF…';
    $('esito-pdf').innerHTML = '';

    try {
      const base64 = await inBase64(scelto);
      const esito = await invia('/api/studio/carica-pdf', {
        cliente: clienteId,
        nome: scelto.name,
        titolo: $('titolo-pdf').value.trim(),
        contenuto: base64,
      });
      caricato = true;

      $('esito-pdf').innerHTML =
        (esito.lettaAutomaticamente
          ? `<div class="avviso ok sotto"><span class="segno" aria-hidden="true">✓</span><span>` +
            `Letto. Ho creato una bozza: aprila, controllala riga per riga e poi pubblicala.</span></div>`
          : `<div class="avviso attenzione sotto"><span class="segno" aria-hidden="true">!</span>` +
            `<span>${esc(esito.motivo ?? 'Non sono riuscito a leggerlo.')} ` +
            `Il PDF resta allegato: la dieta va scritta a mano.</span></div>`) +
        (esito.avvisi.length
          ? `<div class="pila sotto">` +
            esito.avvisi
              .map(
                (a) =>
                  `<div class="avviso attenzione"><span class="segno" aria-hidden="true">!</span>` +
                  `<span>${esc(a)}</span></div>`,
              )
              .join('') +
            `</div>`
          : '') +
        (esito.testo
          ? `<h3 class="sotto-poco">Il testo che ho letto dal PDF</h3>` +
            `<div class="testo-estratto sotto">${esc(esito.testo)}</div>`
          : '') +
        `<button class="btn" id="apri-bozza">Apri la bozza nell'editor</button>`;

      $('apri-bozza').addEventListener('click', () => {
        zona.remove();
        apriEditor(esito.id);
      });
    } catch (e) {
      $('esito-pdf').innerHTML =
        `<div class="avviso grave"><span class="segno" aria-hidden="true">!</span>` +
        `<span>${esc(e.message)}</span></div>`;
      $('invia-pdf').disabled = false;
      $('invia-pdf').textContent = 'Carica e leggi';
    }
  });
}

/** Il file in base64, per farlo viaggiare dentro il JSON. */
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
