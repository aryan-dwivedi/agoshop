import { unavailable } from '../lib/errors.js';

export const rtmpServerUrl = (region: string): string =>
  `rtmp://rtls-ingress-prod-${region}.agoramdn.com/live`;

/** Throws when Media Gateway ingest is turned off for this deployment. */
export const requireMediaGateway = (enabled: boolean): void => {
  if (!enabled) {
    throw unavailable(
      'media_gateway_disabled',
      'Media Gateway is disabled. Set MEDIA_GATEWAY_ENABLED=true and enable it in Agora Console.',
    );
  }
};
