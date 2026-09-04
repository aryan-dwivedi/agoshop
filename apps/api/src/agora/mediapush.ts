import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';

import { SAMPLE_HLS_FALLBACK_URL, simulatedHlsForSlug } from '@shop/shared';
import type { LiveSessionDto } from '@shop/shared';

import { db } from '../db/client.js';
import { liveSessions } from '../db/schema.js';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';
import { AGORA_REST_BASE, agoraBasicAuth } from './tokens.js';
import { agoraRestFetch } from './restFetch.js';

/**
 * Agora Media Push — one "Converter" per session, pushing the mixed channel to YOUR
 * CDN over RTMP(S). HLS packaging is the CDN's job; Agora never serves the playlist.
 *
 * `unverified — external RTMP/HLS origin required`. There is no CDN ingest URL or HLS
 * origin in this project, so `MEDIA_PUSH_ENABLED=false` is the shipped default and
 * `hlsOrigin()` returns the seeded per-session VOD ladder labelled `simulated-origin`. The
 * converter API, the tier-transition math, the transition event and the client HLS
 * handoff are all real and exercised against that fixture; setting the three
 * `MEDIA_PUSH_*` values switches to the real converter with no code change. Every
 * surface that reports an origin reports which of the two it is — never "CDN" flat.
 */

const converterBase = () =>
  `${AGORA_REST_BASE}/${env.MEDIA_PUSH_REGION}/v1/projects/${env.AGORA_APP_ID}/rtmp-converters`;

type Json = Record<string, unknown>;

