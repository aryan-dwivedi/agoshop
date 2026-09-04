import { describe, expect, it } from 'vitest';

import { requireMediaGateway, rtmpServerUrl } from '@shop/agora/ingress.js';
import { resolveRtcTokenRole } from '@shop/agora/rtcRole.js';
import { AppError } from '@shop/platform/lib/errors.js';

import { coHostBody } from '../routes/sessions/schemas.js';

describe('co-host invite schema', () => {
    it('rejects invalid email', () => {
        const parsed = coHostBody.safeParse({ email: 'not-an-email' });
        expect(parsed.success).toBe(false);
    });
    it('accepts a valid registered-user email', () => {
        const parsed = coHostBody.safeParse({ email: 'support@demo.test' });
        expect(parsed.success).toBe(true);
    });
});
describe('resolveRtcTokenRole', () => {
    const session = {
        hostUserId: 'host-1',
        coHostUserId: 'cohost-1',
    };
    it('downgrades a random viewer requesting publisher to subscriber', () => {
        expect(
            resolveRtcTokenRole('publisher', {
                userId: 'viewer-1',
                userRole: 'customer',
                ...session,
            }),
        ).toBe('subscriber');
    });
    it('grants publisher to the session host', () => {
        expect(
            resolveRtcTokenRole('host', {
                userId: 'host-1',
                userRole: 'seller',
                ...session,
            }),
        ).toBe('publisher');
    });
    it('grants publisher to the invited co-host', () => {
        expect(
            resolveRtcTokenRole('publisher', {
                userId: 'cohost-1',
                userRole: 'support',
                ...session,
            }),
        ).toBe('publisher');
    });
    it('grants publisher to platform admin regardless of session membership', () => {
        expect(
            resolveRtcTokenRole('host', {
                userId: 'admin-1',
                userRole: 'admin',
                hostUserId: null,
                coHostUserId: null,
            }),
        ).toBe('publisher');
    });
    it('maps audience requests to subscriber', () => {
        expect(
            resolveRtcTokenRole('audience', {
                userId: 'host-1',
                userRole: 'seller',
                ...session,
            }),
        ).toBe('subscriber');
    });
});
describe('media gateway RTMP URL shape', () => {
    it('uses the Agora unified ingress domain pattern', () => {
        expect(rtmpServerUrl('ap')).toMatch(
            /^rtmp:\/\/rtls-ingress-prod-[a-z]{2}\.agoramdn\.com\/live$/,
        );
    });
});
describe('requireMediaGateway', () => {
    it('throws a 503 when Media Gateway is disabled', () => {
        expect(() => requireMediaGateway(false)).toThrow(AppError);
        try {
            requireMediaGateway(false);
        } catch (err) {
            expect(err).toBeInstanceOf(AppError);
            expect((err as AppError).status).toBe(503);
            expect((err as AppError).code).toBe('media_gateway_disabled');
        }
    });
    it('does nothing when Media Gateway is enabled', () => {
        expect(() => requireMediaGateway(true)).not.toThrow();
    });
});
