'use client';

import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';

export function VoiceSample({ voice, lang, name }: { voice: string; lang: string; name: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle');
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  const toggle = async () => {
    if (state === 'playing') {
      audio.current?.pause();
      setState('idle');
      return;
    }
    setState('loading');
    try {
      if (!audio.current) audio.current = new Audio();
      audio.current.src = `/api/voice-sample?voice=${encodeURIComponent(voice)}&lang=${encodeURIComponent(lang)}&name=${encodeURIComponent(name)}`;
      audio.current.onended = () => setState('idle');
      await audio.current.play();
      setState('playing');
    } catch {
      setState('idle');
    }
  };
  return (
    <button type="button" onClick={toggle} disabled={state === 'loading'} className="btn btn-quiet btn-sm" aria-label={`Hear ${name}`}>
      {state === 'playing' ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden fill="currentColor" />}
      {state === 'loading' ? 'Loading' : state === 'playing' ? 'Stop' : `Hear ${name}`}
    </button>
  );
}
