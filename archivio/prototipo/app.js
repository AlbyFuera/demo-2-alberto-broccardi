/**
 * Nutrizionista AI — interfaccia a conversazione.
 *
 * La chat è il prodotto: la settimana, la spesa e la preparazione stanno in un
 * pannello laterale, non al centro. Ogni risposta mostra da dove viene — se
 * l'ha scritta il motore o se l'ha riformulata il modello — e su quali regole
 * del piano poggia. Un paziente deve poter risalire alla fonte di ogni numero.
 */

const $ = (id) => document.getElementById(id);
const DAYS = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];

const state = {
  piano: 'demarco',
  seed: 1,
  fuori: [],
  libero: null,
  plan: null,
  data: null,
  ai: { available: false },
  tab: 'settimana',
  busy: false,
};

/* ────────────────────── utilità ────────────────────── */

const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

const round = (n) => Math.round(n * 10) / 10;
const todayIndex = () => (new Date().getDay() + 6) % 7;

function quantity(item) {
  if (item.freeQuantity) return 'q.b.';
  const v = item.qtyMax && item.qtyMax !== item.qty ? `${item.qty}–${item.qtyMax}` : item.qty;
  return item.unit === 'pz' ? `${v} pz` : `${v}${item.unit}`;
}

async function api(path, params = '') {
  const res = await fetch(`/api/${path}?${params}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? 'Errore imprevisto');
  return body;
}

async function post(path, payload) {
  const res = await fetch(`/api/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? 'Errore imprevisto');
  return body;
}

/** Parametri della settimana: i pasti fuori casa passano per ripianificazione. */
function weekParams() {
  const p = new URLSearchParams({ piano: state.piano, seed: String(state.seed) });
  if (state.libero) p.set('libero', state.libero);
  if (state.fuori.length) {
    p.set('eventi', state.fuori.join(','));
    p.set('da', '0');
  }
  return p.toString();
}

/* ────────────────────── caricamento ────────────────────── */

async function loadPlans() {
  const piani = await api('piani');
  $('plan-select').innerHTML = piani
    .map(
      (p) =>
        `<option value="${esc(p.key)}"${p.key === state.piano ? ' selected' : ''}>` +
        `${esc(p.label)}</option>`,
    )
    .join('');
}

async function loadPlan() {
  state.plan = await api('piano', `piano=${encodeURIComponent(state.piano)}`);
  $('who-name').textContent = `Assistente di ${state.plan.professional.name}`;

  if (!state.plan.canGenerate.ok) {
    state.data = null;
    $('who-sub').textContent = 'piano a macronutrienti — non pianificabile';
    return;
  }
  state.data = await api('settimana', weekParams());
  $('who-sub').textContent =
    `${state.plan.patient.name} · ${state.data.validation.ok ? 'settimana conforme' : 'settimana NON conforme'}`;
}

/* ────────────────────── conversazione ────────────────────── */

function bubble(role, html) {
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.innerHTML = html;
  $('thread').appendChild(el);
  $('chat').scrollTop = $('chat').scrollHeight;
  return el;
}

function say(text, { source, cards = [], citations = [], flag } = {}) {
  const parts = [`<div class="bubble">${esc(text)}</div>`];

  if (source) {
    const label = source === 'ai' ? 'riformulato dall’AI' : 'motore';
    parts.push(
      `<div class="msg-meta"><span class="src${source === 'ai' ? ' is-ai' : ''}">${label}</span>` +
        `<span>i dati vengono dal piano, non dal modello</span></div>`,
    );
  }

  for (const card of cards) parts.push(renderCard(card));

  if (citations.length) {
    parts.push(
      `<div class="cites">${citations.map((c) => `<div>· ${esc(c)}</div>`).join('')}</div>`,
    );
  }
  if (flag) {
    parts.push(
      `<div class="flagged">⚑ Domanda girata allo studio: la vedrà ${esc(
        state.plan.professional.name,
      )}.</div>`,
    );
  }

  const el = bubble('bot', parts.join(''));
  wireCard(el);
}

