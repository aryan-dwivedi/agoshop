import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { EVENTS, type AiProductCard, type ServerEvent } from '@shop/shared';
import { useServerEvents } from '../lib/useServerEvents';
import { useSheet } from '../components/RightSheet';
import type { AssistantLine } from './useVoiceAgent';
type AiToolExecuted = {
    conversationId: string;
    tool: string;
};
type AiProductsShown = {
    conversationId: string;
    turnId: number;
    products: AiProductCard[];
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
    const onEvent = useCallback((event: ServerEvent) => {
        if (event.event === EVENTS.aiProductsShown) {
            const shown = event.data as AiProductsShown;
            if (shown.conversationId !== conversationId)
                return;
            setVoiceProducts((current) => ({ ...current, [shown.turnId]: shown.products }));
            return;
        }
        if (event.event !== EVENTS.aiToolExecuted)
            return;
        const data = event.data as AiToolExecuted;
        if (data.conversationId !== conversationId)
            return;
        if (data.tool !== 'add_to_cart' && data.tool !== 'add_to_wishlist')
            return;
        if (data.tool === 'add_to_wishlist') {
            void queryClient.invalidateQueries({ queryKey: ['wishlist'] });
            void queryClient.invalidateQueries({ queryKey: ['recommendations'] });
        }
        void queryClient.invalidateQueries({ queryKey: ['cart'] });
        if (data.tool === 'add_to_cart')
            openSheet('cart');
    }, [conversationId, openSheet, queryClient]);
    useServerEvents({ enabled: conversationId !== null, onEvent });
    const merged = useMemo(() => lines.map((line) => line.role === 'assistant' && line.turnId !== null && voiceProducts[line.turnId]
        ? { ...line, products: voiceProducts[line.turnId] as AiProductCard[] }
        : line), [lines, voiceProducts]);
    return { lines: merged };
};
