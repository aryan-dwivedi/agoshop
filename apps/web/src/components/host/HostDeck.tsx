import type { useHostBroadcast } from '../../hooks/useHostBroadcast';
import type { PollDto } from '../../hooks/useLiveSession';
import type { SessionProductDto } from '@shop/shared';

import { CaptionIcon, GridIcon, MicIcon, PlayIcon, TagIcon } from '../icons';
import { DeckButton } from './DeckButton';
import { PollPanel } from './PollPanel';
import { PricePanel } from './PricePanel';

type Broadcast = ReturnType<typeof useHostBroadcast>;
export const HostDeck = ({
    broadcast,
    session,
    poll,
    onPollChange,
    focusProduct,
    captionsVisible,
    onCaptionsChange,
    pricePanel,
    onPricePanelChange,
    pollPanel,
    onPollPanelChange,
    reconnecting,
    disconnected,
    pinError,
    pinnedSoldOut,
    pinnedProduct,
    nextInStock,
    onPin,
    pinBusy,
    isOwner = true,
}: {
    broadcast: Broadcast;
    session: {
        id: string;
        discountPercent: number | null;
    };
    poll: PollDto | null;
    onPollChange: (poll: PollDto | null) => void;
    focusProduct: SessionProductDto | null;
    captionsVisible: boolean;
    onCaptionsChange: (visible: boolean) => void;
    pricePanel: boolean;
    onPricePanelChange: (open: boolean) => void;
    pollPanel: boolean;
    onPollPanelChange: (open: boolean) => void;
    reconnecting: boolean;
    disconnected: boolean;
    pinError: string | null;
    pinnedSoldOut: boolean;
    pinnedProduct: SessionProductDto | null;
    nextInStock: SessionProductDto | null;
    onPin: (productId: string) => void;
    pinBusy: boolean;
    isOwner?: boolean;
}): JSX.Element => {
    const { toggleMic, toggleCamera, source } = broadcast;
    const publishing = broadcast.state === 'live';
    return (
        <>
            <div className="flex shrink-0 flex-col gap-1 px-3">
                {pinError !== null && <p className="text-14 text-danger">{pinError}</p>}

                {pinnedSoldOut && pinnedProduct !== null && (
                    <div className="flex flex-wrap items-center gap-2 rounded-ctl border border-danger px-3 py-1.5 text-14">
                        <span className="text-danger">{pinnedProduct.title} is out of stock</span>
                        {nextInStock !== null && (
                            <button
                                type="button"
                                className="btn-standard btn-sm"
                                disabled={pinBusy}
                                onClick={() => onPin(nextInStock.productId)}
                            >
                                Pin {nextInStock.title}
                            </button>
                        )}
                    </div>
                )}

                {broadcast.recorder.state === 'failed' && (
                    <div className="flex flex-wrap items-center gap-2 text-14">
                        <span className="text-danger">Replay capture failed</span>
                        {broadcast.recorder.canRetryUpload && (
                            <>
                                <button
                                    type="button"
                                    className="btn-standard btn-sm"
                                    onClick={() => void broadcast.recorder.retryUpload()}
                                >
                                    Retry upload
                                </button>
                                <span className="text-t2">
                                    The recording is held in this tab, so retrying works until you
                                    close it.
                                </span>
                            </>
                        )}
                    </div>
                )}

                {broadcast.tokenNotice !== null && (
                    <p className="text-14 text-danger">{broadcast.tokenNotice}</p>
                )}

                {!broadcast.videoPublished && publishing && (
                    <div className="flex flex-wrap items-center gap-2 text-14">
                        <span className="text-accent">
                            Camera is off air — your mic is still live
                        </span>
                        <button
                            type="button"
                            className="btn-standard btn-sm"
                            onClick={() => void broadcast.publishVideo(true)}
                        >
                            Put the camera back on
                        </button>
                    </div>
                )}

                {broadcast.error !== null && !disconnected && (
                    <p className="text-14 text-danger">{broadcast.error}</p>
                )}
            </div>

            <div className="relative flex h-16 shrink-0 items-center gap-2 border-t border-line px-3">
                <DeckButton
                    shortcut="M"
                    label={broadcast.micEnabled ? 'Mic on' : 'Mic off'}
                    tone={broadcast.micEnabled ? 'idle' : 'off'}
                    disabled={
                        source === 'obs' ||
                        broadcast.state === 'idle' ||
                        reconnecting ||
                        disconnected
                    }
                    icon={<MicIcon className="h-4 w-4" />}
                    onClick={() => void toggleMic()}
                />
                <DeckButton
                    shortcut="V"
                    label={broadcast.cameraEnabled ? 'Camera on' : 'Camera off'}
                    tone={broadcast.cameraEnabled ? 'idle' : 'off'}
                    disabled={
                        source === 'obs' ||
                        broadcast.state === 'idle' ||
                        reconnecting ||
                        disconnected
                    }
                    icon={<PlayIcon className="h-4 w-4" />}
                    onClick={() => void toggleCamera()}
                />
                {isOwner && (
                    <>
                        <DeckButton
                            shortcut="D"
                            label="Price"
                            value={
                                session.discountPercent === null
                                    ? 'no markdown'
                                    : `${session.discountPercent}% off`
                            }
                            tone={session.discountPercent === null ? 'idle' : 'active'}
                            icon={<TagIcon className="h-4 w-4" />}
                            onClick={() => {
                                onPricePanelChange(!pricePanel);
                                onPollPanelChange(false);
                            }}
                        />
                        <DeckButton
                            shortcut="P"
                            label="Poll"
                            value={poll === null ? 'none open' : 'open'}
                            tone={poll === null ? 'idle' : 'active'}
                            icon={<GridIcon className="h-4 w-4" />}
                            onClick={() => {
                                onPollPanelChange(!pollPanel);
                                onPricePanelChange(false);
                            }}
                        />
                    </>
                )}
                <DeckButton
                    shortcut="C"
                    label={captionsVisible ? 'Captions on' : 'Captions off'}
                    tone={captionsVisible ? 'active' : 'idle'}
                    icon={<CaptionIcon className="h-4 w-4" />}
                    onClick={() => onCaptionsChange(!captionsVisible)}
                />

                {isOwner && pricePanel && (
                    <PricePanel
                        sessionId={session.id}
                        discountPercent={session.discountPercent}
                        focus={focusProduct}
                        onClose={() => onPricePanelChange(false)}
                    />
                )}
                {isOwner && pollPanel && (
                    <PollPanel
                        sessionId={session.id}
                        poll={poll}
                        onPollChange={onPollChange}
                        onClose={() => onPollPanelChange(false)}
                    />
                )}
            </div>
        </>
    );
};
