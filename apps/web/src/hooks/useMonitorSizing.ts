import { useEffect, useMemo, useRef, useState } from 'react';
import { RIBBON_H, RIBBON_H_EXPANDED } from '../components/host/constants';
export const useMonitorSizing = (aspect: number, ribbonExpanded: boolean): {
    stageRef: React.RefObject<HTMLDivElement>;
    monitorWidth: number | null;
} => {
    const stageRef = useRef<HTMLDivElement>(null);
    const [stage, setStage] = useState({ width: 0, height: 0 });
    useEffect(() => {
        const element = stageRef.current;
        if (!element)
            return;
        const observer = new ResizeObserver((entries) => {
            const rect = entries[0]?.contentRect;
            if (rect)
                setStage({ width: rect.width, height: rect.height });
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    const monitorWidth = useMemo(() => {
        const ribbon = ribbonExpanded ? RIBBON_H_EXPANDED : RIBBON_H;
        const usableHeight = Math.max(0, stage.height - ribbon);
        if (stage.width === 0 || usableHeight === 0)
            return null;
        return Math.min(stage.width, usableHeight * aspect);
    }, [stage, aspect, ribbonExpanded]);
    return { stageRef, monitorWidth };
};
