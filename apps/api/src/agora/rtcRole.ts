export type RtcClientRole = 'host' | 'publisher' | 'audience' | 'subscriber';
export type RtcTokenRole = 'publisher' | 'subscriber';
export const resolveRtcTokenRole = (requested: RtcClientRole | undefined, ctx: {
    userId: string;
    userRole: string;
    hostUserId: string | null;
    coHostUserId: string | null;
}): RtcTokenRole => {
    const wantsPublisher = requested === 'host' || requested === 'publisher';
    if (!wantsPublisher)
        return 'subscriber';
    if (ctx.userRole === 'admin')
        return 'publisher';
    if (ctx.hostUserId === ctx.userId || ctx.coHostUserId === ctx.userId)
        return 'publisher';
    return 'subscriber';
};
