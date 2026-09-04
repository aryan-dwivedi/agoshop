/** Fixed, non-configurable identifiers shared by web and server. */

/** RTM account that the backend publishes chat as. Clients authorize on this. */
export const DEFAULT_CHAT_SERVICE_ACCOUNT = 'chat-service';

/** RTM account format for a human user. Bound into the RTM token. */
export const rtmAccountForUser = (userId: string): string => `user-${userId}`;

/** RTC channel names. */
export const liveChannelForSlug = (slug: string): string => `live-${slug}`;
export const aiChannelForConversation = (conversationId: string): string => `ai-${conversationId}`;

/** Chat shard channel naming — host, viewer and backend all derive names from this. */
export const chatShardChannel = (slug: string, shardIndex: number): string =>
  `chat-${slug}-${shardIndex}`;

/**
 * RTM allows 50 subscribed channels per client; the host subscribes to every shard,
 * so 49 leaves one channel of headroom.
 */
export const MAX_CHAT_SHARDS = 49;

/** Media fixtures produced by scripts/make-sample-video.sh. */
export const SAMPLE_VOD_FALLBACK_URL = '/media/recordings/sample-session.mp4';
export const SAMPLE_HLS_FALLBACK_URL = '/media/recordings/simulated-origin/index.m3u8';
/**
 * The file feed. The host console can publish it over RTC instead of a webcam, and a
 * viewer room plays it as a standby feed while no host is publishing — both paths are
 * supported, and both say out loud which one is on screen.
 */
export const SAMPLE_LIVE_SOURCE_URL = '/media/recordings/live-source.mp4';

/**
 * Per-session media fixtures. Each category replay needs its own recording so the
 * playback shelf shows the show its card describes. The same files remain valid as
 * standby feeds when a host deliberately starts one of these sessions again; the
 * server only advertises a live source after confirming that its file exists.
 */
export const liveSourceForSlug = (slug: string): string => `/media/recordings/live-${slug}.mp4`;
export const simulatedHlsForSlug = (slug: string): string =>
  `/media/recordings/simulated-origin/${slug}/index.m3u8`;
/**
 * A session's cover art, cut from its own clip by the fixture generator. The storefront
 * prefers this still over decoding a frame in every tile, so a replay shelf costs N
 * images instead of N video decoders. A session without a cover falls back to a frame
 * from its playable media.
 */
export const sessionCoverForSlug = (slug: string): string => `/media/recordings/covers/${slug}.jpg`;

export const CURRENCY = 'INR';
