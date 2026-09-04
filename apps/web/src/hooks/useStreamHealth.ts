import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConnectionState, IAgoraRTCClient, NetworkQuality } from 'agora-rtc-sdk-ng';

/**
 * Publish-side telemetry, sampled once a second off the client that is already
 * publishing.
 *
 * The seller has about two seconds of attention and is looking at a lens, not at a
 * number — so everything here collapses to three states with two-word labels. The
 * raw values are still returned because the pre-flight screen has room to show a
 * measurement, and because a number nobody has to parse is cheaper than a number
 * that is wrong.
 *
 * Cost discipline: one interval, two listeners, no per-frame work. Both stats getters
 * are synchronous reads of the SDK's own WebRTC-Stats snapshot, so a tick is a few
 * property lookups and one `setState`.
 */

export type StreamHealthState = 'unknown' | 'good' | 'strain' | 'bad';

/**
 * The history is a plain `number[]` so the ribbon can render 60 cells without
 * allocating 60 strings a second. Ordered by severity, which is what `worse()` uses.
 */
export const HEALTH_CODE: Record<StreamHealthState, number> = {
  unknown: 0,
  good: 1,
  strain: 2,
  bad: 3,
};

export const HEALTH_STATE_BY_CODE: readonly StreamHealthState[] = [
  'unknown',
  'good',
  'strain',
  'bad',
];

/** Two words, because the seller reads this out of the corner of their eye. */
export const HEALTH_LABEL: Record<StreamHealthState, string> = {
  unknown: 'Uplink idle',
  good: 'Uplink good',
  strain: 'Uplink weak',
  bad: 'Losing connection',
};

export type StreamHealth = {
  state: StreamHealthState;
  /** Last 60 one-second samples, oldest first. Codes, not states — see `HEALTH_CODE`. */
  history: number[];
  bitrateKbps: number | null;
  rttMs: number | null;
  /** Send-side packet loss as a percentage, already multiplied out for display. */
  lossPct: number | null;
  /** 0 is "not measured yet"; 1 is excellent and 6 is disconnected. */
  uplink: number;
  connectionState: ConnectionState;
  label: string;
};

/** One second, and exactly 60 of them on screen: a minute of history at a glance. */
const SAMPLE_MS = 1000;
const HISTORY_CELLS = 60;

/** Thresholds are the design's, not the SDK's: bitrate against its own target. */
const RATIO_GOOD = 0.8;
const RATIO_STRAIN = 0.5;
const LOSS_GOOD = 0.02;
const LOSS_STRAIN = 0.08;
const UPLINK_GOOD = 2;
const UPLINK_STRAIN = 4;

type Sample = {
  code: number;
  bitrateKbps: number | null;
  rttMs: number | null;
  lossPct: number | null;
  uplink: number;
  history: number[];
  /** Zero means nothing has been measured, which is not the same as "good". */
  taken: number;
};

const EMPTY: Sample = {
  code: HEALTH_CODE.unknown,
  bitrateKbps: null,
  rttMs: null,
  lossPct: null,
  uplink: 0,
  history: [],
  taken: 0,
};

const worse = (a: number, b: number): number => (a > b ? a : b);

/**
 * Every metric grades itself, and the worst grade wins. A metric that has not
 * reported yet abstains rather than voting "good" — a green ribbon nobody measured
 * is the one failure mode this screen cannot afford.
 */
const grade = (opts: {
  sendBitrate: number;
  targetSendBitrate: number;
  loss: number;
  uplink: number;
}): number => {
  const { sendBitrate, targetSendBitrate, loss, uplink } = opts;
  if (targetSendBitrate <= 0 && sendBitrate <= 0 && uplink === 0) return HEALTH_CODE.unknown;

  let code = HEALTH_CODE.good;
  if (targetSendBitrate > 0) {
    const ratio = sendBitrate / targetSendBitrate;
    code = worse(
      code,
      ratio >= RATIO_GOOD
        ? HEALTH_CODE.good
        : ratio >= RATIO_STRAIN
          ? HEALTH_CODE.strain
          : HEALTH_CODE.bad,
    );
  }
  if (Number.isFinite(loss)) {
    code = worse(
      code,
      loss < LOSS_GOOD
        ? HEALTH_CODE.good
        : loss < LOSS_STRAIN
          ? HEALTH_CODE.strain
          : HEALTH_CODE.bad,
    );
  }
  if (uplink > 0) {
    code = worse(
      code,
      uplink <= UPLINK_GOOD
        ? HEALTH_CODE.good
        : uplink <= UPLINK_STRAIN
          ? HEALTH_CODE.strain
          : HEALTH_CODE.bad,
    );
  }
  return code;
};

