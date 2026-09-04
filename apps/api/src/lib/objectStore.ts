import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '../env.js';
import { logger } from './logger.js';
export const objectStoreConfigured = env.RECORDING_STORAGE_BUCKET.length > 0 &&
    env.RECORDING_STORAGE_ACCESS_KEY.length > 0 &&
    env.RECORDING_STORAGE_SECRET_KEY.length > 0;
const endpointUrl = (): string | undefined => {
    if (env.RECORDING_STORAGE_ENDPOINT.length === 0)
        return undefined;
    return /^https?:\/\//.test(env.RECORDING_STORAGE_ENDPOINT)
        ? env.RECORDING_STORAGE_ENDPOINT
        : `https://${env.RECORDING_STORAGE_ENDPOINT}`;
};
let client: S3Client | null = null;
const s3 = (): S3Client => {
    if (client)
        return client;
    client = new S3Client({
        region: env.RECORDING_STORAGE_REGION || 'us-east-1',
        endpoint: endpointUrl(),
        forcePathStyle: true,
        credentials: {
            accessKeyId: env.RECORDING_STORAGE_ACCESS_KEY,
            secretAccessKey: env.RECORDING_STORAGE_SECRET_KEY,
        },
    });
    return client;
};
export const publicUrlFor = (key: string): string | null => {
    const base = env.RECORDING_PUBLIC_BASE_URL || endpointUrl();
    if (!base)
        return null;
    return `${base.replace(/\/$/, '')}/${env.RECORDING_STORAGE_BUCKET}/${key}`;
};
export type MirrorResult = {
    mirrored: true;
    key: string;
    url: string;
    bytes: number;
} | {
    mirrored: false;
    reason: string;
};
export const mirrorRecording = async (localPath: string, key: string, contentType: string): Promise<MirrorResult> => {
    if (!objectStoreConfigured)
        return { mirrored: false, reason: 'object_store_not_configured' };
    try {
        const { size } = await stat(localPath);
        await s3().send(new PutObjectCommand({
            Bucket: env.RECORDING_STORAGE_BUCKET,
            Key: key,
            Body: createReadStream(localPath),
            ContentType: contentType,
            ContentLength: size,
        }));
        const url = publicUrlFor(key);
        if (!url)
            return { mirrored: false, reason: 'no_public_base_url' };
        logger.info({ key, bytes: size }, 'recording mirrored to object store');
        return { mirrored: true, key, url, bytes: size };
    }
    catch (err) {
        logger.warn({ err, key }, 'recording mirror failed — keeping the local URL');
        return { mirrored: false, reason: err instanceof Error ? err.message : 'mirror_failed' };
    }
};
export const deleteRecordingObject = async (key: string): Promise<boolean> => {
    if (!objectStoreConfigured)
        return false;
    try {
        await s3().send(new DeleteObjectCommand({ Bucket: env.RECORDING_STORAGE_BUCKET, Key: key }));
        return true;
    }
    catch (err) {
        logger.warn({ err, key }, 'recording object delete failed');
        return false;
    }
};
export const keyFromUrl = (url: string): string | null => {
    const marker = `/${env.RECORDING_STORAGE_BUCKET}/`;
    const at = url.indexOf(marker);
    return at === -1 ? null : url.slice(at + marker.length);
};
