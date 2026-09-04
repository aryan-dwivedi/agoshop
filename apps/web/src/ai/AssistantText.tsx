import { Fragment } from 'react';

/**
 * The assistant writes for two channels at once: a TTS voice, which ignores markup,
 * and this panel, which was rendering `**VoltCore**` literally. Rather than pull a
 * markdown engine (and its sanitiser) into the bundle for two constructs, the three
 * things a shopping answer actually uses are rendered here: emphasis, list lines and
 * paragraph breaks. Anything else stays verbatim text — there is no HTML path, so
 * model output can never inject markup.
 */

const EMPHASIS = /(\*\*[^*]+\*\*|\*[^*\n]+\*)/g;

const inline = (text: string, keyPrefix: string): JSX.Element[] =>
  text.split(EMPHASIS).map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={key} className="font-semibold text-t1">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return (
        <em key={key} className="italic">
          {part.slice(1, -1)}
        </em>
      );
    }
    return <Fragment key={key}>{part}</Fragment>;
  });

/** `- item`, `* item` and `1. item` all read as one bulleted line. */
const BULLET = /^\s*(?:[-*•]|\d+\.)\s+/;

export const AssistantText = ({ text }: { text: string }): JSX.Element => {
  // Horizontal rules and heading hashes are noise in a 380px panel.
  const lines = text
    .split('\n')
    .map((line) => line.replace(/^\s*#{1,6}\s*/, '').trimEnd())
    .filter(
      (line, index, all) =>
        !/^\s*[-—_]{3,}\s*$/.test(line) && !(line === '' && all[index - 1] === ''),
    );

  return (
    <div className="space-y-1.5">
      {lines.map((line, index) => {
        if (line.trim().length === 0) return <div key={`gap-${index}`} className="h-1" />;
        const bullet = BULLET.test(line);
        return bullet ? (
          <div key={`line-${index}`} className="flex gap-2">
            <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-t3" />
            <span className="min-w-0">{inline(line.replace(BULLET, ''), `line-${index}`)}</span>
          </div>
        ) : (
          <p key={`line-${index}`}>{inline(line, `line-${index}`)}</p>
        );
      })}
    </div>
  );
};
