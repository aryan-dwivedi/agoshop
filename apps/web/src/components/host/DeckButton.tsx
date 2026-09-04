/**
 * One deck control: an icon, a word, and its key printed on the control itself.
 * Nothing in this room is reachable only from the keyboard.
 */
export const DeckButton = ({
  shortcut,
  label,
  value,
  tone = 'idle',
  disabled = false,
  icon,
  onClick,
}: {
  shortcut: string;
  label: string;
  /** The current setting, when the control has one worth reading from a metre away. */
  value?: string;
  tone?: 'idle' | 'active' | 'off';
  disabled?: boolean;
  icon: JSX.Element;
  onClick: () => void;
}): JSX.Element => (
  <button
    type="button"
    disabled={disabled}
    aria-keyshortcuts={shortcut}
    onClick={onClick}
    className={`inline-flex h-ctl shrink-0 items-center gap-2 rounded-ctl border px-3 text-14 font-medium transition duration-ctl ease-out disabled:cursor-not-allowed disabled:opacity-50 ${
      tone === 'off'
        ? 'border-danger text-danger'
        : tone === 'active'
          ? 'border-accent text-accent'
          : 'border-line-ctl text-t1 hover:bg-accent-wash'
    }`}
  >
    {icon}
    <span className="flex flex-col items-start leading-tight">
      <span>{label}</span>
      {value !== undefined && <span className="tnum text-11 text-t2">{value}</span>}
    </span>
    <span className="tnum rounded-chip border border-line px-1 text-11 text-t3">{shortcut}</span>
  </button>
);
