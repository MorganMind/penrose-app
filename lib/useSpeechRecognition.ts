"use client";

import { useState, useCallback, useEffect, useRef } from "react";

type SpeechRecognitionStatus = "idle" | "listening" | "unsupported";

/* eslint-disable @typescript-eslint/no-explicit-any */
interface SpeechRecognitionInstance {
  start: () => void;
  stop: () => void;
  abort: () => void;
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: (e: any) => void;
  onerror: (e: any) => void;
  onend: () => void;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Web Speech API hook for live transcription.
 * Streams transcribed text into the textarea.
 */
export function useSpeechRecognition({
  onTranscript,
  onActivation,
}: {
  onTranscript: (text: string, isFinal: boolean) => void;
  onActivation?: () => void;
}) {
  const [status, setStatus] = useState<SpeechRecognitionStatus>("idle");
  const [recognition, setRecognition] = useState<SpeechRecognitionInstance | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  const onActivationRef = useRef(onActivation);
  onTranscriptRef.current = onTranscript;
  onActivationRef.current = onActivation;

  useEffect(() => {
    if (typeof window === "undefined") return;

    const win = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionInstance; webkitSpeechRecognition?: new () => SpeechRecognitionInstance };
    const SpeechRecognitionAPI = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      setStatus("unsupported");
      return;
    }

    const rec = new SpeechRecognitionAPI() as SpeechRecognitionInstance;
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";

    rec.onresult = (event: { resultIndex: number; results: Array<{ isFinal: boolean; 0: { transcript: string } }> }) => {
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript;
        if (result.isFinal) {
          finalText += text;
        } else {
          interimText += text;
        }
      }
      if (finalText) onTranscriptRef.current(finalText, true);
      if (interimText) onTranscriptRef.current(interimText, false);
    };

    rec.onerror = (event: { error?: string }) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      setStatus("idle");
    };

    rec.onend = () => setStatus("idle");

    setRecognition(rec);
    return () => {
      try {
        rec.abort();
      } catch {
        // ignore
      }
    };
  }, []);

  const start = useCallback(() => {
    if (!recognition || status === "unsupported") return;
    if (status === "listening") {
      recognition.stop();
      return;
    }
    onActivation?.();
    recognition.start();
    setStatus("listening");
  }, [recognition, status, onActivation]);

  const stop = useCallback(() => {
    if (recognition && status === "listening") {
      recognition.stop();
      setStatus("idle");
    }
  }, [recognition, status]);

  return { start, stop, status, isSupported: status !== "unsupported" };
}
