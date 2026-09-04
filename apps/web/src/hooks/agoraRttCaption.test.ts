import { describe, expect, it } from 'vitest';
import { parseAgoraRttCaption } from './agoraRttCaption';
const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
describe('Agora RTT JSON caption parsing', () => {
    it('returns every segment from the current transcript.results protocol', async () => {
        const payload = encode({
            transcript: {
                uid: 42,
                textTs: 1710000012345,
                offset: 1000,
                duration: 500,
                language: 'en-US',
                text: 'Hello.',
                isFinal: true,
                sentenceId: 1710000012000,
                results: [
                    { text: 'Hello.', isFinal: true, offset: 1000, duration: 200 },
                    { text: 'How', isFinal: false, offset: 1300, duration: 200 },
                ],
            },
        });
        await expect(parseAgoraRttCaption(payload)).resolves.toEqual([
            {
                id: '42:1710000012000:1000',
                text: 'Hello.',
                language: 'en-US',
                finalized: true,
                absoluteMs: 1710000012345,
            },
            {
                id: '42:1710000012000:1300',
                text: 'How',
                language: 'en-US',
                finalized: false,
                absoluteMs: 1710000012645,
            },
        ]);
    });
    it('ignores the documented empty-results follow-up instead of duplicating text', async () => {
        const payload = encode({
            transcript: {
                textTs: 1710000012345,
                offset: 1000,
                language: 'en-US',
                text: 'Hello.',
                isFinal: true,
                results: [],
            },
        });
        await expect(parseAgoraRttCaption(payload)).resolves.toEqual([]);
    });
    it('inflates gzip-compressed protocol messages', async () => {
        const raw = encode({
            transcript: {
                textTs: 1710000012345,
                offset: 1000,
                language: 'en-US',
                results: [{ text: 'Ready to shop.', isFinal: true, offset: 1000, duration: 200 }],
            },
        });
        const compressed = new Uint8Array(await new Response(new Blob([raw as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
        await expect(parseAgoraRttCaption(compressed)).resolves.toEqual([
            {
                id: '0:1710000012345:1000',
                text: 'Ready to shop.',
                language: 'en-US',
                finalized: true,
                absoluteMs: 1710000012345,
            },
        ]);
    });
    it('keeps one id while an interim segment text changes', async () => {
        const message = (text: string, isFinal: boolean) => encode({
            transcript: {
                uid: 42,
                textTs: 1710000012345,
                offset: 1300,
                language: 'en-US',
                sentenceId: 1710000012000,
                results: [{ text, isFinal, offset: 1300, duration: 200 }],
            },
        });
        const [interim, finalized] = await Promise.all([
            parseAgoraRttCaption(message('This is real', false)),
            parseAgoraRttCaption(message('This is real time.', true)),
        ]);
        expect(interim[0]?.id).toBe('42:1710000012000:1300');
        expect(finalized[0]?.id).toBe(interim[0]?.id);
    });
});