export const useStreamHealth = (opts: {
  /** The client that is already publishing. A second client would cost a second uplink. */
  client: IAgoraRTCClient | null;
  /** Sampling stops when the room is not publishing, so an idle console is free. */
  enabled?: boolean;
}): StreamHealth => {
  const { client, enabled = true } = opts;

  const [sample, setSample] = useState<Sample>(EMPTY);
  const [connectionState, setConnectionState] = useState<ConnectionState>('DISCONNECTED');

  /**
   * `network-quality` fires on its own two-second cadence and the connection state
   * fires whenever the transport moves. Both land in refs so they are folded into the
   * next 1 Hz sample instead of triggering their own renders — except the connection
   * state, which the room reacts to immediately and therefore also holds in state.
   */
  const uplinkRef = useRef(0);
  const connectionRef = useRef<ConnectionState>('DISCONNECTED');
  const historyRef = useRef<number[]>([]);

  useEffect(() => {
    if (!client) {
      uplinkRef.current = 0;
      connectionRef.current = 'DISCONNECTED';
      historyRef.current = [];
      setConnectionState('DISCONNECTED');
      setSample(EMPTY);
      return;
    }

    connectionRef.current = client.connectionState;
    setConnectionState(client.connectionState);

    const onQuality = (quality: NetworkQuality): void => {
      uplinkRef.current = quality.uplinkNetworkQuality;
    };
    const onConnection = (current: ConnectionState): void => {
      connectionRef.current = current;
      setConnectionState(current);
    };

    client.on('network-quality', onQuality);
    client.on('connection-state-change', onConnection);
    return () => {
      client.off('network-quality', onQuality);
      client.off('connection-state-change', onConnection);
    };
  }, [client]);

  useEffect(() => {
    if (!client || !enabled) return;

    const tick = (): void => {
      const video = client.getLocalVideoStats();
      const rtc = client.getRTCStats();
      const uplink = uplinkRef.current;

      const code =
        connectionRef.current === 'RECONNECTING' || connectionRef.current === 'DISCONNECTED'
          ? HEALTH_CODE.bad
          : grade({
              sendBitrate: video.sendBitrate,
              targetSendBitrate: video.targetSendBitrate,
              loss: video.currentPacketLossRate,
              uplink,
            });

      const history = [...historyRef.current, code].slice(-HISTORY_CELLS);
      historyRef.current = history;

      setSample((current) => ({
        code,
        bitrateKbps: Math.round(video.sendBitrate / 1000),
        rttMs: rtc.RTT > 0 ? Math.round(rtc.RTT) : null,
        lossPct: Number.isFinite(video.currentPacketLossRate)
          ? Math.round(video.currentPacketLossRate * 1000) / 10
          : null,
        uplink,
        history,
        taken: current.taken + 1,
      }));
    };

    tick();
    const id = window.setInterval(tick, SAMPLE_MS);
    return () => window.clearInterval(id);
  }, [client, enabled]);

  return useMemo(() => {
    /**
     * A transport that has dropped is bad the instant it drops, not at the next tick.
     * `DISCONNECTED` before anything was ever measured is just "not started".
     */
    const dropped =
      connectionState === 'RECONNECTING' ||
      (connectionState === 'DISCONNECTED' && sample.taken > 0);
    const code = dropped ? HEALTH_CODE.bad : sample.code;
    const state = HEALTH_STATE_BY_CODE[code] ?? 'unknown';

    return {
      state,
      history: sample.history,
      bitrateKbps: sample.bitrateKbps,
      rttMs: sample.rttMs,
      lossPct: sample.lossPct,
      uplink: sample.uplink,
      connectionState,
      label: HEALTH_LABEL[state],
    };
  }, [sample, connectionState]);
};
