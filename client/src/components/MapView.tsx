import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { Facility } from "@shared/schema";
import { DOMAIN_PALETTE, paletteForDomain } from "@shared/taxonomy";

const RADIUS_METERS = 8047; // 5 miles

export interface ViewportBounds {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

interface MapViewProps {
  facilities: Facility[];
  selectedFacility: Facility | null;
  onSelectFacility: (facility: Facility) => void;
  userLocation: { lat: number; lng: number } | null;
  circleCenter: { lat: number; lng: number } | null;
  /**
   * Fired (debounced) after the user finishes panning/zooming so the parent
   * can refetch facilities for the visible area. The bounds are slightly
   * padded around the actual viewport — see VIEWPORT_PAD_FRACTION.
   */
  onViewportChange?: (bounds: ViewportBounds) => void;
}

function haversineDistanceMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function createCircleGeoJSON(
  lat: number,
  lng: number,
  radiusMeters: number
): GeoJSON.FeatureCollection {
  const points = 64;
  const coords: [number, number][] = [];
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    const dx = radiusMeters * Math.cos(angle);
    const dy = radiusMeters * Math.sin(angle);
    const ptLat = lat + dy / 111320;
    const ptLng = lng + dx / (111320 * Math.cos((lat * Math.PI) / 180));
    coords.push([ptLng, ptLat]);
  }
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [coords] },
        properties: {},
      },
    ],
  };
}

// Pad viewport bounds outward when reporting them so a meaningful pan
// distance is already in the cache by the time the user gets there. Combined
// with the 1° grid snap in useFacilities, this means panning within roughly
// 70 mi of where you started rarely re-hits the network.
const VIEWPORT_PAD_FRACTION = 0.5;
// Debounce viewport-change emissions so rapid panning doesn't thrash the API.
const VIEWPORT_DEBOUNCE_MS = 350;

