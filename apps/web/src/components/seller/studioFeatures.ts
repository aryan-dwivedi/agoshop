/** Features that are not yet wired — used to gate UI and show "coming soon" messaging. */
export type StudioFeature =
    | 'payouts'
    | 'coverImageUpload'
    | 'productEdit'
    | 'orderFulfillment'
    | 'orderExport'
    | 'audienceModeration'
    | 'settings'
    | 'analyticsExport'
    | 'bulkCatalog';

export const STUDIO_FEATURES: Record<StudioFeature, boolean> = {
    payouts: false,
    coverImageUpload: false,
    productEdit: false,
    orderFulfillment: false,
    orderExport: false,
    audienceModeration: false,
    settings: false,
    analyticsExport: false,
    bulkCatalog: false,
};

export const FEATURE_LABELS: Record<StudioFeature, string> = {
    payouts: 'Payouts & bank settlement',
    coverImageUpload: 'Cover image upload',
    productEdit: 'Full product editing',
    orderFulfillment: 'Order fulfillment',
    orderExport: 'Export orders',
    audienceModeration: 'Audience moderation from this page',
    settings: 'Studio settings',
    analyticsExport: 'Export analytics',
    bulkCatalog: 'Bulk catalog import',
};

export const isFeatureLive = (feature: StudioFeature): boolean => STUDIO_FEATURES[feature];
