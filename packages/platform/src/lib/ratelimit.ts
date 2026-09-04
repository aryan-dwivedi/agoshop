import type { NextFunction, Request, Response } from 'express';

import { env } from '../env.js';
import { AppError } from './errors.js';
import { redis } from './redis.js';

const TAKE = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refillPerSec = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local state = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(state[1])
local ts = tonumber(state[2])
if tokens == nil then tokens = capacity; ts = now end
tokens = math.min(capacity, tokens + (now - ts) * refillPerSec)
local allowed = 0
if tokens >= 1 then tokens = tokens - 1; allowed = 1 end
redis.call('HMSET', key, 'tokens', tokens, 'ts', now)
redis.call('EXPIRE', key, math.ceil(capacity / refillPerSec) + 60)
if allowed == 1 then return -1 end
return math.ceil((1 - tokens) / refillPerSec)
`;
const cidrMatches = (ip: string, cidr: string): boolean => {
    const [range, bitsRaw] = cidr.split('/');
    if (!range) return false;
    const bits = Number(bitsRaw ?? 32);
    const toInt = (addr: string) =>
        addr
            .replace(/^::ffff:/, '')
            .split('.')
            .reduce((acc, part) => (acc << 8) + (Number(part) & 255), 0) >>> 0;
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(range)) return false;
    const normalized = ip.replace(/^::ffff:/, '');
    if (normalized === '::1') return cidr.startsWith('127.');
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(normalized)) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (toInt(normalized) & mask) === (toInt(range) & mask);
};
export const isTrustedIp = (ip: string): boolean =>
    env.RATE_LIMIT_TRUSTED_CIDRS.some((cidr) => cidrMatches(ip, cidr));
type Budget = {
    perMinute: number;
    ipPerMinute?: number;
};
const take = async (key: string, perMinute: number): Promise<number> => {
    const retry = (await redis.eval(
        TAKE,
        1,
        key,
        String(perMinute),
        String(perMinute / 60),
        String(Date.now() / 1000),
    )) as number;
    return retry;
};
export const rateLimit =
    (name: string, budget: Budget) =>
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const userId = req.session?.userId;
            if (userId) {
                const retry = await take(`rl:${name}:u:${userId}`, budget.perMinute);
                if (retry >= 0) {
                    res.setHeader('Retry-After', String(Math.max(1, retry)));
                    throw new AppError(429, 'rate_limited', `too many ${name} requests`);
                }
            } else if (budget.ipPerMinute) {
                const ip = req.ip ?? '0.0.0.0';
                if (!isTrustedIp(ip)) {
                    const retry = await take(`rl:${name}:ip:${ip}`, budget.ipPerMinute);
                    if (retry >= 0) {
                        res.setHeader('Retry-After', String(Math.max(1, retry)));
                        throw new AppError(429, 'rate_limited', `too many ${name} requests`);
                    }
                }
            }
            next();
        } catch (err) {
            next(err);
        }
    };
export const BUDGETS = {
    products: { perMinute: 600, ipPerMinute: 1200 },
    cart: { perMinute: 120 },
    chat: { perMinute: 120 },
    reactions: { perMinute: 120 },
    pollVote: { perMinute: 10 },
    aiConversations: { perMinute: 10 },
    orders: { perMinute: 60 },
    login: { perMinute: 10, ipPerMinute: 10 },
} as const;
