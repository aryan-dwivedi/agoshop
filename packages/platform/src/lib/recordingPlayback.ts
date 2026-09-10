import type { Response } from 'express';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import { GetObjectCommand } from '@aws-sdk/client-s3';

import { env } from '../env.js';
import { keyFromUrl, objectStoreConfigured, publicUrlFor, s3Client } from './objectStore.js';

const MEDIA_PREFIX = '/media/recordings/';
const LEGACY_RECORDING_DIR = '/var/lib/live-commerce/recordings';
const MIME_BY_EXT: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.mkv': 'video/x-matroska',
    '.m3u8': 'application/vnd.apple.mpegurl',
    '.ts': 'video/mp2t',
};
export const recordingPlaybackPath = (sessionKey: string): string =>
    `/api/sessions/${sessionKey}/recording/play`;
export const normalizeStoredRecordingUrl = (stored: string): string => {
    if (
        stored.startsWith(MEDIA_PREFIX) ||
        stored.startsWith('http://') ||
        stored.startsWith('https://')
    ) {
        return stored;
    }
    return publicUrlFor(stored) ?? stored;
};
export type RecordingTarget =
    | {
          kind: 'local';
          path: string;
      }
    | {
          kind: 'remote';
          url: string;
      }
    | {
          kind: 'object';
          key: string;
      };
const contentTypeFor = (name: string): string | undefined => {
    const dot = name.lastIndexOf('.');
    if (dot === -1) return undefined;
    return MIME_BY_EXT[name.slice(dot).toLowerCase()];
};
const localTargetForName = (name: string): RecordingTarget | null => {
    if (name.length === 0 || name.includes('/') || name.includes('..')) return null;
    for (const dir of [env.RECORDING_LOCAL_DIR, LEGACY_RECORDING_DIR]) {
        const path = join(dir, name);
        if (existsSync(path)) return { kind: 'local', path };
    }
    return null;
};
export const resolveRecordingTarget = (stored: string): RecordingTarget | null => {
    if (stored.startsWith(MEDIA_PREFIX)) {
        const local = localTargetForName(stored.slice(MEDIA_PREFIX.length));
        if (local) return local;
    }
    if (stored.startsWith('http://') || stored.startsWith('https://')) {
        const key = keyFromUrl(stored);
        if (key) {
            const local = localTargetForName(basename(key));
            if (local) return local;
            if (objectStoreConfigured) return { kind: 'object', key };
        }
        return { kind: 'remote', url: stored };
    }
    if (objectStoreConfigured) {
        const local = localTargetForName(basename(stored));
        if (local) return local;
        const publicUrl = publicUrlFor(stored);
        if (publicUrl) return { kind: 'remote', url: publicUrl };
        return { kind: 'object', key: stored };
    }
    return null;
};
const parseRange = (
    rangeHeader: string | undefined,
    size: number,
): { start: number; end: number } | null => {
    if (!rangeHeader?.startsWith('bytes=')) return null;
    const [startText, endText] = rangeHeader.slice(6).split('-', 2);
    const start = Number(startText);
    const end = endText ? Number(endText) : size - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end >= size) {
        return null;
    }
    return { start, end };
};
const streamLocal = async (
    path: string,
    rangeHeader: string | undefined,
    res: Response,
): Promise<void> => {
    const { size } = await stat(path);
    const type = contentTypeFor(basename(path));
    if (type) res.setHeader('Content-Type', type);
    res.setHeader('Accept-Ranges', 'bytes');
    const range = parseRange(rangeHeader, size);
    if (range === null) {
        res.setHeader('Content-Length', String(size));
        res.status(200);
        await pipeline(createReadStream(path), res);
        return;
    }
    const chunk = range.end - range.start + 1;
    res.status(206);
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
    res.setHeader('Content-Length', String(chunk));
    await pipeline(createReadStream(path, { start: range.start, end: range.end }), res);
};
const streamObject = async (
    key: string,
    rangeHeader: string | undefined,
    res: Response,
): Promise<void> => {
    const response = await s3Client().send(
        new GetObjectCommand({
            Bucket: env.RECORDING_STORAGE_BUCKET,
            Key: key,
            ...(rangeHeader ? { Range: rangeHeader } : {}),
        }),
    );
    const body = response.Body;
    if (!body || typeof body === 'string') {
        res.status(404).end();
        return;
    }
    const type = response.ContentType ?? contentTypeFor(key);
    if (type) res.setHeader('Content-Type', type);
    if (response.ContentRange) res.setHeader('Content-Range', response.ContentRange);
    if (response.ContentLength !== undefined) {
        res.setHeader('Content-Length', String(response.ContentLength));
    }
    res.setHeader('Accept-Ranges', 'bytes');
    res.status(rangeHeader && response.ContentRange ? 206 : 200);
    await pipeline(body as NodeJS.ReadableStream, res);
};
export const streamRecording = async (
    stored: string,
    rangeHeader: string | undefined,
    res: Response,
): Promise<boolean> => {
    const target = resolveRecordingTarget(stored);
    if (!target) return false;
    if (target.kind === 'local') {
        await streamLocal(target.path, rangeHeader, res);
        return true;
    }
    if (target.kind === 'object') {
        await streamObject(target.key, rangeHeader, res);
        return true;
    }
    res.redirect(302, target.url);
    return true;
};
