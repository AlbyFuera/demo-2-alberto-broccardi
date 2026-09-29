import type {
  NutritionPlan,
  PlannedMeal,
  ValidationResult,
  WeekPlan,
} from './types.ts';
import { tagCountInDay, tagCountInWeek } from './core/validator.ts';
import { allMealTemplates, portionDerivations, variantLabelForDay } from './core/plan.ts';
import type { MealPrep } from './core/mealprep.ts';
import type { ShoppingList } from './core/shopping.ts';
import { formatQuantity } from './core/substitutions.ts';

export function describeMeal(meal: PlannedMeal): string {
  if (meal.kind === 'free') return '🎉 **Pasto libero**';
  if (meal.kind === 'external') return `🍽️ *${meal.note ?? 'Fuori casa'}*`;
  return meal.items.map((i) => `${i.food.label} ${formatQuantity(i.food)}`).join(' + ');
}

export function renderWeekTable(plan: NutritionPlan, week: WeekPlan): string {
  const templates = allMealTemplates(plan);
  const hasVariants = (plan.variants?.length ?? 0) > 0;

  const header = ['Giorno', ...(hasVariants ? ['Regime'] : []), ...templates.map((m) => m.label)];
  const lines = [`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`];

  for (const day of week.days) {
    const cells = [day.training ? `**${day.name}** 💪` : day.name];
    if (hasVariants) cells.push(variantLabelForDay(plan, day.index) ?? '—');
    for (const tpl of templates) {
      const meal = day.meals.find((m) => m.mealId === tpl.id);
      cells.push(meal ? describeMeal(meal) : '—');
    }
    lines.push(`| ${cells.join(' | ')} |`);
  }

  return lines.join('\n');
}

export function renderShoppingList(list: ShoppingList): string {
  const out: string[] = [];
  for (const cat of list.categories) {
    out.push(`**${cat.name}**`);
    for (const line of cat.lines) {
      const total = line.freeQuantity
        ? `q.b. (in ${line.occurrences} pasti)`
        : `${round(line.totalQty)}${line.unit === 'pz' ? ' pz' : line.unit}`;
      let text = `- ${line.label} — ${total}`;
      if (line.purchaseQty !== undefined) {
        text += ` *(≈ ${round(line.purchaseQty)}${line.unit} da comprare`;
        text += line.purchaseNote ? `, ${line.purchaseNote})*` : ')*';
      }
      out.push(text);
    }
    out.push('');
  }
  if (list.skippedMeals > 0) {
    out.push(
      `_${list.skippedMeals} pasti (liberi o fuori casa) non sono inclusi nella spesa._`,
    );
  }
  return out.join('\n').trim();
}

export function renderMealPrep(prep: MealPrep): string {
  const out: string[] = [];

  for (const session of prep.sessions) {
    out.push(`**${session.dayName} — sessione di cottura**`);
    for (const b of session.batches) {
      const covers =
        b.coversDays.length > 1 ? ` → copre ${b.coversDays.length} giorni` : ' → per il giorno stesso';
      out.push(`- ${b.label}: ${round(b.qty)}${b.unit}${covers}`);
    }
    out.push('');
  }

  if (prep.fresh.length > 0) {
    out.push('**Da preparare al momento**');
    for (const f of prep.fresh) out.push(`- ${f.dayName}: ${f.labels.join(', ')}`);
    out.push('');
  }

  for (const note of prep.notes) out.push(`> ${note}`);
  return out.join('\n').trim();
}

