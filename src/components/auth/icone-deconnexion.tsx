/**
 * Icône de déconnexion — porte ouverte et flèche sortante.
 *
 * Définie ici plutôt que dans le jeu d'icônes du shell pour que l'ajout de
 * l'authentification reste autonome : même trait (1,6 px, bouts arrondis,
 * grille 24) que `components/shell/icons.tsx`, dont elle reprend les réglages.
 */
export function IconDeconnexion({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14.5 4.5H6.2A1.7 1.7 0 0 0 4.5 6.2v11.6a1.7 1.7 0 0 0 1.7 1.7h8.3" />
      <path d="M16.5 8.5 20.5 12l-4 3.5M20.5 12h-9" />
    </svg>
  );
}
