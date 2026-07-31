/**
 * Il controllo di plausibilità sulla frase del modello.
 *
 * L'architettura dice che l'AI riformula i fatti del motore e non li cambia. Ne
 * segue una cosa che non era scritta da nessuna parte e che è costata una
 * risposta illeggibile a un cliente in produzione: se la riformulazione non è
 * una frase italiana, va BUTTATA, e si mostra quella del motore.
 *
 * I modelli quantizzati (fp8) degenerano di tanto in tanto e restituiscono un
 * impasto di token — cirillico, ideogrammi, frammenti di codice — senza alcun
 * segnale di errore: la chiamata riesce, il testo arriva, ed è spazzatura.
 * Questo è il caso reale che ha fatto scrivere questo file:
 *
 *   «diffusion inclusive mingle besar_slave Incre kleingreenuntosشار秒-spec
 *    gpsutut Mour Dict::|dek_SCOREliquid mlx тру_AUTH_five…»
 *
 * Il motore aveva già pronta la frase giusta. Senza questo controllo la
 * scartava per mostrare quella.
 *
 * I controlli sono volutamente GROSSOLANI: devono prendere la spazzatura
 * evidente e non devono mai bocciare una frase italiana normale. Un falso
 * positivo costa poco (si mostra la frase del motore, che è corretta), un falso
 * negativo costa la fiducia del cliente.
 */

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

/**
 * `ok: false` significa «non mostrarla»: si usa la frase del motore.
 *
 * `attesa` è la risposta che il motore aveva già composto. Serve al controllo
 * sulla lunghezza: una riformulazione di due frasi non può essere cinque volte
 * più lunga dei fatti che riformula.
 */
export function plausibile(testo: string, attesa: string): Verdetto {
  const t = testo.trim();

  if (t.length < 15) return { ok: false, motivo: 'troppo corta' };
  if (t.length > 1200) return { ok: false, motivo: 'troppo lunga' };

  if (attesa.length > 40 && t.length > attesa.length * 5) {
    return { ok: false, motivo: 'sproporzionata rispetto ai fatti' };
  }

  // Caratteri fuori dall'alfabeto atteso: qualcuno ci sta, un impasto di
  // alfabeti no. La soglia è bassa perché una frase italiana non ne ha.
  let fuori = 0;
  for (const ch of t) if (!AMMESSI.test(ch)) fuori++;
  if (fuori / t.length > 0.02) {
    return { ok: false, motivo: `${Math.round((fuori / t.length) * 100)}% di caratteri estranei` };
  }

  for (const re of SOSPETTE) {
    if (re.test(t)) return { ok: false, motivo: `frammento di codice: ${re}` };
  }

  // Parole medie sopra i 18 caratteri: token incollati, non parole.
  const parole = t.split(/\s+/).filter(Boolean);
  if (parole.length < 3) return { ok: false, motivo: 'non è una frase' };
  if (t.length / parole.length > 18) return { ok: false, motivo: 'parole incollate' };

  // Una frase italiana ha delle vocali. Un impasto di token spesso no.
  const vocali = (t.match(/[aeiouàèéìòù]/gi) ?? []).length;
  if (vocali / t.length < 0.2) return { ok: false, motivo: 'troppo poche vocali' };

  return { ok: true };
}