const call = async (
  method: 'POST' | 'GET' | 'DELETE',
  suffix: string,
  body?: Json,
): Promise<{ ok: boolean; status: number; json: Json | null }> => {
  const auth = agoraBasicAuth();
  if (!auth) return { ok: false, status: 0, json: null };
  try {
    const response = await agoraRestFetch(converterBase() + suffix, {
      method,
      headers: {
        Authorization: auth,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    let json: Json | null = null;
    if (text.length > 0) {
      try {
        json = JSON.parse(text) as Json;
      } catch {
        json = { raw: text.slice(0, 512) };
      }
    }
    return { ok: response.ok, status: response.status, json };
  } catch (err) {
    logger.error({ err, suffix }, 'media push request failed');
    return { ok: false, status: 0, json: null };
  }
};

/**
 * Per-slug simulated ladders, resolved once per slug. `hlsOrigin` runs on every
 * session read — list, detail and join — so a filesystem probe per request per
 * session would be pure waste. `db:seed` generates every fixture before the API
 * serves traffic, so a cached miss cannot go stale inside a process lifetime.
 */
const simulatedOriginCache = new Map<string, string>();

const simulatedOriginFor = (slug: string): string => {
  const cached = simulatedOriginCache.get(slug);
  if (cached !== undefined) return cached;
  const playlist = join(env.RECORDING_LOCAL_DIR, 'simulated-origin', slug, 'index.m3u8');
  const resolved = existsSync(playlist) ? simulatedHlsForSlug(slug) : SAMPLE_HLS_FALLBACK_URL;
  simulatedOriginCache.set(slug, resolved);
  return resolved;
};

/**
 * Where the CDN tier plays from, and honestly labelled.
 * `media-push` only once a converter exists for this session; otherwise the seeded
 * VOD ladder, so the transition and the client handoff stay demonstrable. The ladder
 * is per session where one was generated: four rooms sharing one playlist would make
 * "every viewer sees the same frame" indistinguishable from "every viewer sees the
 * same file".
 */
export const hlsOrigin = (session: {
  slug: string;
  hlsUrl: string | null;
  hlsOriginKind: LiveSessionDto['hlsOriginKind'];
}): { hlsUrl: string; hlsOriginKind: 'media-push' | 'simulated-origin' } => {
  if (env.MEDIA_PUSH_ENABLED && session.hlsOriginKind === 'media-push' && session.hlsUrl) {
    return { hlsUrl: session.hlsUrl, hlsOriginKind: 'media-push' };
  }
  return { hlsUrl: simulatedOriginFor(session.slug), hlsOriginKind: 'simulated-origin' };
};

/**
 * True once the CDN tier has something to play. This is the second half of the
 * tier-transition precondition (decision 8): a viewer-count threshold alone must never
 * move an audience onto a dead playlist. With Media Push disabled the simulated origin
 * is a static file that is always ready.
 */
export const hlsOriginReady = (session: { mediaPushStatus: string }): boolean =>
  env.MEDIA_PUSH_ENABLED ? session.mediaPushStatus === 'running' : true;

/**
 * Creates the converter at session start. Transcoded 720p / 1500 Kbps / H.264 —
 * inside the documented 1–10000 Kbps range and the 1080p30 cap. Records its own
 * `mediaPushStatus` and never rolls back a working RTC session.
 */
export const createConverter = async (session: {
  id: string;
  slug: string;
  rtcChannel: string;
}): Promise<void> => {
  if (!env.MEDIA_PUSH_ENABLED) return;
  if (!env.MEDIA_PUSH_RTMP_URL || !env.MEDIA_PUSH_HLS_URL) {
    await db
      .update(liveSessions)
      .set({ mediaPushStatus: 'failed' })
      .where(eq(liveSessions.id, session.id));
    logger.warn(
      { sessionId: session.id },
      'media push enabled but MEDIA_PUSH_RTMP_URL/MEDIA_PUSH_HLS_URL are empty',
    );
    return;
  }

  await db
    .update(liveSessions)
    .set({ mediaPushStatus: 'connecting' })
    .where(eq(liveSessions.id, session.id));

  const rtmpUrl = `${env.MEDIA_PUSH_RTMP_URL.replace(/\/+$/, '')}/${session.slug}`;
  const created = await call('POST', '', {
    converter: {
      name: `live-${session.slug}`,
      rtcChannel: session.rtcChannel,
      transcodeOptions: {
        rtcChannel: session.rtcChannel,
        audioOptions: { profile: 0, sampleRate: 48000, bitrate: 128, channels: 2 },
        videoOptions: {
          codec: 'H264',
          width: 1280,
          height: 720,
          frameRate: 30,
          bitrate: 1500,
          lowLatency: false,
          layoutType: 0,
        },
      },
      rtmpUrl,
      idleTimeout: 300,
    },
  });

  const converter = created.json?.['converter'] as Json | undefined;
  const converterId = converter?.['id'] ?? created.json?.['id'];
  if (!created.ok || typeof converterId !== 'string') {
    await db
      .update(liveSessions)
      .set({ mediaPushStatus: 'failed' })
      .where(eq(liveSessions.id, session.id));
    logger.warn(
      { sessionId: session.id, status: created.status, body: created.json },
      'media push converter creation failed',
    );
    return;
  }

  await db
    .update(liveSessions)
    .set({
      mediaPushConverterId: converterId,
      mediaPushStatus: 'running',
      hlsUrl: `${env.MEDIA_PUSH_HLS_URL.replace(/\/+$/, '')}/${session.slug}.m3u8`,
      hlsOriginKind: 'media-push',
    })
    .where(eq(liveSessions.id, session.id));
  logger.info({ sessionId: session.id, converterId }, 'media push converter running');
};

/** Documented states: connecting | running | failed. */
export const getConverter = async (
  sessionId: string,
): Promise<{ converterId: string; state: string } | null> => {
  const [row] = await db
    .select({ converterId: liveSessions.mediaPushConverterId })
    .from(liveSessions)
    .where(eq(liveSessions.id, sessionId));
  if (!row?.converterId) return null;
  const queried = await call('GET', `/${encodeURIComponent(row.converterId)}`);
  if (!queried.ok) return null;
  const converter = (queried.json?.['converter'] as Json | undefined) ?? queried.json ?? {};
  const state = converter['state'] ?? converter['status'];
  return {
    converterId: row.converterId,
    state: typeof state === 'string' ? state : 'UNKNOWN',
  };
};

/** Idempotent best-effort delete, run after the `live -> ended` DB transition. */
export const deleteConverter = async (sessionId: string): Promise<void> => {
  const [row] = await db
    .select({
      converterId: liveSessions.mediaPushConverterId,
      status: liveSessions.mediaPushStatus,
    })
    .from(liveSessions)
    .where(eq(liveSessions.id, sessionId));
  if (!row?.converterId || row.status === 'off') return;

  await call('DELETE', `/${encodeURIComponent(row.converterId)}`);
  await db
    .update(liveSessions)
    .set({ mediaPushStatus: 'off', mediaPushConverterId: null })
    .where(eq(liveSessions.id, sessionId));
};
