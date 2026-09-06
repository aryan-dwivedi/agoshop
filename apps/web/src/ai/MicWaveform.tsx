import type { ILocalAudioTrack } from 'agora-rtc-sdk-ng';

import { MicIcon } from '../components/icons';
import { useMicLevel } from './useMicLevel';

export const MicWaveform = ({
    track,
    bars = 5,
    className = '',
}: {
    track: ILocalAudioTrack | null;
    bars?: number;
    className?: string;
}): JSX.Element => {
    const level = useMicLevel(track);
    if (level === null) {
        return <MicIcon className={`h-4 w-4 ${className}`} />;
    }
    const gains = [0.55, 1, 0.75, 1.15, 0.65];
    return (
        <span
            className={`flex items-end gap-[2px] ${className}`}
            aria-hidden="true"
        >
            {Array.from({ length: bars }, (_, index) => (
                <span
                    key={index}
                    className="w-[3px] rounded-full bg-current transition-transform duration-75"
                    style={{
                        height: '16px',
                        transform: `scaleY(${Math.max(0.12, Math.min(1, level * (gains[index % gains.length] ?? 1)))})`,
                    }}
                />
            ))}
        </span>
    );
};
