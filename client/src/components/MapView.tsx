import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { Facility } from "@shared/schema";

interface MapViewProps {
  facilities: Facility[];
  selectedFacility: Facility | null;
  onSelectFacility: (facility: Facility) => void;
}

export function MapView({ facilities, selectedFacility, onSelectFacility }: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const facilitiesRef = useRef<Facility[]>(facilities);
  const onSelectRef = useRef(onSelectFacility);
  const initializedRef = useRef(false);

  onSelectRef.current = onSelectFacility;
  facilitiesRef.current = facilities;

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

      map.addSource("facilities", {
        type: "geojson",
        data: buildGeoJSON(facilitiesRef.current),
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
            "step", ["get", "point_count"],
            "#E8864A", 10,
            "#D4693A", 50,
            "#B8532A",
          ],
          "circle-radius": [
            "step", ["get", "point_count"],
            18, 10, 24, 50, 32,
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

      // Individual facility points — hiring = blue, others by facility group
      map.addLayer({
        id: "unclustered-point",
        type: "circle",
        source: "facilities",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": [
            "case",
            ["==", ["get", "isHiring"], true], "#E8864A",
            ["match", ["get", "facilityGroup"],
              "Adult & Senior Care", "#D4693A",
              "Child Care", "#22c55e",
              "Children's Residential", "#a855f7",
              "Home Care", "#C25A2E",
              ["match", ["get", "status"],
                "LICENSED", "#22c55e",
                "CLOSED", "#ef4444",
                "PENDING", "#f59e0b",
                "ON PROBATION", "#a855f7",
                "#6b7280"
              ],
            ],
          ],
          "circle-radius": [
            "case",
            ["==", ["get", "isHiring"], true], 9,
            7,
          ],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });

      // Hiring badge icon layer — small pulsing ring around hiring facilities
      map.addLayer({
        id: "hiring-ring",
        type: "circle",
        source: "facilities",
        filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "isHiring"], true]],
        paint: {
          "circle-color": "transparent",
          "circle-radius": 14,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#E8864A",
          "circle-stroke-opacity": 0.4,
        },
      });

      // Unified click handler for clusters and individual points
      map.on("click", (e) => {
        // Check for cluster clicks first
        const clusterFeatures = map.queryRenderedFeatures(e.point, { layers: ["clusters"] });
        if (clusterFeatures.length > 0) {
          const clusterId = clusterFeatures[0].properties?.cluster_id;
          const source = map.getSource("facilities") as maplibregl.GeoJSONSource;
          if (clusterId !== undefined && source.getClusterExpansionZoom) {
            source.getClusterExpansionZoom(clusterId).then((zoom) => {
              const coords = (clusterFeatures[0].geometry as GeoJSON.Point).coordinates as [number, number];
              map.easeTo({ center: coords, zoom: Math.min(zoom, 18), duration: 500 });
            }).catch(() => {
              // Fallback: zoom +3
              const coords = (clusterFeatures[0].geometry as GeoJSON.Point).coordinates as [number, number];
              map.easeTo({ center: coords, zoom: map.getZoom() + 3, duration: 500 });
            });
          } else {
            const coords = (clusterFeatures[0].geometry as GeoJSON.Point).coordinates as [number, number];
            map.easeTo({ center: coords, zoom: map.getZoom() + 3, duration: 500 });
          }
          return;
        }

        // Check for individual point clicks (including hiring ring)
        const pointFeatures = map.queryRenderedFeatures(e.point, { layers: ["unclustered-point", "hiring-ring"] });
        if (pointFeatures.length > 0) {
          const props = pointFeatures[0].properties;
          const facility = facilitiesRef.current.find((f) => f.number === props?.number);
          if (facility) {
            onSelectRef.current(facility);
          }
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

      // Tooltip on hover
      const popup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 12,
        className: "facility-tooltip",
      });

      map.on("mouseenter", "unclustered-point", (e) => {
        if (!e.features?.[0]) return;
        const coords = (e.features[0].geometry as GeoJSON.Point).coordinates.slice() as [number, number];
        const p = e.features[0].properties;
        const hiringBadge = p?.isHiring ? `<div style="color:#D4693A;font-weight:700;font-size:11px;margin-top:2px;font-family:'Nunito',sans-serif">★ Hiring · ${p?.jobCount || 0} position${(p?.jobCount || 0) !== 1 ? 's' : ''}</div>` : '';
        const typeBadge = p?.facilityType && p.facilityType !== "Adult Residential Facility"
          ? `<div style="color:#8b5cf6;font-size:10px;margin-top:1px">${p.facilityType}</div>` : '';
        popup.setLngLat(coords).setHTML(`
          <div style="font-family:'Nunito',sans-serif;font-size:13px;line-height:1.4">
            <div style="font-weight:600;margin-bottom:2px">${p?.name || ""}</div>
            <div style="color:#6b7280">${p?.city || ""}${p?.county ? ` · ${p.county} Co.` : ""} · Cap: ${p?.capacity || "?"}</div>
            ${typeBadge}
            ${hiringBadge}
          </div>
        `).addTo(map);
      });
      map.on("mouseleave", "unclustered-point", () => popup.remove());
    });

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; initializedRef.current = false; };
  }, []);

  // Update data when facilities change & fit bounds
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !initializedRef.current) return;

    const update = () => {
      const source = map.getSource("facilities") as maplibregl.GeoJSONSource;
      if (!source) return;
      source.setData(buildGeoJSON(facilities));

      // Fit bounds to filtered data
      if (facilities.length > 0 && facilities.length < 10000) {
        const bounds = new maplibregl.LngLatBounds();
        facilities.forEach((f) => bounds.extend([f.lng, f.lat]));
        map.fitBounds(bounds, { padding: 80, maxZoom: 15, duration: 600 });
      }
    };

    if (map.isStyleLoaded()) {
      update();
    } else {
      map.once("load", update);
    }
  }, [facilities]);

  // Fly to selected facility — use a one-shot upward offset so the pin appears
  // in the visible upper portion of the map above the bottom sheet.
  // `offset` is not persisted by MapLibre, so it won't distort later interactions.
  useEffect(() => {
    if (!selectedFacility || !mapRef.current) return;
    // Positive Y offset pushes the viewport center below the target,
    // making the pin appear above center — clear of the bottom sheet (~72vh).
    const upwardOffset = Math.floor(window.innerHeight * 0.15);
    mapRef.current.easeTo({
      center: [selectedFacility.lng, selectedFacility.lat],
      zoom: Math.max(mapRef.current.getZoom(), 15),
      offset: [0, upwardOffset],
      duration: 700,
    });
  }, [selectedFacility]);

  return (
    <div ref={mapContainer} className="absolute inset-0" data-testid="map-container">
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

function buildGeoJSON(facilities: Facility[]): GeoJSON.FeatureCollection {
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
      },
    })),
  };
}
