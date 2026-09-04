import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { env } from '../env.js';
import { logger } from './logger.js';

/**
 * Object storage for session recordings.
 *
 * This is the production seam the architecture promised, and it is real rather than
 * stubbed: browser-captured recordings are written to the shared volume (so nginx can
 * serve them and replay never depends on which replica accepted the upload) and then
 * mirrored to an S3-compatible bucket, which becomes the authoritative playback URL.
 *
 * Deliberately NOT Agora Cloud Recording: that is a paid add-on, and the browser
 * `MediaRecorder` path already produces a genuine artifact every run. The same
 * credentials work against MinIO, Cloudflare R2, Backblaze B2 or AWS S3 — only
 * `RECORDING_STORAGE_ENDPOINT` changes.
 *
 * Mirroring is best-effort: if the bucket is unreachable the local URL is kept and
 * the failure is logged, because losing the demo artifact would be worse than losing
 * the mirror.
 */

export const objectStoreConfigured =
  env.RECORDING_STORAGE_BUCKET.length > 0 &&
  env.RECORDING_STORAGE_ACCESS_KEY.length > 0 &&
  env.RECORDING_STORAGE_SECRET_KEY.length > 0;

const endpointUrl = (): string | undefined => {
  if (env.RECORDING_STORAGE_ENDPOINT.length === 0) return undefined;
  return /^https?:\/\//.test(env.RECORDING_STORAGE_ENDPOINT)
    ? env.RECORDING_STORAGE_ENDPOINT
    : `https://${env.RECORDING_STORAGE_ENDPOINT}`;
};

let client: S3Client | null = null;

const s3 = (): S3Client => {
  if (client) return client;
  client = new S3Client({
    // `region` is required by the SDK even when the endpoint ignores it.
    region: env.RECORDING_STORAGE_REGION || 'us-east-1',
    endpoint: endpointUrl(),
    // MinIO and most S3-compatible services need path-style addressing, because
    // `<bucket>.<host>` is not a resolvable name for them.
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.RECORDING_STORAGE_ACCESS_KEY,
      secretAccessKey: env.RECORDING_STORAGE_SECRET_KEY,
    },
  });
  return client;
};

/** Public playback URL for a stored object, or null when no public base is known. */
export const publicUrlFor = (key: string): string | null => {
  const base = env.RECORDING_PUBLIC_BASE_URL || endpointUrl();
  if (!base) return null;
  return `${base.replace(/\/$/, '')}/${env.RECORDING_STORAGE_BUCKET}/${key}`;
};

export type MirrorResult =
  { mirrored: true; key: string; url: string; bytes: number } | { mirrored: false; reason: string };

export const mirrorRecording = async (
  localPath: string,
  key: string,
  contentType: string,
): Promise<MirrorResult> => {
  if (!objectStoreConfigured) return { mirrored: false, reason: 'object_store_not_configured' };

  try {
    const { size } = await stat(localPath);
    await s3().send(
      new PutObjectCommand({
        Bucket: env.RECORDING_STORAGE_BUCKET,
        Key: key,
        Body: createReadStream(localPath),
        ContentType: contentType,
        ContentLength: size,
      }),
    );
    const url = publicUrlFor(key);
    if (!url) return { mirrored: false, reason: 'no_public_base_url' };
    logger.info({ key, bytes: size }, 'recording mirrored to object store');
    return { mirrored: true, key, url, bytes: size };
  } catch (err) {
    logger.warn({ err, key }, 'recording mirror failed — keeping the local URL');
    return { mirrored: false, reason: err instanceof Error ? err.message : 'mirror_failed' };
  }
};

/** Best-effort delete, used by manual deletion and the nightly retention purge. */
export const deleteRecordingObject = async (key: string): Promise<boolean> => {
  if (!objectStoreConfigured) return false;
  try {
    await s3().send(new DeleteObjectCommand({ Bucket: env.RECORDING_STORAGE_BUCKET, Key: key }));
    return true;
  } catch (err) {
    logger.warn({ err, key }, 'recording object delete failed');
    return false;
  }
};

/** Recovers the object key from a stored playback URL, for delete and retention. */
export const keyFromUrl = (url: string): string | null => {
  const marker = `/${env.RECORDING_STORAGE_BUCKET}/`;
  const at = url.indexOf(marker);
  return at === -1 ? null : url.slice(at + marker.length);
};
