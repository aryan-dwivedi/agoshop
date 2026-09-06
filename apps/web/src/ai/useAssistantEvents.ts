import type { AssistantLine } from './useVoiceAgent';
import type { AiProductCard, ServerEvent } from '@shop/shared';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { EVENTS } from '@shop/shared';

import { useSheet } from '../components/RightSheet';
import { useServerEvents } from '../lib/useServerEvents';

type AiToolExecuted = {
    conversationId: string;
    tool: string;
};
type AiProductsShown = {
    conversationId: string;
    turnId: number;
    products: AiProductCard[];
};
const mergeVoiceProducts = (
    lines: readonly AssistantLine[],
    voiceProducts: Readonly<Record<number, AiProductCard[]>>,
): AssistantLine[] => {
    const byTurn = new Map(
        Object.entries(voiceProducts).map(([turnId, products]) => [Number(turnId), products]),
    );
    let lastAssistantIdx = -1;
    for (let i = lines.length - 1; i >= 0; i -= 1) {
        if (lines[i]?.role === 'assistant') {
            lastAssistantIdx = i;
            break;
        }
    }
    return lines.map((line, idx) => {
        if (line.role !== 'assistant' || line.turnId === null) return line;
        const exact = byTurn.get(line.turnId);
        if (exact) {
            byTurn.delete(line.turnId);
            return { ...line, products: exact };
        }
        if (idx === lastAssistantIdx) {
            const orphan = [...byTurn.values()].flat();
            if (orphan.length > 0) {
                byTurn.clear();
                return { ...line, products: orphan };
            }
        }
        return line;
    });
};
export type UseAssistantEventsResult = {
    lines: AssistantLine[];
};
export const useAssistantEvents = (opts: {
    conversationId: string | null;
    lines: AssistantLine[];
}): UseAssistantEventsResult => {
    const { conversationId, lines } = opts;
    const queryClient = useQueryClient();
    const openSheet = useSheet((state) => state.openSheet);
    const [voiceProducts, setVoiceProducts] = useState<Record<number, AiProductCard[]>>({});
    useEffect(() => setVoiceProducts({}), [conversationId]);
    const onEvent = useCallback(
        (event: ServerEvent) => {
            if (event.event === EVENTS.aiProductsShown) {
                const shown = event.data as AiProductsShown;
                if (shown.conversationId !== conversationId) return;
                setVoiceProducts((current) => ({
                    ...current,
                    [shown.turnId]: shown.products,
                }));
                return;
            }
            if (event.event !== EVENTS.aiToolExecuted) return;
            const data = event.data as AiToolExecuted;
            if (data.conversationId !== conversationId) return;
            if (data.tool !== 'add_to_cart' && data.tool !== 'add_to_wishlist') return;
            if (data.tool === 'add_to_wishlist') {
                void queryClient.invalidateQueries({ queryKey: ['wishlist'] });
                void queryClient.invalidateQueries({ queryKey: ['recommendations'] });
            }
            void queryClient.invalidateQueries({ queryKey: ['cart'] });
            if (data.tool === 'add_to_cart') openSheet('cart');
        },
        [conversationId, openSheet, queryClient],
    );
    useServerEvents({ enabled: conversationId !== null, onEvent });
    const merged = useMemo(() => mergeVoiceProducts(lines, voiceProducts), [lines, voiceProducts]);
    return { lines: merged };
};