function renderCard(card) {
  if (card.options) {
    const rows = card.options
      .map(
        (o) =>
          `<div class="opt ${o.allowed ? '' : 'is-no'}">` +
          `<span class="opt-mark ${o.allowed ? 'ok' : 'ko'}">${o.allowed ? '✓' : '✕'}</span>` +
          `<span>${esc(o.label)}` +
          (o.reason ? `<span class="opt-reason">${esc(o.reason)}</span>` : '') +
          `</span></div>`,
      )
      .join('');
    return (
      `<div class="card"><div class="card-head">${esc(card.title)}</div>` +
      `<div class="card-body">${rows}</div></div>`
    );
  }

  if (card.items) {
    const chips = card.items
      .map(
        (i) =>
          `<button class="chip" data-day="${card.day}" data-meal="${esc(card.mealId)}" ` +
          `data-slot="${esc(i.slotId ?? '')}"><span>${esc(i.label)}</span> ` +
          `<b>${esc(i.qty)}</b> <span class="swap">⇄</span></button>`,
      )
      .join('');
    return (
      `<div class="card"><div class="card-head">${esc(card.title)}</div>` +
      `<div class="card-body"><div class="chips">${chips}</div></div>` +
      `<div class="card-actions">` +
      `<button class="mini" data-fuori="${card.day}:${esc(card.mealId)}">Sono fuori</button>` +
      (state.plan.hasFreeMeal
        ? `<button class="mini" data-libero="${card.day}:${esc(card.mealId)}">Pasto libero qui</button>`
        : '') +
      `</div></div>`
    );
  }

  return (
    `<div class="card"><div class="card-head">${esc(card.title)}</div>` +
    `<div class="card-body">${(card.lines ?? []).map((l) => esc(l)).join('<br>')}</div></div>`
  );
}

function wireCard(root) {
  for (const el of root.querySelectorAll('.chip[data-slot]')) {
    el.addEventListener('click', () =>
      ask(`Posso sostituire ${el.querySelector('span').textContent}?`, {
        day: Number(el.dataset.day),
        mealId: el.dataset.meal,
        slotId: el.dataset.slot,
      }),
    );
  }
  for (const el of root.querySelectorAll('[data-fuori]')) {
    el.addEventListener('click', async () => {
      const key = el.dataset.fuori;
      if (!state.fuori.includes(key)) state.fuori.push(key);
      await loadPlan();
      const n = state.data?.changes?.length ?? 0;
      say(
        `Fatto, ho segnato quel pasto come fuori casa e ho riadattato la settimana: ` +
          `${n} pasti cambiati, il minimo indispensabile.`,
        { source: 'motore' },
      );
      renderPanel();
    });
  }
  for (const el of root.querySelectorAll('[data-libero]')) {
    el.addEventListener('click', async () => {
      state.libero = el.dataset.libero;
      await loadPlan();
      say('Ho spostato lì il pasto libero.', { source: 'motore' });
      renderPanel();
    });
  }
}

/**
 * Sostituzione richiesta toccando un alimento: si passa dall'endpoint
 * dedicato, che conosce già slot e giorno, invece di far reinterpretare
 * all'assistente una frase che abbiamo costruito noi.
 */
async function askSubstitution(target) {
  const params =
    `${weekParams()}&giorno=${target.day}&pasto=${encodeURIComponent(target.mealId)}` +
    `&slot=${encodeURIComponent(target.slotId)}`;
  const res = await api('sostituzioni', params);
  const ammesse = res.options.filter((o) => o.allowed).length;
  const altri = (res.options[0]?.affectsDays ?? []).filter((d) => d !== target.day);

  say(
    `${res.current?.label ?? 'Questo alimento'} si può cambiare: ${ammesse} alternative ` +
      `ammesse su ${res.options.length}. Le altre romperebbero un vincolo del piano.`,
    {
      source: 'motore',
      cards: [
        {
          title: `Al posto di ${res.current?.label ?? '—'}`,
          options: res.options.map((o) => ({
            label: o.label.replace(/\*\(([^)]*)\)\*/g, '($1)'),
            allowed: o.allowed,
            reason: o.reason,
          })),
        },
      ],
      citations: altri.length
        ? [
            `Il piano tiene appaiati questi giorni: vale anche per ` +
              `${altri.map((d) => DAYS[d]).join(' e ')}.`,
          ]
        : [],
    },
  );
}

