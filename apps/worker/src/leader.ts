import { hostname } from 'node:os';

import { logger } from '@shop/platform/lib/logger.js';
import { redis } from '@shop/platform/lib/redis.js';

export const LEADER_KEY = 'worker:leader';
export const LEADER_TTL_SECONDS = 30;
export const LEADER_RENEW_INTERVAL_MS = 10000;
let leaderToken = `worker-${process.pid}-${hostname()}`;
let isLeader = false;
export const getIsLeader = (): boolean => isLeader;
export const setLeaderTokenForTests = (token: string): void => {
    leaderToken = token;
};
const acquireOrRenew = async (): Promise<boolean> => {
    const acquired = await redis.set(LEADER_KEY, leaderToken, 'EX', LEADER_TTL_SECONDS, 'NX');
    if (acquired === 'OK') {
        isLeader = true;
        return true;
    }
    const holder = await redis.get(LEADER_KEY);
    if (holder === leaderToken) {
        await redis.expire(LEADER_KEY, LEADER_TTL_SECONDS);
        isLeader = true;
        return true;
    }
    isLeader = false;
    return false;
};
export const tryAcquireOrRenewLeader = acquireOrRenew;
export const startLeaderElection = (
    onChange?: (next: boolean) => void,
): {
    stop: () => void;
} => {
    let timer: NodeJS.Timeout | undefined;
    let stopped = false;
    const tick = async (): Promise<void> => {
        if (stopped) return;
        const wasLeader = isLeader;
        try {
            await acquireOrRenew();
        } catch (err) {
            isLeader = false;
            logger.warn({ err }, 'leader election tick failed');
        }
        if (onChange && wasLeader !== isLeader) onChange(isLeader);
        if (!stopped) timer = setTimeout(() => void tick(), LEADER_RENEW_INTERVAL_MS).unref();
    };
    void tick();
    return {
        stop: () => {
            stopped = true;
            if (timer) clearTimeout(timer);
        },
    };
};
export const releaseLeaderLock = async (): Promise<void> => {
    if (!isLeader) return;
    const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
  else
      return 0
    end
  `;
    try {
        await redis.eval(script, 1, LEADER_KEY, leaderToken);
    } catch (err) {
        logger.warn({ err }, 'leader lock release failed');
    } finally {
        isLeader = false;
    }
};
