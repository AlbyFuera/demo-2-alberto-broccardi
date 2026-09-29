import type { Alimento, Macro } from '../types.ts';

/** Da dove viene un valore di composizione. */
export type Fonte = 'studio' | 'tabella';

export interface Composizione extends Macro {
  /** Base di riferimento: 100 g/ml oppure un pezzo. */
  per: 'g100' | 'pz';
  fonte: Fonte;
  /** Testo da mostrare accanto al valore. */
  descrizioneFonte: string;
}

/** Un alimento della libreria di uno studio. */
export interface VoceLibreria extends Macro {
  /** Nome normalizzato: è la chiave. */
  chiave: string;
  /** Nome come lo ha scritto il professionista. */
  nome: string;
  per: 'g100' | 'pz';
}

/** La libreria di uno studio, indicizzata per chiave normalizzata. */
export type Libreria = Map<string, VoceLibreria>;

const STIMA = 'stima interna, non validata da un nutrizionista';

/** Valori per 100 g/ml edibili, crudi salvo dove indicato. Non validati. */
const PER_100: Record<string, [number, number, number]> = {
  /* --- cereali e derivati, a crudo --- */
  pasta: [13, 75, 1.5],
  'pasta integrale': [13, 67, 2.5],
  riso: [7, 80, 0.6],
  'riso integrale': [7.5, 74, 2.2],
  'riso basmati': [8, 78, 0.9],
  'riso venere': [8.5, 75, 2.5],
  farro: [15, 67, 2.5],
  orzo: [10.5, 71, 1.5],
  quinoa: [14, 64, 6],
  'cous cous': [12, 72, 1.5],
  'farina di avena': [13, 60, 7],
  'avena in fiocchi': [13, 60, 7],
  'cereali da colazione': [8, 78, 4],

  /* --- pane, gallette, sostituti --- */
  pane: [8.5, 58, 1],
  'pane bianco': [8.5, 58, 1],
  'pane integrale': [9, 49, 1.5],
  'pane azzimo': [10, 75, 1],
  piadina: [8, 50, 10],
  gallette: [8, 81, 2.8],
  'gallette di riso': [8, 81, 2.8],
  'gallette di farro': [10, 78, 2],
  'fette wasa': [10, 63, 1.7],
  'fette wasa integrali': [10, 63, 1.7],
  'fette biscottate': [11, 73, 6],
  crackers: [10, 70, 10],
  pavesini: [9, 76, 5],

  /* --- tuberi e derivati --- */
  patate: [2, 17, 0.1],
  'patate americane': [1.6, 20, 0.1],
  'gnocchi di patate': [4, 33, 0.5],
  polenta: [2, 20, 0.4], // già pronta, non farina

  /* --- carne --- */
  pollo: [23, 0, 1.5],
  'petto di pollo': [23, 0, 1.5],
  tacchino: [24, 0, 1],
  'petto di tacchino': [24, 0, 1],
  'fesa di tacchino': [19, 1, 2],
  'prosciutto cotto': [20, 1, 6],
  'prosciutto crudo': [26, 0, 11],
  bresaola: [32, 0.4, 2.6],
  lonza: [20, 0.5, 3],
  bistecca: [21, 0, 6],
  'macinato magro': [21, 0, 5],
  'macinato di vitello': [20, 0, 3],
  vitello: [20, 0, 2.5],
  equino: [21, 0, 2],
  'hamburger di manzo': [20, 0, 12],
  'tartare di manzo magro': [21, 0, 4],
  'filetto di maiale': [21, 0, 4],

  /* --- pesce --- */
  merluzzo: [17, 0, 0.7],
  nasello: [17, 0, 1.5],
  platessa: [16.5, 0, 1.5],
  sogliola: [16, 0, 1.5],
  pangasio: [15, 0, 3],
  halibut: [19, 0, 2],
  branzino: [18, 0, 2.5],
  orata: [20, 0, 3],
  trota: [19, 0, 3],
  salmone: [20, 0, 12],
  'salmone affumicato': [22, 0, 9],
  sgombro: [19, 0, 11],
  'pesce spada': [20, 0, 4],
  tonno: [22, 0, 4],
  'tonno al naturale': [24, 0, 1],
  "tonno sott'olio sgocciolato": [25, 0, 8],
  gamberi: [18, 0, 1],
  calamari: [13, 1, 1.5],
  seppie: [14, 1, 1.5],
  polpo: [16, 1, 1],

  /* --- uova e latticini --- */
  albume: [11, 0.7, 0.2],
  'mozzarella light': [19, 1.5, 11],
  ricotta: [8.8, 3.5, 10.9],
  'fiocchi di latte': [12, 3, 4],
  'stracchino light': [14, 2, 14],
  grana: [33, 0, 28],
  emmental: [28, 0, 31],
  pecorino: [26, 0, 33],
  scamorza: [25, 1, 21],
  yogurt: [6, 5, 2],
  'yogurt (tradizionale/greco/skyr/kefir)': [6, 5, 2],
  'latte scremato o parz. scremato': [3.4, 5, 1.5],
  'bevanda vegetale': [1, 3, 1.5],
  'budino o mousse proteica': [10, 5, 2],

  /* --- legumi e fonti vegetali, cotti dove indicato --- */
  'ceci cotti': [7, 17, 2.5],
  'fagioli cotti': [7, 15, 0.5],
  'fagioli neri cotti': [8, 16, 0.5],
  'lenticchie cotte': [7, 16, 0.4],
  piselli: [5.5, 10, 0.5],
  tofu: [8, 1.5, 4.8],
  tempeh: [19, 9, 11],
  seitan: [24, 4, 2],
  'hamburger vegetale': [17, 6, 9],

  /* --- verdura --- */
  asparagi: [3, 2, 0.2],
  broccoli: [3, 3, 0.4],
  carote: [1, 8, 0.2],
  cavolfiore: [2.5, 2.5, 0.3],
  fagiolini: [2, 3, 0.2],
  finocchi: [1.2, 1, 0.2],
  'insalata mista': [1.5, 2, 0.2],
  melanzane: [1.1, 2.6, 0.2],
  peperoni: [1, 4.2, 0.3],
  pomodorini: [1.2, 3.5, 0.2],
  rucola: [2.6, 2, 0.7],
  spinaci: [3, 2, 0.4],
  zucca: [1.1, 3.5, 0.1],
  zucchine: [1.3, 1.4, 0.1],
  'minestra di verdure': [1.5, 5, 1],
  'passato di verdure': [1.5, 5, 1],
  'vellutata di verdure': [1.5, 6, 2],

  /* --- grassi --- */
  'olio extravergine': [0, 0, 100],
  burro: [0.8, 0.6, 83],
  avocado: [2, 1.8, 15],
  'frutta secca': [18, 8, 55],
  mandorle: [22, 4.5, 55],
  noci: [15, 3.5, 65],
  'crema di frutta secca': [20, 10, 52],

  /* --- zuccheri e dolci --- */
  miele: [0.3, 80, 0],
  marmellata: [0.5, 60, 0],
  "sciroppo d'acero": [0, 67, 0],
  "sciroppo d'agave": [0, 76, 0],
  'cioccolato fondente': [7, 30, 42],
  'cioccolato fondente 70%': [8, 30, 42],
  'crema proteica': [20, 15, 25],
  'succo di frutta': [0.5, 11, 0],
  'barretta proteica o a zona': [30, 40, 12],

  /* --- frutta --- */
  'frutta fresca': [0.8, 12, 0.3],
  banana: [1.2, 23, 0.3],

  /* --- integratori proteici --- */
  'proteine in polvere': [80, 5, 3],
  'proteine isolate': [88, 2, 1],
  'proteine idrolizzate': [85, 2, 1],
}