export function renderConstraintCheck(
  plan: NutritionPlan,
  week: WeekPlan,
  validation: ValidationResult,
): string {
  const out: string[] = [];

  out.push('| Vincolo | Richiesto | Effettivo | Esito |');
  out.push('|---|---|---|---|');

  for (const rule of plan.frequencies) {
    const name = rule.label ?? rule.tag;
    if (rule.per === 'week') {
      const count = tagCountInWeek(week, rule.tag);
      const req =
        rule.min !== undefined ? `≥ ${rule.min}/sett` : `≤ ${rule.max}/sett`;
      const ok =
        (rule.min === undefined || count >= rule.min) &&
        (rule.max === undefined || count <= rule.max);
      out.push(`| ${name} | ${req} | ${count} | ${ok ? '✅' : '❌'} |`);
    } else {
      const perDay = week.days.map((d) => tagCountInDay(d, rule.tag));
      const req = rule.min !== undefined ? `≥ ${rule.min}/giorno` : `≤ ${rule.max}/giorno`;
      const ok = perDay.every(
        (c, i) =>
          (rule.min === undefined ||
            c >= rule.min ||
            week.days[i].meals.some((m) => m.kind !== 'plan')) &&
          (rule.max === undefined || c <= rule.max),
      );
      out.push(`| ${name} | ${req} | ${perDay.join('·')} | ${ok ? '✅' : '❌'} |`);
    }
  }

  const free = week.days.flatMap((d) => d.meals.filter((m) => m.kind === 'free')).length;
  out.push(
    `| Pasto libero | ${plan.structure.freeMeals}/sett | ${free} | ` +
      `${free === plan.structure.freeMeals ? '✅' : '❌'} |`,
  );
  out.push(
    `| Alcol | ≤ ${plan.structure.alcoholUnitsMax} unità | ${week.alcoholUnits} | ` +
      `${week.alcoholUnits <= plan.structure.alcoholUnitsMax ? '✅' : '❌'} |`,
  );

  out.push('');
  if (validation.ok) {
    out.push('✅ **Settimana conforme al piano del professionista.**');
  } else {
    out.push('❌ **Settimana NON conforme.** Non va consegnata al paziente:');
    for (const e of validation.errors) out.push(`- ${e.message}`);
  }
  for (const w of validation.warnings) out.push(`- ⚠️ ${w.message}`);

  return out.join('\n');
}

export function renderPortionDerivations(plan: NutritionPlan): string {
  const groups = portionDerivations(plan);
  if (groups.length === 0) return '';

  const out: string[] = [];
  for (const group of groups) {
    out.push(`**${group.qty} g di ${group.nutrient} per pasto**`);
    out.push('');
    out.push(`| Fonte | Porzione | g ${group.nutrient}/100 g |`);
    out.push('|---|---|---|');
    for (const row of group.rows) {
      out.push(
        `| ${row.label} | ${row.portion}${row.unit} | ` +
          `${row.fixed ? 'quantità indicata dal professionista' : (row.per100 ?? '—')} |`,
      );
    }
    out.push('');
  }

  out.push(
    '> I valori di composizione qui sopra determinano quanto finisce nel piatto: ' +
      'vanno confermati dal professionista, non dedotti dal software.',
  );
  return out.join('\n');
}

export interface FullRenderInput {
  plan: NutritionPlan;
  week: WeekPlan;
  validation: ValidationResult;
  shopping: ShoppingList;
  prep: MealPrep;
}

export function renderFull(input: FullRenderInput): string {
  const { plan, week, validation, shopping, prep } = input;
  const sections: string[] = [];

  sections.push(`# Piano settimanale — ${plan.patient.name}`);
  sections.push(
    `_Piano del ${plan.professional.name}${
      plan.professional.register ? ` (${plan.professional.register})` : ''
    }, ${plan.issuedAt}. ${plan.weighingNote}_`,
  );
  sections.push(`\n## 1. Settimana\n\n${renderWeekTable(plan, week)}`);
  sections.push(`\n## 2. Lista della spesa\n\n${renderShoppingList(shopping)}`);
  sections.push(`\n## 3. Preparazione\n\n${renderMealPrep(prep)}`);
  sections.push(`\n## 4. Check dei vincoli\n\n${renderConstraintCheck(plan, week, validation)}`);

  const derivations = renderPortionDerivations(plan);
  if (derivations) sections.push(`\n## 5. Come sono calcolate le porzioni\n\n${derivations}`);

  if (plan.supplements.length > 0) {
    const sup = plan.supplements.map((s) => `- ${s.name}: ${s.dose} ${s.when}`).join('\n');
    sections.push(`\n## Integrazione\n\n${sup}`);
  }

  return sections.join('\n');
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
