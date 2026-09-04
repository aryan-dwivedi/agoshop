import { Router } from 'express';

import type { AppConfig } from '@shop/shared';

import { env, features } from '../env.js';

/**
 * The web app receives no Agora secrets — only the App ID, the RTM account it should
 * trust as the chat publisher, and the feature/language switches. The client's chat
 * authorization predicate reads `chatServiceAccount` from here instead of hardcoding
 * the literal, which is what makes CHAT_SERVICE_RTM_USER genuinely configurable.
 */
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
