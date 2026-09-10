"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { deconnexion } from "@/app/auth-actions";
import { IconDeconnexion } from "@/components/auth/icone-deconnexion";
import { usePersistedFlag } from "@/lib/client-state";
import { applyTheme, readTheme, type Theme } from "@/lib/theme";
import {
  IconChevronDown,
  IconChevronUpDown,
  IconSoleil,
  IconZone,
} from "@/components/shell/icons";

/* ── Barre latérale ──────────────────────────────────────────────────
   Identité de l'agence en tête (elle porte la zone : c'est le contexte de
   TOUT ce qui est affiché ailleurs), sections repliables, item actif en
   pilule neutre. Seules les pages qui existent y figurent. Pas de champ de
   recherche : ⌘K appartient à la page (cf. app-shell). */

export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: ReactNode;
  /** Compteur calculé côté serveur (leads chauds, file de rapprochement). */
  count?: number;
}

export interface NavSection {
  key: string;
  title: string;
  items: NavItem[];
}

export interface AgenceEnTete {
  nom: string;
  /** Ligne secondaire : « Vichy · 30 km ». */
  sousTitre: string;
  initiale: string;
  /** Compte connecté, affiché dans le menu : savoir sous quelle identité on agit. */
  email?: string | null;
}

const CLE_REPLI = "chronos.nav.replie.";

export function Sidebar({
  agence,
  sections,
  demo,
  open,
  onNavigate,
}: {
  agence: AgenceEnTete;
  sections: NavSection[];
  /** La base contient des fixtures : l'outil le dit en pied de barre. */
  demo: boolean;
  open: boolean;
  onNavigate: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const wsRef = useRef<HTMLDivElement>(null);

  // Fermeture du menu : clic extérieur ou Échap.
  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (!wsRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <aside className="sb" data-open={open}>
      <div className="ws" ref={wsRef}>
        <button
          type="button"
          className="ws-btn"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span className="ws-logo">{agence.initiale}</span>
          <span className="ws-meta">
            <span className="ws-name">{agence.nom}</span>
            <span className="ws-sub">{agence.sousTitre}</span>
          </span>
          <span className="ws-chev">
            <IconChevronUpDown />
          </span>
        </button>

        {menuOpen && <MenuAgence agence={agence} onClose={() => setMenuOpen(false)} />}
      </div>

      <nav className="sb-nav">
        {sections.map((section) => (
          <Section key={section.key} section={section} onNavigate={onNavigate} />
        ))}
      </nav>

      <div className="sb-datasrc" title={demo ? SOURCE_DEMO : SOURCE_REELLE}>
        <span className="dot" data-env={demo ? "local" : undefined} />
        <span className="lb">{demo ? "Démo · fixtures" : "Données réelles"}</span>
      </div>
    </aside>
  );
}

const SOURCE_DEMO =
  "La base contient des signaux « fixture: » — données fictives de démonstration, étiquetées comme telles.";
const SOURCE_REELLE =
  "Aucune fixture en base : tout ce qui est affiché vient des sources publiques ingérées.";

/* ── Section repliable (état persisté) ─────────────────────────────── */
function Section({ section, onNavigate }: { section: NavSection; onNavigate: () => void }) {
  const [replie, setReplie] = usePersistedFlag(CLE_REPLI + section.key);

  return (
    <div>
      <button
        type="button"
        className="sb-section-label"
        aria-expanded={!replie}
        onClick={() => setReplie(!replie)}
      >
        <span>{section.title}</span>
        <span className="chev">
          <IconChevronDown />
        </span>
        <span className="rule" />
      </button>
      {!replie && (
        <div>
          {section.items.map((item) => (
            <Item key={item.key} item={item} onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </div>
  );
}

function Item({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  const pathname = usePathname();
  const actif = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href + "/"));

  return (
    <Link
      href={item.href}
      className="sb-item"
      data-active={actif}
      aria-current={actif ? "page" : undefined}
      onClick={onNavigate}
    >
      {item.icon}
      <span>{item.label}</span>
      {item.count != null && item.count > 0 && (
        <span className="sb-count">{item.count.toLocaleString("fr-FR")}</span>
      )}
    </Link>
  );
}

/* ── Menu de l'agence : zone, thème ──────────────────────────────── */
function MenuAgence({ agence, onClose }: { agence: AgenceEnTete; onClose: () => void }) {
  // Le menu n'est monté qu'au clic : lire localStorage au premier rendu est
  // sans risque d'écart d'hydratation.
  const [theme, setTheme] = useState<Theme>(readTheme);

  function changerTheme(next: Theme) {
    setTheme(next);
    applyTheme(next);
  }

  return (
    <div className="ws-menu" role="menu">
      <div className="am-head">
        <span className="am-av">{agence.initiale}</span>
        <span className="am-id">
          <span className="n">{agence.nom}</span>
          <span className="e">{agence.email ?? agence.sousTitre}</span>
        </span>
      </div>
      <div className="am-div" />
      <Link href="/zone" className="am-row" role="menuitem" onClick={onClose}>
        <IconZone />
        Ma zone de prospection
      </Link>
      <div className="am-div" />
      {/* `.am-row.danger` existe déjà pour ce genre d'action : rien à ajouter
          au style global, l'authentification reste un ajout autonome. */}
      <form action={deconnexion}>
        <button type="submit" className="am-row danger" role="menuitem">
          <IconDeconnexion />
          Se déconnecter
        </button>
      </form>
      <div className="am-div" />
      <div className="am-theme">
        <IconSoleil />
        <span className="lb">Thème</span>
        <span className="am-seg">
          <button
            type="button"
            className={theme === "clair" ? "on" : undefined}
            onClick={() => changerTheme("clair")}
          >
            Clair
          </button>
          <button
            type="button"
            className={theme === "noir" ? "on" : undefined}
            onClick={() => changerTheme("noir")}
          >
            Noir
          </button>
        </span>
      </div>
    </div>
  );
}
