import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import express from 'express';
import {withTestDatabase} from './helpers/database.mjs';
import {withBrowser, pageActions} from './helpers/browser.mjs';
import {initializeUsers} from '../dist/backend/bootstrap.js';
import {createAuthentication, registerAuthApi} from '../dist/backend/auth.js';
import {registerEntityApi} from '../dist/backend/api.js';
import {registerEntityEvents} from '../dist/backend/entity-events.js';

test('browser restarts restore a session only while its server identity remains valid', {timeout: 60000}, async () => {
    await withTestDatabase(async ({pool}) => {
        await initializeUsers(pool, {username: 'browser', password: 'browser-test-password'});
        const app = express(), auth = createAuthentication(pool, 'browser-test-secret-with-at-least-32-bytes');
        const publish = registerEntityEvents(app, auth);
        let logins = 0;
        app.use('/api/auth/login', (req, _res, next) => { if (req.method === 'POST') logins++; next(); });
        registerAuthApi(app, pool, auth);
        registerEntityApi(app, pool, auth, publish);
        app.use('/assets', express.static('dist/frontend'));
        app.use(express.static('src/frontend/public'));
        const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
        const profile = await mkdtemp(join(tmpdir(), 'ssot-persistent-browser-'));
        const visit = async (browser, action) => {
            const page = pageActions(browser);
            await browser.send('Page.navigate', {url: `http://127.0.0.1:${server.address().port}`});
            await page.waitFor(() => typeof document.querySelector('#login-form')?.onsubmit === 'function');
            await action(page);
            assert.deepEqual(browser.errors, []);
        };
        const signedIn = page => page.waitFor(() => document.querySelector('#session-user').textContent === 'browser' && !document.querySelector('#workspace').disabled);
        try {
            await withBrowser(browser => visit(browser, async page => {
                await page.inPage(() => {
                    document.querySelector('#login-user').value = 'browser';
                    document.querySelector('#identity-form').requestSubmit();
                    document.querySelector('#login-password').value = 'browser-test-password';
                    document.querySelector('#login-form').requestSubmit();
                });
                await signedIn(page);
                assert.equal(await page.inPage(() => {
                    const payload = JSON.parse(atob(localStorage.getItem('ssot-session-token').split('.')[1]));
                    return payload.exp - payload.iat;
                }), 86400);
            }), {profile});
            await withBrowser(browser => visit(browser, async page => {
                await signedIn(page);
                assert.equal(logins, 1, 'A new browser process restores without another login');
                await page.inPage(() => {
                    localStorage.removeItem('ssot-session-token');
                    window.dispatchEvent(new StorageEvent('storage', {key: 'ssot-session-token', newValue: null}));
                });
                await page.waitFor(() => document.querySelector('#workspace').hidden);
            }), {profile});
            await withBrowser(browser => visit(browser, async page => {
                assert.equal(await page.inPage(() => localStorage.getItem('ssot-session-token')), null);
                assert.equal(await page.inPage(() => document.querySelector('#workspace').hidden), true);
            }), {profile});
        } finally {
            server.closeAllConnections();
            await new Promise(resolve => server.close(resolve));
            // Exact temporary profile created by this test.
            await rm(profile, {recursive: true, force: true, maxRetries: 20, retryDelay: 200});
        }
    });
});
