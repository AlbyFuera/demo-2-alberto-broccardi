/** Caratteri che una risposta in italiano può contenere. */
const AMMESSI =
  /[a-zàèéìòùáíóúâêîôûäëïöüçA-ZÀÈÉÌÒÙ0-9\s.,;:!?'’"«»()\[\]%°/+\-–—…&@]/;

/** Sequenze che tradiscono frammenti di codice o di markup. */
const SOSPETTE = [
  /::/,
  /\|=/,
  /=>/,
  /<\//,
  />>/,
  /\\\w/,
  /__/,
  /\w_\w+_\w/,
  /\bfunction\b|\breturn\b|\bconst\b|\bnull\b|\bundefined\b/i,
];

export interface Verdetto {
  ok: boolean;
  motivo?: string;
}

/** Se `ok` è false si mostra la frase del motore (`attesa`). */
export function plausibile(testo: string, attesa: string): Verdetto {
  const t = testo.trim();

  if (t.length < 15) return { ok: false, motivo: 'troppo corta' };
  if (t.length > 1200) return { ok: false, motivo: 'troppo lunga' };

  if (attesa.length > 40 && t.length > attesa.length * 5) {
    return { ok: false, motivo: 'sproporzionata rispetto ai fatti' };
  }

  // Caratteri fuori dall'alfabeto atteso.
  let fuori = 0;
  for (const ch of t) if (!AMMESSI.test(ch)) fuori++;
  if (fuori / t.length > 0.02) {
    return { ok: false, motivo: `${Math.round((fuori / t.length) * 100)}% di caratteri estranei` };
  }

  for (const re of SOSPETTE) {
    if (re.test(t)) return { ok: false, motivo: `frammento di codice: ${re}` };
  }

  // Parole medie sopra i 18 caratteri: token incollati.
  const parole = t.split(/\s+/).filter(Boolean);
  if (parole.length < 3) return { ok: false, motivo: 'non è una frase' };
  if (t.length / parole.length > 18) return { ok: false, motivo: 'parole incollate' };

  const vocali = (t.match(/[aeiouàèéìòù]/gi) ?? []).length;
  if (vocali / t.length < 0.2) return { ok: false, motivo: 'troppo poche vocali' };

  return { ok: true };
}
