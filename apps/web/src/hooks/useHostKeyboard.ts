import { useEffect, type RefObject } from 'react';
import type { HoldToConfirmHandle } from '../components/HoldToConfirm';
export const useHostKeyboard = ({ enabled, endHoldRef, pinSlot, onPinClear, toggleMic, toggleCamera, onPricePanelToggle, onPollPanelToggle, onCaptionsToggle, onKeyMapToggle, onKeyMapClose, onPanelsClose, }: {
    enabled: boolean;
    endHoldRef: RefObject<HoldToConfirmHandle>;
    pinSlot: (index: number) => void;
    onPinClear: () => void;
    toggleMic: () => void | Promise<void>;
    toggleCamera: () => void | Promise<void>;
    onPricePanelToggle: () => void;
    onPollPanelToggle: () => void;
    onCaptionsToggle: () => void;
    onKeyMapToggle: () => void;
    onKeyMapClose: () => void;
    onPanelsClose: () => void;
}): void => {
    useEffect(() => {
        if (!enabled)
            return;
        const onKeyDown = (event: KeyboardEvent): void => {
            const target = event.target as HTMLElement | null;
            if (target !== null &&
                (target.isContentEditable ||
                    target.tagName === 'INPUT' ||
                    target.tagName === 'TEXTAREA' ||
                    target.tagName === 'SELECT')) {
                return;
            }
            if (event.metaKey || event.ctrlKey || event.altKey)
                return;
            if (event.key === '?') {
                event.preventDefault();
                onKeyMapToggle();
                return;
            }
            if (event.key === 'Escape') {
                onKeyMapClose();
                onPanelsClose();
                return;
            }
            if (event.shiftKey) {
                if (event.key === 'E') {
                    event.preventDefault();
                    endHoldRef.current?.begin();
                }
                return;
            }
            if (event.key >= '1' && event.key <= '9') {
                event.preventDefault();
                pinSlot(Number(event.key) - 1);
                return;
            }
            if (event.key === '0') {
                event.preventDefault();
                onPinClear();
                return;
            }
            switch (event.key.toLowerCase()) {
                case 'm':
                    event.preventDefault();
                    void toggleMic();
                    return;
                case 'v':
                    event.preventDefault();
                    void toggleCamera();
                    return;
                case 'd':
                    event.preventDefault();
                    onPricePanelToggle();
                    return;
                case 'p':
                    event.preventDefault();
                    onPollPanelToggle();
                    return;
                case 'c':
                    event.preventDefault();
                    onCaptionsToggle();
                    return;
                default:
                    return;
            }
        };
        const onKeyUp = (event: KeyboardEvent): void => {
            if (event.key === 'E' || event.key === 'e' || event.key === 'Shift') {
                endHoldRef.current?.abort();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
        };
    }, [
        enabled,
        endHoldRef,
        pinSlot,
        onPinClear,
        toggleMic,
        toggleCamera,
        onPricePanelToggle,
        onPollPanelToggle,
        onCaptionsToggle,
        onKeyMapToggle,
        onKeyMapClose,
        onPanelsClose,
    ]);
};
