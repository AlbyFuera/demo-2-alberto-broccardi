// Elementi grafici condivisi da studio e cliente: icone, avatar, anelli, grafici,
// fogli che salgono dal basso, avvisi brevi e la pagina di stampa della dieta.
// Niente style="" nell'HTML: la CSP lo blocca. Le misure passano da data-w/data-h.

import { $, GIORNI, esc } from '/comune.js';
import { FOTO_DEMO } from '/demo-foto.js';

const svg = (corpo) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${corpo}</svg>`;

export const ICONE = {
  home: svg('<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5.5h4V20"/>'),
  calendario: svg('<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  chat: svg('<path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4 3v-3H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/>'),
  documento: svg('<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M10 13h6M10 17h6"/>'),
  persona: svg('<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c0-4 3.4-6.5 7.5-6.5s7.5 2.5 7.5 6.5"/>'),
  persone: svg('<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.4"/><path d="M16.5 14.2c2.8.2 4.5 2.2 4.5 4.8"/>'),
  foglia: svg('<path d="M12 20c-5 0-8-3-8-8 5 0 8 2 8 5 0-4 2-8 8-9 0 7-3 12-8 12z"/><path d="M12 20v-6"/>'),
  pdf: svg('<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M9.5 16h5"/>'),
  scarpa: svg('<path d="M3 16c3.5 0 5.5-2.5 6.5-6l2 2c1 1 3 2 5 2.5 3 .7 4.5 1.5 4.5 3.5v1H3z"/><path d="M3 20.5h18"/>'),
  fiamma: svg('<path d="M12 3c.5 3-1.5 4.5-3 6.5-1.3 1.8-2 3.2-2 5a5 5 0 0 0 10 0c0-2-1-3.5-2-4.5 0 1.5-.8 2.5-1.8 2.5.5-3-.2-6-1.2-9.5z"/>'),
  goccia: svg('<path d="M12 3.5c3 4 6 7 6 10.5a6 6 0 0 1-12 0C6 10.5 9 7.5 12 3.5z"/>'),
  bilancia: svg('<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M8 9.5a5 5 0 0 1 8 0"/><path d="m12 9.5 1.5-1.8"/>'),
  piatto: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.5"/>'),
  stella: svg('<path d="m12 4 2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z"/>'),
  lucchetto: svg('<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  esci: svg('<path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3"/><path d="m16 8 4 4-4 4M20 12H9"/>'),
  invia: svg('<path d="M4 12 20 4l-5 16-3-6.5z"/>'),
  piu: svg('<path d="M12 5v14M5 12h14"/>'),
  meno: svg('<path d="M5 12h14"/>'),
  avanti: svg('<path d="m9 5 7 7-7 7"/>'),
  indietro: svg('<path d="m15 5-7 7 7 7"/>'),
  spunta: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  croce: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  scambia: svg('<path d="M4 8h13l-3-3"/><path d="M20 16H7l3 3"/>'),
  campana: svg('<path d="M6 17v-6a6 6 0 0 1 12 0v6l2 2H4z"/><path d="M10 21.5h4"/>'),
  busta: svg('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 8 8 6 8-6"/>'),
  cerca: svg('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>'),
  matita: svg('<path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/>'),
  cestino: svg('<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>'),
  puntini: svg('<circle class="pieno" cx="5" cy="12" r="1.6"/><circle class="pieno" cx="12" cy="12" r="1.6"/><circle class="pieno" cx="19" cy="12" r="1.6"/>'),
  stampa: svg('<path d="M7 9V4h10v5"/><rect x="3.5" y="9" width="17" height="8" rx="2"/><path d="M7 14h10v6H7z"/>'),
  cartella: svg('<rect x="5" y="4" width="14" height="17" rx="2.5"/><path d="M9 4V3h6v1"/><path d="M9 10h6M9 14h6M9 18h3"/>'),
  nota: svg('<path d="M5 4h14v11l-5 5H5z"/><path d="M14 20v-5h5"/><path d="M8 9h8M8 12.5h5"/>'),
  grafico: svg('<path d="M4 19h16"/><path d="m5 15 4-4 3 3 6-7"/>'),
  allerta: svg('<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.3v.2"/>'),
  orologio: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  info: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.2"/>'),
};

export const ico = (nome) => `<span class="ico">${ICONE[nome] ?? ''}</span>`;

export const iniziali = (nome) =>
  String(nome ?? '')
    .trim()
    .split(/\s+/)
    .filter((p) => !/^dott/i.test(p))
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('') || '?';

/** Una delle sei tinte, sempre la stessa per lo stesso nome. */
export const tinta = (nome) => {
  let h = 0;
  for (const c of String(nome ?? '')) h = (h * 31 + c.codePointAt(0)) % 6;
  return h;
};

/** Foto di esempio se c'è (solo demo), altrimenti le iniziali. */
export const avatar = (nome, misura = '', email = '') =>
  FOTO_DEMO[email]
    ? `<img class="avatar con-foto${misura ? ` ${misura}` : ''}" src="${esc(FOTO_DEMO[email])}" alt="">`
    : `<span class="avatar av${tinta(nome)}${misura ? ` ${misura}` : ''}" aria-hidden="true">${esc(iniziali(nome))}</span>`;

/* Numeri e date */

export const numero = (n, decimali = 0) =>
  n == null || Number.isNaN(Number(n))
    ? '—'
    : Number(n).toLocaleString('it-IT', { minimumFractionDigits: decimali, maximumFractionDigits: decimali });

/** "Venerdì 2 ottobre". */
export function dataLunga(data = new Date()) {
  const d = typeof data === 'string' ? new Date(data.length === 10 ? `${data}T12:00` : data) : data;
  const t = d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** "2 ott". */
export const dataBreve = (giorno) =>
  new Date(`${giorno}T12:00`).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });

/** "lunedì 6 ottobre, 17:30". */
export function dataOra(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return (
    d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }) +
    (iso.length > 10 ? `, ${d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}` : '')
  );
}

export function eta(nascita) {
  if (!nascita) return null;
  const n = new Date(`${nascita}T12:00`);
  const oggi = new Date();
  let anni = oggi.getFullYear() - n.getFullYear();
  if (oggi < new Date(oggi.getFullYear(), n.getMonth(), n.getDate())) anni--;
  return anni;
}

/* Misure che la CSP non permette di scrivere nell'HTML */

export function applicaMisure(radice = document) {
  for (const el of radice.querySelectorAll('[data-w]')) {
    el.style.width = `${Math.max(0, Math.min(100, Number(el.dataset.w) || 0))}%`;
  }
  for (const el of radice.querySelectorAll('[data-h]')) {
    el.style.height = `${Math.max(3, Math.min(100, Number(el.dataset.h) || 0))}%`;
  }
  for (const el of radice.querySelectorAll('[data-x]')) {
    el.style.left = `${Number(el.dataset.x) || 0}%`;
    el.style.top = `${Number(el.dataset.y) || 0}%`;
  }
}

export const barra = (percentuale, tono = '') =>
  `<div class="barra ${tono}"><i data-w="${Math.round(percentuale || 0)}"></i></div>`;

/** Anello di avanzamento con un valore al centro. */
export function anello(percentuale, valore, unita = '', misura = '') {
  const r = 52;
  const giro = 2 * Math.PI * r;
  const arco = percentuale == null ? 0 : (Math.max(0, Math.min(100, percentuale)) / 100) * giro;

  return (
    `<div class="anello-wrap ${misura}">` +
    `<svg class="anello" viewBox="0 0 120 120" role="img" ` +
    `aria-label="${percentuale == null ? 'Nessun dato' : `${Math.round(percentuale)} per cento`}">` +
    `<circle class="anello-pista" cx="60" cy="60" r="${r}"/>` +
    (arco > 0
      ? `<circle class="anello-arco" cx="60" cy="60" r="${r}" ` +
        `stroke-dasharray="${arco.toFixed(1)} ${giro.toFixed(1)}" transform="rotate(-90 60 60)"/>`
      : '') +
    `</svg>` +
    `<div class="anello-testo"><strong>${esc(valore)}</strong>${unita ? `<span>${esc(unita)}</span>` : ''}</div></div>`
  );
}

/** Grafico a linea: punti { etichetta, valore } in ordine di tempo. */
export function linea(punti, { unita = '', decimali = 1, assi = true } = {}) {
  const validi = punti.filter((p) => p.valore != null);
  if (validi.length === 0) return '';

  const valori = validi.map((p) => p.valore);
  let min = Math.min(...valori);
  let max = Math.max(...valori);
  if (max - min < 1) {
    min -= 0.5;
    max += 0.5;
  }
  const margine = (max - min) * 0.18;
  min -= margine;
  max += margine;

  // Coordinate in percentuale: il tratto si allunga, punti ed etichette restano HTML.
  const x = (i) => (validi.length === 1 ? 50 : (i / (validi.length - 1)) * 100);
  const y = (v) => (1 - (v - min) / (max - min)) * 100;

  const tracciato = validi.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)} ${y(p.valore).toFixed(2)}`).join(' ');
  const area = `${tracciato} L${x(validi.length - 1).toFixed(2)} 100 L${x(0).toFixed(2)} 100 Z`;
  const ultimo = validi[validi.length - 1];

  const scelte = validi.length <= 2 ? validi.map((_, i) => i) : [0, Math.floor((validi.length - 1) / 2), validi.length - 1];

  return (
    `<div class="grafico" role="img" aria-label="Andamento: ultimo valore ${numero(ultimo.valore, decimali)} ${esc(unita)}">` +
    `<div class="grafico-area">` +
    `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">` +
    `<path class="area" d="${area}"/><path class="tratto" d="${tracciato}"/></svg>` +
    validi
      .map((p, i) => `<i class="punto${i === validi.length - 1 ? ' ultimo' : ''}" data-x="${x(i).toFixed(2)}" data-y="${y(p.valore).toFixed(2)}" title="${esc(p.etichetta)}: ${numero(p.valore, decimali)} ${esc(unita)}"></i>`)
      .join('') +
    `</div>` +
    (assi
      ? `<div class="grafico-asse">${scelte.map((i) => `<span>${esc(validi[i].etichetta)}</span>`).join('')}</div>`
      : '') +
    `</div>`
  );
}

