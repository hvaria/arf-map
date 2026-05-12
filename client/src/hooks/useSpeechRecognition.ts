import { useCallback, useEffect, useRef, useState } from "react";

// Web Speech API has no DOM lib types in TS yet. We declare the minimum surface
// we use here and keep all `any` casts isolated to this file.
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
};

interface SpeechRecognitionResultEvent {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
}

interface SpeechRecognitionErrorEvent {
  error: string;
  message?: string;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface UseSpeechRecognitionOptions {
  lang?: string;
  continuous?: boolean;
  interimResults?: boolean;
  onFinal?: (text: string) => void;
}

export interface UseSpeechRecognitionReturn {
  supported: boolean;
  listening: boolean;
  interimText: string;
  error: string | null;
  start: () => void;
  stop: () => void;
  reset: () => void;
}

/**
 * Thin wrapper over the browser Web Speech API.
 *
 * Notes:
 * - Unsupported on iOS Safari / Capacitor WKWebView in practice — callers must
 *   render a text fallback when `supported` is false.
 * - One-shot mode (`continuous: false`) is the right default for Q&A flows:
 *   recognition auto-ends after the speaker pauses, which fires `onFinal` once.
 */
export function useSpeechRecognition(
  opts: UseSpeechRecognitionOptions = {},
): UseSpeechRecognitionReturn {
  const { lang = "en-US", continuous = false, interimResults = true, onFinal } = opts;
  const ctor = getCtor();
  const supported = ctor != null;

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const [listening, setListening] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onFinalRef = useRef(onFinal);
  useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);

  useEffect(() => {
    if (!ctor) return;
    const rec = new ctor();
    rec.lang = lang;
    rec.continuous = continuous;
    rec.interimResults = interimResults;
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (interim) setInterimText(interim);
      if (final) {
        const trimmed = final.trim();
        setInterimText("");
        onFinalRef.current?.(trimmed);
      }
    };
    rec.onerror = (event) => {
      setError(event.error || "speech-error");
      setListening(false);
      setInterimText("");
    };
    rec.onend = () => {
      setListening(false);
      setInterimText("");
    };

    recRef.current = rec;
    return () => {
      try {
        rec.abort();
      } catch {
        // recognition may already be inactive
      }
      recRef.current = null;
    };
  }, [ctor, lang, continuous, interimResults]);

  const start = useCallback(() => {
    const rec = recRef.current;
    if (!rec || listening) return;
    setError(null);
    setInterimText("");
    try {
      rec.start();
      setListening(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "start-failed");
    }
  }, [listening]);

  const stop = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;
    try {
      rec.stop();
    } catch {
      // ignore if already stopped
    }
  }, []);

  const reset = useCallback(() => {
    setInterimText("");
    setError(null);
  }, []);

  return { supported, listening, interimText, error, start, stop, reset };
}
