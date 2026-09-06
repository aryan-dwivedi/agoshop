type AgoraTranscriptResult = {
    text?: unknown;
    isFinal?: unknown;
    offset?: unknown;
};
type AgoraTranscript = {
    uid?: unknown;
    sentenceId?: unknown;
    textTs?: unknown;
    offset?: unknown;
    language?: unknown;
    results?: unknown;
};
type AgoraTranslationResult = {
    language?: unknown;
    texts?: unknown;
    text?: unknown;
    isFinal?: unknown;
    offset?: unknown;
};
type AgoraTranslation = {
    uid?: unknown;
    sentenceId?: unknown;
    textTs?: unknown;
    offset?: unknown;
    results?: unknown;
};
export type AgoraRttCaptionSegment = {
    id: string;
    text: string;
    language: string;
    finalized: boolean;
    absoluteMs: number;
    kind: 'transcript' | 'translation';
};
const finiteNumber = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;
const segmentText = (value: unknown): string => {
    if (typeof value === 'string') return value.trim();
    if (!Array.isArray(value)) return '';
    return value
        .filter((item): item is string => typeof item === 'string')
        .join(' ')
        .trim();
};
const captionId = (uid: number, sentenceId: number, segmentOffset: number): string =>
    `${uid}:${sentenceId}:${segmentOffset}`;
const parseTranscriptEnvelope = (transcript: unknown): AgoraRttCaptionSegment[] => {
    if (typeof transcript !== 'object' || transcript === null) return [];
    const payload = transcript as AgoraTranscript;
    if (!Array.isArray(payload.results)) return [];
    const textTs = finiteNumber(payload.textTs) ?? Date.now();
    const uid = finiteNumber(payload.uid) ?? 0;
    const sentenceId = finiteNumber(payload.sentenceId) ?? textTs;
    const batchOffset = finiteNumber(payload.offset) ?? 0;
    const language = typeof payload.language === 'string' ? payload.language : 'en-US';
    return (payload.results as AgoraTranscriptResult[]).flatMap((result) => {
        const text = typeof result.text === 'string' ? result.text.trim() : '';
        if (text.length === 0) return [];
        const segmentOffset = finiteNumber(result.offset) ?? batchOffset;
        return [
            {
                id: captionId(uid, sentenceId, segmentOffset),
                text,
                language,
                finalized: result.isFinal === true,
                absoluteMs: Math.max(0, textTs + segmentOffset - batchOffset),
                kind: 'transcript' as const,
            },
        ];
    });
};
const parseTranslationEnvelope = (translation: unknown): AgoraRttCaptionSegment[] => {
    if (typeof translation !== 'object' || translation === null) return [];
    const payload = translation as AgoraTranslation;
    if (!Array.isArray(payload.results)) return [];
    const textTs = finiteNumber(payload.textTs) ?? Date.now();
    const uid = finiteNumber(payload.uid) ?? 0;
    const sentenceId = finiteNumber(payload.sentenceId) ?? textTs;
    const batchOffset = finiteNumber(payload.offset) ?? 0;
    return (payload.results as AgoraTranslationResult[]).flatMap((result, index) => {
        const text = segmentText(result.texts ?? result.text);
        if (text.length === 0) return [];
        const language = typeof result.language === 'string' ? result.language : 'en-US';
        const segmentOffset = finiteNumber(result.offset) ?? batchOffset + index;
        return [
            {
                id: captionId(uid, sentenceId, segmentOffset),
                text,
                language,
                finalized: result.isFinal === true,
                absoluteMs: Math.max(0, textTs + segmentOffset - batchOffset),
                kind: 'translation' as const,
            },
        ];
    });
};
export const parseAgoraRttCaption = async (
    payload: Uint8Array,
): Promise<AgoraRttCaptionSegment[]> => {
    const gzipped = payload[0] === 0x1f && payload[1] === 0x8b;
    const raw = gzipped
        ? await new Response(
              new Blob([payload as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip')),
          ).text()
        : new TextDecoder().decode(payload);
    const envelope = JSON.parse(raw) as {
        transcript?: unknown;
        translation?: unknown;
    };
    return [
        ...parseTranscriptEnvelope(envelope.transcript),
        ...parseTranslationEnvelope(envelope.translation),
    ];
};
