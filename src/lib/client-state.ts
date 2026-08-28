"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { readTheme, type Theme } from "@/lib/theme";

/* ── Lectures « externes » au rendu React ────────────────────────────
   localStorage n'est pas connu du serveur : le lire via
   useSyncExternalStore plutôt qu'un useState + useEffect donne au rendu
   serveur une valeur de repli explicite, sans rendu en cascade. */

const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

/** Booléen persisté dans localStorage (section repliée, option d'affichage). */
export function usePersistedFlag(key: string): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(subscribe, () => readFlag(key), () => false);

  function set(next: boolean) {
    try {
      localStorage.setItem(key, next ? "1" : "0");
    } catch {
      /* stockage indisponible : l'état ne survivra pas au rechargement */
    }
    listeners.forEach((l) => l());
  }

  return [value, set];
}

/**
 * Valeur persistée libre (mode d'affichage, filtres sérialisés…).
 *
 * Renvoie une CHAÎNE, jamais un objet : `useSyncExternalStore` compare les
 * instantanés par identité, une valeur parsée à chaque lecture bouclerait.
 * `getServerSnapshot` rend le défaut, si bien que le rendu serveur et le
 * premier rendu client coïncident — lire localStorage dans un `useState`
 * initial provoquait un écart d'hydratation à chaque chargement.
 */
export function useStoredString(key: string, fallback: string): [string, (v: string) => void] {
  const valeur = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return localStorage.getItem(key) ?? fallback;
      } catch {
        return fallback;
      }
    },
    () => fallback,
  );

  function set(next: string) {
    try {
      localStorage.setItem(key, next);
    } catch {
      /* stockage indisponible : la valeur ne survivra pas au rechargement */
    }
    listeners.forEach((l) => l());
  }

  return [valeur, set];
}

/**
 * Media query observée. Sert aux composants qui doivent RETIRER des éléments
 * du DOM plutôt que les masquer — un tableau, par exemple : une cellule en
 * `display: none` disparaît à l'œil mais sa colonne continue de réclamer sa
 * part de largeur en layout fixe.
 */
export function useMediaQuery(query: string): boolean {
  const souscrire = useCallback(
    (onChange: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    souscrire,
    () => window.matchMedia(query).matches,
    // Rendu serveur : on suppose l'écran large, l'hydratation corrige.
    () => false,
  );
}

const noopSubscribe = () => () => {};

/** Vrai sur les plateformes Apple — décide du glyphe ⌘ vs Ctrl. */
export function useIsMac(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => /Mac|iPhone|iPad/i.test(navigator.userAgent),
    () => true,
  );
}

/** Thème courant, réévalué à chaque bascule (événement `chronos:theme`). */
export function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(() =>
    typeof window === "undefined" ? "clair" : readTheme(),
  );
  useEffect(() => {
    function onChange(e: Event) {
      setTheme((e as CustomEvent<Theme>).detail);
    }
    window.addEventListener("chronos:theme", onChange);
    return () => window.removeEventListener("chronos:theme", onChange);
  }, []);
  return theme;
}

/** Fond de carte correspondant au thème (styles Carto, sans clé). */
export function basemapStyle(theme: Theme): string {
  return theme === "noir"
    ? "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
    : "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
}
