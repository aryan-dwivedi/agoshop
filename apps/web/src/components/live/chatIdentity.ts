import type { Role } from '@shop/shared';

/**
 * One identity vocabulary for every chat surface in the room.
 *
 * `ChatPanel` and `RoomConversation` each used to carry their own copy of the role
 * table plus two six-entry colour rainbows keyed off a hash of the user id. Two
 * copies meant the same shopper could be teal in one panel and violet in the other,
 * and the rainbow itself was six unthemed hues that exist in neither accent ramp.
 *
 * So the palette collapses: an avatar is one surface step with `--text-1` on it, and
 * the only identity the room actually needs to distinguish is the host's, which gets
 * the commit amber as *ink* (legal on dark: 10.85:1 on `--bg`). A moderation notice
 * has no author at all and reads as tertiary text.
 */

export const ROLE_TAG: Partial<Record<Role, string>> = {
  seller: 'Host',
  admin: 'Staff',
};

type Kind = { host: boolean; moderation?: boolean };

/** The initial chip at the left edge of a line. */
export const avatarTone = ({ host, moderation = false }: Kind): string =>
  moderation ? 'bg-surface text-t3' : host ? 'bg-accent-wash text-accent' : 'bg-surface text-t1';

/** The display name itself. */
export const nameTone = ({ host, moderation = false }: Kind): string =>
  moderation ? 'text-t3' : host ? 'text-accent' : 'text-t1';

/** The `Host` / `Staff` tag beside a name — a filled amber chip, dark ink. */
export const ROLE_TAG_CLASS =
  'ml-1.5 rounded-chip bg-accent px-1.5 py-px text-11 font-semibold uppercase tracking-[0.08em] text-accent-ink';