/** Barre verticali piccole: valori in ordine di tempo, obiettivo facoltativo. */
export function barre(valori, obiettivo = null) {
  const massimo = Math.max(obiettivo ?? 0, ...valori.map((v) => v.valore ?? 0), 1);
  return (
    `<div class="barre">` +
    valori
      .map(
        (v) =>
          `<span class="colonna${obiettivo && v.valore >= obiettivo ? ' raggiunto' : ''}${v.valore == null ? ' vuota' : ''}" ` +
          `title="${esc(v.etichetta)}: ${v.valore == null ? 'nessun dato' : numero(v.valore)}">` +
          `<i data-h="${v.valore == null ? 0 : (v.valore / massimo) * 100}"></i></span>`,
      )
      .join('') +
    `</div>`
  );
}

/* Fogli, avvisi, segmenti */

/** Un foglio che sale dal basso (al centro su schermi larghi). Restituisce il corpo e chiudi(). */
export function foglio({ titolo = '', classe = '' } = {}) {
  const velo = document.createElement('div');
  velo.className = 'foglio-velo';
  velo.innerHTML =
    `<div class="foglio ${classe}" role="dialog" aria-modal="true" aria-label="${esc(titolo)}">` +
    `<div class="foglio-testa"><h2>${esc(titolo)}</h2>` +
    `<button class="btn-icona" type="button" data-chiudi-foglio aria-label="Chiudi">${ico('croce')}</button></div>` +
    `<div class="foglio-corpo"></div></div>`;

  const chiudi = () => {
    velo.classList.add('esce');
    document.removeEventListener('keydown', tasto);
    setTimeout(() => velo.remove(), 180);
  };
  const tasto = (e) => {
    if (e.key === 'Escape') chiudi();
  };

  velo.addEventListener('click', (e) => {
    if (e.target === velo || e.target.closest('[data-chiudi-foglio]')) chiudi();
  });
  document.addEventListener('keydown', tasto);
  document.body.appendChild(velo);

  return { corpo: velo.querySelector('.foglio-corpo'), chiudi, foglio: velo.querySelector('.foglio') };
}

