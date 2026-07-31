/**
 * Livello Claude — opzionale.
 *
 * Fa due cose, entrambe di LINGUA, nessuna di sostanza:
 *
 *  1. capisce la domanda del paziente meglio delle espressioni regolari;
 *  2. dice la risposta del motore con la voce del professionista.
 *
 * Quello che NON fa, e che il prompt di sistema gli vieta esplicitamente:
 * aggiungere alimenti, cambiare quantità, dare consigli nutrizionali propri.
 * I fatti arrivano già decisi da `assistant.ts`, che li ha ottenuti dal
 * validatore. Il modello li riscrive, non li rivede.
 *
 * Senza chiave API o senza SDK installato, tutto continua a funzionare in
 * modalità deterministica: le stesse risposte, scritte dal codice.
 *
 *   npm install @anthropic-ai/sdk
 *   export ANTHROPIC_API_KEY=...
 */

import type { AssistantReply, Intent } from './assistant.ts';

const MODEL = 'claude-opus-5';

export interface LlmStatus {
  available: boolean;
  reason?: string;
}

let cachedClient: any = null;
let checked: LlmStatus | null = null;

/** Se il livello AI è utilizzabile in questo momento. */
export async function status(): Promise<LlmStatus> {
  if (checked) return checked;

  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    checked = {
      available: false,
      reason:
        'Nessuna credenziale Anthropic nell\'ambiente. Imposta ANTHROPIC_API_KEY ' +
        '(oppure accedi con `ant auth login`) per attivare le risposte in linguaggio naturale.',
    };
    return checked;
  }

  try {
    // Import dinamico: il progetto resta senza dipendenze obbligatorie.
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    cachedClient = new Anthropic();
    checked = { available: true };
  } catch {
    checked = {
      available: false,
      reason:
        'SDK non installato. Esegui `npm install @anthropic-ai/sdk` per attivare ' +
        'le risposte in linguaggio naturale.',
    };
  }
  return checked;
}

/* ------------------------------------------------------------------ */
/* 1. Comprensione della domanda                                       */
/* ------------------------------------------------------------------ */

const SYSTEM_INTENT = `Classifichi le domande di un paziente sul suo piano alimentare.

Rispondi SOLO con un oggetto JSON, senza testo attorno, con questa forma:
{"kind": "...", "day": <0-6 o null>, "mealId": "<id o null>", "food": "<nome o null>"}

I valori ammessi per "kind":
- "saluto"        saluti e convenevoli
- "pasto-adesso"  cosa mangiare ora / prossimo pasto
- "pasto-giorno"  cosa prevede un giorno o un pasto specifico
- "sostituzione"  può cambiare un alimento con un altro
- "porzione"      quanto pesa qualcosa, a crudo o a cotto
- "spesa"         lista della spesa
- "regola"        acqua, alcol, caffè, pasto libero, integratori
- "fuori-casa"    salterà un pasto o mangia fuori
- "ignoto"        tutto il resto

"day": 0 = lunedì … 6 = domenica. null se non indicato.
"mealId": SOLO uno degli id che ti vengono forniti. null se non indicato.
"food": il nome dell'alimento come compare nel piano. null se non nominato.`;

export async function interpretWithAi(
  question: string,
  mealIds: { id: string; label: string }[],
  today: number,
): Promise<Intent | null> {
  const s = await status();
  if (!s.available) return null;

  try {
    const response = await cachedClient.beta.messages.create({
      model: MODEL,
      max_tokens: 512, // output deliberatamente breve: un oggetto JSON
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM_INTENT,
      messages: [
        {
          role: 'user',
          content:
            `Oggi è il giorno ${today} (0 = lunedì).\n` +
            `Pasti disponibili: ${mealIds.map((m) => `${m.id} ("${m.label}")`).join(', ')}\n\n` +
            `Domanda del paziente: ${question}`,
        },
      ],
    });

    if (response.stop_reason === 'refusal') return null;

    const text = response.content.find((b: any) => b.type === 'text')?.text ?? '';
    const parsed = JSON.parse(text.replace(/^```(?:json)?|```$/gm, '').trim());

    return {
      kind: parsed.kind,
      day: parsed.day ?? undefined,
      mealId: parsed.mealId ?? undefined,
      food: parsed.food ?? undefined,
      topic: question,
    };
  } catch {
    // Qualunque problema (rete, quota, JSON malformato) ricade sul motore.
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* 2. Voce del professionista                                          */
/* ------------------------------------------------------------------ */

const SYSTEM_VOICE = `Sei l'assistente che parla al paziente per conto del suo nutrizionista.

REGOLA ASSOLUTA — non ammette eccezioni:
Puoi usare SOLO i fatti che ti vengono forniti. Non aggiungere alimenti, non
cambiare quantità, non dare consigli nutrizionali tuoi, non citare linee guida
generali. Se un'informazione non è nei fatti forniti, dì che non la sai e che
la domanda verrà girata allo studio. Non sei un nutrizionista: riferisci quello
che ha stabilito il professionista.

Come scrivere:
- In italiano, dando del tu, con tono pratico e cordiale.
- Breve: due o tre frasi. È una chat, non un referto.
- Attribuisci le decisioni al professionista quando è naturale
  ("il dott. X prevede…", "nel tuo piano…"), non a te stesso.
- Riporta le quantità ESATTAMENTE come te le trovi scritte.
- Niente elenchi puntati: le liste le mostra già l'interfaccia sotto il messaggio.
- Niente emoji, niente frasi di circostanza, niente "spero di esserti utile".`;

export async function speakWithVoice(
  reply: AssistantReply,
  styleBrief: string,
  question: string,
): Promise<string | null> {
  const s = await status();
  if (!s.available) return null;

  const fatti = [
    `Risposta stabilita dal motore (è la verità, riformulala senza cambiarla):`,
    reply.answer,
  ];

  for (const card of reply.cards) {
    if (card.items?.length) {
      fatti.push(
        `${card.title}: ${card.items.map((i) => `${i.label} ${i.qty}`).join(', ')}`,
      );
    }
    if (card.options?.length) {
      const ok = card.options.filter((o) => o.allowed).map((o) => o.label);
      const no = card.options.filter((o) => !o.allowed);
      fatti.push(`${card.title} — ammesse: ${ok.join(', ') || 'nessuna'}`);
      if (no.length) {
        fatti.push(
          `Non ammesse: ${no.map((o) => `${o.label} (${o.reason ?? 'vincolo del piano'})`).join('; ')}`,
        );
      }
    }
    if (card.lines?.length) fatti.push(`${card.title}: ${card.lines.join(', ')}`);
  }

  if (reply.citations.length > 0) {
    fatti.push(`Regole del piano applicabili:\n- ${reply.citations.join('\n- ')}`);
  }

  try {
    const response = await cachedClient.beta.messages.create({
      model: MODEL,
      max_tokens: 1024, // una risposta di chat: deliberatamente corta
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: `${SYSTEM_VOICE}\n\n--- CHI È IL PROFESSIONISTA ---\n${styleBrief}`,
      messages: [
        {
          role: 'user',
          content: `Il paziente ha chiesto: "${question}"\n\n--- FATTI ---\n${fatti.join('\n')}`,
        },
      ],
    });

    if (response.stop_reason === 'refusal') return null;
    return response.content.find((b: any) => b.type === 'text')?.text?.trim() ?? null;
  } catch {
    return null;
  }
}
