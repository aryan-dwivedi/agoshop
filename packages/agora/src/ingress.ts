import { unavailable } from '@shop/platform/lib/errors.js';

export const rtmpServerUrl = (region: string): string =>
    `rtmp://rtls-ingress-prod-${region}.agoramdn.com/live`;
export const requireMediaGateway = (enabled: boolean): void => {
    if (!enabled) {
        throw unavailable(
            'media_gateway_disabled',
            'Media Gateway is disabled. Set MEDIA_GATEWAY_ENABLED=true or remove the override that set it to false.',
        );
    }
};
