import { useCallback, useMemo, useRef, useState } from 'react';

/**
 * Browser-side recording — the replay artifact every demo actually produces.
 *
 * Agora Cloud Recording needs a third-party bucket this project does not have, so the
 * host records the published camera + mic locally with `MediaRecorder` and uploads the
 * blob when the session ends. The mime type is negotiated against the browser rather
 * than assumed, and when nothing in the list is supported the UI says so and the
 * session is marked `recordingStatus='failed'` — it never pretends to record.
 */

const MIME_CANDIDATES = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'] as const;

const EXTENSION_BY_MIME: Record<string, string> = {
  'video/webm': 'webm',
  'video/mp4': 'mp4',
};

export type RecorderState =
  'unsupported' | 'idle' | 'recording' | 'stopped' | 'uploading' | 'uploaded' | 'failed';

export type UseHostRecorderResult = {
  mimeType: string | null;
  supported: boolean;
  state: RecorderState;
  error: string | null;
  sizeBytes: number;
  durationMs: number;
  start: (stream: MediaStream) => void;
  /** Stops the recorder and uploads the artifact. Safe to call when not recording. */
  stopAndUpload: () => Promise<void>;
  /** Tells the server this browser cannot record at all. */
  reportUnsupported: () => Promise<void>;
  /**
   * True while a recorded file is still held in this tab and has not been accepted by
   * the server. It is the honest precondition for `retryUpload`.
   */
  canRetryUpload: boolean;
  /**
   * Re-sends the file the last upload failed on. Valid only while this tab lives: the
   * recording is an in-memory blob, so closing the tab is what actually loses it, and
   * every surface offering this says so in one sentence.
   */
  retryUpload: () => Promise<void>;
};

export const useHostRecorder = (opts: { sessionId: string | null }): UseHostRecorderResult => {
  const { sessionId } = opts;

  const mimeType = useMemo(() => {
    if (typeof MediaRecorder === 'undefined') return null;
    return MIME_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? null;
  }, []);

  const [state, setState] = useState<RecorderState>(mimeType ? 'idle' : 'unsupported');
  const [error, setError] = useState<string | null>(null);
  const [sizeBytes, setSizeBytes] = useState(0);
  const [durationMs, setDurationMs] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);

  const start = useCallback(
    (stream: MediaStream) => {
      if (!mimeType || recorderRef.current) return;
      try {
        const recorder = new MediaRecorder(stream, { mimeType });
        chunksRef.current = [];
        recorder.ondataavailable = (event) => {
          if (event.data.size === 0) return;
          chunksRef.current.push(event.data);
          setSizeBytes((current) => current + event.data.size);
          setDurationMs(Date.now() - startedAtRef.current);
        };
        recorder.onerror = () => {
          setState('failed');
          setError('The browser recorder stopped unexpectedly.');
        };
        startedAtRef.current = Date.now();
        recorder.start(1000);
        recorderRef.current = recorder;
        setState('recording');
        setError(null);
      } catch (err) {
        setState('failed');
        setError(err instanceof Error ? err.message : 'recorder_start_failed');
      }
    },
    [mimeType],
  );

  /**
   * The finished file, retained until the server accepts it. This is what makes a
   * retry possible at all — and what makes it tab-lifetime only, because a blob is
   * memory and nothing more.
   */
  const pendingRef = useRef<{ blob: Blob; durationMs: number } | null>(null);
  const [canRetryUpload, setCanRetryUpload] = useState(false);

  const upload = useCallback(
    async (artifact: { blob: Blob; durationMs: number }): Promise<void> => {
      if (!sessionId || !mimeType) return;
      const baseMime = mimeType.split(';')[0] ?? 'video/webm';
      const extension = EXTENSION_BY_MIME[baseMime] ?? 'webm';

      setState('uploading');
      const form = new FormData();
      form.append('recording', artifact.blob, `session.${extension}`);
      form.append('durationMs', String(artifact.durationMs));

      try {
        const res = await fetch(`/api/sessions/${sessionId}/recording`, {
          method: 'POST',
          credentials: 'include',
          body: form,
        });
        if (!res.ok) throw new Error(`upload_failed_${res.status}`);
        // Accepted: drop the copy this tab was holding.
        pendingRef.current = null;
        setCanRetryUpload(false);
        setError(null);
        setState('uploaded');
      } catch (err) {
        setState('failed');
        setCanRetryUpload(true);
        setError(err instanceof Error ? err.message : 'recording_upload_failed');
      }
    },
    [sessionId, mimeType],
  );

  const stopAndUpload = useCallback(async (): Promise<void> => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder || !sessionId || !mimeType) return;

    // `Promise.withResolvers` is ES2024; this workspace targets the ES2023 lib.
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });

    const duration = Date.now() - startedAtRef.current;
    setDurationMs(duration);

    const baseMime = mimeType.split(';')[0] ?? 'video/webm';
    const artifact = {
      blob: new Blob(chunksRef.current, { type: baseMime }),
      durationMs: duration,
    };
    chunksRef.current = [];
    pendingRef.current = artifact;

    await upload(artifact);
  }, [sessionId, mimeType, upload]);

  const retryUpload = useCallback(async (): Promise<void> => {
    const artifact = pendingRef.current;
    if (!artifact) return;
    await upload(artifact);
  }, [upload]);

  const reportUnsupported = useCallback(async (): Promise<void> => {
    if (!sessionId) return;
    try {
      await fetch(`/api/sessions/${sessionId}/recording`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'unsupported_mimetype' }),
      });
    } catch {
      // Nothing to retry: the session simply stays without a replay artifact.
    }
  }, [sessionId]);

  return {
    mimeType,
    supported: mimeType !== null,
    state,
    error,
    sizeBytes,
    durationMs,
    start,
    stopAndUpload,
    reportUnsupported,
    canRetryUpload,
    retryUpload,
  };
};
