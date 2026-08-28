"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CommandPalette, type CommandItem } from "@/components/shell/command-palette";
import { Sidebar, type AgenceEnTete, type NavSection } from "@/components/shell/sidebar";
import {
  IconActualites,
  IconCouverture,
  IconIngestion,
  IconLeads,
  IconReglages,
  IconResolution,
  IconZone,
} from "@/components/shell/icons";

/* ── Coquille de l'application ───────────────────────────────────────
   Grille « barre figée + contenu qui défile seul ». Sous 900 px la barre
   devient un tiroir, ouvert par le bouton du chrome de page. */

interface ShellUi {
  openDrawer: () => void;
  openPalette: () => void;
  /** Détourne ⌘K vers la recherche de la page ; `null` le rend à la palette. */
  setSearchShortcut: (focus: (() => void) | null) => void;
}

const ShellUiContext = createContext<ShellUi>({
  openDrawer: () => {},
  openPalette: () => {},
  setSearchShortcut: () => {},
});

export function useShellUi(): ShellUi {
  return useContext(ShellUiContext);
}

/* ── ⌘K de page ──────────────────────────────────────────────────────
   Une page qui possède sa propre recherche (la liste des leads) capte le
   raccourci tant qu'elle est montée ; ailleurs il ouvre la palette.
   `focus` doit être stable (useCallback), sinon l'inscription se rejoue à
   chaque rendu de l'appelant — sans dommage, mais pour rien. */
export function useSearchShortcut(focus: () => void): void {
  const { setSearchShortcut } = useShellUi();
  useEffect(() => {
    setSearchShortcut(focus);
    return () => setSearchShortcut(null);
  }, [focus, setSearchShortcut]);
}

export interface ShellCounts {
  chauds: number;
  resolutions: number;
}

function construireSections(counts: ShellCounts): NavSection[] {
  return [
    {
      key: "prospection",
      title: "Prospection",
      items: [
        { key: "leads", label: "Leads chauds", href: "/", icon: <IconLeads />, count: counts.chauds },
        { key: "couverture", label: "Couverture du bassin", href: "/couverture", icon: <IconCouverture /> },
        { key: "actualites", label: "Actualités", href: "/actualites", icon: <IconActualites /> },
      ],
    },
    {
      key: "moteur",
      title: "Moteur",
      items: [
        { key: "reglages", label: "Poids du moteur", href: "/reglages", icon: <IconReglages /> },
        {
          key: "resolution",
          label: "Rapprochements",
          href: "/resolution",
          icon: <IconResolution />,
          count: counts.resolutions,
        },
        { key: "ingestion", label: "Sources", href: "/ingestion", icon: <IconIngestion /> },
      ],
    },
  ];
}

const COMMANDES: CommandItem[] = [
  { id: "leads", label: "Leads chauds", hint: "Liste et carte", href: "/", icon: <IconLeads /> },
  { id: "couverture", label: "Couverture du bassin", hint: "Concurrence", href: "/couverture", icon: <IconCouverture /> },
  {
    id: "actualites",
    label: "Actualités",
    hint: "Marchés, appels d'offres, vie des entreprises",
    href: "/actualites",
    icon: <IconActualites />,
  },
  { id: "zone", label: "Ma zone de prospection", hint: "Commune et rayon", href: "/zone", icon: <IconZone /> },
  { id: "reglages", label: "Poids du moteur", href: "/reglages", icon: <IconReglages /> },
  { id: "resolution", label: "Rapprochements", href: "/resolution", icon: <IconResolution /> },
  { id: "ingestion", label: "Sources", href: "/ingestion", icon: <IconIngestion /> },
];

export function AppShell({
  agence,
  counts,
  demo,
  children,
}: {
  agence: AgenceEnTete;
  counts: ShellCounts;
  demo: boolean;
  children: React.ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const sections = useMemo(() => construireSections(counts), [counts]);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const openPalette = useCallback(() => {
    setDrawerOpen(false);
    setPaletteOpen(true);
  }, []);

  // Recherche de page inscrite par `useSearchShortcut`, et état de la
  // palette : le handler clavier est monté une fois et les lit par ref.
  const searchRef = useRef<(() => void) | null>(null);
  const setSearchShortcut = useCallback((focus: (() => void) | null) => {
    searchRef.current = focus;
  }, []);
  const paletteOpenRef = useRef(false);
  useEffect(() => {
    paletteOpenRef.current = paletteOpen;
  }, [paletteOpen]);

  const ui = useMemo<ShellUi>(
    () => ({ openDrawer, openPalette, setSearchShortcut }),
    [openDrawer, openPalette, setSearchShortcut],
  );

  // ⌘K / Ctrl+K : la recherche de la page si elle en a une, la palette sinon.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return;
      e.preventDefault();
      if (paletteOpenRef.current) {
        setPaletteOpen(false);
        return;
      }
      const focusRecherchePage = searchRef.current;
      if (focusRecherchePage) focusRecherchePage();
      else setPaletteOpen(true);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <ShellUiContext.Provider value={ui}>
      <div className="shell-root">
        <Sidebar
          agence={agence}
          sections={sections}
          demo={demo}
          open={drawerOpen}
          onNavigate={() => setDrawerOpen(false)}
        />
        {drawerOpen && <div className="sb-scrim" onClick={() => setDrawerOpen(false)} aria-hidden />}
        <main className="shell-main">{children}</main>
      </div>
      {paletteOpen && <CommandPalette items={COMMANDES} onClose={() => setPaletteOpen(false)} />}
    </ShellUiContext.Provider>
  );
}
