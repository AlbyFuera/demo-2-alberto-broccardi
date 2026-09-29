import type { NutritionPlan, WeekPlan } from '../types.ts';

export interface ShoppingLine {
  label: string;
  unit: string;
  /** Totale a crudo previsto dal piano. */
  totalQty: number;
  /** L'alimento non ha un peso prescritto ("verdure o insalata"). */
  freeQuantity?: boolean;
  /** Quantità da comprare, se diversa (es. legumi secchi). */
  purchaseQty?: number;
  purchaseNote?: string;
  /** In quanti pasti compare: utile per capire l'impegno. */
  occurrences: number;
}

export interface ShoppingCategory {
  name: string;
  lines: ShoppingLine[];
}

export interface ShoppingList {
  categories: ShoppingCategory[];
  skippedMeals: number;
}

export function buildShoppingList(plan: NutritionPlan, week: WeekPlan): ShoppingList {
  const byCategory = new Map<string, Map<string, ShoppingLine>>();
  let skippedMeals = 0;

  for (const day of week.days) {
    for (const meal of day.meals) {
      if (meal.kind !== 'plan') {
        skippedMeals++;
        continue;
      }
      for (const { food } of meal.items) {
        const cat = byCategory.get(food.shoppingCategory) ?? new Map<string, ShoppingLine>();
        byCategory.set(food.shoppingCategory, cat);

        const key = `${food.label}|${food.unit}`;
        const line = cat.get(key) ?? {
          label: food.label,
          unit: food.unit,
          totalQty: 0,
          occurrences: 0,
          freeQuantity: food.freeQuantity,
          purchaseNote: food.purchaseNote,
        };
        line.totalQty += food.qty;
        line.occurrences += 1;
        if (food.purchaseFactor !== undefined) {
          line.purchaseQty = Math.round((line.purchaseQty ?? 0) + food.qty * food.purchaseFactor);
        }
        cat.set(key, line);
      }
    }
  }

  const categories: ShoppingCategory[] = [...byCategory.entries()]
    .map(([name, lines]) => ({
      name,
      lines: [...lines.values()].sort((a, b) => a.label.localeCompare(b.label)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { categories, skippedMeals };
}