export function avviso(tipo, testo, html = false) {
  const segno = { ok: 'spunta', attenzione: 'allerta', grave: 'allerta', neutro: 'info' }[tipo] ?? 'info';
  return (
    `<div class="avviso ${tipo}">${ico(segno)}<div>${html ? testo : esc(testo)}</div></div>`
  );
}

/** Un messaggio breve che compare in basso e se ne va da solo. */
export function notifica(testo, tipo = 'ok') {
  let zona = $('notifiche');
  if (!zona) {
    zona = document.createElement('div');
    zona.id = 'notifiche';
    zona.setAttribute('role', 'status');
    zona.setAttribute('aria-live', 'polite');
    document.body.appendChild(zona);
  }
  const el = document.createElement('div');
  el.className = `notifica ${tipo}`;
  el.textContent = testo;
  zona.appendChild(el);
  setTimeout(() => el.classList.add('esce'), tipo === 'grave' ? 5200 : 2600);
  setTimeout(() => el.remove(), tipo === 'grave' ? 5600 : 3000);
}

/** Controllo a segmenti: [valore, etichetta]. */
export const segmenti = (id, opzioni, attivo) =>
  `<div class="segmenti" id="${esc(id)}" role="group">` +
  opzioni
    .map(
      ([valore, etichetta]) =>
        `<button type="button" data-valore="${esc(valore)}" aria-pressed="${valore === attivo}">${esc(etichetta)}</button>`,
    )
    .join('') +
  `</div>`;

