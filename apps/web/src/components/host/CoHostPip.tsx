import { useEffect, useRef } from 'react';
import type { RemotePublisher } from '../../hooks/useHostBroadcast';
export const CoHostPip = ({ publisher, label, }: {
    publisher: RemotePublisher;
    label: string;
}): JSX.Element => {
    const containerRef = useRef<HTMLDivElement>(null);
    const track = publisher.videoTrack;
    useEffect(() => {
        const element = containerRef.current;
        if (!element || !track)
            return;
        track.play(element, { fit: 'cover' });
        return () => track.stop();
    }, [track]);
    return (<div className="absolute bottom-3 right-3 z-20 w-40 overflow-hidden rounded-ctl border border-line bg-[#101210]">
      <div ref={containerRef} className="aspect-video w-full"/>
      {track === null && (<p className="text-on-video absolute inset-0 flex items-center justify-center px-2 text-center text-14 font-medium">
          {label} is on audio
        </p>)}
      <span className="on-video absolute left-1 top-1 rounded-chip px-1.5 py-0.5 text-14 font-medium">
        {label}
      </span>
    </div>);
};
