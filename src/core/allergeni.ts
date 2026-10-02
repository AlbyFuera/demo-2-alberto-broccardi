import type { Dieta } from '../types.ts';
import { normalizza } from './composizione.ts';

// Il professionista scrive allergie e intolleranze a testo libero, separate da
// virgole. Le voci note si espandono negli alimenti che le contengono; una voce
// sconosciuta (es. "fragole") si cerca così com'è nel nome dell'alimento.

const LATTE = [
  'latte', 'yogurt', 'formaggio', 'ricotta', 'mozzarella', 'parmigiano', 'grana', 'burro',
  'fiocchi di latte', 'stracchino', 'scamorza', 'kefir', 'skyr', 'panna', 'mascarpone',
  'pecorino', 'emmental', 'feta', 'philadelphia', 'robiola', 'crescenza', 'provola',
];

const GLUTINE = [
  'pasta', 'pane', 'farro', 'orzo', 'cous cous', 'couscous', 'crackers', 'fette biscottate',
  'fette wasa', 'piadina', 'farina', 'frumento', 'grano', 'segale', 'seitan', 'biscotti',
  'pavesini', 'gallette di farro', 'cereali da colazione', 'avena', 'bulgur', 'pizza', 'grissini',
];

const PESCE = [
  'pesce', 'merluzzo', 'salmone', 'tonno', 'orata', 'branzino', 'spigola', 'sgombro', 'sogliola',
  'nasello', 'platessa', 'trota', 'alici', 'acciughe', 'sardine', 'pesce spada', 'baccalà',
];

const FRUTTA_A_GUSCIO = [
  'frutta secca', 'noci', 'mandorle', 'nocciole', 'pistacchi', 'anacardi', 'noci pecan',
  'noci brasiliane', 'macadamia', 'pinoli', 'burro di mandorle', 'crema di nocciole',
];

/** Voce scritta dal professionista → parole che la rivelano nel nome di un alimento. */
const NOTI: Record<string, string[]> = {
  lattosio: LATTE,
  latte: LATTE,
  latticini: LATTE,
  'proteine del latte': LATTE,
  caseina: LATTE,
  glutine: GLUTINE,
  celiachia: GLUTINE,
  frumento: GLUTINE,
  grano: GLUTINE,
  uova: ['uova', 'uovo', 'albume', 'tuorlo', 'maionese', 'frittata'],
  uovo: ['uova', 'uovo', 'albume', 'tuorlo', 'maionese', 'frittata'],
  pesce: PESCE,
  crostacei: ['gamberi', 'gamberetti', 'scampi', 'aragosta', 'astice', 'granchio', 'mazzancolle'],
  molluschi: ['cozze', 'vongole', 'calamari', 'polpo', 'seppie', 'totani', 'ostriche'],
  'frutta a guscio': FRUTTA_A_GUSCIO,
  'frutta secca': FRUTTA_A_GUSCIO,
  noci: FRUTTA_A_GUSCIO,
  arachidi: ['arachidi', 'burro di arachidi', 'noccioline'],
  soia: ['soia', 'tofu', 'tempeh', 'edamame', 'latte di soia', 'yogurt di soia', 'tamari'],
  sesamo: ['sesamo', 'tahina', 'tahini', 'hummus'],
  sedano: ['sedano'],
  senape: ['senape'],
  lupini: ['lupini'],
  solfiti: ['vino', 'aceto'],
  nichel: ['pomodoro', 'cacao', 'cioccolato', 'legumi', 'spinaci', 'avena', 'frutta secca'],
};

/** Le voci separate dal professionista, normalizzate. */
export function vociAllergie(testo: string | null | undefined): string[] {
  return String(testo ?? '')
    .split(/[,;\n]+/)
    .map((v) => normalizza(v))
    .filter((v) => v.length >= 3);
}

/** Parola intera dentro il nome: "pane" sì in "pane integrale", no in "panettone". */
function contiene(nome: string, parola: string): boolean {
  if (nome === parola) return true;
  const spazi = ` ${nome} `;
  return spazi.includes(` ${parola} `);
}

/** La voce di allergia che riguarda questo alimento, o null. */
export function allergeneDi(nomeAlimento: string, voci: string[]): string | null {
  const nome = normalizza(nomeAlimento);
  if (!nome) return null;

  // Le eccezioni scritte nel nome vincono: "latte senza lattosio", "pasta senza glutine".
  for (const voce of voci) {
    if (nome.includes(`senza ${voce}`) || nome.includes(`${voce} free`)) continue;
    // Una voce sconosciuta si cerca anche al singolare: "fragole" trova "fragola".
    const parole = NOTI[voce] ?? [voce, voce.replace(/e$/, 'a'), voce.replace(/i$/, 'o'), voce.replace(/i$/, 'e')];
    if (parole.some((p) => contiene(nome, normalizza(p)))) return voce;
  }
  return null;
}

export interface Attenzione {
  alimento: string;
  /** La voce di allergia, come scritta (normalizzata). */
  allergene: string;
  /** Dove compare: "Lunedì · Pranzo". */
  dove: string[];
}

const GIORNI = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];

/** Gli alimenti della dieta, alternative comprese, che toccano un'allergia. */
export function attenzioniDellaDieta(dieta: Dieta, allergie: string | null | undefined): Attenzione[] {
  const voci = vociAllergie(allergie);
  if (voci.length === 0) return [];

  const per = new Map<string, Attenzione>();
  const segna = (nome: string, dove: string) => {
    const allergene = allergeneDi(nome, voci);
    if (!allergene) return;
    const chiave = normalizza(nome);
    const voce = per.get(chiave) ?? { alimento: nome, allergene, dove: [] };
    if (!voce.dove.includes(dove)) voce.dove.push(dove);
    per.set(chiave, voce);
  };

  for (const giorno of dieta.giorni) {
    for (const pasto of giorno.pasti) {
      const dove = `${GIORNI[giorno.indice]} · ${pasto.nome}`;
      for (const a of pasto.alimenti) {
        segna(a.nome, dove);
        for (const alt of a.alternative ?? []) segna(alt.nome, `${dove} (sostituzione)`);
      }
    }
  }

  return [...per.values()];
}
