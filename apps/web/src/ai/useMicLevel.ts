import type { ILocalAudioTrack } from 'agora-rtc-sdk-ng';
import { useEffect, useState } from 'react';

/**
 * The mic level, for the composer's three-bar meter.
 *
 * A pulsing ring is decoration; a level meter is feedback — it proves the microphone
 * is actually picking the shopper up, which is the one thing a voice UI must show.
 * The value is the track's own RMS, sampled at ~30fps and quantised to 20 steps so a
 * silent room does not re-render three divs sixty times a second.
 *
 * `null` means there is no track to measure (browser dictation owns the mic, or the
 * SDK build exposes no level): the caller draws a static filled mic rather than a
 * fake animation.
 */
export const useMicLevel = (track: ILocalAudioTrack | null): number | null => {
  const [level, setLevel] = useState<number | null>(null);

  useEffect(() => {
    if (!track || typeof track.getVolumeLevel !== 'function') {
      setLevel(null);
      return undefined;
    }
    let frame = 0;
    let last = 0;
    const tick = (now: number): void => {
      frame = window.requestAnimationFrame(tick);
      if (now - last < 33) return;
      last = now;
      const next = Math.round(track.getVolumeLevel() * 20) / 20;
      setLevel((current) => (current === next ? current : next));
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [track]);

  return level;
};