async function ask(question, target) {
  if (state.busy) return;
  state.busy = true;
  $('send').disabled = true;

  bubble('me', `<div class="bubble">${esc(question)}</div>`);
  $('input').value = '';

  const thinking = bubble(
    'bot',
    `<div class="bubble"><span class="typing"><i></i><i></i><i></i></span></div>`,
  );

  try {
    if (target) {
      thinking.remove();
      await askSubstitution(target);
    } else {
      const reply = await post('chat', {
        piano: state.piano,
        domanda: question,
        settimana: weekParams(),
      });
      thinking.remove();
      say(reply.answer, {
        source: reply.source,
        cards: reply.cards,
        citations: reply.citations,
        flag: reply.flag,
      });
      if (reply.intent.kind === 'spesa') openPanel('spesa');
    }
  } catch (error) {
    thinking.remove();
    bubble('bot', `<div class="bubble error">${esc(error.message)}</div>`);
  } finally {
    state.busy = false;
    $('send').disabled = false;
    $('input').focus();
  }
}

/* ────────────────────── suggerimenti ────────────────────── */

function renderSuggestions() {
  const s = state.plan?.canGenerate.ok
    ? [
        'Cosa mangio adesso?',
        'Cosa prevede oggi?',
        'Posso sostituire qualcosa a pranzo?',
        'Quanta acqua devo bere?',
        'Stasera sono fuori',
        'Lista della spesa',
      ]
    : ['Perché non c’è una settimana?'];

  $('suggestions').innerHTML = s
    .map((t) => `<button class="sug">${esc(t)}</button>`)
    .join('');
  for (const b of $('suggestions').querySelectorAll('.sug')) {
    b.addEventListener('click', () => ask(b.textContent));
  }
}

/* ────────────────────── pannello ────────────────────── */

function openPanel(tab) {
  if (tab) state.tab = tab;
  $('scrim').hidden = false;
  $('panel').hidden = false;
  renderPanel();
}

function closePanel() {
  $('scrim').hidden = true;
  $('panel').hidden = true;
}

function renderPanel() {
  for (const b of $('panel-tabs').querySelectorAll('.tab')) {
    b.setAttribute('aria-selected', String(b.dataset.tab === state.tab));
  }
  const body = $('panel-body');

  if (!state.data && state.tab !== 'studio') {
    body.innerHTML =
      `<div class="verdict is-warn"><span>!</span><span>${esc(
        state.plan.canGenerate.reason,
      )}</span></div>`;
    return;
  }

  if (state.tab === 'settimana') return renderWeek(body);
  if (state.tab === 'spesa') return renderShopping(body);
  if (state.tab === 'prep') return renderPrep(body);
  if (state.tab === 'studio') return renderStudio(body);
}

