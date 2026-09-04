export type RtcClientRole = 'host' | 'publisher' | 'audience' | 'subscriber';

export type RtcTokenRole = 'publisher' | 'subscriber';

/**
 * Maps a client's requested RTC role onto the token privilege the server will mint.
 * Publishing is limited to the session host, invited co-host, or platform admin.
 */
export const resolveRtcTokenRole = (
  requested: RtcClientRole | undefined,
  ctx: {
    userId: string;
    userRole: string;
    hostUserId: string | null;
    coHostUserId: string | null;
  },
): RtcTokenRole => {
  const wantsPublisher = requested === 'host' || requested === 'publisher';
  if (!wantsPublisher) return 'subscriber';
  if (ctx.userRole === 'admin') return 'publisher';
  if (ctx.hostUserId === ctx.userId || ctx.coHostUserId === ctx.userId) return 'publisher';
  return 'subscriber';
};
