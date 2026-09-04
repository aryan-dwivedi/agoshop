import type { Role } from '@shop/shared';
import type { Logger } from 'pino';

declare global {
    namespace Express {
        interface Request {
            requestId: string;
            log: Logger;
            session?: {
                id: string;
                userId: string;
                role: Role;
            };
        }
    }
}
export {};
