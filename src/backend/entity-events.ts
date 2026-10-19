import type {Express, Response, Request} from 'express';
import type {Authentication} from './auth.js';
import type {EntityName} from './api-contract.js';
import {apiErrorHandler} from './api-errors.js';
import {authenticationEntity} from './system.js';

// The app runs one HTTP process. Only invalidation names, never row data, travel here.
export function registerEntityEvents(app: Express, auth: Authentication) {
    const clients = new Set<Response>();
    const publish = (name: EntityName) => {
        for (const client of clients) {
            client.write(`data: ${JSON.stringify(name)}\n\n`);
            if (name === authenticationEntity) client.end();
        }
    };
    app.get('/api/events', auth.requireUser, (_req: Request, res: Response) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();
        clients.add(res);
        // Reconnection always invalidates the cache, including events missed offline.
        res.write('data: null\n\n');
        const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
        const expiry = setTimeout(() => res.end(), Math.max(0, Number(res.locals['expiresAt']) - Date.now()));
        res.on('close', () => { clearInterval(heartbeat); clearTimeout(expiry); clients.delete(res); });
    }, apiErrorHandler);
    // Authentication operations can change the same users exposed by the CRUD API.
    app.use('/api/auth', (req, res, next) => {
        res.on('finish', () => { if (req.method === 'POST' && req.path !== '/login' && res.statusCode < 300) publish(authenticationEntity); });
        next();
    });
    return publish;
}
