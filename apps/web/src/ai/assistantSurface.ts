import { create } from 'zustand';

/**
 * Who owns the assistant right now.
 *
 * There is one entry point per surface — the top bar's `Ask` on browse, the
 * composer's destination switch inside a session — and never two conversations for
 * one shopper: a live room or a replay claims the assistant on mount, and the browse
 * entry point defers to it rather than burning a second agent slot.
 */
type AssistantSurfaceStore = {
  /** True while a live room or replay owns the assistant. */
  pageOwned: boolean;
  /** Incremented to ask the owning page to reveal its panel. */
  openSignal: number;
  /** Incremented when another surface asks to open the browse assistant. */
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
