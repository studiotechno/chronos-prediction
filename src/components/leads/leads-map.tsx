"use client";

import {
  LngLatBounds,
  Map as MapLibre,
  Marker,
  NavigationControl,
  Popup,
  type GeoJSONSource,
  type MapLayerMouseEvent,
} from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { basemapStyle, useTheme } from "@/lib/client-state";
import { fenetreLisible } from "@/lib/format";
import { signalTypeLabel } from "@/lib/scoring/labels";
import { nafLabel } from "@/lib/reference/naf";
import type { LeadListe } from "@/lib/queries";

/* ── Carte des leads ─────────────────────────────────────────────────
   Même jeu de données que la liste, lu autrement : où sont les
   déclencheurs par rapport à l'agence. Un point = un établissement ;
   la taille dit le score, la couleur dit le segment (AMBRE un lead
   chaud, ACIER du nurturing). Le cercle tracé est la zone de l'agence :
   ce qui en sort n'est pas hors sujet, c'est plus loin à desservir. */

export interface AgenceCarte {
  nom: string;
  lat: number;
  lon: number;
  rayonKm: number;
}

/** Polygone approchant un cercle géodésique (72 côtés : lisse à l'œil). */
function cercleGeoJSON(lat: number, lon: number, rayonKm: number): GeoJSON.Feature<GeoJSON.Polygon> {
  const points: [number, number][] = [];
  const degLat = rayonKm / 110.574;
  const degLon = rayonKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= 72; i++) {
    const angle = (i / 72) * 2 * Math.PI;
    points.push([lon + degLon * Math.cos(angle), lat + degLat * Math.sin(angle)]);
  }
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [points] } };
}

/* Une coordonnée peut être absente (établissement non géolocalisé) mais aussi
   NaN : l'INSEE publie les entreprises « non diffusibles » sans position, et
   une coordonnée vide se parse en NaN. `!= null` laissait passer ces NaN, dont
   MapLibre ne veut rien savoir — « Invalid LngLat object: (NaN, NaN) ». */
function geolocalise(l: LeadListe): boolean {
  return Number.isFinite(l.lat) && Number.isFinite(l.lon);
}

function versGeoJSON(leads: LeadListe[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: leads
      .filter(geolocalise)
      .map((l) => ({
        type: "Feature" as const,
        properties: {
          siret: l.siret,
          nom: l.denomination,
          score: Math.round(l.scoreFinal),
          strate: Math.round(l.strate),
          sismo: Math.round(l.sismo),
          segment: l.segment,
          raison: l.raisonFr,
          proposition: l.propositionFr ?? "",
          fenetre: fenetreLisible(l.fenetreDebut, l.fenetreFin) ?? "",
          lieu: l.lieuBesoinFr ?? "",
          commune: l.commune ?? "",
          naf: nafLabel(l.naf),
          distance: l.distanceKm,
          signaux: l.topSignals.map((s) => signalTypeLabel(s.type)).join(" · "),
        },
        geometry: { type: "Point" as const, coordinates: [l.lon!, l.lat!] },
      })),
  };
}

