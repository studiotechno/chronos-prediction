/* ── Icônes du shell ─────────────────────────────────────────────────
   Trait unique : stroke 1.8, boîte 24, cap et join arrondis. C'est ce
   trait, tenu partout, qui donne sa signature à la barre latérale et au
   chrome — aucune icône pleine, aucune couleur en dur. */

type IconProps = { size?: number };

function base(size: number) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
}

/** Onde sismique — les leads chauds, ce qui vient de bouger. */
export function IconLeads({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M2 12h3.2l2.4-6.4 3.2 12.8 2.6-8.4 1.8 4.4h6.8" />
    </svg>
  );
}

/** Boussole — la couverture du bassin. */
export function IconCouverture({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5.2-5.2 2 2-5.2z" />
    </svg>
  );
}

/** Journal plié — les actualités du bassin. */
export function IconActualites({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M4 5.4h12.6v13.2H5.6A1.6 1.6 0 0 1 4 17V5.4Z" />
      <path d="M16.6 8.6H20V17a1.6 1.6 0 0 1-3.4 0" />
      <path d="M6.8 8.8h7M6.8 12h7M6.8 15.2h4.4" />
    </svg>
  );
}

/** Cible — la zone de prospection (commune + rayon). */
export function IconZone({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </svg>
  );
}

/** Curseurs — les poids du moteur. */
export function IconReglages({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h8M16 18h4" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="14" cy="18" r="2" />
    </svg>
  );
}

/** Deux traits qui se rejoignent — la file de rapprochement. */
export function IconResolution({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M4 5h3c4 0 4 14 8 14h5" />
      <path d="M4 19h3c1.6 0 2.6-2.2 3.4-4.8" />
      <path d="m17 16 3 3-3 3" />
    </svg>
  );
}

/** Cylindre — l'état des sources. */
export function IconIngestion({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
      <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </svg>
  );
}

/** Fiche entreprise. */
export function IconEntreprise({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M3 21h18" />
      <path d="M5 21V7l7-4 7 4v14" />
      <path d="M9 21v-5h6v5" />
      <path d="M9 9h1.5M13.5 9H15M9 12.5h1.5M13.5 12.5H15" />
    </svg>
  );
}

export function IconListe({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </svg>
  );
}

export function IconCarte({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" />
      <path d="M9 4v14M15 6v14" />
    </svg>
  );
}

export function IconRecherche({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.6-3.6" />
    </svg>
  );
}

export function IconRefresh({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 5v6h-6" />
    </svg>
  );
}

export function IconChevronDown({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function IconChevronUpDown({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="m8 9 4-4 4 4M8 15l4 4 4-4" />
    </svg>
  );
}

export function IconCheck({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="m5 12.5 4.5 4.5L19 7" />
    </svg>
  );
}

export function IconBurger({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

export function IconSoleil({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

export function IconCompte({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </svg>
  );
}

export function IconFleche({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M4 12h15M13 6l6 6-6 6" />
    </svg>
  );
}

export function IconTelephone({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M6.5 3h3l1.5 4-2 1.4a12 12 0 0 0 5.6 5.6L16 12l4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 3 6.2 2 2 0 0 1 5 4z" />
    </svg>
  );
}

/** Lien sortant — une annonce lue chez la source, dans un nouvel onglet. */
export function IconLienExterne({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M14 4h6v6M20 4l-8.5 8.5" />
      <path d="M18 14v5a1.8 1.8 0 0 1-1.8 1.8H5A1.8 1.8 0 0 1 3.2 19V7.8A1.8 1.8 0 0 1 5 6h5" />
    </svg>
  );
}

/* ── Icônes de nature d'actualité ────────────────────────────────────
   Une vignette par famille d'événement, dans le fil du bassin. Le trait est
   le même que celui du shell : ces icônes appartiennent à l'outil, elles ne
   sont pas rapportées d'une bibliothèque tierce. */

/** Coupe — un marché public remporté. */
export function IconMarche({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M7.5 4h9v4.2a4.5 4.5 0 0 1-9 0V4Z" />
      <path d="M7.5 5.6H5a2 2 0 0 0 2.5 3.6M16.5 5.6H19a2 2 0 0 1-2.5 3.6" />
      <path d="M12 12.7V16M9 20h6l-.6-2.2a1.2 1.2 0 0 0-1.1-.8h-2.6a1.2 1.2 0 0 0-1.1.8Z" />
    </svg>
  );
}

/** Calendrier — une consultation qui ferme à une date. */
export function IconCalendrier({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="3.6" y="5.4" width="16.8" height="15" rx="2.4" />
      <path d="M3.6 10h16.8M8.4 3.4v3.6M15.6 3.4v3.6" />
      <path d="M8 14h2.2" />
    </svg>
  );
}

/** Courbe montante — effectifs ou chiffre d'affaires qui progressent. */
export function IconTendance({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M3.5 16.5 9 11l3.6 3.6L20.5 6.7" />
      <path d="M15.6 6.7h4.9v4.9" />
    </svg>
  );
}

/** Billet — un mouvement de capital. (Le cylindre de la base de données est
    déjà pris par les sources : ici c'est d'argent qu'on parle.) */
export function IconCapital({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="2.6" y="6" width="18.8" height="12" rx="2.6" />
      <circle cx="12" cy="12" r="2.9" />
      <path d="M6 10v4M18 10v4" />
    </svg>
  );
}

/** Bâtiment — permis, locaux, vie de l'établissement. */
export function IconBatiment({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M4.2 20.4V6.6L12 3.6l7.8 3v13.8" />
      <path d="M2.8 20.4h18.4" />
      <path d="M9 10.2h1.6M13.4 10.2H15M9 14.2h1.6M13.4 14.2H15" />
      <path d="M10.4 20.4v-3.2h3.2v3.2" />
    </svg>
  );
}

export function IconAlerte({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 4 2.8 20h18.4z" />
      <path d="M12 10v4M12 17h.01" />
    </svg>
  );
}
