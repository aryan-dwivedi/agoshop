import { pathToFileURL } from 'node:url';
import { startBackground, stopBackground } from './background.js';
const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entry === import.meta.url) {
    process.on('SIGINT', () => void stopBackground('SIGINT').then(() => process.exit(0)));
    process.on('SIGTERM', () => void stopBackground('SIGTERM').then(() => process.exit(0)));
    startBackground().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
export { startBackground, stopBackground } from './background.js';
export * from './background.js';
export * from './leader.js';
