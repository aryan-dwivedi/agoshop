import { useEffect, useRef, useState } from 'react';

import type { LiveSessionDto } from '@shop/shared';

/**
 * The still frame a storefront tile shows for a session that is on air.
 *
 * Tiles deliberately do NOT play. A page listing four live rooms was starting four
 * decoders and, because autoplay was attempted unmuted first, whichever one the
 * browser allowed spoke over the others. A listing's job is to say "this is on air",
 * and one frame says it: no motion, no audio, no second copy of the stream, and
 * nothing for a viewer to mute. Sound belongs to the room the viewer chose to enter,
 * and even there it starts muted.
 *
 * The session's own cover art wins when it has any. It is a still of the same show —
 * the fixture generator cuts it out of that room's clip — so decoding a video to
 * produce a second, worse copy of a picture we already have buys nothing and costs a
 * media element per tile. The video frame is the FALLBACK, for a room whose seller
 * never uploaded cover art: that room still gets a real thumbnail instead of a
 * placeholder. `preload="metadata"` fetches enough to decode frame one and then stops.
 */

type Props = {
  session: LiveSessionDto;
  variant: 'hero' | 'tile';
  className?: string;
  /**
   * Fires once whatever this tile ended up showing — cover art or the decoded video
   * frame — is actually painted, so a caller can settle its scrim against a picture
   * rather than against a bare surface.
   */
  onFrameReady?: (ready: boolean) => void;
};

/**
 * Only the mp4 fixture can yield a frame without a streaming library attached; an
 * HLS-only session with no cover art falls back to the host-name placeholder rather
 * than pulling in hls.js to decode a single picture.
 */
const frameUrl = (session: LiveSessionDto): string | null => {
  if (session.status !== 'live') return null;
  const source = session.liveSourceUrl;
  return source !== null && !source.endsWith('.m3u8') ? source : null;
};

export const LivePreviewMedia = ({
  session,
  variant,
  className,
  onFrameReady,
}: Props): JSX.Element => {
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
    if (!showFrame) return;
    const video = videoRef.current;
    if (!video) return;

    setMediaReady(false);

    /**
     * Chrome paints frame one on metadata alone; Safari needs the explicit seek. The
     * assignment is therefore unconditional and `seeked` is what confirms a picture
     * is actually on screen in both.
     */
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

  return (
    <div className={`relative h-full w-full overflow-hidden ${className ?? ''}`}>
      {/*
       * Cover art is the whole picture when the session has any: it is a still of this
       * same show, so there is nothing a decoded frame would add. The placeholder
       * underneath only ever shows for a room with neither cover art nor an mp4 feed.
       */}
      {poster !== null ? (
        <img
          src={poster}
          alt={session.title}
          onLoad={() => setMediaReady(true)}
          className={`absolute inset-0 h-full w-full object-cover transition-transform ${
            variant === 'hero'
              ? 'duration-500 group-hover:scale-[1.03]'
              : 'duration-300 group-hover:scale-105'
          }`}
          loading={variant === 'tile' ? 'lazy' : undefined}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-surface text-14 font-semibold text-t2">
          {session.hostName}
        </div>
      )}

      {showFrame && (
        <video
          ref={videoRef}
          // Never plays and never has a soundtrack: muted and preload-metadata are
          // what keep this a picture rather than a second copy of the broadcast.
          muted
          playsInline
          preload="metadata"
          tabIndex={-1}
          aria-hidden
          className={`pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${
            mediaReady ? 'opacity-100' : 'opacity-0'
          } ${variant === 'hero' ? 'group-hover:scale-[1.03]' : 'group-hover:scale-105'}`}
        />
      )}
    </div>
  );
};

/** Static cover for scheduled/ended sessions — same sizing as the preview player. */
export const SessionCoverImage = ({
  session,
  variant,
  className,
}: {
  session: LiveSessionDto;
  variant: 'hero' | 'tile';
  className?: string;
}): JSX.Element => {
  const hoverScale =
    variant === 'hero'
      ? 'group-hover:scale-[1.03] transition duration-500'
      : 'group-hover:scale-105 transition duration-300';

  if (session.coverImageUrl) {
    return (
      <img
        src={session.coverImageUrl}
        alt={session.title}
        className={`h-full w-full object-cover ${hoverScale} ${className ?? ''}`}
        loading={variant === 'tile' ? 'lazy' : undefined}
      />
    );
  }

  return (
    <div
      className={`flex h-full w-full items-center justify-center bg-surface text-14 font-semibold text-t2 ${className ?? ''}`}
    >
      {session.hostName}
    </div>
  );
};