function renderWeek(body) {
  const { week } = state.data;
  body.innerHTML = week.days
    .map((day) => {
      const rows = state.plan.meals
        .map((tpl) => {
          const meal = day.meals.find((m) => m.mealId === tpl.id);
          const head = `<span class="meal-label">${esc(tpl.label)}</span>`;
          if (!meal) return `<div class="meal">${head}<span class="muted">non previsto</span></div>`;

          let bodyHtml;
          if (meal.kind === 'free') bodyHtml = `<span class="meal-note is-free">🎉 Pasto libero</span>`;
          else if (meal.kind === 'external')
            bodyHtml = `<span class="meal-note is-external">🍽️ ${esc(meal.note ?? 'Fuori casa')}</span>`;
          else
            bodyHtml =
              `<div class="chips">` +
              meal.items
                .map(
                  (i) =>
                    `<button class="chip" data-day="${day.index}" data-meal="${esc(tpl.id)}" ` +
                    `data-slot="${esc(i.slotId)}"><span>${esc(i.label)}</span> ` +
                    `<b>${quantity(i)}</b> <span class="swap">⇄</span></button>`,
                )
                .join('') +
              `</div>`;

          const actions =
            meal.kind === 'external'
              ? ''
              : `<div class="mini-row"><button class="mini" data-fuori="${day.index}:${esc(tpl.id)}">Sono fuori</button></div>`;

          return `<div class="meal">${head}${bodyHtml}${actions}</div>`;
        })
        .join('');

      const tags = [];
      if (day.variant) tags.push(`<span class="tag">${esc(day.variant)}</span>`);
      if (day.training) tags.push('<span class="tag is-training">allenamento</span>');

      return (
        `<article class="day"><header class="day-head">` +
        `<p class="day-name">${DAYS[day.index]}${day.index === todayIndex() ? ' · oggi' : ''}</p>` +
        `<div class="day-tags">${tags.join('')}</div></header>${rows}</article>`
      );
    })
    .join('');

  wirePanelCards(body);
}

function wirePanelCards(root) {
  for (const el of root.querySelectorAll('.chip[data-slot]')) {
    el.addEventListener('click', () => {
      closePanel();
      ask(`Posso sostituire ${el.querySelector('span').textContent}?`, {
        day: Number(el.dataset.day),
        mealId: el.dataset.meal,
        slotId: el.dataset.slot,
      });
    });
  }
  for (const el of root.querySelectorAll('[data-fuori]')) {
    el.addEventListener('click', async () => {
      const key = el.dataset.fuori;
      if (!state.fuori.includes(key)) state.fuori.push(key);
      await loadPlan();
      renderPanel();
      closePanel();
      say(
        `Ho segnato quel pasto come fuori casa: ${state.data?.changes?.length ?? 0} pasti riadattati.`,
        { source: 'motore' },
      );
    });
  }
}

function renderShopping(body) {
  const { shopping } = state.data;
  body.innerHTML =
    `<div class="block">` +
    shopping.categories
      .map((cat) => {
        const items = cat.lines
          .map((line) => {
            const amount = line.freeQuantity
              ? `q.b.`
              : `${round(line.totalQty)}${line.unit === 'pz' ? ' pz' : line.unit}`;
            const buy =
              line.purchaseQty != null
                ? `<div class="hint">≈ ${round(line.purchaseQty)}${line.unit} da comprare${
                    line.purchaseNote ? ` — ${esc(line.purchaseNote)}` : ''
                  }</div>`
                : '';
            return `<li><div>${esc(line.label)}${buy}</div><span class="amount">${amount}</span></li>`;
          })
          .join('');
        return `<h3>${esc(cat.name)}</h3><ul class="list">${items}</ul>`;
      })
      .join('') +
    (shopping.skippedMeals
      ? `<p class="hint">${shopping.skippedMeals} pasti liberi o fuori casa non sono inclusi.</p>`
      : '') +
    `</div>`;
}

function renderPrep(body) {
  const { prep } = state.data;
  const sessions = prep.sessions
    .map((s) => {
      const items = s.batches
        .map(
          (b) =>
            `<li><div>${esc(b.label)}<div class="hint">${
              b.coversDays.length > 1
                ? `copre ${b.coversDays.map((d) => DAYS[d]).join(', ')}`
                : 'per il giorno stesso'
            }</div></div><span class="amount">${round(b.qty)}${b.unit}</span></li>`,
        )
        .join('');
      return `<h3>${esc(s.dayName)} — cottura</h3><ul class="list">${items}</ul>`;
    })
    .join('');

  const fresh = prep.fresh.length
    ? `<h3>Da preparare al momento</h3><ul class="list">` +
      prep.fresh
        .map((f) => `<li><div>${esc(f.dayName)}</div><span class="amount">${esc(f.labels.join(', '))}</span></li>`)
        .join('') +
      `</ul>`
    : '';

  body.innerHTML =
    `<div class="block">${sessions}${fresh}</div>` +
    prep.notes.map((n) => `<p class="hint">${esc(n)}</p>`).join('');
}