export function MapView({
  facilities,
  selectedFacility,
  onSelectFacility,
  userLocation,
  circleCenter,
  onViewportChange,
}: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const facilitiesRef = useRef<Facility[]>(facilities);
  const onSelectRef = useRef(onSelectFacility);
  const initializedRef = useRef(false);
  const hasFlownToUser = useRef(false);
  const prevFacilitiesRef = useRef<Facility[]>([]);
  const userLocationRef = useRef(userLocation);
  // Donut overlays for clusters: maplibre Marker keyed by cluster_id
  const clusterMarkersRef = useRef<Map<number, maplibregl.Marker>>(new Map());
  const onViewportChangeRef = useRef(onViewportChange);
  onViewportChangeRef.current = onViewportChange;

  onSelectRef.current = onSelectFacility;
  facilitiesRef.current = facilities;
  userLocationRef.current = userLocation;

  // Initialize map once
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: "https://tiles.openfreemap.org/styles/positron",
      center: [-119.5, 37.5],
      zoom: 6,
      minZoom: 4,
      maxZoom: 18,
    });

    map.addControl(new maplibregl.NavigationControl(), "bottom-right");

    map.on("load", () => {
      initializedRef.current = true;

      // ── 5-mile radius circle ───────────────────────────────────────────────
      map.addSource("user-radius", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "user-radius-fill",
        type: "fill",
        source: "user-radius",
        paint: {
          "fill-color": "#E8864A",
          "fill-opacity": 0.08,
        },
      });
      map.addLayer({
        id: "user-radius-stroke",
        type: "line",
        source: "user-radius",
        paint: {
          "line-color": "#E8864A",
          "line-width": 2,
          "line-opacity": 0.45,
        },
      });

      // ── Facilities cluster source ─────────────────────────────────────────
      // clusterProperties aggregate per-domain counts so each cluster's donut
      // shows the same color story as the pins it expands into. The fifth
      // bucket ("other") catches unknown / future domains so the segments
      // always sum to point_count.
      map.addSource("facilities", {
        type: "geojson",
        data: buildGeoJSON(facilitiesRef.current, userLocationRef.current),
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50,
        clusterProperties: {
          adult:    ["+", ["case", ["==", ["get", "facilityGroup"], "Adult & Senior Care"],    1, 0]],
          children: ["+", ["case", ["==", ["get", "facilityGroup"], "Children's Residential"], 1, 0]],
          childCare:["+", ["case", ["==", ["get", "facilityGroup"], "Child Care"],             1, 0]],
          homeCare: ["+", ["case", ["==", ["get", "facilityGroup"], "Home Care"],              1, 0]],
        },
      });

      // Cluster donut markers are rendered as DOM overlays in the
      // updateClusterMarkers effect below — no MapLibre layer needed for them.

      // Individual facility points
      //   fill   = domain (DOMAIN_PALETTE)         — primary identity signal
      //   stroke = status (white normal / red bad) — secondary "is something
      //                                              wrong with this license"
      //   ring   = hiring (separate hiring-ring layer below)
      //   opacity = within 5-mile radius?
      map.addLayer({
        id: "unclustered-point",
        type: "circle",
        source: "facilities",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": [
            "match",
            ["get", "facilityGroup"],
            "Adult & Senior Care",   DOMAIN_PALETTE["Adult & Senior Care"].hex,
            "Children's Residential",DOMAIN_PALETTE["Children's Residential"].hex,
            "Child Care",            DOMAIN_PALETTE["Child Care"].hex,
            "Home Care",             DOMAIN_PALETTE["Home Care"].hex,
            "#6B7280", // unknown domain fallback
          ],
          "circle-radius": [
            "case",
            ["==", ["get", "isHiring"], true],
            9,
            7,
          ],
          "circle-stroke-width": 2,
          "circle-stroke-color": [
            "match",
            ["get", "status"],
            "CLOSED",       "#EF4444",
            "REVOKED",      "#7F1D1D",
            "ON PROBATION", "#F59E0B",
            "#FFFFFF",
          ],
          "circle-opacity": [
            "case",
            ["==", ["get", "isNearby"], true],
            1.0,
            0.35,
          ],
          "circle-stroke-opacity": [
            "case",
            ["==", ["get", "isNearby"], true],
            1.0,
            0.35,
          ],
        },
      });

      // Hiring ring — faded when out of radius
      map.addLayer({
        id: "hiring-ring",
        type: "circle",
        source: "facilities",
        filter: [
          "all",
          ["!", ["has", "point_count"]],
          ["==", ["get", "isHiring"], true],
        ],
        paint: {
          "circle-color": "transparent",
          "circle-radius": 14,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#E8864A",
          "circle-stroke-opacity": [
            "case",
            ["==", ["get", "isNearby"], true],
            0.4,
            0.1,
          ],
        },
      });

      // Single-pin click handler — cluster clicks are handled by their own
      // donut HTML markers, so we only need to detect unclustered points here.
      map.on("click", (e) => {
        const pointFeatures = map.queryRenderedFeatures(e.point, {
          layers: ["unclustered-point", "hiring-ring"],
        });
        if (pointFeatures.length > 0) {
          const props = pointFeatures[0].properties;
          const facility = facilitiesRef.current.find(
            (f) => f.number === props?.number
          );
          if (facility) onSelectRef.current(facility);
        }
      });

      // Cursor styling
      const pointer = () => { map.getCanvas().style.cursor = "pointer"; };
      const noPointer = () => { map.getCanvas().style.cursor = ""; };
      map.on("mouseenter", "unclustered-point", pointer);
      map.on("mouseleave", "unclustered-point", noPointer);
      map.on("mouseenter", "hiring-ring", pointer);
      map.on("mouseleave", "hiring-ring", noPointer);

      // Hover tooltip
      const popup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 12,
        className: "facility-tooltip",
      });

      map.on("mouseenter", "unclustered-point", (e) => {
        if (!e.features?.[0]) return;
        const coords = (
          e.features[0].geometry as GeoJSON.Point
        ).coordinates.slice() as [number, number];
        const p = e.features[0].properties;
        const palette = paletteForDomain(p?.facilityGroup);
        const domainBadge = p?.facilityGroup
          ? `<div style="display:flex;align-items:center;gap:5px;margin-top:3px;font-size:10px;color:${palette.hex};font-weight:600">
              <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${palette.hex}"></span>
              ${p.facilityGroup}${p?.facilityType && p.facilityType !== p.facilityGroup ? ` · <span style="color:#6b7280;font-weight:500">${p.facilityType}</span>` : ""}
            </div>`
          : "";
        const hiringBadge = p?.isHiring
          ? `<div style="color:#D4693A;font-weight:700;font-size:11px;margin-top:3px;font-family:'Nunito',sans-serif">★ Hiring · ${p?.jobCount || 0} position${(p?.jobCount || 0) !== 1 ? "s" : ""}</div>`
          : "";
        popup
          .setLngLat(coords)
          .setHTML(
            `<div style="font-family:'Nunito',sans-serif;font-size:13px;line-height:1.4;border-left:3px solid ${palette.hex};padding-left:8px;margin-left:-4px">
              <div style="font-weight:600;margin-bottom:2px">${p?.name || ""}</div>
              <div style="color:#6b7280;font-size:11px">${p?.city || ""}${p?.county ? ` · ${p.county} Co.` : ""} · Cap: ${p?.capacity || "?"}</div>
              ${domainBadge}
              ${hiringBadge}
            </div>`
          )
          .addTo(map);
      });
      map.on("mouseleave", "unclustered-point", () => popup.remove());
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      initializedRef.current = false;
      hasFlownToUser.current = false;
    };
  }, []);

