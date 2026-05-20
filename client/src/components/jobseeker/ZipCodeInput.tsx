// ZipCodeInput — 5-digit ZIP entry + an optional "Use my location"
// button that ONLY validates location permission (it does NOT
// reverse-geocode). Used on the onboarding wizard's LocationStep.
//
// Geolocation behavior shares the 1.5s-hard-timeout + silent-on-denial
// primitive in client/src/lib/geolocation.ts with MapPage. Success sets
// a "Detected in California ✓" confirmation pill; the seeker still
// types their ZIP for the actual stored value.
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MapPin, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { requestGeolocationOnce } from "@/lib/geolocation";

interface ZipCodeInputProps {
  value: string;
  onChange(zip: string): void;
  /**
   * Fires once when the user types the 5th digit (4 → 5 transition).
   * Useful for auto-advancing to the next step without an extra tap.
   */
  onAutoSubmit?(zip: string): void;
  disabled?: boolean;
}

// California bounding box — used to decide whether the resolved
// coordinates count as "in California" for the confirmation pill. Rough
// envelope is plenty: the wizard does not store lat/lng or restrict ZIP.
const CA_BOUNDS = {
  minLat: 32.5,
  maxLat: 42.05,
  minLng: -124.5,
  maxLng: -114.0,
};

function isInCalifornia(lat: number, lng: number): boolean {
  return (
    lat >= CA_BOUNDS.minLat &&
    lat <= CA_BOUNDS.maxLat &&
    lng >= CA_BOUNDS.minLng &&
    lng <= CA_BOUNDS.maxLng
  );
}

export function ZipCodeInput({
  value,
  onChange,
  onAutoSubmit,
  disabled = false,
}: ZipCodeInputProps) {
  const [geoValidated, setGeoValidated] = useState(false);
  const [geoOutOfCa, setGeoOutOfCa] = useState(false);
  const [geoChecking, setGeoChecking] = useState(false);

  // Track the previous length so onAutoSubmit fires EXACTLY ONCE on the
  // 4 → 5 transition — not on every keystroke that leaves length === 5
  // (e.g. paste of a longer string, or backspace+retype).
  const prevLenRef = useRef(value.length);
  useEffect(() => {
    const prev = prevLenRef.current;
    if (prev < 5 && value.length === 5 && onAutoSubmit) {
      onAutoSubmit(value);
    }
    prevLenRef.current = value.length;
  }, [value, onAutoSubmit]);

  const handleChange = (raw: string) => {
    // Strip non-digits, hard-cap at 5 — matches the maxLength on the
    // input but defends against paste / IME quirks.
    const digits = raw.replace(/\D/g, "").slice(0, 5);
    onChange(digits);
  };

  const handleUseMyLocation = async () => {
    if (disabled) return;
    setGeoChecking(true);
    const coords = await requestGeolocationOnce();
    setGeoChecking(false);
    if (!coords) {
      // Permission denied, timeout, or unavailable — silent per spec.
      return;
    }
    if (isInCalifornia(coords.latitude, coords.longitude)) {
      setGeoValidated(true);
      setGeoOutOfCa(false);
    } else {
      // Out-of-CA — show a soft hint instead of the green pill, but
      // do NOT block the user; they can still type any ZIP.
      setGeoValidated(false);
      setGeoOutOfCa(true);
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="onboarding-zip">ZIP code</Label>
        <Input
          id="onboarding-zip"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={5}
          autoComplete="postal-code"
          placeholder="95814"
          value={value}
          disabled={disabled}
          onChange={(e) => handleChange(e.target.value)}
          className="text-lg tracking-wider"
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleUseMyLocation}
          disabled={disabled || geoChecking}
          aria-label="Use my current location to confirm I'm in California"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
            "bg-white text-indigo-700 border-indigo-200 hover:bg-indigo-50",
            (disabled || geoChecking) && "opacity-50 cursor-not-allowed",
          )}
        >
          <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
          {geoChecking ? "Checking…" : "Use my location"}
        </button>

        {geoValidated && (
          <span
            className="inline-flex items-center gap-1 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200 px-2.5 py-1 text-xs font-medium"
            role="status"
          >
            <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
            Detected in California
          </span>
        )}

        {geoOutOfCa && (
          <span className="text-xs text-stone-500">
            Couldn't confirm California — type your ZIP to continue.
          </span>
        )}
      </div>
    </div>
  );
}

export default ZipCodeInput;
