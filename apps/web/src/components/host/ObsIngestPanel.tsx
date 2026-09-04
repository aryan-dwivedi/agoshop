import { Check, Copy } from 'lucide-react';
import { useCallback, useState } from 'react';
export type ObsIngestDto = {
    rtmpServer: string;
    streamKey: string;
    uid: number;
    channel: string;
    expiresAfter: number;
};
const copyText = async (label: string, value: string): Promise<void> => {
    await navigator.clipboard.writeText(value);
};
export const ObsIngestPanel = ({ ingest, connected, }: {
    ingest: ObsIngestDto | null;
    connected: boolean;
}): JSX.Element => {
    const [copied, setCopied] = useState<'server' | 'key' | null>(null);
    const onCopy = useCallback(async (which: 'server' | 'key', value: string) => {
        await copyText(which, value);
        setCopied(which);
        window.setTimeout(() => setCopied(null), 2000);
    }, []);
    if (ingest === null) {
        return (<div className="absolute inset-0 z-20 flex items-center justify-center bg-bg/90 p-6 text-center">
        <p className="text-14 text-t2">Preparing OBS credentials…</p>
      </div>);
    }
    return (<div className="absolute inset-0 z-20 flex flex-col justify-end bg-gradient-to-t from-bg via-bg/80 to-transparent p-4">
      <div className="rounded-panel border border-line bg-bg p-4 shadow-e1">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-14 font-semibold text-t1">OBS / RTMP ingest</h3>
          <span className={`rounded-chip px-2 py-0.5 text-12 font-medium ${connected ? 'bg-success/15 text-success' : 'bg-accent/15 text-accent'}`}>
            {connected ? 'Feed connected' : 'Waiting for OBS…'}
          </span>
        </div>

        <dl className="mt-3 space-y-2 text-13">
          <div>
            <dt className="text-t3">Server</dt>
            <dd className="mt-0.5 flex items-center gap-2">
              <code className="tnum min-w-0 flex-1 truncate text-12 text-t1">{ingest.rtmpServer}</code>
              <button type="button" className="btn-quiet btn-xs shrink-0" onClick={() => void onCopy('server', ingest.rtmpServer)}>
                {copied === 'server' ? (<Check className="h-3.5 w-3.5" strokeWidth={1.8}/>) : (<Copy className="h-3.5 w-3.5" strokeWidth={1.8}/>)}
              </button>
            </dd>
          </div>
          <div>
            <dt className="text-t3">Stream key</dt>
            <dd className="mt-0.5 flex items-center gap-2">
              <code className="tnum min-w-0 flex-1 truncate text-12 text-t1">{ingest.streamKey}</code>
              <button type="button" className="btn-quiet btn-xs shrink-0" onClick={() => void onCopy('key', ingest.streamKey)}>
                {copied === 'key' ? (<Check className="h-3.5 w-3.5" strokeWidth={1.8}/>) : (<Copy className="h-3.5 w-3.5" strokeWidth={1.8}/>)}
              </button>
            </dd>
          </div>
          <div className="text-t3">
            Host uid <span className="tnum text-t2">{ingest.uid}</span> · channel{' '}
            <span className="text-t2">{ingest.channel}</span>
          </div>
        </dl>

        <p className="mt-3 text-12 text-t3">
          In OBS: Settings → Output → keyframe interval 2s, profile baseline, 30 fps. Replay
          capture is not recorded for OBS shows in this prototype.
        </p>
      </div>
    </div>);
};
