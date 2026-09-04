import { describe, expect, it } from 'vitest';

import {
  orderVoiceTranscript,
  voiceTranscriptKey,
  type VoiceTranscriptItem,
} from './voiceTranscript';

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
