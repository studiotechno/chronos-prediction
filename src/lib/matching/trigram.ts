/** Similarité par trigrammes de caractères (coefficient de Dice, 0..1). */

export function trigrams(s: string): Set<string> {
  const rembourre = `  ${s} `;
  const grams = new Set<string>();
  for (let i = 0; i <= rembourre.length - 3; i++) {
    grams.add(rembourre.slice(i, i + 3));
  }
  return grams;
}

export function trigramSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const ga = trigrams(a);
  const gb = trigrams(b);
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  return (2 * inter) / (ga.size + gb.size);
}
