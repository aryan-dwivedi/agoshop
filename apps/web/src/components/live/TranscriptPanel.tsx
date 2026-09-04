import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { TranscriptLine } from '@shop/shared';

import { api } from '../../lib/api';
import type { CaptionLine } from '../../hooks/useLiveSession';
import { AskIcon, CaptionIcon, CloseIcon, SearchIcon } from '../icons';
import type { QuotedLine } from './RoomConversation';

/**
 * The live transcription, as a readable surface rather than two lines over the video.
 *
 * Captions over the frame answer "what was just said"; they cannot answer "what did he
 * say about the fabric two minutes ago", which is the question a shopper who joined
 * late actually has. So this panel does what the overlay structurally cannot:
 *
 *   - it seeds from `GET /api/sessions/:slug/transcript`, so a viewer who opened the
 *     segment thirty seconds ago still sees the show from the top, not from their join;
 *   - it appends the lines the room is producing right now;
 *   - it lets any line be handed to the assistant as the subject of a question, which
 *     is the same gesture the chat lane offers — the room is one context, not three.
 *
 * Transcription is both a deployment feature and a per-show runtime state. Both off
 * states are stated plainly here instead of being dressed up as "no captions yet",
 * because a shopper waiting for text that is never coming is worse than a shopper
 * told there is none.
 */

const stamp = (startMs: number): string => {
  const total = Math.max(0, Math.round(startMs / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

type Row = { key: string; speaker: string; text: string; startMs: number };

export const TranscriptPanel = ({
  slug,
  captions,
  enabled,
  isLive,
  onQuote,
  className,
}: {
  slug: string | undefined;
  /** Lines that arrived since this client joined. */
  captions: CaptionLine[];
  /** `join.captionsEnabled` — false means this deployment/show produces none. */
  enabled: boolean;
  isLive: boolean;
  onQuote: (quoted: QuotedLine) => void;
  className?: string;
}): JSX.Element => {
  const [query, setQuery] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  // History is worth one fetch even when captions are off: an earlier run of the same
  // show may have left transcript rows behind.
  const history = useQuery<{ lines: TranscriptLine[] }, Error>({
    queryKey: ['session-transcript', slug],
    queryFn: () => api.get<{ lines: TranscriptLine[] }>(`/api/sessions/${slug}/transcript`),
    enabled: Boolean(slug),
    staleTime: 60_000,
  });

  const rows = useMemo<Row[]>(() => {
    const merged: Row[] = (history.data?.lines ?? []).map((line) => ({
      key: `h-${line.id}`,
      speaker: line.speaker === 'host' ? 'Host' : line.speaker,
      text: line.text,
      startMs: line.startMs,
    }));

    // A line can arrive live and then again in a refetched history. `startMs` plus the
    // text is the only identity both copies share, so it is the dedupe key.
    const seen = new Set(merged.map((row) => `${row.startMs}|${row.text}`));
    for (const caption of captions) {
      const fingerprint = `${caption.startMs}|${caption.text}`;
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      merged.push({
        key: `c-${caption.id}`,
        speaker: caption.speaker === 'host' ? 'Host' : caption.speaker,
        text: caption.text,
        startMs: caption.startMs,
      });
    }

    return merged.sort((a, b) => a.startMs - b.startMs);
  }, [history.data, captions]);

  const needle = query.trim().toLowerCase();
  const visible =
    needle.length === 0 ? rows : rows.filter((row) => row.text.toLowerCase().includes(needle));

  const tail = rows[rows.length - 1]?.key ?? '';
  useEffect(() => {
    const el = scrollRef.current;
    // Searching freezes the view: scrolling a filtered list to the bottom throws away
    // the match the shopper was reading.
    if (!el || !pinnedRef.current || needle.length > 0) return;
    el.scrollTop = el.scrollHeight;
  }, [tail, needle]);

  return (
    <section className={`flex min-h-0 flex-col ${className ?? ''}`}>
      <div className="flex items-center gap-2 px-2.5 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-line-ctl px-3 py-1.5 transition duration-ctl focus-within:border-accent">
          <SearchIcon className="h-3.5 w-3.5 shrink-0 text-t3" />
          <input
            className="min-w-0 flex-1 bg-transparent text-14 text-t1 outline-none placeholder:text-t3"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search what the host said"
            placeholder="Search what was said…"
          />
          {query.length > 0 && (
            <button
              type="button"
              aria-label="Clear search"
              className="shrink-0 rounded-full p-0.5 text-t3 transition duration-ctl hover:text-t1"
              onClick={() => setQuery('')}
            >
              <CloseIcon className="h-3 w-3" />
            </button>
          )}
        </div>
        {isLive && enabled && (
          <span
            className="inline-flex shrink-0 items-center gap-1.5 text-13 font-medium text-t3"
            title="Speech-to-text is running for this show"
          >
            <span aria-hidden className="h-1.5 w-1.5 animate-breathe rounded-full bg-accent" />
            Transcribing
          </span>
        )}
      </div>

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        className="scroll-thin min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2.5 pb-3"
      >
        {history.isLoading && (
          <div className="space-y-2 px-1 pt-1">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skeleton h-3.5" style={{ width: `${92 - i * 14}%` }} />
            ))}
          </div>
        )}

        {!history.isLoading && rows.length === 0 && (
          <div className="flex flex-col items-center gap-2.5 px-4 py-10 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface text-t3">
              <CaptionIcon className="h-5 w-5" />
            </span>
            <p className="text-14 leading-relaxed text-t2">
              {!enabled
                ? 'Speech-to-text is not running for this show, so there is no transcript to read. Captions and this panel both fill in the moment a host turns it on.'
                : isLive
                  ? 'Listening — the transcript fills in as the host speaks.'
                  : 'This show produced no transcript.'}
            </p>
          </div>
        )}

        {!history.isLoading && rows.length > 0 && visible.length === 0 && (
          <p className="px-1 py-6 text-center text-14 text-t3">Nothing said matches “{query}”.</p>
        )}

        {visible.map((row) => (
          <div
            key={row.key}
            className="group/line relative rounded-ctl px-2 py-1.5 transition duration-ctl hover:bg-surface"
          >
            <p className="flex items-baseline gap-2">
              <span className="tnum shrink-0 text-11 text-t3">{stamp(row.startMs)}</span>
              <span className="min-w-0 flex-1 text-14 leading-relaxed text-t2">
                <span className="mr-1.5 font-semibold text-t3">{row.speaker}</span>
                {row.text}
              </span>
            </p>
            <button
              type="button"
              aria-label="Ask about this line"
              title="Ask about this line"
              onClick={() => onQuote({ author: row.speaker, text: row.text, source: 'caption' })}
              className="absolute right-1.5 top-1 inline-flex items-center gap-1 rounded-full border border-line-ctl bg-elev px-2 py-0.5 text-11 font-medium text-t2 transition duration-ctl hover:border-accent hover:text-t1 md:pointer-events-none md:opacity-0 md:group-hover/line:pointer-events-auto md:group-hover/line:opacity-100 md:focus-visible:pointer-events-auto md:focus-visible:opacity-100"
            >
              <AskIcon className="h-3 w-3" />
              Ask
            </button>
          </div>
        ))}
      </div>

      {rows.length > 0 && (
        <p className="border-t border-line px-3 py-1.5 text-11 leading-tight text-t3">
          Auto-generated from speech — wording may be imperfect. The assistant reads this too, so
          you can ask about anything above.
        </p>
      )}
    </section>
  );
};
