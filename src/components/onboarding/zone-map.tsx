"use client";

import {
  Map as MapLibre,
  Marker,
  type GeoJSONSource,
  type LngLatBoundsLike,
} from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { basemapStyle, useTheme } from "@/lib/client-state";

/* ── Aperçu de la zone ───────────────────────────────────────────────
   Un cercle sur une carte : c'est tout ce qu'il faut pour comprendre ce
   qu'on est en train de choisir. Le rayon se règle au curseur juste à
   côté, et le cadrage suit — on voit tout de suite si on couvre la
   préfecture voisine ou seulement sa vallée. */

function cercle(lat: number, lon: number, rayonKm: number): GeoJSON.Feature<GeoJSON.Polygon> {
  const pts: [number, number][] = [];
  const dLat = rayonKm / 110.574;
  const dLon = rayonKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= 72; i++) {
    const a = (i / 72) * 2 * Math.PI;
    pts.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [pts] } };
}

function token(nom: string): string {
  if (typeof window === "undefined") return "#000";
  return getComputedStyle(document.documentElement).getPropertyValue(nom).trim() || "#000";
}

export function ZoneMap({
  lat,
  lon,
  rayonKm,
  hauteur = 260,
}: {
  lat: number;
  lon: number;
  rayonKm: number;
  hauteur?: number;
}) {
  const theme = useTheme();
  // Sans WebGL2, pas de carte : on l'annonce au lieu de casser l'écran.
  const [indisponible, setIndisponible] = useState(false);
  const boite = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibre | null>(null);
  const pret = useRef(false);

  useEffect(() => {
    if (!boite.current) return;
    let map: MapLibre;
    try {
      map = new MapLibre({
        container: boite.current,
        style: basemapStyle(theme),
        center: [lon, lat],
        zoom: 8,
        attributionControl: { compact: true },
        // Aperçu : on regarde, on ne navigue pas — le réglage se fait au curseur.
        dragRotate: false,
      });
    } catch (e) {
      console.warn("[zone] aperçu cartographique impossible :", e);
      setIndisponible(true);
      return;
    }
    mapRef.current = map;
    // Même précaution que la carte des leads : la taille du cadre vient de la
    // mise en page, pas de la fenêtre, et `trackResize` n'observe que celle-ci.
    const observateur = new ResizeObserver(() => map.resize());
    observateur.observe(boite.current);

    map.on("load", () => {
      pret.current = true;
      map.addSource("zone", { type: "geojson", data: cercle(lat, lon, rayonKm) });
      map.addLayer({
        id: "zone-fond",
        type: "fill",
        source: "zone",
        paint: { "fill-color": token("--accent"), "fill-opacity": 0.09 },
      });
      map.addLayer({
        id: "zone-trait",
        type: "line",
        source: "zone",
        paint: { "line-color": token("--accent"), "line-width": 1.6 },
      });
      const puce = document.createElement("div");
      puce.className = "pp-agence-pin";
      new Marker({ element: puce }).setLngLat([lon, lat]).addTo(map);
      map.fitBounds(bornes(lat, lon, rayonKm), { padding: 26, duration: 0 });
    });

    return () => {
      pret.current = false;
      observateur.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // Le centre ne bouge qu'en changeant de commune : la carte se remonte
    // alors proprement, marqueur compris. `rayonKm` est volontairement hors
    // des dépendances — il est lu au montage puis suivi par l'effet suivant ;
    // le mettre ici remonterait la carte à chaque cran du curseur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, lat, lon]);

  // Le rayon, lui, se règle en continu : on redessine sans remonter la carte.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !pret.current) return;
    const src = map.getSource("zone") as GeoJSONSource | undefined;
    if (!src) return;
    src.setData(cercle(lat, lon, rayonKm));
    map.fitBounds(bornes(lat, lon, rayonKm), { padding: 26, duration: 350 });
  }, [rayonKm, lat, lon]);

  if (indisponible) {
    return (
      <div className="oz-map oz-map--vide" style={{ height: hauteur }}>
        Aperçu cartographique indisponible sur ce navigateur (WebGL2). Le rayon et les secteurs se
        règlent quand même, et le récapitulatif ci-dessous reste juste.
      </div>
    );
  }

  return <div ref={boite} className="oz-map" style={{ height: hauteur }} />;
}

function bornes(lat: number, lon: number, rayonKm: number): LngLatBoundsLike {
  const dLat = rayonKm / 110.574;
  const dLon = rayonKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  return [
    [lon - dLon, lat - dLat],
    [lon + dLon, lat + dLat],
  ];
}
