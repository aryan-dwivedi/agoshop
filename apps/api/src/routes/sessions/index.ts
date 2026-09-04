import { Router } from 'express';

import { registerCohostRoutes } from './cohost.js';
import { registerEngagementRoutes } from './engagement.js';
import { registerObsRoutes } from './obs.js';
import { registerMediaRoutes } from './media.js';
import { registerReadRoutes } from './read.js';
import { registerWriteRoutes } from './write.js';

/**
 * Live-session HTTP surface: lifecycle, presence, chat, moderation, reactions, polls,
 * captions and the browser-recording artifact.
 */
export const router: Router = Router();

registerReadRoutes(router);
registerWriteRoutes(router);
registerEngagementRoutes(router);
registerMediaRoutes(router);
registerCohostRoutes(router);
registerObsRoutes(router);