// ── Viewport tracking ──────────────────────────────────────────────────────
  // Emit the current map bounds (debounced) on moveend so the parent can
  // refetch facilities for the visible region. Padded outward so a small
  // pan doesn't immediately blank-edge the data.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const emit = () => {
      const cb = onViewportChangeRef.current;
      if (!cb) return;
      const b = map.getBounds();
      const sw = b.getSouthWest();
      const ne = b.getNorthEast();
      const dLat = (ne.lat - sw.lat) * VIEWPORT_PAD_FRACTION;
      const dLng = (ne.lng - sw.lng) * VIEWPORT_PAD_FRACTION;
      cb({
        minLat: sw.lat - dLat,
        minLng: sw.lng - dLng,
        maxLat: ne.lat + dLat,
        maxLng: ne.lng + dLng,
      });
    };

    const onMoveEnd = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(emit, VIEWPORT_DEBOUNCE_MS);
    };

    if (map.isStyleLoaded()) emit();
    else map.once("load", emit);
    map.on("moveend", onMoveEnd);

    return () => {
      if (timer) clearTimeout(timer);
      map.off("moveend", onMoveEnd);
    };
  }, []);

  // Fly to user location once on first GPS fix
  useEffect(() => {
    const map = mapRef.current;
    if (!userLocation || !map || hasFlownToUser.current) return;
    const doFly = () => {
      if (hasFlownToUser.current) return;
      hasFlownToUser.current = true;
      map.flyTo({
        center: [userLocation.lng, userLocation.lat],
        zoom: 12,
        duration: 1500,
      });
    };
    if (map.isStyleLoaded()) doFly();
    else map.once("load", doFly);
  }, [userLocation]);

  // Update facilities GeoJSON; fitBounds only when facilities list changes
  // and the user hasn't given a location (they have their own local context).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !initializedRef.current) return;

    const facilitiesChanged = facilities !== prevFacilitiesRef.current;
    prevFacilitiesRef.current = facilities;

    const update = () => {
      const source = map.getSource("facilities") as maplibregl.GeoJSONSource;
      if (!source) return;
      source.setData(buildGeoJSON(facilities, userLocation));

      if (
        facilitiesChanged &&
        !userLocation &&
        facilities.length > 0 &&
        facilities.length < 10000
      ) {
        const bounds = new maplibregl.LngLatBounds();
        facilities.forEach((f) => bounds.extend([f.lng, f.lat]));
        map.fitBounds(bounds, { padding: 80, maxZoom: 15, duration: 600 });
      }
    };

    if (map.isStyleLoaded()) update();
    else map.once("load", update);
  }, [facilities, userLocation]);

  // Update radius circle when circleCenter changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !initializedRef.current) return;

    const update = () => {
      const source = map.getSource("user-radius") as maplibregl.GeoJSONSource;
      if (!source) return;
      source.setData(
        circleCenter
          ? createCircleGeoJSON(circleCenter.lat, circleCenter.lng, RADIUS_METERS)
          : { type: "FeatureCollection", features: [] }
      );
    };

    if (map.isStyleLoaded()) update();
    else map.once("load", update);
  }, [circleCenter]);

  // ── Donut cluster overlays ────────────────────────────────────────────────
  // Renders an SVG donut as an HTML marker for each cluster currently in
  // view, with arc segments sized by per-status counts (clusterProperties
  // populated above). Re-runs on map move and on source data changes so
  // markers stay in sync with what MapLibre is rendering.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const update = () => {
      if (!map.getSource("facilities")) return;
      const source = map.getSource("facilities") as maplibregl.GeoJSONSource;
      const features = map.querySourceFeatures("facilities", {
        filter: ["has", "point_count"],
      });

      const seen = new Set<number>();

      for (const f of features) {
        const props = f.properties as ClusterProps | null;
        if (!props || typeof props.cluster_id !== "number") continue;
        const id = props.cluster_id;
        seen.add(id);

        const coords = (f.geometry as GeoJSON.Point).coordinates as [number, number];
        const html = donutSvgHtml(props);
        let marker = clusterMarkersRef.current.get(id);

        if (!marker) {
          const el = document.createElement("div");
          el.style.cursor = "pointer";
          el.innerHTML = html;
          el.addEventListener("click", (ev) => {
            ev.stopPropagation();
            source
              .getClusterExpansionZoom(id)
              .then((zoom) => {
                map.easeTo({ center: coords, zoom: Math.min(zoom, 18), duration: 500 });
              })
              .catch(() => {
                map.easeTo({ center: coords, zoom: map.getZoom() + 3, duration: 500 });
              });
          });
          marker = new maplibregl.Marker({ element: el }).setLngLat(coords).addTo(map);
          clusterMarkersRef.current.set(id, marker);
        } else {
          marker.setLngLat(coords);
          const el = marker.getElement();
          // Only re-render the SVG if the counts changed (cheap string compare)
          if (el.innerHTML !== html) el.innerHTML = html;
        }
      }

      // Remove markers no longer present
      const stale: number[] = [];
      clusterMarkersRef.current.forEach((marker, id) => {
        if (!seen.has(id)) {
          marker.remove();
          stale.push(id);
        }
      });
      stale.forEach((id) => clusterMarkersRef.current.delete(id));
    };

    const onData = (e: maplibregl.MapDataEvent) => {
      if ((e as any).sourceId === "facilities" && (e as any).isSourceLoaded) update();
    };
    const onMoveEnd = () => update();

    map.on("data", onData);
    map.on("moveend", onMoveEnd);
    if (map.isStyleLoaded()) update();
    else map.once("load", update);

    return () => {
      map.off("data", onData);
      map.off("moveend", onMoveEnd);
      clusterMarkersRef.current.forEach((m) => m.remove());
      clusterMarkersRef.current.clear();
    };
  }, []);

  // Fly to selected facility
  useEffect(() => {
    if (!selectedFacility || !mapRef.current) return;
    const upwardOffset = Math.floor(window.innerHeight * 0.15);
    mapRef.current.easeTo({
      center: [selectedFacility.lng, selectedFacility.lat],
      zoom: Math.max(mapRef.current.getZoom(), 15),
      offset: [0, upwardOffset],
      duration: 700,
    });
  }, [selectedFacility]);

  return (
    <div className="absolute inset-0">
      <div
        ref={mapContainer}
        className="absolute inset-0"
        data-testid="map-container"
      />

      <style>{`
        .facility-tooltip .maplibregl-popup-content {
          padding: 8px 12px;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
          border: 1px solid #e5e7eb;
        }
        .facility-tooltip .maplibregl-popup-tip {
          border-top-color: #ffffff;
        }
      `}</style>
    </div>
  );
}

