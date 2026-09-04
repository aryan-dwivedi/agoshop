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
export type AgoraRttCaptionSegment = {
    id: string;
    text: string;
    language: string;
    finalized: boolean;
    absoluteMs: number;
};
const finiteNumber = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
export const parseAgoraRttCaption = async (payload: Uint8Array): Promise<AgoraRttCaptionSegment[]> => {
    const gzipped = payload[0] === 0x1f && payload[1] === 0x8b;
    const raw = gzipped
        ? await new Response(new Blob([payload as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
        : new TextDecoder().decode(payload);
    const envelope = JSON.parse(raw) as {
        transcript?: unknown;
    };
    if (typeof envelope.transcript !== 'object' || envelope.transcript === null)
        return [];
    const transcript = envelope.transcript as AgoraTranscript;
    if (!Array.isArray(transcript.results))
        return [];
    const textTs = finiteNumber(transcript.textTs) ?? Date.now();
    const uid = finiteNumber(transcript.uid) ?? 0;
    const sentenceId = finiteNumber(transcript.sentenceId) ?? textTs;
    const batchOffset = finiteNumber(transcript.offset) ?? 0;
    const language = typeof transcript.language === 'string' ? transcript.language : 'en-US';
    return (transcript.results as AgoraTranscriptResult[]).flatMap((result) => {
        const text = typeof result.text === 'string' ? result.text.trim() : '';
        if (text.length === 0)
            return [];
        const segmentOffset = finiteNumber(result.offset) ?? batchOffset;
        return [
            {
                id: `${uid}:${sentenceId}:${segmentOffset}`,
                text,
                language,
                finalized: result.isFinal === true,
                absoluteMs: Math.max(0, textTs + segmentOffset - batchOffset),
            },
        ];
    });
};
