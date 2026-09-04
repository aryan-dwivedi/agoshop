import type { ILocalAudioTrack } from 'agora-rtc-sdk-ng';

import { useEffect, useState } from 'react';

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
