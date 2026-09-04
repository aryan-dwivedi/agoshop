import { Router } from 'express';
import { sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import { invalidate } from '../lib/cache.js';
import { logger } from '../lib/logger.js';
import { destroySession, requireAuth } from '../middleware/session.js';
export const router = Router();
router.delete('/api/me/data', requireAuth, async (req, res, next) => {
    try {
        const userId = req.session!.userId;
        const removed = await db.transaction(async (tx) => {
            const counts: Record<string, number> = {};
            const run = async (label: string, statement: SQL): Promise<void> => {
                const { rowCount } = await tx.execute(statement);
                counts[label] = rowCount ?? 0;
            };
            const uid = sql `cast(${userId} as uuid)`;
            await run('wishlistItems', sql `delete from wishlist_items where user_id = ${uid}`);
            await run('productViews', sql `delete from product_views where user_id = ${uid}`);
            await run('chatMessages', sql `delete from chat_messages where user_id = ${uid}`);
            await run('pollVotes', sql `delete from poll_votes where user_id = ${uid}`);
            await run('aiToolCalls', sql `delete from ai_tool_calls where conversation_id in
              (select id from ai_conversations where user_id = ${uid})`);
            await run('aiMessages', sql `delete from ai_messages where conversation_id in
              (select id from ai_conversations where user_id = ${uid})`);
            await run('aiConversations', sql `delete from ai_conversations where user_id = ${uid}`);
            await run('cartItems', sql `delete from cart_items where cart_id in
              (select id from carts where user_id = ${uid})`);
            await run('carts', sql `delete from carts where user_id = ${uid}`);
            await run('chatModeration', sql `delete from chat_moderation where target_user_id = ${uid} or actor_user_id = ${uid}`);
            await run('analyticsEvents', sql `update analytics_events set user_id = null where user_id = ${uid}`);
            await run('users', sql `update users
            set deleted_at = now(),
                email = concat('erased+', id::text, '@deleted.invalid'),
                display_name = 'Erased user',
                password_hash = '',
                default_pincode = null,
                banned_at = null
            where id = ${uid}`);
            return counts;
        });
        await invalidate(`rec:v1:${userId}`);
        await destroySession(req, res);
        logger.info({ userId, removed }, 'subject erasure completed');
        res.json({ erased: true, removed });
    }
    catch (err) {
        next(err);
    }
});
