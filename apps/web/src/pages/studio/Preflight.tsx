import type { BroadcastSource } from '../../hooks/useHostBroadcast';

import { Camera, CheckCircle2, Mic, Radio, Wifi, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { RoleGate } from '../../components/seller/RoleGate';
import { writePreflightHandoff } from '../../hooks/useHostBroadcast';
import { ApiError, api } from '../../lib/api';
import { useSession } from '../../state/session';

type PermissionState = 'idle' | 'checking' | 'ready' | 'blocked';
type CoHostInviteState =
    | 'checking'
    | 'none'
    | 'redeeming'
    | 'accepted'
    | 'invalid'
    | 'wrong-account'
    | 'failed';
const SOURCES: {
    id: BroadcastSource;
    label: string;
    hint: string;
}[] = [
    {
        id: 'camera',
        label: 'Camera & mic',
        hint: 'Browser webcam and microphone',
    },
    { id: 'file', label: 'Video file', hint: 'Publish a pre-uploaded clip' },
    {
        id: 'obs',
        label: 'OBS / RTMP',
        hint: 'Push from OBS via Agora Media Gateway',
    },
];
const Preflight = (): JSX.Element => {
    const { slug } = useParams<{
        slug: string;
    }>();
    const { user } = useSession();
    const [params] = useSearchParams();
    const inviteToken = params.get('cohost');
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const inviteAttemptRef = useRef<string | null>(null);
    const [source, setSource] = useState<BroadcastSource>('camera');
    const [state, setState] = useState<PermissionState>('idle');
    const [cohostInviteState, setCohostInviteState] = useState<CoHostInviteState>('checking');
    const [message, setMessage] = useState(
        'Check your camera and microphone before opening the room.',
    );
    useEffect(() => {
        if (!slug || user === null) return;
        const attemptKey = `${user.id}:${slug}:${inviteToken ?? ''}`;
        if (inviteAttemptRef.current === attemptKey) return;
        inviteAttemptRef.current = attemptKey;
        setCohostInviteState(inviteToken === null ? 'checking' : 'redeeming');
        void (async () => {
            try {
                const { session } = await api.get<{
                    session: {
                        id: string;
                        coHostUserId: string | null;
                    };
                }>(`/api/sessions/${slug}`);
                if (session.coHostUserId === user.id) {
                    setCohostInviteState('accepted');
                    return;
                }
                if (inviteToken === null) {
                    setCohostInviteState('none');
                    return;
                }
                await api.post(`/api/sessions/${session.id}/cohost-invite/redeem`, {
                    token: inviteToken,
                });
                setCohostInviteState('accepted');
            } catch (err) {
                if (inviteToken === null) {
                    setCohostInviteState('none');
                } else if (err instanceof ApiError && err.code === 'cohost_is_host') {
                    setCohostInviteState('wrong-account');
                } else if (err instanceof ApiError && err.code === 'cohost_invite_invalid') {
                    setCohostInviteState('invalid');
                } else {
                    setCohostInviteState('failed');
                }
            }
        })();
    }, [slug, user, inviteToken]);
    const stopPreview = (): void => {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        if (videoRef.current) videoRef.current.srcObject = null;
    };
    useEffect(() => stopPreview, []);
    const startPreview = async (): Promise<void> => {
        if (source === 'obs') {
            setState('ready');
            setMessage('OBS ingest selected — configure RTMP after you go live.');
            return;
        }
        stopPreview();
        setState('checking');
        setMessage('Requesting camera and microphone access…');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'user',
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                },
                audio: true,
            });
            streamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                await videoRef.current.play();
            }
            setState('ready');
            setMessage('Camera and microphone are ready.');
        } catch {
            setState('blocked');
            setMessage('Allow camera and microphone access in your browser, then try again.');
        }
    };
    const continueToRoom = (): void => {
        if (!slug) return;
        if (!cohostInvite) {
            window.localStorage.setItem(`studio.preflight.${slug}`, new Date().toISOString());
        }
        writePreflightHandoff(slug, {
            consent: false,
            autoGoLive: false,
            skipped: false,
            source,
            cameraId: null,
            microphoneId: null,
        });
    };
    const online = navigator.onLine;
    const ready = state === 'ready' || source === 'obs';
    const cohostInvite = cohostInviteState === 'accepted';
    const canEnter = (ready || cohostInvite) && online;
    if (
        inviteToken !== null &&
        (cohostInviteState === 'checking' || cohostInviteState === 'redeeming')
    ) {
        return (
            <RoleGate
                roles={['shopper', 'seller', 'support', 'admin']}
                title="Accepting co-host link"
                subtitle="Connecting this browser to the broadcast room."
                theme="light"
            >
                <div
                    className="card mx-auto h-32 max-w-lg animate-pulse"
                    aria-label="Accepting co-host invite"
                />
            </RoleGate>
        );
    }
    if (inviteToken !== null && cohostInviteState === 'wrong-account') {
        return (
            <RoleGate
                roles={['shopper', 'seller', 'support', 'admin']}
                title="Open this link as the co-host"
                subtitle="You are currently signed in as the show host."
                theme="light"
            >
                <div className="card mx-auto max-w-lg p-6 text-center">
                    <p className="text-14 text-t2">
                        Send this link to your co-host, or open it in a private window or another
                        browser where the host account is not signed in.
                    </p>
                </div>
            </RoleGate>
        );
    }
    if (inviteToken !== null && cohostInviteState === 'failed') {
        return (
            <RoleGate
                roles={['shopper', 'seller', 'support', 'admin']}
                title="Could not accept co-host link"
                subtitle="The invite could not be checked. Try again."
                theme="light"
            >
                <div className="card mx-auto max-w-lg p-6 text-center">
                    <button
                        type="button"
                        className="btn-commit"
                        onClick={() => window.location.reload()}
                    >
                        Try again
                    </button>
                </div>
            </RoleGate>
        );
    }
    if (inviteToken !== null && cohostInviteState === 'invalid') {
        return (
            <RoleGate
                roles={['shopper', 'seller', 'support', 'admin']}
                title="Co-host link unavailable"
                subtitle="This invite has expired or was already used."
                theme="light"
            >
                <div className="card mx-auto max-w-lg p-6 text-center">
                    <p className="text-14 text-t2">
                        Ask the host to create and copy a new co-host join link.
                    </p>
                </div>
            </RoleGate>
        );
    }
    if (cohostInvite && slug) {
        return (
            <RoleGate
                roles={['shopper', 'seller', 'support', 'admin']}
                title="Join as co-host"
                subtitle="You were invited to publish on this show."
                theme="light"
                actions={
                    <Link
                        to="/shows"
                        className="btn-quiet"
                    >
                        Back to shows
                    </Link>
                }
            >
                <div className="mx-auto max-w-lg card p-6 text-center">
                    <p className="text-14 text-t2">
                        Open the broadcast room to publish your camera beside the host. You cannot
                        end the show or run moderation.
                    </p>
                    <Link
                        to={`/live/${slug}`}
                        className="btn-commit btn-lg mt-4 inline-flex w-full justify-center"
                        onClick={() => {
                            writePreflightHandoff(slug, {
                                consent: true,
                                autoGoLive: false,
                                skipped: true,
                                source: 'camera',
                                cameraId: null,
                                microphoneId: null,
                            });
                        }}
                    >
                        Open broadcast room
                    </Link>
                </div>
            </RoleGate>
        );
    }
    return (
        <RoleGate
            roles={['seller']}
            title="Get ready to go live"
            subtitle="Choose a publish source and run a quick check."
            theme="light"
            actions={
                <Link
                    to="/shows"
                    className="btn-quiet"
                >
                    Back to shows
                </Link>
            }
        >
            <div className="mx-auto grid max-w-5xl items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
                <section>
                    <div className="mb-3 flex flex-wrap gap-2">
                        {SOURCES.map((option) => (
                            <button
                                key={option.id}
                                type="button"
                                className={`rounded-ctl border px-3 py-2 text-left text-13 transition ${
                                    source === option.id
                                        ? 'border-accent bg-accent/10 text-t1'
                                        : 'border-line text-t2 hover:text-t1'
                                }`}
                                onClick={() => {
                                    setSource(option.id);
                                    setState('idle');
                                    setMessage(
                                        option.id === 'obs'
                                            ? 'OBS ingest — no browser camera needed.'
                                            : 'Check your camera and microphone before opening the room.',
                                    );
                                }}
                            >
                                <span className="font-medium">{option.label}</span>
                                <span className="mt-0.5 block text-12 text-t3">{option.hint}</span>
                            </button>
                        ))}
                    </div>

                    <div className="relative overflow-hidden rounded-panel bg-[#101210] shadow-e1">
                        {source === 'obs' ? (
                            <div className="flex aspect-video items-center justify-center p-6 text-center text-white/75">
                                <div>
                                    <Radio
                                        className="mx-auto h-8 w-8"
                                        strokeWidth={1.8}
                                    />
                                    <p className="mt-3 text-14">
                                        RTMP credentials appear after you go live
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <>
                                <video
                                    ref={videoRef}
                                    muted
                                    playsInline
                                    className="aspect-video w-full object-cover"
                                    aria-label="Camera preview"
                                />
                                {state !== 'ready' && (
                                    <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-white">
                                        <div>
                                            <Camera
                                                className="mx-auto h-8 w-8"
                                                strokeWidth={1.8}
                                            />
                                            <p className="mt-3 text-14 text-white/75">
                                                Your preview appears here
                                            </p>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                    {source !== 'obs' && (
                        <button
                            type="button"
                            className="btn-standard mt-3"
                            disabled={state === 'checking'}
                            onClick={() => void startPreview()}
                        >
                            <Camera
                                className="h-4 w-4"
                                strokeWidth={1.8}
                            />
                            {state === 'checking'
                                ? 'Checking…'
                                : state === 'ready'
                                  ? 'Check again'
                                  : 'Check camera and mic'}
                        </button>
                    )}
                </section>

                <aside className="card p-5">
                    <h2 className="section-title">Device check</h2>
                    <ul className="mt-4 space-y-3">
                        {source !== 'obs' && (
                            <>
                                <li className="flex items-start gap-3">
                                    <Camera
                                        className="mt-0.5 h-5 w-5 text-t2"
                                        strokeWidth={1.8}
                                    />
                                    <div className="min-w-0 flex-1">
                                        <p className="text-14 font-medium text-t1">Camera</p>
                                        <p className="text-13 text-t3">
                                            {state === 'ready' ? 'Ready' : 'Not checked'}
                                        </p>
                                    </div>
                                    {state === 'ready' ? (
                                        <CheckCircle2 className="h-5 w-5 text-success" />
                                    ) : state === 'blocked' ? (
                                        <XCircle className="h-5 w-5 text-danger" />
                                    ) : null}
                                </li>
                                <li className="flex items-start gap-3">
                                    <Mic
                                        className="mt-0.5 h-5 w-5 text-t2"
                                        strokeWidth={1.8}
                                    />
                                    <div className="min-w-0 flex-1">
                                        <p className="text-14 font-medium text-t1">Microphone</p>
                                        <p className="text-13 text-t3">
                                            {state === 'ready' ? 'Ready' : 'Not checked'}
                                        </p>
                                    </div>
                                    {state === 'ready' && (
                                        <CheckCircle2 className="h-5 w-5 text-success" />
                                    )}
                                </li>
                            </>
                        )}
                        {source === 'obs' && (
                            <li className="flex items-start gap-3">
                                <Radio
                                    className="mt-0.5 h-5 w-5 text-t2"
                                    strokeWidth={1.8}
                                />
                                <div className="min-w-0 flex-1">
                                    <p className="text-14 font-medium text-t1">
                                        OBS / Media Gateway
                                    </p>
                                    <p className="text-13 text-t3">
                                        RTMP credentials appear after you go live
                                    </p>
                                </div>
                                <CheckCircle2 className="h-5 w-5 text-success" />
                            </li>
                        )}
                        <li className="flex items-start gap-3">
                            <Wifi
                                className="mt-0.5 h-5 w-5 text-t2"
                                strokeWidth={1.8}
                            />
                            <div className="min-w-0 flex-1">
                                <p className="text-14 font-medium text-t1">Connection</p>
                                <p className="text-13 text-t3">{online ? 'Online' : 'Offline'}</p>
                            </div>
                            {online ? (
                                <CheckCircle2 className="h-5 w-5 text-success" />
                            ) : (
                                <XCircle className="h-5 w-5 text-danger" />
                            )}
                        </li>
                    </ul>

                    <p
                        className={`mt-5 text-13 ${state === 'blocked' ? 'text-danger' : 'text-t2'}`}
                    >
                        {message}
                    </p>
                    <Link
                        to={slug ? `/live/${slug}` : '/shows'}
                        aria-disabled={!canEnter}
                        className={`btn-commit btn-lg mt-4 w-full ${!canEnter ? 'pointer-events-none opacity-50' : ''}`}
                        onClick={continueToRoom}
                    >
                        Open broadcast room
                    </Link>
                </aside>
            </div>
        </RoleGate>
    );
};
export default Preflight;
