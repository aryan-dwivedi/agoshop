import type { NextFunction, Request, Response } from 'express';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { rateLimit } from '@shop/platform/lib/ratelimit.js';
import { setLeaderTokenForTests, tryAcquireOrRenewLeader } from '@shop/worker/leader.js';

const { redisEval, redisSet, redisGet, redisExpire } = vi.hoisted(() => ({
    redisEval: vi.fn(),
    redisSet: vi.fn(),
    redisGet: vi.fn(),
    redisExpire: vi.fn(),
}));
vi.mock('@shop/platform/lib/redis.js', () => ({
    redis: {
        eval: redisEval,
        set: redisSet,
        get: redisGet,
        expire: redisExpire,
    },
}));
vi.mock('@shop/platform/env.js', () => ({
    env: { RATE_LIMIT_TRUSTED_CIDRS: [] },
}));
vi.mock('@shop/platform/lib/logger.js', () => ({
    logger: { warn: vi.fn() },
}));

describe('distributed coordination regressions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        redisEval.mockResolvedValue(-1);
        redisSet.mockResolvedValue(null);
    });

    it('charges both authenticated and IP buckets when an IP budget exists', async () => {
        const req = {
            session: { userId: 'guest-session-id' },
            ip: '203.0.113.7',
        } as unknown as Request;
        const res = { setHeader: vi.fn() } as unknown as Response;
        const next = vi.fn() as NextFunction;

        await rateLimit('login', { perMinute: 10, ipPerMinute: 10 })(req, res, next);

        expect(redisEval).toHaveBeenCalledTimes(2);
        expect(redisEval.mock.calls[0]?.[2]).toBe('rl:login:u:guest-session-id');
        expect(redisEval.mock.calls[1]?.[2]).toBe('rl:login:ip:203.0.113.7');
        expect(next).toHaveBeenCalledWith();
    });

    it('renews leadership with one compare-and-expire command', async () => {
        setLeaderTokenForTests('worker-test-token');
        redisEval.mockResolvedValueOnce(1);

        await expect(tryAcquireOrRenewLeader()).resolves.toBe(true);

        expect(redisGet).not.toHaveBeenCalled();
        expect(redisExpire).not.toHaveBeenCalled();
        expect(redisEval).toHaveBeenCalledWith(
            expect.stringContaining("redis.call('EXPIRE'"),
            1,
            'worker:leader',
            'worker-test-token',
            '30',
        );
    });
});
