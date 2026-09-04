import { SHORTCUTS } from './constants';

export const KeyMapOverlay = ({ onClose }: { onClose: () => void }): JSX.Element => (
  <div className="absolute inset-0 z-40 flex items-center justify-center p-4">
    <button
      type="button"
      aria-label="Close the shortcut list"
      className="absolute inset-0 bg-bg opacity-80"
      onClick={onClose}
    />
    <div
      role="dialog"
      aria-label="Keyboard shortcuts"
      className="card animate-slide-up relative w-[26rem] p-4 shadow-sheet"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="section-title">Shortcuts</h2>
        <button type="button" className="btn-quiet btn-sm" onClick={onClose}>
          Close
        </button>
      </div>
      <dl className="mt-3 space-y-1.5">
        {SHORTCUTS.map((shortcut) => (
          <div key={shortcut.keys} className="flex items-baseline gap-3 text-14">
            <dt className="tnum w-24 shrink-0 font-semibold text-t1">{shortcut.keys}</dt>
            <dd className="text-t2">{shortcut.does}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-13 text-t2">
        Every one of these is also a control you can click. Shortcuts pause while you are typing.
      </p>
    </div>
  </div>
);