/** Valori per un pezzo, non per 100 g. */
const PER_PEZZO: Record<string, [number, number, number]> = {
  uova: [6.5, 0.4, 5.5], // un uovo medio, ~55 g edibili
  tuorlo: [2.7, 0.3, 4.5],
  mela: [0.5, 19, 0.3], // un frutto medio, ~150 g
  sottiletta: [3.5, 1, 4.5],
  'budino proteico': [20, 10, 4],
  'burro di arachidi': [3.8, 1.5, 7.5], // un cucchiaio, ~15 g
}

export const normalizza = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9%+/().'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Chiavi dalla più lunga alla più corta: "pane integrale" prima di "pane". */
const CHIAVI_100 = Object.keys(PER_100).sort((a, b) => b.length - a.length);
const CHIAVI_PZ = Object.keys(PER_PEZZO).sort((a, b) => b.length - a.length);

function daTabella(
  nome: string,
  tabella: Record<string, [number, number, number]>,
  chiavi: string[],
  per: 'g100' | 'pz',
): Composizione | null {
  const n = normalizza(nome);

  // Prima la corrispondenza esatta.
  const esatta = tabella[n];
  if (esatta) return comporre(esatta, per);

  for (const chiave of chiavi) {
    if (n.includes(chiave)) return comporre(tabella[chiave], per);
  }
  return null;
}

function comporre(v: [number, number, number], per: 'g100' | 'pz'): Composizione {
  return {
    proteine: v[0],
    carboidrati: v[1],
    grassi: v[2],
    per,
    fonte: 'tabella',
    descrizioneFonte: STIMA,
  };
}

/** `null` se la composizione è ignota: nessun valore di riserva. */
export function composizioneDi(nome: string, unita: string, libreria?: Libreria): Composizione | null {
  const chiave = normalizza(nome);
  const per = unita === 'pz' ? 'pz' : 'g100';

  // 1. La libreria dello studio vince sempre.
  const sua = libreria?.get(chiave);
  if (sua && sua.per === per) {
    return {
      proteine: sua.proteine,
      carboidrati: sua.carboidrati,
      grassi: sua.grassi,
      per: sua.per,
      fonte: 'studio',
      descrizioneFonte: 'valori del tuo studio',
    };
  }

  // 2. Tabella interna, per pezzo o per 100 g a seconda dell'unità.
  return per === 'pz'
    ? daTabella(nome, PER_PEZZO, CHIAVI_PZ, 'pz')
    : daTabella(nome, PER_100, CHIAVI_100, 'g100');
}

/** `null` se composizione ignota o quantità libera. */
export function macroDi(
  alimento: Alimento,
  libreria?: Libreria,
): { macro: Macro; composizione: Composizione } | null {
  if (alimento.libera || alimento.quantita === null) return null;

  const c = composizioneDi(alimento.nome, alimento.unita, libreria);
  if (!c) return null;

  // Per 100 g/ml si scala sulla quantità; a pezzo si moltiplica per il numero.
  const fattore = c.per === 'pz' ? alimento.quantita : alimento.quantita / 100;

  return {
    macro: {
      proteine: c.proteine * fattore,
      carboidrati: c.carboidrati * fattore,
      grassi: c.grassi * fattore,
    },
    composizione: c,
  };
}

/** True se di quell'alimento non si sa nulla: serve a chiedere i valori. */
export const composizioneIgnota = (nome: string, unita: string, libreria?: Libreria): boolean =>
  composizioneDi(nome, unita, libreria) === null;

/** Quanti alimenti la tabella interna conosce. Mostrato nelle impostazioni. */
export const alimentiInTabella = (): number =>
  Object.keys(PER_100).length + Object.keys(PER_PEZZO).length;
