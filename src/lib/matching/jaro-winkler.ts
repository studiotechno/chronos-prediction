/** Similarité Jaro-Winkler (0..1). Implémentation standard, préfixe max 4, p = 0.1. */

export function jaro(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length;
  const lb = b.length;
  if (la === 0 || lb === 0) return 0;

  const fenetre = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const matchA = new Array<boolean>(la).fill(false);
  const matchB = new Array<boolean>(lb).fill(false);

  let matches = 0;
  for (let i = 0; i < la; i++) {
    const debut = Math.max(0, i - fenetre);
    const fin = Math.min(lb - 1, i + fenetre);
    for (let j = debut; j <= fin; j++) {
      if (matchB[j] || a[i] !== b[j]) continue;
      matchA[i] = true;
      matchB[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < la; i++) {
    if (!matchA[i]) continue;
    while (!matchB[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  transpositions /= 2;

  return (matches / la + matches / lb + (matches - transpositions) / matches) / 3;
}

export function jaroWinkler(a: string, b: string): number {
  const j = jaro(a, b);
  let prefixe = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefixe++;
    else break;
  }
  return j + prefixe * 0.1 * (1 - j);
}
