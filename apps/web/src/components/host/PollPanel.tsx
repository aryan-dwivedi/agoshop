import { useCallback, useState } from 'react';
import type { PollDto } from '../../hooks/useLiveSession';
import { api } from '../../lib/api';
import { PollCard } from '../live/PollCard';
export const PollPanel = ({ sessionId, poll, onPollChange, onClose, }: {
    sessionId: string;
    poll: PollDto | null;
    onPollChange: (poll: PollDto | null) => void;
    onClose: () => void;
}): JSX.Element => {
    const [question, setQuestion] = useState('');
    const [options, setOptions] = useState(['', '']);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const submit = useCallback(() => {
        const cleaned = options.map((option) => option.trim()).filter((option) => option.length > 0);
        if (question.trim().length === 0 || cleaned.length < 2) {
            setError('A poll needs a question and at least two answers.');
            return;
        }
        setBusy(true);
        setError(null);
        void api
            .post<{
            poll: PollDto;
        }>(`/api/sessions/${sessionId}/polls`, {
            question: question.trim(),
            options: cleaned,
        })
            .then((result) => {
            onPollChange(result.poll);
            setQuestion('');
            setOptions(['', '']);
        })
            .catch(() => setError('The poll could not be opened.'))
            .finally(() => setBusy(false));
    }, [question, options, sessionId, onPollChange]);
    return (<div role="dialog" aria-label="Poll" className="card animate-slide-up absolute bottom-full left-0 z-30 mb-2 w-[26rem] p-3 shadow-sheet">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-14 font-semibold text-t1">{poll === null ? 'New poll' : 'Poll'}</h2>
        <button type="button" className="btn-quiet btn-sm" onClick={onClose}>
          Close
        </button>
      </div>

      {poll === null ? (<div className="mt-2 space-y-2">
          <input className="input" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Which shade should we restock first?" aria-label="Poll question"/>
          {options.map((option, index) => (<input key={index} className="input" value={option} onChange={(event) => setOptions((current) => current.map((existing, at) => (at === index ? event.target.value : existing)))} placeholder={`Answer ${index + 1}`} aria-label={`Answer ${index + 1}`}/>))}
          <div className="flex items-center gap-2">
            <button type="button" className="btn-quiet btn-sm" disabled={options.length >= 4} onClick={() => setOptions((current) => [...current, ''])}>
              Add an answer
            </button>
            <button type="button" className="btn-commit btn-sm ml-auto" disabled={busy} onClick={submit}>
              {busy ? 'Opening…' : 'Open poll'}
            </button>
          </div>
          {error !== null && <p className="field-error">{error}</p>}
        </div>) : (<div className="mt-2">
          <PollCard poll={poll} onPollChange={onPollChange} canVote={false} canClose/>
        </div>)}
    </div>);
};