export function collegaSegmenti(id, quandoCambia) {
  const gruppo = $(id);
  if (!gruppo) return;
  for (const b of gruppo.querySelectorAll('button')) {
    b.addEventListener('click', () => {
      for (const altro of gruppo.querySelectorAll('button')) altro.setAttribute('aria-pressed', String(altro === b));
      quandoCambia(b.dataset.valore);
    });
  }
}

export const caricamento = () =>
  `<div class="caricamento" aria-label="Caricamento"><span></span><span></span><span></span></div>`;

/* Diario */

/** Un giorno del diario: pallini dei pasti e i dati segnati. */
export function rigaDiario(g) {
  const pallini = Array.from({ length: g.previsti }, (_, i) =>
    `<i class="${i < g.fatti ? 'pieno' : i < g.fatti + g.saltati ? 'saltato' : ''}"></i>`,
  ).join('');
  const dati = [
    g.passi != null ? `${numero(g.passi)} passi` : '',
    g.acqua != null ? `${numero(g.acqua / 1000, 1)} L` : '',
    g.peso != null ? `${numero(g.peso, 1)} kg` : '',
    g.liberi ? 'pasto libero' : '',
  ].filter(Boolean);

  return (
    `<div class="riga diario-riga">` +
    `<div class="diario-data"><strong>${esc(GIORNI[g.indice].slice(0, 3))}</strong><span>${esc(dataBreve(g.data))}</span></div>` +
    `<div class="corpo"><div class="pallini esito-${g.esito}">${pallini || '<span class="muto piccolo">nessun pasto previsto</span>'}</div>` +
    `<div class="muto piccolo">${dati.length ? esc(dati.join(' · ')) : g.esito === 'vuoto' ? 'nessuna spunta' : ''}</div></div>` +
    `<span class="diario-conto">${g.previsti ? `${g.fatti}/${g.previsti}` : ''}</span></div>`
  );
}

/* Stampa */

/** Stampa la settimana: giorni come li restituisce il server (nome, pasti, alimenti). */
export function stampaDieta({ titolo, autore = '', cliente = '', indicazioni = [], giorni = [], obiettivi = {} }) {
  document.getElementById('stampa')?.remove();
  const zona = document.createElement('div');
  zona.id = 'stampa';

  const obiettiviTesto = [
    obiettivi.acqua ? `${numero(obiettivi.acqua, 1)} L di acqua al giorno` : '',
    obiettivi.passi ? `${numero(obiettivi.passi)} passi al giorno` : '',
    obiettivi.pastiLiberi ? `${obiettivi.pastiLiberi} pasto libero a settimana` : '',
  ].filter(Boolean);

  zona.innerHTML =
    `<header><h1>${esc(titolo)}</h1>` +
    `<p>${[cliente && `per ${esc(cliente)}`, autore && `scritta da ${esc(autore)}`].filter(Boolean).join(' · ')}</p></header>` +
    (indicazioni.length || obiettiviTesto.length
      ? `<section class="stampa-note"><h2>Indicazioni</h2><ul>` +
        [...indicazioni, ...obiettiviTesto].map((t) => `<li>${esc(t)}</li>`).join('') +
        `</ul></section>`
      : '') +
    giorni
      .map(
        (g) =>
          `<section class="stampa-giorno"><h2>${esc(g.nome ?? GIORNI[g.indice])}` +
          `<span>${g.kcal ? `${g.kcal} kcal` : ''}</span></h2>` +
          (g.pasti.length
            ? g.pasti
                .map(
                  (p) =>
                    `<div class="stampa-pasto"><h3>${esc(p.nome)}${p.orario ? ` · ${esc(p.orario)}` : ''}</h3><ul>` +
                    p.alimenti.map((a) => `<li><span>${esc(a.nome)}</span><span>${esc(a.quantita)}</span></li>`).join('') +
                    `</ul>${p.nota ? `<p>${esc(p.nota)}</p>` : ''}</div>`,
                )
                .join('')
            : `<p class="vuoto-stampa">Nessun pasto scritto.</p>`) +
          `</section>`,
      )
      .join('');

  document.body.appendChild(zona);
  document.body.classList.add('in-stampa');
  const fine = () => {
    document.body.classList.remove('in-stampa');
    zona.remove();
    window.removeEventListener('afterprint', fine);
  };
  window.addEventListener('afterprint', fine);
  setTimeout(() => window.print(), 50);
}
