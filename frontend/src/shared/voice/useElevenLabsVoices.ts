import { useEffect, useState } from 'react';
import { api } from '../../api/client';

export type ElevenLabsVoice = { voice_id: string; name: string };

export function useElevenLabsVoices(enabled: boolean) {
  const [voices, setVoices] = useState<ElevenLabsVoice[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    api
      .get<{ success: boolean; data: ElevenLabsVoice[] }>('/api/settings/elevenlabs/voices')
      .then((res) => setVoices(res.data ?? []))
      .catch(() => setVoices([]))
      .finally(() => setLoading(false));
  }, [enabled]);

  return { voices, loading };
}
