import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const recordingDir = join(process.cwd(), 'var', 'recordings-test');

vi.mock('../env.js', () => ({
    env: {
        RECORDING_LOCAL_DIR: recordingDir,
        RECORDING_STORAGE_BUCKET: 'live-commerce',
        RECORDING_STORAGE_ENDPOINT: 'http://127.0.0.1:9000',
        RECORDING_PUBLIC_BASE_URL: 'http://127.0.0.1:9000',
        RECORDING_STORAGE_REGION: 'us-east-1',
        RECORDING_STORAGE_ACCESS_KEY: 'test',
        RECORDING_STORAGE_SECRET_KEY: 'test',
    },
}));

describe('recordingPlayback', () => {
    beforeEach(() => {
        mkdirSync(recordingDir, { recursive: true });
    });
    afterEach(() => {
        vi.resetModules();
    });

    it('prefers a local file when the stored URL points at object storage', async () => {
        writeFileSync(join(recordingDir, 'session.webm'), 'video');
        const { resolveRecordingTarget } = await import('./recordingPlayback.js');
        expect(
            resolveRecordingTarget(
                'http://127.0.0.1:9000/live-commerce/sessions/abc/session.webm',
            ),
        ).toEqual({
            kind: 'local',
            path: join(recordingDir, 'session.webm'),
        });
    });

    it('maps bare object keys to a public playback URL when no local copy exists', async () => {
        const { resolveRecordingTarget } = await import('./recordingPlayback.js');
        expect(resolveRecordingTarget('live-commerce/demo/show.mp4')).toEqual({
            kind: 'remote',
            url: 'http://127.0.0.1:9000/live-commerce/live-commerce/demo/show.mp4',
        });
    });

    it('exposes a stable API playback path for hydrated sessions', async () => {
        const { recordingPlaybackPath } = await import('./recordingPlayback.js');
        expect(recordingPlaybackPath('birthday-sale-sound')).toBe(
            '/api/sessions/birthday-sale-sound/recording/play',
        );
    });
});