export function LeadsMap({
  leads,
  agence,
  videHint,
}: {
  leads: LeadListe[];
  agence: AgenceCarte;
  videHint: string | null;
}) {
  const router = useRouter();
  const theme = useTheme();
  /* Une carte WebGL peut être impossible à créer (WebGL2 désactivé, GPU
     indisponible, machine virtuelle). Ce n'est pas une raison pour perdre
     l'écran : on le dit, et la liste reste à un clic. */
  const [indisponible, setIndisponible] = useState(false);
  const conteneur = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibre | null>(null);
  const pretRef = useRef(false);
  // Les données changent à chaque filtre ; l'effet de création ne doit pas
  // se rejouer pour autant — il les relit par ref au moment du `load`.
  const leadsRef = useRef(leads);
  leadsRef.current = leads;
  const routerRef = useRef(router);
  routerRef.current = router;

  /* ── Création de la carte (une fois par thème) ── */
  useEffect(() => {
    if (!conteneur.current) return;

    let map: MapLibre;
    try {
      map = new MapLibre({
        container: conteneur.current,
        style: basemapStyle(theme),
        center: [agence.lon, agence.lat],
        zoom: 9,
        attributionControl: { compact: true },
      });
    } catch (e) {
      console.warn("[carte] rendu impossible :", e);
      setIndisponible(true);
      return;
    }
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");

    /* MapLibre lit la taille de son conteneur à la construction, et
       `trackResize` n'observe que la FENÊTRE. Or ce cadre tient sa hauteur
       d'une colonne flex : la carte peut donc naître avant que la mise en
       page ne soit arrêtée et rester figée — style chargé, aucune tuile
       demandée, aucune image rendue. Un observateur sur le conteneur la
       remet d'aplomb, à l'ouverture comme au repli de la barre latérale. */
    const observateur = new ResizeObserver(() => map.resize());
    observateur.observe(conteneur.current);

    map.on("load", () => {
      pretRef.current = true;

      // Zone de l'agence : contour tireté, remplissage à peine perceptible.
      map.addSource("zone", {
        type: "geojson",
        data: cercleGeoJSON(agence.lat, agence.lon, agence.rayonKm),
      });
      map.addLayer({
        id: "zone-fond",
        type: "fill",
        source: "zone",
        paint: { "fill-color": couleur("--accent"), "fill-opacity": 0.04 },
      });
      map.addLayer({
        id: "zone-trait",
        type: "line",
        source: "zone",
        paint: {
          "line-color": couleur("--accent"),
          "line-width": 1.2,
          "line-dasharray": [3, 3],
          "line-opacity": 0.55,
        },
      });

      // Leads : un halo pour les chauds, puis le point lui-même.
      map.addSource("leads", { type: "geojson", data: versGeoJSON(leadsRef.current) });
      map.addLayer({
        id: "leads-halo",
        type: "circle",
        source: "leads",
        filter: ["==", ["get", "segment"], "chaud"],
        paint: {
          "circle-color": couleur("--sismo"),
          "circle-opacity": 0.14,
          "circle-radius": ["interpolate", ["linear"], ["get", "score"], 0, 10, 100, 30],
        },
      });
      map.addLayer({
        id: "leads-pts",
        type: "circle",
        source: "leads",
        paint: {
          "circle-color": [
            "case",
            ["==", ["get", "segment"], "chaud"],
            couleur("--sismo"),
            couleur("--strate"),
          ],
          "circle-radius": ["interpolate", ["linear"], ["get", "score"], 0, 4, 100, 13],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": couleur("--surface"),
          "circle-opacity": 0.92,
        },
      });

      // Repère de l'agence : le centre de la zone, jamais un lead.
      const puce = document.createElement("div");
      puce.className = "pp-agence-pin";
      puce.title = `${agence.nom} — centre de la zone`;
      new Marker({ element: puce }).setLngLat([agence.lon, agence.lat]).addTo(map);

      map.on("mouseenter", "leads-pts", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "leads-pts", () => (map.getCanvas().style.cursor = ""));
      map.on("click", "leads-pts", (e: MapLayerMouseEvent) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as Record<string, string | number | null>;
        const [lon, lat] = (f.geometry as GeoJSON.Point).coordinates;
        new Popup({ className: "pp-pin-pop", offset: 14, maxWidth: "320px" })
          .setLngLat([lon, lat])
          .setDOMContent(contenuPopup(p, () => routerRef.current.push(`/lead/${p.siret}`)))
          .addTo(map);
      });

      cadrer(map, leadsRef.current, agence);
    });

    return () => {
      pretRef.current = false;
      observateur.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [theme, agence]);

  /* ── Mise à jour des points quand les filtres bougent ── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !pretRef.current) return;
    const source = map.getSource("leads") as GeoJSONSource | undefined;
    if (!source) return;
    source.setData(versGeoJSON(leads));
    cadrer(map, leads, agence);
  }, [leads, agence]);

  if (indisponible) {
    return (
      <div className="grid min-h-[420px] flex-1 place-items-center bg-s2">
        <div className="pp-map-vide" style={{ position: "static", transform: "none" }}>
          <b>Carte indisponible sur ce navigateur</b>
          <span>
            L’affichage cartographique demande WebGL2. Les mêmes leads, avec les mêmes filtres,
            restent lisibles en vue Liste.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-[420px] flex-1">
      <div ref={conteneur} className="pp-map-hote" />
      <div className="pp-map-legend">
        <div className="lbl">Lecture de la carte</div>
        <div className="pp-ml-scale">
          <span className="pp-ml-dot" data-segment="chaud" />
          <span>Lead chaud</span>
          <span className="pp-ml-dot" data-segment="nurturing" />
          <span>Lead tiède</span>
        </div>
        <div className="pp-ml-note">La taille du point suit le score final.</div>
      </div>
      {videHint && (
        <div className="pp-map-vide">
          <b>Aucun lead à afficher</b>
          <span>{videHint}</span>
        </div>
      )}
    </div>
  );
}

/** Valeur calculée d'un token CSS — MapLibre ne lit pas les variables. */
function couleur(token: string): string {
  if (typeof window === "undefined") return "#000";
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim() || "#000";
}

function cadrer(map: MapLibre, leads: LeadListe[], agence: AgenceCarte) {
  const points = leads.filter(geolocalise);
  if (points.length === 0) {
    map.easeTo({ center: [agence.lon, agence.lat], zoom: 9 });
    return;
  }
  const bounds = new LngLatBounds();
  for (const l of points) bounds.extend([l.lon as number, l.lat as number]);
  bounds.extend([agence.lon, agence.lat]);
  map.fitBounds(bounds, { padding: 70, maxZoom: 12, duration: 500 });
}

/** Contenu du popup — construit en DOM : aucune donnée n'est injectée en HTML. */
function contenuPopup(
  p: Record<string, string | number | null>,
  ouvrir: () => void,
): HTMLElement {
  const chaud = p.segment === "chaud";
  const racine = document.createElement("div");
  racine.className = "pp-pin";

  const tete = document.createElement("div");
  tete.className = "pp-pin-head";
  const score = document.createElement("span");
  score.className = "pp-pin-score";
  score.style.background = `var(${chaud ? "--sismo" : "--strate"})`;
  score.textContent = String(p.score ?? "");
  const bloc = document.createElement("div");
  const nom = document.createElement("div");
  nom.className = "pp-pin-addr";
  nom.textContent = String(p.nom ?? "");
  const meta = document.createElement("div");
  meta.className = "pp-pin-meta";
  meta.textContent = [
    p.commune,
    p.naf,
    Number.isFinite(p.distance) ? `${p.distance} km${p.lieu ? ` (besoin à ${p.lieu})` : ""}` : null,
    `Socle ${p.strate} · Pouls ${p.sismo}`,
  ]
    .filter(Boolean)
    .join(" · ");
  bloc.append(nom, meta);
  tete.append(score, bloc);

  const signaux = document.createElement("div");
  signaux.className = "pp-pin-sigs";
  const raison = document.createElement("span");
  raison.className = "pp-pin-sig hi";
  raison.style.setProperty("--sig", `var(${chaud ? "--sismo" : "--strate"})`);
  raison.textContent = String(p.raison ?? "");
  signaux.append(raison);
  if (p.proposition || p.fenetre) {
    const prop = document.createElement("span");
    prop.className = "pp-pin-sig";
    prop.style.setProperty("--sig", "var(--tempo)");
    prop.textContent = [p.fenetre ? `Fenêtre : ${p.fenetre}` : null, p.proposition].filter(Boolean).join(" · ");
    signaux.append(prop);
  }
  if (p.signaux) {
    const liste = document.createElement("span");
    liste.className = "pp-pin-sig";
    liste.textContent = String(p.signaux);
    signaux.append(liste);
  }

  const pied = document.createElement("div");
  pied.className = "pp-pin-foot";
  const bouton = document.createElement("button");
  bouton.type = "button";
  bouton.className = "pp-pin-ghost";
  bouton.textContent = "Ouvrir la fiche →";
  bouton.addEventListener("click", ouvrir);
  pied.append(bouton);

  racine.append(tete, signaux, pied);
  return racine;
}
