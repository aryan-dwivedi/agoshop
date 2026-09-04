import type { Router } from 'express';

import { router as adminRouter } from './admin.js';
import { router as aiRouter } from './ai.js';
import { router as authRouter } from './auth.js';
import { router as cartRouter } from './cart.js';
import { router as catalogRouter } from './catalog.js';
import { router as checkoutRouter } from './checkout.js';
import { router as configRouter } from './config.js';
import { router as healthRouter } from './health.js';
import { router as meRouter } from './me.js';
import { router as ordersRouter } from './orders.js';
import { router as pollsRouter } from './polls.js';
import { router as sellerRouter } from './seller.js';
import { router as sellersRouter } from './sellers.js';
import { router as sessionsRouter } from './sessions.js';
import { router as tokensRouter } from './tokens.js';
import { router as webhooksRouter } from './webhooks.js';
import { router as supportRouter } from './support.js';
import { router as pstnRouter } from './pstn.js';
import { mcpRouter } from './mcp.js';
import { completionsRouter } from './completions.js';
import { router as ttsRouter } from '../ai/ttsRoute.js';
import { router as wishlistRouter } from './wishlist.js';

/**
 * The production router set. Every module declares fully-qualified `/api/...` paths,
 * so mount order across modules is irrelevant; ordering *within* a module (for
 * example `/api/products/compare` before `/api/products/:slug`) is that module's job.
 *
 * Tests build a narrower app with `createApp([...])` containing only the slice under
 * test — that is why the app factory takes routers as an argument.
 */
export const allRouters: Router[] = [
  healthRouter,
  configRouter,
  authRouter,
  catalogRouter,
  cartRouter,
  checkoutRouter,
  ordersRouter,
  wishlistRouter,
  meRouter,
  adminRouter,
  tokensRouter,
  sessionsRouter,
  pollsRouter,
  aiRouter,
  completionsRouter,
  mcpRouter,
  ttsRouter,
  supportRouter,
  pstnRouter,
  sellerRouter,
  sellersRouter,
  webhooksRouter,
];
