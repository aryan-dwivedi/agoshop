let draining = false;

/** When true, `/api/health/ready` returns 503 so load balancers stop sending traffic. */
export const setDraining = (value: boolean): void => {
  draining = value;
};

export const isDraining = (): boolean => draining;
