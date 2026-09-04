import type { Role } from '@shop/shared';
export const ROLE_TAG: Partial<Record<Role, string>> = {
    seller: 'Host',
    admin: 'Staff',
};
type Kind = {
    host: boolean;
    moderation?: boolean;
};
export const avatarTone = ({ host, moderation = false }: Kind): string => moderation ? 'bg-surface text-t3' : host ? 'bg-accent-wash text-accent' : 'bg-surface text-t1';
export const nameTone = ({ host, moderation = false }: Kind): string => moderation ? 'text-t3' : host ? 'text-accent' : 'text-t1';
export const ROLE_TAG_CLASS = 'ml-1.5 rounded-chip bg-accent px-1.5 py-px text-11 font-semibold uppercase tracking-[0.08em] text-accent-ink';
