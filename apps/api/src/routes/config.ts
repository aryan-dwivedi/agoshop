import type { AppConfig } from '@shop/shared';

import { Router } from 'express';

import { env, features } from '@shop/platform/env.js';

export const router = Router();
router.get('/api/config', (_req, res) => {
    const config: AppConfig = {
        agoraAppId: env.AGORA_APP_ID,
        chatServiceAccount: env.CHAT_SERVICE_RTM_USER,
        supportedLanguages: env.CONVOAI_SUPPORTED_LANGUAGES,
        privacyMode: env.PRIVACY_MODE,
        features,
    };
    res.json(config);
});
