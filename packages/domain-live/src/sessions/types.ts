import type { liveSessions } from '@shop/db/schema.js';
import type { Role, SessionStatus } from '@shop/shared';

export type SessionRow = typeof liveSessions.$inferSelect & {
    sellerName: string;
    coHostName: string | null;
};
export type SessionFilter = {
    statuses?: SessionStatus[];
    sellerSlug?: string;
};
export type CreateSessionInput = {
    title: string;
    slug?: string;
    description?: string;
    hostName?: string;
    scheduledFor?: string | null;
    language?: string;
    expectedPeakViewers?: number;
    autoStart?: boolean;
    coverImageUrl?: string | null;
    discountPercent?: number | null;
    sellerId?: string;
};
export type UpdateSessionInput = Partial<
    Pick<
        CreateSessionInput,
        | 'title'
        | 'description'
        | 'hostName'
        | 'scheduledFor'
        | 'language'
        | 'expectedPeakViewers'
        | 'coverImageUrl'
        | 'autoStart'
    >
>;
export const VIEWER_TTL_MS = 30000;
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,60}$/;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const STATUS_RANK: Record<SessionStatus, number> = {
    live: 0,
    scheduled: 1,
    ended: 2,
};
export type SessionActor = {
    userId: string;
    role: Role;
    displayName: string;
};
