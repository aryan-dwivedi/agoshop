import { AGORA_REST_BASE } from './tokens.js';

const FAILOVER_BASE = 'https://api.sd-rtn.com';
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const basesForUrl = (url: string): string[] => {
    const candidates: string[] = [url];
    if (url.startsWith(AGORA_REST_BASE) && !AGORA_REST_BASE.includes('sd-rtn')) {
        candidates.push(url.replace(AGORA_REST_BASE, FAILOVER_BASE));
    }
    return candidates;
};
export const agoraRestFetch = async (
    url: string,
    init: RequestInit,
    opts?: {
        retries?: number;
    },
): Promise<Response> => {
    const retries = opts?.retries ?? 2;
    let lastError: unknown;
    let lastResponse: Response | undefined;
    for (const candidate of basesForUrl(url)) {
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const response = await fetch(candidate, init);
                if (response.status >= 500) {
                    lastResponse = response;
                    if (attempt < retries) {
                        await sleep(150 * 2 ** attempt);
                        continue;
                    }
                    break;
                }
                return response;
            } catch (err) {
                lastError = err;
                if (attempt < retries) await sleep(150 * 2 ** attempt);
                else break;
            }
        }
    }
    if (lastResponse) return lastResponse;
    throw lastError instanceof Error ? lastError : new Error('agora_rest_unreachable');
};
