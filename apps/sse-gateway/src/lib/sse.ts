import type { Response } from 'express';

import { logger } from '@shop/platform/lib/logger.js';
import { GLOBAL_CHANNEL, sessionChannel, userChannel } from '@shop/shared';

import { sseClientsGauge } from './metrics.js';
import { subscriber } from './redis.js';

type Client = {
    res: Response;
    userId: string;
    sessionIds: string[];
};
const clients = new Set<Client>();
const byChannel = new Map<string, Set<Client>>();
let wired = false;
const ensureWired = (): void => {
    if (wired) return;
    wired = true;
    subscriber.on('message', (channel, payload) => {
        const targets = byChannel.get(channel);
        if (!targets || targets.size === 0) return;
        for (const client of targets) {
            client.res.write(`data: ${payload}\n\n`);
        }
    });
    void subscriber.subscribe(GLOBAL_CHANNEL);
    byChannel.set(GLOBAL_CHANNEL, new Set());
};
const attach = (channel: string, client: Client): void => {
    let set = byChannel.get(channel);
    if (!set) {
        set = new Set();
        byChannel.set(channel, set);
        if (channel !== GLOBAL_CHANNEL) void subscriber.subscribe(channel);
    }
    set.add(client);
};
const detach = (channel: string, client: Client): void => {
    const set = byChannel.get(channel);
    if (!set) return;
    set.delete(client);
    if (set.size === 0 && channel !== GLOBAL_CHANNEL) {
        byChannel.delete(channel);
        void subscriber.unsubscribe(channel);
    }
};
export const getSseClientCount = (): number => clients.size;
export const drainSseClients = (): void => {
    for (const client of clients) {
        try {
            client.res.write(': shutting down\n\n');
            client.res.end();
        } catch (err) {
            logger.warn({ err }, 'failed to close SSE client during drain');
        }
    }
};
export const addSseClient = (res: Response, userId: string, sessionIds: string[]): void => {
    ensureWired();
    const client: Client = { res, userId, sessionIds };
    clients.add(client);
    sseClientsGauge.set(clients.size);
    attach(GLOBAL_CHANNEL, client);
    attach(userChannel(userId), client);
    for (const sessionId of sessionIds) attach(sessionChannel(sessionId), client);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);
    res.on('close', () => {
        clearInterval(heartbeat);
        clients.delete(client);
        sseClientsGauge.set(clients.size);
        detach(GLOBAL_CHANNEL, client);
        detach(userChannel(userId), client);
        for (const sessionId of sessionIds) detach(sessionChannel(sessionId), client);
    });
};
