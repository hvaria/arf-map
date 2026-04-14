import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { Search } from "lucide-react";
import type { Facility } from "@shared/schema";

const RADIUS_METERS = 48280; // 30 miles

interface MapViewProps {
  facilities: Facility[];
  selectedFacility: Facility | null;
  onSelectFacility: (facility: Facility) => void;
  userLocation: { lat: number; lng: number } | null;
  circleCenter: { lat: number; lng: number } | null;
  onSearchArea: (lat: number, lng: number) => void;
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

export function MapView({
  facilities,
  selectedFacility,
  onSelectFacility,
  userLocation,
  circleCenter,
  onSearchArea,
}: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const facilitiesRef = useRef<Facility[]>(facilities);
  const onSelectRef = useRef(onSelectFacility);
  const initializedRef = useRef(false);
  const hasFlownToUser = useRef(false);
  const prevFacilitiesRef = useRef<Facility[]>([]);
  const userLocationRef = useRef(userLocation);
  const [showSearchArea, setShowSearchArea] = useState(false);

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

      // ── 30-mile radius circle ──────────────────────────────────────────────
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
      map.addSource("facilities", {
        type: "geojson",
        data: buildGeoJSON(facilitiesRef.current, userLocationRef.current),
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50,
      });

      // Cluster circles
      map.addLayer({
        id: "clusters",
        type: "circle",
        source: "facilities",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": [
            "step",
            ["get", "point_count"],
            "#E8864A",
            10,
            "#D4693A",
            50,
            "#B8532A",
          ],
          "circle-radius": [
            "step",
            ["get", "point_count"],
            18,
            10,
            24,
            50,
            32,
          ],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });

      // Cluster count text
      map.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "facilities",
        filter: ["has", "point_count"],
        layout: {
          "text-field": "{point_count_abbreviated}",
          "text-font": ["Noto Sans Regular"],
          "text-size": 13,
        },
        paint: { "text-color": "#ffffff" },
      });

      // Individual facility points — opacity driven by isNearby flag
      map.addLayer({
        id: "unclustered-point",
        type: "circle",
        source: "facilities",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": [
            "case",
            ["==", ["get", "isHiring"], true],
            "#E8864A",
            [
              "match",
              ["get", "facilityGroup"],
              "Adult & Senior Care",
              "#D4693A",
              "Child Care",
              "#22c55e",
              "Children's Residential",
              "#a855f7",
              "Home Care",
              "#C25A2E",
              [
                "match",
                ["get", "status"],
                "LICENSED",
                "#22c55e",
                "CLOSED",
                "#ef4444",
                "PENDING",
                "#f59e0b",
                "ON PROBATION",
                "#a855f7",
                "#6b7280",
              ],
            ],
          ],
          "circle-radius": [
            "case",
            ["==", ["get", "isHiring"], true],
            9,
            7,
          ],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
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

      // Unified click handler
      map.on("click", (e) => {
        const clusterFeatures = map.queryRenderedFeatures(e.point, {
          layers: ["clusters"],
        });
        if (clusterFeatures.length > 0) {
          const clusterId = clusterFeatures[0].properties?.cluster_id;
          const source = map.getSource("facilities") as maplibregl.GeoJSONSource;
          if (clusterId !== undefined && source.getClusterExpansionZoom) {
            source
              .getClusterExpansionZoom(clusterId)
              .then((zoom) => {
                const coords = (
                  clusterFeatures[0].geometry as GeoJSON.Point
                ).coordinates as [number, number];
                map.easeTo({ center: coords, zoom: Math.min(zoom, 18), duration: 500 });
              })
              .catch(() => {
                const coords = (
                  clusterFeatures[0].geometry as GeoJSON.Point
                ).coordinates as [number, number];
                map.easeTo({ center: coords, zoom: map.getZoom() + 3, duration: 500 });
              });
          } else {
            const coords = (
              clusterFeatures[0].geometry as GeoJSON.Point
            ).coordinates as [number, number];
            map.easeTo({ center: coords, zoom: map.getZoom() + 3, duration: 500 });
          }
          return;
        }

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
      map.on("mouseenter", "clusters", pointer);
      map.on("mouseleave", "clusters", noPointer);
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
        const hiringBadge = p?.isHiring
          ? `<div style="color:#D4693A;font-weight:700;font-size:11px;margin-top:2px;font-family:'Nunito',sans-serif">★ Hiring · ${p?.jobCount || 0} position${(p?.jobCount || 0) !== 1 ? "s" : ""}</div>`
          : "";
        const typeBadge =
          p?.facilityType && p.facilityType !== "Adult Residential Facility"
            ? `<div style="color:#8b5cf6;font-size:10px;margin-top:1px">${p.facilityType}</div>`
            : "";
        popup
          .setLngLat(coords)
          .setHTML(
            `<div style="font-family:'Nunito',sans-serif;font-size:13px;line-height:1.4">
              <div style="font-weight:600;margin-bottom:2px">${p?.name || ""}</div>
              <div style="color:#6b7280">${p?.city || ""}${p?.county ? ` · ${p.county} Co.` : ""} · Cap: ${p?.capacity || "?"}</div>
              ${typeBadge}
              ${hiringBadge}
            </div>`
          )
          .addTo(map);
      });
      map.on("mouseleave", "unclustered-point", () => popup.remove());

      // Show "Search this area" button when user drags the map
      map.on("dragend", () => setShowSearchArea(true));
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      initializedRef.current = false;
      hasFlownToUser.current = false;
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
        zoom: 10,
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

      {/* "Search this area" floating pill — appears after user drags */}
      {showSearchArea && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
          <button
            className="pointer-events-auto flex items-center gap-2 px-4 py-2 bg-background/95 backdrop-blur-sm rounded-full shadow-lg border border-border/60 text-sm font-medium hover:bg-background transition-colors whitespace-nowrap"
            onClick={() => {
              const center = mapRef.current?.getCenter();
              if (center) onSearchArea(center.lat, center.lng);
              setShowSearchArea(false);
            }}
          >
            <Search className="h-3.5 w-3.5 text-primary" />
            Search this area
          </button>
        </div>
      )}
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
        // true when no user location (no dimming) or within 30 miles
        isNearby: userLocation
          ? haversineDistanceMiles(userLocation.lat, userLocation.lng, f.lat, f.lng) <= 30
          : true,
      },
    })),
  };
}
