import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConnectionState, IAgoraRTCClient, NetworkQuality } from 'agora-rtc-sdk-ng';
export type StreamHealthState = 'unknown' | 'good' | 'strain' | 'bad';
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
export const HEALTH_LABEL: Record<StreamHealthState, string> = {
    unknown: 'Uplink idle',
    good: 'Uplink good',
    strain: 'Uplink weak',
    bad: 'Losing connection',
};
export type StreamHealth = {
    state: StreamHealthState;
    history: number[];
    bitrateKbps: number | null;
    rttMs: number | null;
    lossPct: number | null;
    uplink: number;
    connectionState: ConnectionState;
    label: string;
};
const SAMPLE_MS = 1000;
const HISTORY_CELLS = 60;
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
const grade = (opts: {
    sendBitrate: number;
    targetSendBitrate: number;
    loss: number;
    uplink: number;
}): number => {
    const { sendBitrate, targetSendBitrate, loss, uplink } = opts;
    if (targetSendBitrate <= 0 && sendBitrate <= 0 && uplink === 0)
        return HEALTH_CODE.unknown;
    let code = HEALTH_CODE.good;
    if (targetSendBitrate > 0) {
        const ratio = sendBitrate / targetSendBitrate;
        code = worse(code, ratio >= RATIO_GOOD
            ? HEALTH_CODE.good
            : ratio >= RATIO_STRAIN
                ? HEALTH_CODE.strain
                : HEALTH_CODE.bad);
    }
    if (Number.isFinite(loss)) {
        code = worse(code, loss < LOSS_GOOD
            ? HEALTH_CODE.good
            : loss < LOSS_STRAIN
                ? HEALTH_CODE.strain
                : HEALTH_CODE.bad);
    }
    if (uplink > 0) {
        code = worse(code, uplink <= UPLINK_GOOD
            ? HEALTH_CODE.good
            : uplink <= UPLINK_STRAIN
                ? HEALTH_CODE.strain
                : HEALTH_CODE.bad);
    }
    return code;
};
export const useStreamHealth = (opts: {
    client: IAgoraRTCClient | null;
    enabled?: boolean;
}): StreamHealth => {
    const { client, enabled = true } = opts;
    const [sample, setSample] = useState<Sample>(EMPTY);
    const [connectionState, setConnectionState] = useState<ConnectionState>('DISCONNECTED');
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
        if (!client || !enabled)
            return;
        const tick = (): void => {
            const video = client.getLocalVideoStats();
            const rtc = client.getRTCStats();
            const uplink = uplinkRef.current;
            const code = connectionRef.current === 'RECONNECTING' || connectionRef.current === 'DISCONNECTED'
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
        const dropped = connectionState === 'RECONNECTING' ||
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
