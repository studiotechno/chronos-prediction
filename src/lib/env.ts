// Lecture normalisée des variables d'environnement.
//
// Une valeur collée dans le dashboard Vercel embarque facilement un saut de
// ligne final. C'est invisible sur une clé d'API (les en-têtes HTTP sont
// normalisés à l'envoi) mais destructeur dès qu'une valeur sert à composer ou
// à comparer une URL. On lit donc toujours les variables via ce module.

// Accès statiques : Next.js n'inline les variables NEXT_PUBLIC_* dans le
// bundle navigateur que sous cette forme (pas via process.env[nom]).
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";

/**
 * Variable d'environnement serveur, débarrassée des espaces parasites.
 * Renvoie `undefined` si absente ou vide (côté navigateur, toujours
 * `undefined` : seules les variables NEXT_PUBLIC_* y sont exposées).
 */
export function serverEnv(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}
