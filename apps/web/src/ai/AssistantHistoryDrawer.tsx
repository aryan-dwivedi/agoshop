import type { AssistantLine } from './useVoiceAgent';

import { CloseIcon } from '../components/icons';

export const AssistantHistoryDrawer = ({
    open,
    prompts,
    onSelect,
    onClose,
    onClear,
}: {
    open: boolean;
    prompts: readonly AssistantLine[];
    onSelect: (text: string) => void;
    onClose: () => void;
    onClear: () => void;
}): JSX.Element | null => {
    if (!open) return null;
    return (
        <>
            <button
                type="button"
                aria-label="Close history"
                className="absolute inset-0 z-30 bg-[rgb(0_30_96/0.18)] backdrop-blur-[1px]"
                onClick={onClose}
            />
            <aside
                className="absolute inset-y-0 right-0 z-40 flex w-[min(100%,18rem)] flex-col border-l border-line bg-white shadow-sheet animate-slide-up"
                aria-label="Conversation history"
            >
                <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-line px-4">
                    <h3 className="text-16 font-semibold text-t1">Recent questions</h3>
                    <button
                        type="button"
                        aria-label="Close history"
                        className="flex h-8 w-8 items-center justify-center rounded-full text-t2 hover:bg-surface"
                        onClick={onClose}
                    >
                        <CloseIcon className="h-4 w-4" />
                    </button>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto scroll-thin p-2">
                    {prompts.length === 0 ? (
                        <p className="px-2 py-8 text-center text-13 text-t3">
                            Your questions will appear here as you chat.
                        </p>
                    ) : (
                        <ul className="space-y-1">
                            {prompts.map((line) => (
                                <li key={line.key}>
                                    <button
                                        type="button"
                                        className="w-full rounded-ctl px-3 py-2.5 text-left text-13 text-t2 transition hover:bg-surface hover:text-t1"
                                        onClick={() => {
                                            onSelect(line.text);
                                            onClose();
                                        }}
                                    >
                                        <span className="line-clamp-3">{line.text}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                {prompts.length > 0 && (
                    <footer className="shrink-0 border-t border-line p-3">
                        <button
                            type="button"
                            className="btn-quiet btn-sm w-full"
                            onClick={onClear}
                        >
                            Clear history
                        </button>
                    </footer>
                )}
            </aside>
        </>
    );
};
