import { useEffect, useRef, useState } from 'react';
import type { LiveSessionDto } from '@shop/shared';
type Props = {
    session: LiveSessionDto;
    variant: 'hero' | 'tile';
    className?: string;
    onFrameReady?: (ready: boolean) => void;
};
const frameUrl = (session: LiveSessionDto): string | null => {
    if (session.status !== 'live')
        return null;
    const source = session.liveSourceUrl;
    return source !== null && !source.endsWith('.m3u8') ? source : null;
};
export const LivePreviewMedia = ({ session, variant, className, onFrameReady, }: Props): JSX.Element => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [mediaReady, setMediaReady] = useState(false);
    const [failed, setFailed] = useState(false);
    const url = frameUrl(session);
    const poster = session.coverImageUrl;
    const showFrame = poster === null && url !== null && !failed;
    useEffect(() => {
        onFrameReady?.(mediaReady);
    }, [mediaReady, onFrameReady]);
    useEffect(() => {
        if (!showFrame)
            return;
        const video = videoRef.current;
        if (!video)
            return;
        setMediaReady(false);
        const onLoadedMetadata = (): void => {
            video.currentTime = 0;
        };
        const onSeeked = (): void => setMediaReady(true);
        const onError = (): void => setFailed(true);
        video.addEventListener('loadedmetadata', onLoadedMetadata);
        video.addEventListener('seeked', onSeeked);
        video.addEventListener('error', onError);
        video.src = url;
        return () => {
            video.removeEventListener('loadedmetadata', onLoadedMetadata);
            video.removeEventListener('seeked', onSeeked);
            video.removeEventListener('error', onError);
        };
    }, [showFrame, url]);
    return (<div className={`relative h-full w-full overflow-hidden ${className ?? ''}`}>

      {poster !== null ? (<img src={poster} alt={session.title} onLoad={() => setMediaReady(true)} className={`absolute inset-0 h-full w-full object-cover transition-transform ${variant === 'hero'
                ? 'duration-500 group-hover:scale-[1.03]'
                : 'duration-300 group-hover:scale-105'}`} loading={variant === 'tile' ? 'lazy' : undefined}/>) : (<div className="absolute inset-0 flex items-center justify-center bg-surface text-14 font-semibold text-t2">
          {session.hostName}
        </div>)}

      {showFrame && (<video ref={videoRef} muted playsInline preload="metadata" tabIndex={-1} aria-hidden className={`pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${mediaReady ? 'opacity-100' : 'opacity-0'} ${variant === 'hero' ? 'group-hover:scale-[1.03]' : 'group-hover:scale-105'}`}/>)}
    </div>);
};
export const SessionCoverImage = ({ session, variant, className, }: {
    session: LiveSessionDto;
    variant: 'hero' | 'tile';
    className?: string;
}): JSX.Element => {
    const hoverScale = variant === 'hero'
        ? 'group-hover:scale-[1.03] transition duration-500'
        : 'group-hover:scale-105 transition duration-300';
    if (session.coverImageUrl) {
        return (<img src={session.coverImageUrl} alt={session.title} className={`h-full w-full object-cover ${hoverScale} ${className ?? ''}`} loading={variant === 'tile' ? 'lazy' : undefined}/>);
    }
    return (<div className={`flex h-full w-full items-center justify-center bg-surface text-14 font-semibold text-t2 ${className ?? ''}`}>
      {session.hostName}
    </div>);
};