function buildGeoJSON(
  facilities: Facility[],
  userLocation: { lat: number; lng: number } | null
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: facilities.map((f) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [f.lng, f.lat] },
      properties: {
        name: f.name,
        number: f.number,
        status: f.status,
        capacity: f.capacity,
        city: f.city,
        county: f.county ?? "",
        facilityType: f.facilityType ?? "Adult Residential Facility",
        facilityGroup: f.facilityGroup ?? "Adult & Senior Care",
        isHiring: f.isHiring,
        jobCount: f.jobPostings?.length || 0,
        // true when no user location (no dimming) or within 5 miles
        isNearby: userLocation
          ? haversineDistanceMiles(userLocation.lat, userLocation.lng, f.lat, f.lng) <= 2
          : true,
      },
    })),
  };
}

// ── Donut cluster SVG ────────────────────────────────────────────────────────

interface ClusterProps {
  cluster: boolean;
  cluster_id: number;
  point_count: number;
  point_count_abbreviated?: string | number;
  adult?: number;
  children?: number;
  childCare?: number;
  homeCare?: number;
}

const UNKNOWN_DOMAIN_COLOR = "#9CA3AF"; // gray-400 — for facilities with an unrecognized domain

function donutSvgHtml(props: ClusterProps): string {
  const total = Number(props.point_count) || 0;
  const adult     = Number(props.adult)     || 0;
  const children  = Number(props.children)  || 0;
  const childCare = Number(props.childCare) || 0;
  const homeCare  = Number(props.homeCare)  || 0;
  const other = Math.max(0, total - adult - children - childCare - homeCare);

  // Outer/inner radii scale with cluster size, matching the prior step ramp.
  const ro = total < 10 ? 18 : total < 50 ? 24 : 32;
  const ri = ro - 6;
  const w = ro * 2 + 4;
  const cx = w / 2;
  const cy = w / 2;

  // Order matches DOMAINS in shared/taxonomy.ts so the visual reading order
  // is the same as the legend.
  const segments = [
    { color: DOMAIN_PALETTE["Adult & Senior Care"].hex,    n: adult },
    { color: DOMAIN_PALETTE["Children's Residential"].hex, n: children },
    { color: DOMAIN_PALETTE["Child Care"].hex,             n: childCare },
    { color: DOMAIN_PALETTE["Home Care"].hex,              n: homeCare },
    { color: UNKNOWN_DOMAIN_COLOR,                         n: other },
  ].filter((s) => s.n > 0);

  let arcs = "";
  if (segments.length === 1) {
    // Full ring: SVG arc cannot draw a 360° arc, draw a stroked circle instead.
    arcs = `<circle cx="${cx}" cy="${cy}" r="${(ro + ri) / 2}" fill="none" stroke="${segments[0].color}" stroke-width="${ro - ri}" />`;
  } else {
    let cum = 0;
    for (const s of segments) {
      const a0 = (cum / total) * 2 * Math.PI;
      cum += s.n;
      const a1 = (cum / total) * 2 * Math.PI;
      arcs += `<path d="${donutArcPath(cx, cy, ro, ri, a0, a1)}" fill="${s.color}" />`;
    }
  }

  const label = abbreviateCount(total);
  const fontSize = total < 10 ? 11 : total < 100 ? 12 : 13;

  return `
    <svg width="${w}" height="${w}" viewBox="0 0 ${w} ${w}" style="display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.18));">
      ${arcs}
      <circle cx="${cx}" cy="${cy}" r="${ri}" fill="white" />
      <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central"
            font-size="${fontSize}" font-weight="700" fill="#1f2937"
            font-family="system-ui, -apple-system, sans-serif">${label}</text>
    </svg>
  `;
}

function donutArcPath(
  cx: number, cy: number, ro: number, ri: number, a0: number, a1: number,
): string {
  // Convert from "0 = 12 o'clock" to standard SVG angle (0 = 3 o'clock).
  const offset = -Math.PI / 2;
  const x0o = cx + ro * Math.cos(a0 + offset);
  const y0o = cy + ro * Math.sin(a0 + offset);
  const x1o = cx + ro * Math.cos(a1 + offset);
  const y1o = cy + ro * Math.sin(a1 + offset);
  const x0i = cx + ri * Math.cos(a1 + offset);
  const y0i = cy + ri * Math.sin(a1 + offset);
  const x1i = cx + ri * Math.cos(a0 + offset);
  const y1i = cy + ri * Math.sin(a0 + offset);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return [
    `M ${x0o} ${y0o}`,
    `A ${ro} ${ro} 0 ${large} 1 ${x1o} ${y1o}`,
    `L ${x0i} ${y0i}`,
    `A ${ri} ${ri} 0 ${large} 0 ${x1i} ${y1i}`,
    "Z",
  ].join(" ");
}

function abbreviateCount(n: number): string {
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}
