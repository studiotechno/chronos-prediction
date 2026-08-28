"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { IconRecherche } from "@/components/shell/icons";

/* ── Palette de commandes ⌘K ─────────────────────────────────────────
   Navigue entre les pages réellement disponibles : un seul geste, pas de
   résultat mort. La recherche d'entreprise, elle, appartient à la page
   des leads (⌘K lui revient tant qu'elle est montée, cf. app-shell). */

export interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  href: string;
  icon: ReactNode;
}

function normalise(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function CommandPalette({ items, onClose }: { items: CommandItem[]; onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [curseurBrut, setCurseur] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const resultats = useMemo(() => {
    const q = normalise(query.trim());
    if (!q) return items;
    return items.filter((it) => normalise(`${it.label} ${it.hint ?? ""}`).includes(q));
  }, [items, query]);

  // Ramené dans les bornes au rendu : filtrer réduit la liste sous le curseur.
  const curseur = curseurBrut >= resultats.length ? 0 : curseurBrut;

  function go(item: CommandItem | undefined) {
    if (!item) return;
    onClose();
    router.push(item.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCurseur((c) => (resultats.length ? (c + 1) % resultats.length : 0));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setCurseur((c) => (resultats.length ? (c - 1 + resultats.length) % resultats.length : 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      go(resultats[curseur]);
    }
  }

  // Garde l'item survolé au clavier visible dans la liste.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [curseur]);

  return (
    <div
      className="cmdk-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cmdk-panel" role="dialog" aria-modal="true" aria-label="Aller à">
        <div className="cmdk-input">
          <IconRecherche />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Aller à…"
            aria-label="Rechercher une page"
          />
        </div>
        <div className="cmdk-list" ref={listRef}>
          {resultats.length === 0 ? (
            <div className="cmdk-empty">Aucun résultat</div>
          ) : (
            resultats.map((it, i) => (
              <button
                key={it.id}
                className="cmdk-item"
                data-active={i === curseur}
                onMouseEnter={() => setCurseur(i)}
                onClick={() => go(it)}
              >
                {it.icon}
                <span>{it.label}</span>
                {it.hint && <span className="hint">{it.hint}</span>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
