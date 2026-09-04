import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { create } from 'zustand';
import type { LiveSessionDto } from '@shop/shared';
import { api } from '../../lib/api';
import { useSellerSessions, useUpdateSessionPricing } from '../../lib/sellerApi';
import { useSession } from '../../state/session';
import { CommandPalette, type Command } from '../CommandPalette';
type PaletteState = {
    open: boolean;
    setOpen: (open: boolean) => void;
};
const usePaletteState = create<PaletteState>((set) => ({
    open: false,
    setOpen: (open) => set({ open }),
}));
export const openCommandPalette = (): void => usePaletteState.getState().setOpen(true);
const MAX_LIVE_DISCOUNT_PERCENT = 90;
export const StudioCommands = (): JSX.Element => {
    const { open, setOpen } = usePaletteState();
    const { user } = useSession();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const operator = user !== null && !user.isGuest && user.role === 'seller';
    const sessions = useSellerSessions(operator);
    const rows = sessions.data?.sessions ?? [];
    const live = rows.find((row) => row.status === 'live') ?? null;
    const upcoming = rows
        .filter((row) => row.status === 'scheduled' && row.scheduledFor !== null)
        .sort((a, b) => Date.parse(a.scheduledFor!) - Date.parse(b.scheduledFor!))[0] ?? null;
    const rail = useQuery({
        queryKey: ['session', live?.slug ?? 'none'],
        queryFn: async () => (await api.get<{
            session: LiveSessionDto;
        }>(`/api/sessions/${live?.slug ?? ''}`)).session,
        enabled: live !== null,
        staleTime: 15000,
    });
    const lineUp = rail.data?.products ?? [];
    const pricing = useUpdateSessionPricing();
    const commands = useMemo<Command[]>(() => {
        const noShow = live === null ? 'No show is on air right now.' : null;
        const goLiveTarget = live ?? upcoming;
        const destinations: {
            label: string;
            keywords: string;
            to: string;
        }[] = [
            { label: 'Today', keywords: 'home overview next up', to: '/' },
            { label: 'Shows', keywords: 'sessions schedule live', to: '/shows' },
            { label: 'Catalog', keywords: 'products inventory stock price', to: '/catalog' },
            { label: 'List a product', keywords: 'new product add listing', to: '/catalog/new' },
            { label: 'Orders', keywords: 'sales receipts payment', to: '/orders' },
            { label: 'Payouts', keywords: 'money settlement gross sales', to: '/payouts' },
            { label: 'Audience', keywords: 'moderation chat muted banned viewers', to: '/audience' },
        ];
        const go: Command[] = destinations.map((entry) => ({
            id: `go-${entry.to}`,
            label: entry.label,
            keywords: `go to ${entry.keywords}`,
            section: 'Go to',
            run: () => navigate(entry.to),
        }));
        const show: Command[] = [
            {
                id: 'go-live',
                label: 'go live',
                keywords: 'start broadcast stream preflight camera',
                section: 'This show',
                hint: live !== null
                    ? `“${live.title}” is already on air — opens the room.`
                    : upcoming === null
                        ? undefined
                        : `Pre-flight for “${upcoming.title}”, then the room.`,
                disabledReason: goLiveTarget === null ? 'Nothing is scheduled to go live.' : null,
                run: () => navigate(live !== null ? `/live/${live.slug}` : `/live/${upcoming!.slug}/preflight`),
            },
            {
                id: 'pin',
                label: 'pin',
                keywords: 'feature product card on camera',
                section: 'This show',
                argument: { placeholder: '<n>', required: true },
                hint: lineUp.length === 0
                    ? undefined
                    : `Puts the nth of ${lineUp.length} line-up products on the pin bar.`,
                disabledReason: noShow ??
                    (rail.isLoading
                        ? 'Reading this show’s line-up…'
                        : lineUp.length === 0
                            ? 'This show has no products on its line-up.'
                            : null),
                run: async (argument) => {
                    const product = lineUp[(argument ?? 0) - 1];
                    if (product === undefined) {
                        throw new Error(`This show has ${lineUp.length} product${lineUp.length === 1 ? '' : 's'}, so there is no #${argument ?? 0}.`);
                    }
                    await api.post(`/api/sessions/${live!.id}/pin`, { productId: product.productId });
                    await queryClient.invalidateQueries({ queryKey: ['session'] });
                    navigate(`/live/${live!.slug}`);
                },
            },
            {
                id: 'price',
                label: 'price',
                keywords: 'discount markdown percent off live',
                section: 'This show',
                argument: { placeholder: '<pct>', required: true },
                hint: 'Moves this room’s live-only markdown, in whole percent.',
                disabledReason: noShow,
                run: async (argument) => {
                    const percent = argument ?? 0;
                    if (percent > MAX_LIVE_DISCOUNT_PERCENT) {
                        throw new Error(`A live markdown cannot exceed ${MAX_LIVE_DISCOUNT_PERCENT}%.`);
                    }
                    await pricing.mutateAsync({
                        sessionId: live!.id,
                        discountPercent: percent === 0 ? null : percent,
                    });
                    navigate(`/live/${live!.slug}`);
                },
            },
            {
                id: 'mute',
                label: 'mute',
                keywords: 'microphone mic silence audio',
                section: 'This show',
                hint: 'The mic switch is on the deck — opens the room with it in reach.',
                disabledReason: noShow,
                run: () => navigate(`/live/${live!.slug}`),
            },
            {
                id: 'open-chat',
                label: 'open chat',
                keywords: 'messages moderation viewers room',
                section: 'This show',
                hint: 'Opens the room with the chat panel.',
                disabledReason: noShow,
                run: () => navigate(`/live/${live!.slug}`),
            },
            {
                id: 'end-show',
                label: 'end show',
                keywords: 'stop finish close broadcast',
                section: 'This show',
                hint: 'Takes the room off air for everyone watching.',
                disabledReason: noShow,
                confirm: live === null
                    ? undefined
                    : `End “${live.title}” now? Everyone watching is taken off air and the show cannot be restarted.`,
                run: async () => {
                    await api.post(`/api/sessions/${live!.id}/end`);
                    await queryClient.invalidateQueries({ queryKey: ['seller', 'sessions'] });
                    await queryClient.invalidateQueries({ queryKey: ['sessions'] });
                    navigate('/shows');
                },
            },
        ];
        return [...go, ...show];
    }, [live, lineUp, navigate, pricing, queryClient, rail.isLoading, upcoming]);
    if (!operator)
        return <></>;
    return <CommandPalette open={open} onOpenChange={setOpen} commands={commands}/>;
};
