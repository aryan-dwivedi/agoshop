import { useEffect, useState } from 'react';

import type { VideoQuality } from '../components/live/VideoStage';

const QUALITY_STORAGE_KEY = 'live.video.quality';

export const useVideoQuality = (): {
  quality: VideoQuality;
  setQuality: (quality: VideoQuality) => void;
  qualityMenuOpen: boolean;
  setQualityMenuOpen: (open: boolean | ((open: boolean) => boolean)) => void;
} => {
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [quality, setQuality] = useState<VideoQuality>(() => {
    const stored = window.localStorage.getItem(QUALITY_STORAGE_KEY);
    return stored === 'low' || stored === 'high' ? stored : 'auto';
  });

  useEffect(() => {
    window.localStorage.setItem(QUALITY_STORAGE_KEY, quality);
  }, [quality]);

  useEffect(() => {
    if (!qualityMenuOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setQualityMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [qualityMenuOpen]);

  return { quality, setQuality, qualityMenuOpen, setQualityMenuOpen };
};
