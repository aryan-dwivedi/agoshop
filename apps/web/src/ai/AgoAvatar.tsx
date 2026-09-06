type AgoAvatarSize = 'sm' | 'md' | 'lg';
const SIZE_CLASS: Record<AgoAvatarSize, string> = {
    sm: 'h-8 w-8',
    md: 'h-10 w-10',
    lg: 'h-14 w-14',
};
const ICON_CLASS: Record<AgoAvatarSize, string> = {
    sm: 'h-5 w-5',
    md: 'h-6 w-6',
    lg: 'h-9 w-9',
};
export type AgoAvatarState = 'idle' | 'listening' | 'thinking' | 'speaking';
const RING_CLASS: Record<AgoAvatarState, string> = {
    idle: '',
    listening: 'ring-2 ring-accent/40 ring-offset-2',
    thinking: 'ring-2 ring-accent/30 ring-offset-2 animate-pulse',
    speaking: 'ring-2 ring-success/50 ring-offset-2',
};
export const AgoAvatar = ({
    size = 'md',
    state = 'idle',
    className = '',
}: {
    size?: AgoAvatarSize;
    state?: AgoAvatarState;
    className?: string;
}): JSX.Element => (
    <span
        aria-hidden="true"
        className={`relative flex shrink-0 items-center justify-center rounded-full bg-[#ffc220] text-[#001e60] shadow-sm ${SIZE_CLASS[size]} ${RING_CLASS[state]} ${className}`}
    >
        <svg
            viewBox="0 0 32 32"
            className={ICON_CLASS[size]}
            fill="none"
        >
            <circle
                cx="11"
                cy="12"
                r="1.7"
                fill="currentColor"
            />
            <circle
                cx="21"
                cy="12"
                r="1.7"
                fill="currentColor"
            />
            <path
                d="M9 19c2.2 3.5 11.8 3.5 14 0"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
            />
            <path
                d="M16 3v3M4.7 7.7l2.2 2.1M27.3 7.7l-2.2 2.1"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
            />
        </svg>
    </span>
);