async function renderStudio(body) {
  const p = state.plan;
  const nErr = p.issues.filter((i) => i.severity === 'errore').length;
  const flags = await api('segnalazioni', `piano=${encodeURIComponent(state.piano)}`);
  const aperte = flags.filter((f) => f.status === 'aperta');

  const verdict =
    p.issues.length === 0
      ? `<div class="verdict is-ok"><span>✓</span><span>Nessuna incoerenza nel piano.</span></div>`
      : `<div class="verdict ${nErr ? 'is-ko' : 'is-warn'}"><span>${nErr ? '✕' : '!'}</span><span>` +
        (nErr ? `${nErr} errori nel piano.` : 'Dati mancanti nel piano.') +
        `</span></div><div class="block">` +
        p.issues
          .map(
            (i) =>
              `<div class="issue ${i.severity === 'errore' ? 'is-error' : 'is-warn'}">` +
              `<span class="issue-mark">${i.severity === 'errore' ? '✕' : '!'}</span>` +
              `<span>${esc(i.message)}</span></div>`,
          )
          .join('') +
        `</div>`;

  const segnalazioni = aperte.length
    ? `<div class="block"><h2>Domande girate allo studio</h2>` +
      aperte
        .map(
          (f) =>
            `<div class="issue is-warn"><span class="issue-mark">⚑</span><span>` +
            `“${esc(f.question)}”<div class="hint">${esc(f.reason)}</div></span>` +
            `<button class="mini" data-close="${esc(f.id)}">Chiudi</button></div>`,
        )
        .join('') +
      `</div>`
    : `<div class="empty"><p class="big">✓</p><p>Nessuna domanda in sospeso.</p>` +
      `<p class="hint">Quando l'assistente non trova la risposta nel piano, la domanda finisce qui.</p></div>`;

  const ai = state.ai.available
    ? `<div class="verdict is-ok"><span>✦</span><span>Assistente in linguaggio naturale <b>attivo</b>.</span></div>`
    : `<div class="verdict is-warn"><span>!</span><span>${esc(state.ai.reason ?? '')}<br>` +
      `Le risposte restano corrette: le compone il motore.</span></div>`;

  body.innerHTML = ai + verdict + segnalazioni;

  for (const el of body.querySelectorAll('[data-close]')) {
    el.addEventListener('click', async () => {
      await post('segnalazioni/chiudi', { id: el.dataset.close });
      renderStudio(body);
    });
  }
}

/* ────────────────────── avvio ────────────────────── */

$('composer').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('input').value.trim();
  if (text) ask(text);
});

$('plan-select').addEventListener('change', async (e) => {
  state.piano = e.target.value;
  state.seed = 1;
  state.fuori = [];
  state.libero = null;
  $('thread').innerHTML = '';
  await loadPlan();
  renderSuggestions();
  greet();
});

$('btn-panel').addEventListener('click', () => openPanel());
$('panel-close').addEventListener('click', closePanel);
$('scrim').addEventListener('click', closePanel);
for (const b of $('panel-tabs').querySelectorAll('.tab')) {
  b.addEventListener('click', () => {
    state.tab = b.dataset.tab;
    renderPanel();
  });
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePanel();
});

function greet() {
  if (!state.plan.canGenerate.ok) {
    say(
      `Il piano di ${state.plan.patient.name} fissa obiettivi di macronutrienti ma non ` +
        `elenca alimenti: non posso comporre una settimana. Apri “Studio” per vedere ` +
        `la verifica del piano — ci sono cose da segnalare al professionista.`,
      { source: 'motore' },
    );
    return;
  }
  ask('Ciao');
}

await loadPlans();
state.ai = await api('assistente/stato');
await loadPlan();
renderSuggestions();
greet();
