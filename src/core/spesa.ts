import type { Dieta } from '../types.ts';
import { normalizza } from './composizione.ts';

export interface RigaSpesa {
  nome: string;
  unita: string;
  /** Totale settimanale; null per gli alimenti q.b. */
  quantita: number | null;
  /** Numero di pasti in cui compare. */
  ricorrenze: number;
  /** Il reparto del supermercato, per raggruppare la lista. */
  reparto: Reparto;
}

export type Reparto = 'frutta e verdura' | 'carne e pesce' | 'latte e uova' | 'pane e cereali' | 'dispensa';

/** In ordine di giro del supermercato; ciò che non si riconosce va in dispensa. */
const REPARTI: [Reparto, string[]][] = [
  // Prima le eccezioni: "frutta secca" non va con la frutta, "olio" non va col pesce.
  ['dispensa', ['frutta secca', 'noci', 'mandorle', 'nocciole', 'pistacchi', 'olio', 'miele', 'marmellata', 'cioccolato']],
  ['carne e pesce', [
    'pollo', 'tacchino', 'manzo', 'vitello', 'maiale', 'bresaola', 'prosciutto', 'speck', 'salmone',
    'merluzzo', 'tonno', 'orata', 'branzino', 'sgombro', 'pesce', 'gamberi', 'carne', 'hamburger',
    'fesa', 'lonza', 'coniglio', 'polpo', 'calamari', 'sogliola', 'nasello', 'platessa', 'trota', 'alici',
  ]],
  ['latte e uova', [
    'latte', 'yogurt', 'skyr', 'kefir', 'formaggio', 'ricotta', 'mozzarella', 'parmigiano', 'grana',
    'fiocchi di latte', 'uova', 'uovo', 'albume', 'burro', 'stracchino', 'feta', 'philadelphia',
  ]],
  ['pane e cereali', [
    'pane', 'pasta', 'riso', 'farro', 'orzo', 'quinoa', 'cous cous', 'avena', 'gallette', 'fette',
    'crackers', 'piadina', 'cereali', 'farina', 'biscotti', 'grissini',
  ]],
  ['frutta e verdura', [
    'frutta', 'verdura', 'insalata', 'mela', 'pera', 'banana', 'arancia', 'kiwi', 'fragole', 'frutti',
    'zucchine', 'pomodori', 'pomodoro', 'carote', 'spinaci', 'broccoli', 'cavolfiore', 'finocchi',
    'peperoni', 'melanzane', 'lattuga', 'rucola', 'patate', 'cipolla', 'funghi', 'fagiolini', 'asparagi',
    'zucca', 'bietole', 'cetrioli', 'avocado', 'limone', 'ananas', 'mirtilli', 'uva', 'pesca', 'albicocche',
    'legumi', 'ceci', 'lenticchie', 'fagioli', 'piselli',
  ]],
];

export function repartoDi(nome: string): Reparto {
  const n = ` ${normalizza(nome)} `;
  for (const [reparto, parole] of REPARTI) {
    if (parole.some((p) => n.includes(` ${p}`))) return reparto;
  }
  return 'dispensa';
}

/** Ordinata per ricorrenza decrescente. */
export function listaSpesa(dieta: Dieta): RigaSpesa[] {
  const righe = new Map<string, RigaSpesa>();

  for (const giorno of dieta.giorni) {
    for (const pasto of giorno.pasti) {
      for (const a of pasto.alimenti) {
        const chiave = `${normalizza(a.nome)}|${a.unita}`;
        const riga = righe.get(chiave) ?? {
          nome: a.nome,
          unita: a.unita,
          quantita: a.libera || a.quantita === null ? null : 0,
          ricorrenze: 0,
          reparto: repartoDi(a.nome),
        };

        riga.ricorrenze++;
        if (a.libera || a.quantita === null) riga.quantita = null;
        else if (riga.quantita !== null) riga.quantita += a.quantita;

        righe.set(chiave, riga);
      }
    }
  }

  return [...righe.values()].sort(
    (a, b) => b.ricorrenze - a.ricorrenze || a.nome.localeCompare(b.nome),
  );
}
