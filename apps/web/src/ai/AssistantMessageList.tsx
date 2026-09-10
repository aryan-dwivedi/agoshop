import type { AssistantLine } from './useVoiceAgent';

import { languageLabel } from '@shop/shared';

import { LockIcon, SparklesIcon } from '../components/icons';
import { AgoAvatar } from './AgoAvatar';
import { AssistantProducts } from './AssistantProducts';
import { AssistantText } from './AssistantText';

const ThinkingIndicator = ({ stillLooking }: { stillLooking: boolean }): JSX.Element => (
    <div className="flex items-start gap-2.5 py-1">
        <AgoAvatar
            size="sm"
            state="thinking"
        />
        <div className="rounded-[18px] rounded-tl-md border border-line bg-white px-4 py-3 shadow-e1">
            <p className="text-13 font-semibold text-t1">
                {stillLooking ? 'Taking a closer look' : 'Working on it'}
            </p>
            <span
                className="mt-2 flex items-center gap-1.5"
                aria-label="Ask Ago is thinking"
            >
                {[0, 1, 2].map((index) => (
                    <span
                        key={index}
                        className="h-1.5 w-1.5 animate-breathe rounded-full bg-accent"
                        style={{ animationDelay: `${index * 160}ms` }}
                    />
                ))}
            </span>
        </div>
    </div>
);
export const AssistantMessageList = ({
    lines,
    firstName,
    starterPrompts,
    spokenBase,
    thinking,
    stillLooking,
    dictationInterim,
    scoped,
    surface,
    liveSessionId,
    onPrompt,
    promptsDisabled,
    showPrivateHint,
    hideEmptyState = false,
    voicePlaceholder = null,
}: {
    lines: readonly AssistantLine[];
    firstName: string;
    starterPrompts: readonly string[];
    spokenBase: string;
    thinking: boolean;
    stillLooking: boolean;
    dictationInterim: string;
    scoped: boolean;
    surface: 'browse' | 'live' | 'replay';
    liveSessionId?: string | null;
    onPrompt: (text: string) => void;
    promptsDisabled: boolean;
    showPrivateHint: boolean;
    hideEmptyState?: boolean;
    voicePlaceholder?: string | null;
}): JSX.Element => (
    <div className="space-y-4">
        {lines.length === 0 && hideEmptyState && voicePlaceholder ? (
            <div className="flex items-start gap-2.5 px-1 pt-2">
                <AgoAvatar size="sm" />
                <p className="pt-1 text-14 text-t2">{voicePlaceholder}</p>
            </div>
        ) : null}
        {lines.length === 0 && !hideEmptyState && (
            <div className="animate-fade-in px-1 pt-2">
                <div className="flex items-start gap-3">
                    <AgoAvatar size="lg" />
                    <div className="min-w-0 flex-1 pt-1">
                        <p className="font-display text-23 font-bold tracking-[-0.02em] text-t1">
                            Hi {firstName}
                        </p>
                        <p className="mt-1 text-16 leading-relaxed text-t2">
                            I can search the catalog, check delivery, compare products, and add to
                            your cart.
                        </p>
                        {showPrivateHint && (
                            <p className="mt-2 flex items-center gap-1.5 text-12 text-t3">
                                <LockIcon className="h-3 w-3 shrink-0" />
                                Private — only you see this conversation
                            </p>
                        )}
                    </div>
                </div>

                <div className="mt-5">
                    <p className="mb-2 px-1 text-11 font-semibold uppercase tracking-[0.08em] text-t3">
                        Try asking
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {starterPrompts.map((example) => (
                            <button
                                key={example}
                                type="button"
                                className="chip max-w-full whitespace-normal text-left"
                                disabled={promptsDisabled}
                                onClick={() => onPrompt(example)}
                            >
                                <SparklesIcon className="h-3.5 w-3.5 shrink-0 text-accent" />
                                <span className="line-clamp-2">{example}</span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        )}

        {lines.map((line) =>
            line.role === 'user' ? (
                <div
                    key={line.key}
                    className="flex flex-col items-end gap-1"
                >
                    <p className="animate-slide-up max-w-[88%] rounded-[18px] rounded-br-md bg-[#001e60] px-4 py-3 text-14 leading-relaxed text-white shadow-e1">
                        {line.text}
                    </p>
                    {line.language && line.language.toLowerCase().split('-')[0] !== spokenBase && (
                        <span className="px-1 text-11 text-t3">
                            Read as {languageLabel(line.language)}
                        </span>
                    )}
                </div>
            ) : (
                <div
                    key={line.key}
                    className="flex items-start gap-2.5"
                >
                    <AgoAvatar size="sm" />
                    <div className="min-w-0 flex-1">
                        <div className="animate-slide-up rounded-[18px] rounded-tl-md border border-line bg-white px-4 py-3 text-14 leading-relaxed text-t1 shadow-e1">
                            <AssistantText
                                text={line.text}
                                productCount={line.products.length}
                            />
                        </div>
                        {line.products.length > 0 && (
                            <div className="mt-2">
                                <AssistantProducts
                                    products={line.products}
                                    liveSessionId={
                                        scoped && surface === 'live' ? liveSessionId : null
                                    }
                                />
                            </div>
                        )}
                        {line.language &&
                            line.language.toLowerCase().split('-')[0] !== spokenBase && (
                                <span className="mt-1 block px-1 text-11 text-t3">
                                    Answered in {languageLabel(line.language)}
                                </span>
                            )}
                    </div>
                </div>
            ),
        )}

        {thinking ? <ThinkingIndicator stillLooking={stillLooking} /> : null}

        {dictationInterim.length > 0 && (
            <p className="px-1 text-right text-14 italic text-t3">{dictationInterim}</p>
        )}
    </div>
);
