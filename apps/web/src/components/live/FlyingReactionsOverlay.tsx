import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

import { FlyingReactionsEngine } from '../../lib/flyingReactions';
import type { ReactionState } from '../../hooks/useLiveSession';

export type FlyingReactionsHandle = {
  /** Optimistic spawn when the local viewer taps a reaction button. */
  spawn: (emoji: string) => void;
};

type Props = {
  reactions: ReactionState;
};

/**
 * Full-screen canvas overlay on the video stage. Reactions drift upward with a
 * slight arc — sampled from 1 Hz SSE deltas so 10k taps/sec never means 10k DOM nodes.
 */
export const FlyingReactionsOverlay = forwardRef<FlyingReactionsHandle, Props>(
  ({ reactions }, ref): JSX.Element => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const engineRef = useRef<FlyingReactionsEngine | null>(null);
    const lastTickRef = useRef(0);
    const reducedMotionRef = useRef(false);

    useImperativeHandle(ref, () => ({
      spawn: (emoji: string) => {
        engineRef.current?.spawn(emoji, 2);
      },
    }));

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return undefined;

      reducedMotionRef.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reducedMotionRef.current) return undefined;

      const engine = new FlyingReactionsEngine(canvas);
      engineRef.current = engine;

      const parent = canvas.parentElement;
      if (!parent) return undefined;

      const resize = (): void => {
        const rect = parent.getBoundingClientRect();
        engine.resize(rect.width, rect.height);
      };

      resize();
      engine.start();

      const observer = new ResizeObserver(resize);
      observer.observe(parent);

      return () => {
        observer.disconnect();
        engine.stop();
        engineRef.current = null;
      };
    }, []);

    useEffect(() => {
      if (reducedMotionRef.current) return;
      if (reactions.tick === lastTickRef.current) return;
      lastTickRef.current = reactions.tick;
      engineRef.current?.ingestDeltas(reactions.deltas);
    }, [reactions]);

    return (
      <canvas
        ref={canvasRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[2] overflow-hidden"
      />
    );
  },
);

FlyingReactionsOverlay.displayName = 'FlyingReactionsOverlay';
