import { useEffect, useMemo, useRef, useState } from 'react';
export const MOD_LABEL: string = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl';
export type Command = {
    id: string;
    label: string;
    keywords?: string;
    hint?: string;
    disabledReason?: string | null;
    confirm?: string;
    argument?: {
        placeholder: string;
        required: boolean;
    };
    section: string;
    run: (argument: number | null) => void | Promise<void>;
};
const score = (needle: string, haystack: string): number | null => {
    if (needle === '')
        return 0;
    let index = 0;
    let total = 0;
    let previous = -2;
    for (const char of needle) {
        const found = haystack.indexOf(char, index);
        if (found === -1)
            return null;
        total += found === previous + 1 ? 0 : 1 + (found === 0 ? 0 : 2);
        previous = found;
        index = found + 1;
    }
    return total;
};
const splitArgument = (query: string): {
    words: string;
    argument: number | null;
} => {
    const match = /^(.*?)\s*(\d+)\s*$/.exec(query);
    if (match === null)
        return { words: query.trim(), argument: null };
    const parsed = Number.parseInt(match[2]!, 10);
    return { words: match[1]!.trim(), argument: Number.isFinite(parsed) ? parsed : null };
};
export const CommandPalette = ({ open, onOpenChange, commands, }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    commands: Command[];
}): JSX.Element => {
    const [query, setQuery] = useState('');
    const [cursor, setCursor] = useState(0);
    const [confirming, setConfirming] = useState<{
        command: Command;
        argument: number | null;
    } | null>(null);
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLUListElement>(null);
    useEffect(() => {
        const onHotkey = (event: KeyboardEvent): void => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
                event.preventDefault();
                onOpenChange(!open);
            }
        };
        window.addEventListener('keydown', onHotkey);
        return () => window.removeEventListener('keydown', onHotkey);
    }, [onOpenChange, open]);
    useEffect(() => {
        if (!open)
            return;
        setQuery('');
        setCursor(0);
        setConfirming(null);
        setFailure(null);
        setBusy(false);
        inputRef.current?.focus();
    }, [open]);
    const { words, argument } = splitArgument(query);
    const matches = useMemo(() => {
        const needle = words.toLowerCase().replace(/\s+/g, '');
        return commands
            .map((command) => ({
            command,
            rank: score(needle, `${command.label} ${command.keywords ?? ''}`.toLowerCase()),
        }))
            .filter((row): row is {
            command: Command;
            rank: number;
        } => row.rank !== null)
            .sort((a, b) => a.rank - b.rank)
            .map((row) => row.command);
    }, [commands, words]);
    const index = matches.length === 0 ? 0 : Math.min(cursor, matches.length - 1);
    const active = matches[index] ?? null;
    useEffect(() => {
        listRef.current
            ?.querySelector(`[data-cursor="${index}"]`)
            ?.scrollIntoView({ block: 'nearest' });
    }, [index]);
    if (!open)
        return <></>;
    const execute = async (command: Command, value: number | null): Promise<void> => {
        setBusy(true);
        setFailure(null);
        try {
            await command.run(value);
            onOpenChange(false);
        }
        catch (err) {
            setFailure(err instanceof Error ? err.message : 'That command did not go through.');
            inputRef.current?.focus();
        }
        finally {
            setBusy(false);
        }
    };
    const choose = (command: Command, value: number | null): void => {
        if (busy || command.disabledReason != null)
            return;
        if (command.argument?.required === true && value === null) {
            setFailure(`${command.label} needs a number — type “${command.label} 3”.`);
            return;
        }
        if (command.confirm !== undefined) {
            setConfirming({ command, argument: value });
            return;
        }
        void execute(command, value);
    };
    const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
        if (event.key === 'Escape') {
            event.preventDefault();
            if (confirming !== null) {
                setConfirming(null);
                inputRef.current?.focus();
                return;
            }
            onOpenChange(false);
            return;
        }
        if (confirming !== null) {
            if (event.key === 'Enter') {
                event.preventDefault();
                const { command, argument: value } = confirming;
                setConfirming(null);
                void execute(command, value);
            }
            return;
        }
        if (event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey)) {
            event.preventDefault();
            if (matches.length > 0)
                setCursor((index + 1) % matches.length);
            return;
        }
        if (event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey)) {
            event.preventDefault();
            if (matches.length > 0)
                setCursor((index + matches.length - 1) % matches.length);
            return;
        }
        if (event.key === 'Home') {
            event.preventDefault();
            setCursor(0);
            return;
        }
        if (event.key === 'End') {
            event.preventDefault();
            setCursor(Math.max(matches.length - 1, 0));
            return;
        }
        if (event.key === 'Enter' && active !== null) {
            event.preventDefault();
            choose(active, argument);
        }
    };
    let section = '';
    return (<div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]" style={{ background: 'rgb(11 12 14 / 0.72)' }} onMouseDown={(event) => {
            if (event.target === event.currentTarget)
                onOpenChange(false);
        }}>
      <div role="dialog" aria-modal="true" aria-label="Studio commands" className="animate-slide-down w-full max-w-xl overflow-hidden rounded-sheet border border-line bg-menu shadow-sheet" onKeyDown={onKeyDown}>
        {confirming === null ? (<>
            <div className="flex items-center gap-2 border-b border-line px-3">
              <span className="eyebrow shrink-0">{MOD_LABEL}K</span>
              <input ref={inputRef} role="combobox" aria-expanded="true" aria-controls="command-palette-list" aria-activedescendant={active === null ? undefined : `command-${active.id}`} aria-autocomplete="list" className="h-ctl-lg w-full bg-transparent text-14 text-t1 outline-none placeholder:text-t3" placeholder="pin 3 · price 20 · end show · catalog" value={query} onChange={(event) => {
                setQuery(event.target.value);
                setCursor(0);
                setFailure(null);
            }}/>
              {busy && <span className="shrink-0 text-11 text-t3">Working…</span>}
            </div>

            {failure !== null && (<p role="alert" className="border-b border-line px-3 py-2 text-13 text-danger">
                {failure}
              </p>)}

            <ul id="command-palette-list" ref={listRef} role="listbox" aria-label="Commands" className="max-h-[52vh] overflow-y-auto py-1 scroll-thin">
              {matches.length === 0 && (<li className="px-3 py-6 text-center text-13 text-t2">
                  No command matches “{query}”.
                </li>)}
              {matches.map((command, position) => {
                const disabled = command.disabledReason != null;
                const selected = position === index;
                const header = command.section === section ? null : command.section;
                section = command.section;
                return (<li key={command.id}>
                    {header !== null && <div className="eyebrow px-3 pb-1 pt-2">{header}</div>}
                    <div id={`command-${command.id}`} role="option" aria-selected={selected} aria-disabled={disabled} data-cursor={position} className={`flex min-h-ctl cursor-default items-center gap-3 px-3 py-1.5 ${selected ? 'bg-accent-wash' : ''}`} onMouseMove={() => setCursor(position)} onClick={() => choose(command, argument)}>
                      <span className={`min-w-0 flex-1 text-14 ${disabled ? 'text-t3' : 'text-t1'}`}>
                        <span className="font-medium">
                          {command.label}
                          {command.argument !== undefined && (<span className={argument === null ? 'text-t3' : 'text-accent'}>
                              {' '}
                              {argument ?? command.argument.placeholder}
                            </span>)}
                        </span>
                        {(command.disabledReason ?? command.hint) !== undefined && (<span className="mt-0.5 block text-11 leading-tight text-t3">
                            {command.disabledReason ?? command.hint}
                          </span>)}
                      </span>
                      {selected && !disabled && (<span className="shrink-0 text-11 font-semibold text-t3">↵</span>)}
                    </div>
                  </li>);
            })}
            </ul>
          </>) : (<div className="p-4">
            <p className="text-16 font-semibold text-t1">{confirming.command.confirm}</p>
            <p className="mt-1 text-13 text-t2">
              Press <span className="font-semibold text-t1">Enter</span> to confirm,{' '}
              <span className="font-semibold text-t1">Esc</span> to back out.
            </p>
            <div className="mt-3 flex gap-2">
              <button type="button" autoFocus className="btn-danger" disabled={busy} onClick={() => {
                const { command, argument: value } = confirming;
                setConfirming(null);
                void execute(command, value);
            }}>
                {confirming.command.label}
              </button>
              <button type="button" className="btn-quiet" onClick={() => {
                setConfirming(null);
                inputRef.current?.focus();
            }}>
                Cancel
              </button>
            </div>
          </div>)}
      </div>
    </div>);
};
