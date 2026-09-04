import { create } from 'zustand';

type AssistantSurfaceStore = {
    pageOwned: boolean;
    openSignal: number;
    browseRequested: number;
    browseSeedPrompt: string | null;
    claimPage: () => void;
    releasePage: () => void;
    requestOpen: () => void;
    requestBrowseAssistant: (prompt?: string) => void;
    consumeBrowseSeed: () => void;
};
export const useAssistantSurface = create<AssistantSurfaceStore>((set) => ({
    pageOwned: false,
    openSignal: 0,
    browseRequested: 0,
    browseSeedPrompt: null,
    claimPage: () => set({ pageOwned: true }),
    releasePage: () => set({ pageOwned: false }),
    requestOpen: () => set((state) => ({ openSignal: state.openSignal + 1 })),
    requestBrowseAssistant: (prompt) =>
        set((state) => ({
            browseRequested: state.browseRequested + 1,
            browseSeedPrompt: prompt ?? null,
        })),
    consumeBrowseSeed: () => set({ browseSeedPrompt: null }),
}));
