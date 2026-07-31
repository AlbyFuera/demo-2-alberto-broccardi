/**
 * CLI di collaudo.
 *
 * Serve a far vedere il motore funzionante senza costruire prima
 * l'interfaccia: è quello che si mostra a un nutrizionista in cinque minuti.
 *
 *   node src/cli.ts settimana --seed 3
 *   node src/cli.ts settimana --libero sab:cena --fuori gio:cena
 *   node src/cli.ts sostituzioni lun pranzo carbo
 *   node src/cli.ts ripianifica --da mer --fuori gio:cena
 */

import { pianoDeMarco } from './data/piano-demarco.ts';
import { pianoAlimAB } from './data/piano-alim-ab.ts';
import { pianoMacro } from './data/piano-macro.ts';
import { canGenerateWeek, checkPlanIntegrity, planMode } from './core/plan.ts';
import { generateWeek } from './core/generator.ts';
import { validate } from './core/validator.ts';
import { buildShoppingList } from './core/shopping.ts';
import { buildMealPrep } from './core/mealprep.ts';
import { substitutionsFor } from './core/substitutions.ts';
import { replan } from './core/replan.ts';
import { renderFull } from './render.ts';
import { DAY_NAMES } from './types.ts';
import type { NutritionPlan, WeekPlan } from './types.ts';

const DAY_KEYS = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];

function parseDay(token: string): number {
  const n = Number(token);
  if (Number.isInteger(n) && n >= 0 && n <= 6) return n;
  const idx = DAY_KEYS.indexOf(token.slice(0, 3).toLowerCase());
  if (idx < 0) throw new Error(`Giorno non riconosciuto: "${token}" (usa lun…dom oppure 0…6)`);
  return idx;
}

function parseDayMeal(token: string): { day: number; meal: string } {
  const [d, m] = token.split(':');
  if (!d || !m) throw new Error(`Formato atteso giorno:pasto (es. sab:cena), ricevuto "${token}"`);
  return { day: parseDay(d), meal: m };
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function flagAll(args: string[], name: string): string[] {
  const out: string[] = [];
  args.forEach((a, i) => {
    if (a === `--${name}` && args[i + 1]) out.push(args[i + 1]);
  });
  return out;
}

function report(plan: NutritionPlan, week: WeekPlan): string {
  return renderFull({
    plan,
    week,
    validation: validate(plan, week),
    shopping: buildShoppingList(plan, week),
    prep: buildMealPrep(plan, week),
  });
}

const PIANI: Record<string, NutritionPlan> = {
  demarco: pianoDeMarco,
  'alim-ab': pianoAlimAB,
  macro: pianoMacro,
};

function main(argv: string[]): void {
  const [command = 'settimana', ...args] = argv;

  const planKey = flag(args, 'piano') ?? 'demarco';
  const plan = PIANI[planKey];
  if (!plan) {
    throw new Error(`Piano "${planKey}" sconosciuto. Disponibili: ${Object.keys(PIANI).join(', ')}`);
  }

  const issues = checkPlanIntegrity(plan);

  if (command === 'verifica') {
    console.log(`# Verifica del piano — ${plan.patient.name}\n`);
    console.log(`Tipo: **${planMode(plan)}**`);
    const generabile = canGenerateWeek(plan);
    console.log(
      `Pianificabile: ${generabile.ok ? '**sì**' : '**no**'}` +
        (generabile.reason ? `\n\n> ${generabile.reason}` : ''),
    );
    console.log('');
    if (issues.length === 0) {
      console.log('✅ Nessuna incoerenza rilevata.');
      return;
    }
    for (const i of issues) {
      console.log(`${i.severity === 'errore' ? '❌' : '⚠️ '} ${i.message}`);
    }
    return;
  }

  // Un piano incoerente deve fermarsi qui, non produrre settimane sbagliate.
  const errori = issues.filter((i) => i.severity === 'errore');
  if (errori.length > 0) {
    throw new Error(
      `Il piano non è utilizzabile:\n  - ${errori.map((e) => e.message).join('\n  - ')}`,
    );
  }

  const generabile = canGenerateWeek(plan);
  if (!generabile.ok) {
    throw new Error(`${generabile.reason}\n\n  Prova: node src/cli.ts verifica --piano ${planKey}`);
  }

  if (command === 'settimana') {
    const seed = Number(flag(args, 'seed') ?? 1);
    const libero = flag(args, 'libero');
    const fuori = flagAll(args, 'fuori').map(parseDayMeal);
    const alcol = Number(flag(args, 'alcol') ?? 0);

    const result = generateWeek(plan, {
      seed,
      freeMeal: libero ? parseDayMeal(libero) : 'auto',
      external: fuori.map((f) => ({ ...f, note: 'Pasto fuori casa' })),
      alcoholUnits: alcol,
    });

    console.log(report(plan, result.week));
    console.log(`\n---\n_Generata in ${result.attempts} tentativo/i · seed ${seed}._`);
    return;
  }

  if (command === 'sostituzioni') {
    const [dayToken, mealId, slotId] = args;
    if (!dayToken || !mealId || !slotId) {
      throw new Error('Uso: sostituzioni <giorno> <pasto> <slot>   es. sostituzioni lun pranzo carbo');
    }
    const day = parseDay(dayToken);
    const seed = Number(flag(args, 'seed') ?? 1);
    const { week } = generateWeek(plan, { seed });

    const meal = week.days[day].meals.find((m) => m.mealId === mealId);
    const current = meal?.items.find((it) => it.slotId === slotId);
    console.log(
      `# Sostituzioni — ${DAY_NAMES[day]} · ${mealId} · ${slotId}\n\n` +
        `Attualmente: **${current ? current.food.label : '—'}**\n`,
    );

    const options = substitutionsFor(plan, week, day, mealId, slotId);
    const affected = options[0]?.affectsDays ?? [day];
    if (affected.length > 1) {
      console.log(
        `> Il piano tiene appaiati questi giorni: la sostituzione vale per ` +
          `${affected.map((d) => DAY_NAMES[d]).join(' e ')}.\n`,
      );
    }

    console.log('| Alternativa | Ammessa | Nota |');
    console.log('|---|---|---|');
    for (const o of options) {
      console.log(`| ${o.label} | ${o.allowed ? '✅' : '❌'} | ${o.reason ?? ''} |`);
    }
    return;
  }

  if (command === 'ripianifica') {
    const fromDay = parseDay(flag(args, 'da') ?? 'mer');
    const seed = Number(flag(args, 'seed') ?? 1);
    const base = generateWeek(plan, { seed }).week;

    const events = flagAll(args, 'fuori')
      .map(parseDayMeal)
      .map((e) => ({ type: 'fuori' as const, ...e, note: 'Pasto fuori casa' }));

    const result = replan(plan, base, { fromDay, events, seed });

    console.log(report(plan, result.week));
    console.log(
      `\n---\n**Ripianificazione da ${DAY_NAMES[fromDay]}** ` +
        `(giorni già consumati e non toccati: ${
          result.keptDays.map((d) => DAY_NAMES[d]).join(', ') || 'nessuno'
        })\n`,
    );
    if (result.changes.length === 0) console.log('_Nessun cambiamento._');
    for (const c of result.changes) console.log(`- ${c}`);
    return;
  }

  throw new Error(
    `Comando sconosciuto "${command}". Disponibili: settimana · sostituzioni · ripianifica · verifica`,
  );
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(`\n✗ ${(error as Error).message}\n`);
  process.exitCode = 1;
}
