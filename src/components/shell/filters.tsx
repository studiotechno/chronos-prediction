"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { IconCheck, IconChevronDown } from "@/components/shell/icons";

/* ── Kit de filtres en barre (préfixe df-) ───────────────────────────
   Pilule + popover, option simple ou multiple, bascule de vue. Le
   popover est en `position: fixed` : la bande de filtres a un scroll
   horizontal qui clipperait un positionnement absolu. */

const GAP = 7;
const MARGE = 8;

/** Pilule ouvrant un popover. `value` est le résumé affiché à droite du label. */
export function DfDropdown({
  label,
  value,
  applied = false,
  badge,
  width = 236,
  children,
}: {
  label: string;
  value: ReactNode;
  applied?: boolean;
  badge?: number;
  width?: number;
  /** Contenu du popover ; reçoit une fonction de fermeture. */
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // Position calculée avant peinture, puis suivie tant que le popover est ouvert.
  useLayoutEffect(() => {
    if (!open) return;

    function place() {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const left = Math.min(rect.left, window.innerWidth - width - MARGE);
      setPos({ top: rect.bottom + GAP, left: Math.max(MARGE, left) });
    }

    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, width]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const cible = e.target as Node;
      if (popRef.current?.contains(cible) || anchorRef.current?.contains(cible)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className={`df-dd${open ? " open" : ""}`}>
      <button
        type="button"
        ref={anchorRef}
        className={`df-pill${applied ? " applied" : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="lb">{label} :</span>
        <span className="vl">{value}</span>
        {badge != null && badge > 1 && <span className="badge">{badge}</span>}
        <span className="chev">
          <IconChevronDown size={13} />
        </span>
      </button>
      {open && (
        <div
          ref={popRef}
          className="df-pop"
          style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width }}
          role="dialog"
          aria-label={label}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </span>
  );
}

/** Option de popover : choix unique (rond) ou multiple (case). */
export function DfOption({
  label,
  count,
  selected,
  multi = false,
  onClick,
}: {
  label: ReactNode;
  count?: number;
  selected: boolean;
  multi?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`df-opt2${selected ? " sel" : ""}`}
      onClick={onClick}
      aria-pressed={selected}
    >
      {multi ? (
        <span className="ckb">
          <IconCheck />
        </span>
      ) : (
        <span className="rk" />
      )}
      <span>{label}</span>
      {count != null && <span className="cnt">{count.toLocaleString("fr-FR")}</span>}
    </button>
  );
}

/** Curseur dans un popover (score minimum, distance maximale). */
export function DfRange({
  value,
  min,
  max,
  step = 1,
  legend,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  legend: ReactNode;
  onChange: (next: number) => void;
}) {
  return (
    <div className="df-rng">
      <div className="df-rngval">{legend}</div>
      <input
        type="range"
        className="pp-range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

/** Pied de popover multi-sélection : « Tout effacer » + « OK ». */
export function DfPopFooter({
  onClear,
  onApply,
  clearLabel = "Tout effacer",
  applyLabel = "OK",
}: {
  onClear: () => void;
  onApply: () => void;
  clearLabel?: string;
  applyLabel?: string;
}) {
  return (
    <div className="df-popft">
      <button type="button" className="df-lnk" onClick={onClear}>
        {clearLabel}
      </button>
      <button type="button" className="df-btn" onClick={onApply}>
        {applyLabel}
      </button>
    </div>
  );
}

export function DfToggle({
  label,
  on,
  onChange,
  title,
}: {
  label: string;
  on: boolean;
  onChange: (next: boolean) => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={`df-tog${on ? " on" : ""}`}
      onClick={() => onChange(!on)}
      aria-pressed={on}
      title={title}
    >
      <span>{label}</span>
      <span className="sw" />
    </button>
  );
}

export function DfViewSwitch<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; title: string; icon: ReactNode }[];
  onChange: (next: T) => void;
}) {
  return (
    <span className="df-vsw">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={o.id === value ? "on" : undefined}
          title={o.title}
          aria-label={o.title}
          aria-pressed={o.id === value}
          onClick={() => onChange(o.id)}
        >
          {o.icon}
        </button>
      ))}
    </span>
  );
}

export function DfSeparator() {
  return <span className="df-sep" aria-hidden />;
}

/** Bouton « Tout effacer » de la bande de filtres. */
export function DfClearAll({ onClear }: { onClear: () => void }) {
  return (
    <button type="button" className="df-allclear" onClick={onClear}>
      Effacer les filtres
    </button>
  );
}
