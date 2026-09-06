import type { AgoAvatarState } from './AgoAvatar';
import type { ILocalAudioTrack } from 'agora-rtc-sdk-ng';

import { AgentState } from 'agora-agent-client-toolkit';

import { StopIcon } from '../components/icons';
import { AgoAvatar } from './AgoAvatar';
import { MicWaveform } from './MicWaveform';

const AGENT_LABEL: Record<AgentState, string> = {
    [AgentState.IDLE]: 'Ready',
    [AgentState.LISTENING]: 'Listening',
    [AgentState.THINKING]: 'Thinking',
    [AgentState.SPEAKING]: 'Speaking',
    [AgentState.SILENT]: 'Ready',
};
const avatarState = (agentState: AgentState | null): AgoAvatarState => {
    if (agentState === AgentState.LISTENING) return 'listening';
    if (agentState === AgentState.THINKING) return 'thinking';
    if (agentState === AgentState.SPEAKING) return 'speaking';
    return 'idle';
};
export const AssistantVoiceDock = ({
    phase,
    agentState,
    humanWaiting,
    humanActive,
    elapsed,
    micTrack,
    handoffNotice,
    supportAudioReady,
    onResumeSupportAudio,
    onEnd,
    ducking,
}: {
    phase: 'starting' | 'active' | 'human_waiting' | 'human_active';
    agentState: AgentState | null;
    humanWaiting: boolean;
    humanActive: boolean;
    elapsed: number;
    micTrack: ILocalAudioTrack | null;
    handoffNotice: string | null;
    supportAudioReady: boolean;
    onResumeSupportAudio: () => void;
    onEnd: () => void;
    ducking: boolean;
}): JSX.Element => {
    const minutes = Math.floor(elapsed / 60)
        .toString()
        .padStart(2, '0');
    const seconds = (elapsed % 60).toString().padStart(2, '0');
    const title =
        phase === 'starting'
            ? 'Connecting voice…'
            : humanWaiting
              ? 'Waiting for support'
              : humanActive
                ? 'Support agent connected'
                : agentState === null
                  ? 'Voice chat live'
                  : AGENT_LABEL[agentState];
    const detail =
        phase === 'starting'
            ? 'Setting up your private audio channel.'
            : humanWaiting
              ? 'Keep this open — your mic stays ready for handoff.'
              : humanActive
                ? 'Speak normally on this private call.'
                : 'Speak naturally. Ago responds when you pause.';
    const state = humanActive ? 'speaking' : avatarState(agentState);
    return (
        <div className="shrink-0 border-b border-line bg-gradient-to-r from-[#e6f1fc] via-white to-[#fff8df] px-4 py-3">
            <div className="flex items-center gap-3">
                <AgoAvatar
                    size="md"
                    state={state}
                />
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <p className="text-14 font-semibold text-t1">{title}</p>
                        {phase !== 'starting' && !humanWaiting && (
                            <span className="tnum text-12 font-medium text-t3">
                                {minutes}:{seconds}
                            </span>
                        )}
                    </div>
                    <p className="mt-0.5 text-12 text-t2">{detail}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-accent">
                    <MicWaveform track={micTrack} />
                    <button
                        type="button"
                        aria-label={humanActive ? 'End support call' : 'End voice chat'}
                        className="btn-danger btn-xs"
                        onClick={onEnd}
                    >
                        <StopIcon className="h-3 w-3" />
                        End
                    </button>
                </div>
            </div>

            {handoffNotice ? (
                <div
                    role="status"
                    className="mt-3 rounded-ctl border border-accent/20 bg-white/90 px-3 py-2 text-13 text-t2"
                >
                    <p>{handoffNotice}</p>
                    {supportAudioReady ? (
                        <button
                            type="button"
                            className="btn-standard btn-xs mt-2"
                            onClick={onResumeSupportAudio}
                        >
                            Play support audio
                        </button>
                    ) : null}
                </div>
            ) : null}

            {ducking ? (
                <p className="mt-2 text-11 text-t3">Show audio is lowered while you talk.</p>
            ) : null}
        </div>
    );
};
