import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { LiveSessionDto } from '@shop/shared';
import type { useHostBroadcast } from '../../hooks/useHostBroadcast';
import type { StreamHealth } from '../../hooks/useStreamHealth';
import { HoldToConfirm } from '../HoldToConfirm';
import { CaptionOverlay } from '../live/CaptionOverlay';
import { HealthRibbon, monitorInsetShadow } from '../live/HealthRibbon';
import { AUDIO_ONLY_AFTER_S } from './constants';
import { CoHostPip } from './CoHostPip';
import { ObsIngestPanel } from './ObsIngestPanel';
type Broadcast = ReturnType<typeof useHostBroadcast>;
export const BroadcastMonitor = ({ session, broadcast, health, publishing, reconnecting, disconnected, captionsVisible, consent, onConsentChange, canGoLive, isLive, viewersLabel, previewRef, stageRef, monitorWidth, aspect, ribbonExpanded, reconnectSeconds, onStartPreview, onEndSession, isOwner = true, }: {
    session: LiveSessionDto;
    broadcast: Broadcast;
    health: StreamHealth;
    publishing: boolean;
    reconnecting: boolean;
    disconnected: boolean;
    captionsVisible: boolean;
    consent: boolean;
    onConsentChange: (consent: boolean) => void;
    canGoLive: boolean;
    isLive: boolean;
    viewersLabel: string;
    previewRef: React.RefObject<HTMLDivElement>;
    stageRef: React.RefObject<HTMLDivElement>;
    monitorWidth: number | null;
    aspect: number;
    ribbonExpanded: boolean;
    reconnectSeconds: number;
    onStartPreview: () => void;
    onEndSession: () => void;
    isOwner?: boolean;
}): JSX.Element => {
    const inset = useMemo(() => monitorInsetShadow(health.state), [health.state]);
    const { source } = broadcast;
    return (<div ref={stageRef} className="flex min-h-0 flex-1 items-center justify-center p-2">
      <div className="flex max-h-full flex-col" style={{ width: monitorWidth === null ? '100%' : `${monitorWidth}px` }}>
        <div className="relative overflow-hidden rounded-t-panel bg-[#101210]" style={{ aspectRatio: aspect, boxShadow: inset }}>
          <div ref={previewRef} className={`h-full w-full transition-opacity duration-ctl ${reconnecting ? 'opacity-60' : ''}`}/>

          <CaptionOverlay captions={broadcast.captions} enabled={captionsVisible && broadcast.captions.length > 0}/>

          {broadcast.remotePublishers.map((publisher) => (<CoHostPip key={publisher.uid} publisher={publisher} label={session.coHostName ?? 'Co-host'}/>))}

          {source === 'obs' && (broadcast.state === 'live' || broadcast.state === 'starting') && (<ObsIngestPanel ingest={broadcast.obsIngest} connected={broadcast.obsFeedConnected}/>)}

          {!broadcast.videoPublished && publishing && !disconnected && source !== 'obs' && (<p className="on-video absolute left-3 top-3 z-20 rounded-chip px-2 py-1 text-14 font-medium">
              Audio only — viewers hear you
            </p>)}

          {(broadcast.state === 'idle' || broadcast.state === 'error') && (<div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-bg p-6 text-center">
              <p className="max-w-md text-14 text-t2">
                {broadcast.error ??
                (source === 'obs'
                    ? 'Configure OBS with the credentials shown after you go live.'
                    : source === 'file'
                        ? 'Load the video feed to check framing before you publish.'
                        : 'Start the camera to check framing and sound before you publish.')}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                {source !== 'obs' && (<button type="button" className="btn-commit" onClick={onStartPreview}>
                    {source === 'file' ? 'Load the feed' : 'Start camera'}
                  </button>)}
                {source === 'obs' && (<button type="button" className="btn-commit" onClick={onStartPreview}>
                    Prepare OBS ingest
                  </button>)}
                {isOwner && (<Link to={`/live/${session.slug}/preflight`} className="btn-standard">
                    Run pre-flight
                  </Link>)}
              </div>
            </div>)}

          {broadcast.state === 'preview' && (<div className="scrim-bottom absolute inset-x-0 bottom-0 z-30 flex flex-wrap items-end justify-between gap-3 p-3">
              <div className="flex flex-col gap-2">
                <span className="on-video rounded-chip px-2 py-1 text-14 font-medium">
                  {isLive
                ? source === 'obs'
                    ? 'Live — waiting for OBS'
                    : 'Live — your camera is not on air yet'
                : 'Not on air'}
                </span>
                {!consent && (<label className="on-video flex max-w-md items-start gap-2 rounded-ctl px-3 py-2 text-14 font-medium">
                    <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[color:var(--accent)]" checked={consent} onChange={(event) => onConsentChange(event.target.checked)}/>
                    This show is recorded and published as a replay. Viewers are told on join.
                  </label>)}
              </div>
              <HoldToConfirm label="Hold to go live" subLabel={consent ? 'Viewers see you at once' : undefined} className="btn-commit btn-lg" disabled={!canGoLive} onConfirm={() => void broadcast.goLive()}/>
            </div>)}

          {broadcast.state === 'starting' && (<p className="on-video absolute inset-x-0 bottom-3 z-30 mx-auto w-fit rounded-chip px-3 py-1.5 text-14 font-medium">
              Going on air…
            </p>)}

          {reconnecting && (<div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 p-4 text-center">
              <p className="on-video rounded-ctl px-4 py-2 text-16 font-medium">
                Reconnecting — viewers are seeing the standby feed
              </p>
              <p className="on-video tnum rounded-chip px-2 py-1 text-14 font-medium">
                {reconnectSeconds}s
              </p>
              {reconnectSeconds >= AUDIO_ONLY_AFTER_S && broadcast.videoPublished && (<button type="button" className="btn-standard on-video" onClick={() => void broadcast.publishVideo(false)}>
                  Audio only
                </button>)}
            </div>)}

          {disconnected && (<div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-bg p-6 text-center">
              <p className="text-19 font-semibold text-t1">Your camera dropped off air.</p>
              <p className="max-w-md text-14 text-t2">
                The show is still live for viewers — they are watching the standby feed. Rejoin to
                put your camera back on it.
              </p>
              <div className="flex flex-wrap items-start justify-center gap-2">
                <button type="button" className="btn-commit btn-lg" onClick={() => void broadcast.rejoin()}>
                  Rejoin
                </button>
                {isOwner && (<HoldToConfirm label="Hold to end the show" subLabel={viewersLabel} onConfirm={() => void onEndSession()}/>)}
              </div>
              {broadcast.error !== null && <p className="text-14 text-danger">{broadcast.error}</p>}
            </div>)}
        </div>

        <HealthRibbon health={health} expanded={ribbonExpanded} className="w-full"/>
      </div>
    </div>);
};
