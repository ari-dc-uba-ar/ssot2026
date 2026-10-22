import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import {writeFile} from 'node:fs/promises';
import {withTestDatabase} from './helpers/database.mjs';
import {withBrowser, until} from './helpers/browser.mjs';
import {initializeUsers} from '../dist/backend/bootstrap.js';
import {createAuthentication, registerAuthApi} from '../dist/backend/auth.js';
import {registerEntityApi} from '../dist/backend/api.js';
import {registerEntityEvents} from '../dist/backend/entity-events.js';

test('table navigation and spreadsheet work with the real API', {timeout: 90000}, async () => {
    await withTestDatabase(async ({pool}) => {
        await initializeUsers(pool, {username: 'browser', password: 'browser-test-password'});
        await pool.query("INSERT INTO ssot.planes (plan, descripcion) SELECT i, 'Plan ' || i FROM generate_series(1,201) i");
        const app = express(), auth = createAuthentication(pool, 'browser-test-secret-with-at-least-32-bytes');
        const publish = registerEntityEvents(app, auth);
        registerAuthApi(app, pool, auth);
        registerEntityApi(app, pool, auth, publish);
        app.use('/assets', express.static('dist/frontend'));
        app.use(express.static('src/frontend/public'));
        const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
        try {
            await withBrowser(async ({send, evaluate, errors}) => {
                await send('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 1, mobile: true});
                await send('Page.navigate', {url: `http://127.0.0.1:${server.address().port}`});
                await until(() => evaluate("return typeof document.querySelector('#login-form')?.onsubmit === 'function'"));
                await evaluate("document.querySelector('#login-prompt-btn').click(); document.querySelector('#login-user').value='browser'; document.querySelector('#login-password').value='browser-test-password'; document.querySelector('#login-form').requestSubmit();");
                await until(() => evaluate("return !document.querySelector('#workspace').disabled && !!document.querySelector('table')"));
                assert.equal(await evaluate("return document.querySelectorAll('#login-form h3').length"), 0);
                await evaluate("document.querySelector('#open-tables').click()");
                assert.equal(await evaluate("return document.querySelector('#tables-panel').matches(':modal')"), true);
                await evaluate("const input=document.querySelector('#table-search'); input.value='planes'; input.dispatchEvent(new Event('input'))");
                assert.deepEqual(await evaluate("return [...document.querySelectorAll('#table-list button')].filter(b=>!b.hidden).map(b=>b.textContent)"), ['Planes de Estudio']);
                await evaluate("document.querySelector('[data-entity=planes]').click()");
                await until(() => evaluate("return !document.querySelector('#workspace').disabled && document.querySelector('.toolbar h2')?.textContent === 'Planes de Estudio'"));
                assert.equal(await evaluate("return document.querySelector('#tables-panel').open"), false);
                assert.equal(await evaluate("return document.querySelectorAll('tbody tr').length"), 10);
                await send('Emulation.setDeviceMetricsOverride', {width: 390, height: 500, deviceScaleFactor: 1, mobile: true});
                await evaluate("const scroll=document.querySelector('.table-scroll'); scroll.scrollTop=100; scroll.scrollLeft=100;");
                await until(() => evaluate("return document.querySelector('.table-scroll').scrollTop > 0"));
                const geometry = await evaluate(`
                    const scroll=document.querySelector('.table-scroll'), bounds=scroll.getBoundingClientRect();
                    return {overflow: document.documentElement.scrollWidth > innerWidth,
                        header: Math.abs(document.querySelector('thead th').getBoundingClientRect().top - bounds.top),
                        selection: Math.abs(document.querySelector('tbody .selection-col').getBoundingClientRect().left - bounds.left),
                        actions: Math.abs(document.querySelector('tbody .row-actions').getBoundingClientRect().right - bounds.right),
                        controls: document.querySelector('.sheet-controls').getBoundingClientRect().bottom <= bounds.top,
                        bottom: innerHeight - bounds.bottom, horizontal: scroll.scrollWidth > scroll.clientWidth};
                `);
                assert.equal(geometry.overflow, false);
                assert.equal(geometry.controls, true);
                assert.equal(geometry.horizontal, true);
                for (const key of ['header', 'selection', 'actions']) assert.ok(geometry[key] <= 2, JSON.stringify(geometry));
                assert.ok(geometry.bottom <= 10, JSON.stringify(geometry));
                assert.equal(await evaluate("return [...document.querySelectorAll('tbody button')].every(b=>b.getAttribute('aria-label') && b.getBoundingClientRect().height >= 44)"), true);
                if (process.env.UI_SCREENSHOT) {
                    const {data} = await send('Page.captureScreenshot');
                    await writeFile(process.env.UI_SCREENSHOT, Buffer.from(data, 'base64'));
                }
                await evaluate("document.querySelector('#open-tables').click()");
                await send('Input.dispatchKeyEvent', {type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27});
                await until(() => evaluate("return !document.querySelector('#tables-panel').open"));
                assert.deepEqual(errors, []);
            });
        } finally {
            const closed = new Promise(resolve => server.close(resolve));
            server.closeAllConnections();
            await closed;
        }
    });
});
