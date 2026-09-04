const USER_TRANSCRIPTION = 'user.transcription';
export type VoiceTranscriptItem = {
    uid: string;
    turn_id: number;
    stream_id: number;
    metadata: {
        object?: string;
    } | null;
};
export const orderVoiceTranscript = <T extends VoiceTranscriptItem>(items: readonly T[]): T[] =>
    items
        .map((item, arrivalIndex) => ({ item, arrivalIndex }))
        .sort((a, b) => {
            if (a.item.turn_id !== b.item.turn_id) return a.item.turn_id - b.item.turn_id;
            const aIsUser = a.item.metadata?.object === USER_TRANSCRIPTION;
            const bIsUser = b.item.metadata?.object === USER_TRANSCRIPTION;
            if (aIsUser !== bIsUser) {
                const userFirst = a.item.turn_id !== 0;
                return aIsUser === userFirst ? -1 : 1;
            }
            if (a.item.stream_id !== b.item.stream_id) return a.item.stream_id - b.item.stream_id;
            return a.arrivalIndex - b.arrivalIndex;
        })
        .map(({ item }) => item);
export const voiceTranscriptKey = (item: VoiceTranscriptItem): string =>
    `${item.uid}-${item.turn_id}-${item.stream_id}`;
