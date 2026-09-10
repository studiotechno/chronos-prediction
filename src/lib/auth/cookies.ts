/**
 * Options durcies pour les cookies de session Supabase.
 *
 * `httpOnly` n'est PAS le défaut de @supabase/ssr, qui prévoit un client
 * navigateur capable de relire la session. Ici rien ne s'authentifie côté
 * navigateur : on ferme donc l'accès au JavaScript de page, sans quoi une
 * faille XSS suffirait à emporter le jeton de rafraîchissement — c'est-à-dire
 * la session entière, renouvelable, et pas seulement l'heure en cours.
 *
 * Conséquence à connaître : n'introduisez pas de `createBrowserClient` sans
 * revoir ce point, il ne verrait plus la session.
 *
 * Module volontairement sans dépendance : il est importé par le middleware,
 * qui s'exécute dans un runtime où `next/headers` n'a pas cours.
 */
export const OPTIONS_COOKIE = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production", // http toléré en dev local
  sameSite: "lax" as const, // le cookie ne part pas sur une requête inter-site
};
