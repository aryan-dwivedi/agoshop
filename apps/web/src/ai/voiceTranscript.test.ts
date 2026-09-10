import type { VoiceTranscriptItem } from './voiceTranscript';

import { describe, expect, it } from 'vitest';

import {
    isVoiceTranscriptFinal,
    orderVoiceTranscript,
    voiceTranscriptKey,
} from './voiceTranscript';

import { TurnStatus } from 'agora-agent-client-toolkit';

const item = (
    uid: string,
    turnId: number,
    streamId: number,
    object: 'user.transcription' | 'assistant.transcription',
): VoiceTranscriptItem => ({
    uid,
    turn_id: turnId,
    stream_id: streamId,
    metadata: { object },
});
describe('voice transcript finality', () => {
    it('treats completed and interrupted turns as final', () => {
        expect(isVoiceTranscriptFinal(TurnStatus.END)).toBe(true);
        expect(isVoiceTranscriptFinal(TurnStatus.INTERRUPTED)).toBe(true);
        expect(isVoiceTranscriptFinal(TurnStatus.IN_PROGRESS)).toBe(false);
    });
});
describe('voice transcript ordering', () => {
    it('puts a late greeting first and each user utterance before its answer', () => {
        const answer = item('agent', 2, 4, 'assistant.transcription');
        const user = item('viewer', 2, 3, 'user.transcription');
        const greeting = item('agent', 0, 1, 'assistant.transcription');
        const previousAnswer = item('agent', 1, 2, 'assistant.transcription');
        expect(orderVoiceTranscript([answer, user, greeting, previousAnswer])).toEqual([
            greeting,
            previousAnswer,
            user,
            answer,
        ]);
    });
    it('gives separate streams in one turn distinct render keys', () => {
        const beforeTool = item('agent', 3, 7, 'assistant.transcription');
        const afterTool = item('agent', 3, 8, 'assistant.transcription');
        expect(voiceTranscriptKey(beforeTool)).not.toBe(voiceTranscriptKey(afterTool));
    });
});
