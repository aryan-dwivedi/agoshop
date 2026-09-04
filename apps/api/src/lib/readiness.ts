let draining = false;
export const setDraining = (value: boolean): void => {
    draining = value;
};
export const isDraining = (): boolean => draining;
