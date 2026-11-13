import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import {withTestDatabase} from './helpers/database.mjs';
import {withBrowser, pageActions} from './helpers/browser.mjs';
import {initializeUsers} from '../dist/backend/bootstrap.js';
import {createAuthentication, registerAuthApi} from '../dist/backend/auth.js';
import {registerEntityApi} from '../dist/backend/api.js';
import {registerEntityEvents} from '../dist/backend/entity-events.js';

test('related records page, cache and refresh through the real API', {timeout: 90000}, async t => {
    await withTestDatabase(async ({pool}) => {
        await initializeUsers(pool, {username: 'browser', password: 'browser-test-password'});
        await pool.query("INSERT INTO ssot.estudiantes (legajo, nombre) VALUES ('E001', 'Original')");
        await pool.query("INSERT INTO ssot.departamentos (cod_dep, departamento) VALUES ('DC', 'Computación')");
        await pool.query(`INSERT INTO ssot.materias (cod_mat, cod_dep, materia)
            SELECT 'M' || lpad(n::text, 3, '0'), 'DC', 'Materia ' || n FROM generate_series(1, 202) n`);
        await pool.query(`INSERT INTO ssot.enrolamientos (legajo, cod_mat, cod_dep, año, cuatrimestre)
            SELECT 'E001', cod_mat, cod_dep, 2026, '1C' FROM ssot.materias WHERE cod_mat <> 'M202'`);
        const app = express(), auth = createAuthentication(pool, 'browser-test-secret-with-at-least-32-bytes');
        const publish = registerEntityEvents(app, auth);
        const reads = [];
        let failRelated = false;
        app.use('/api/entities', (req, res, next) => {
            if (req.method === 'GET') {
                reads.push({entity: req.path.slice(1), query: JSON.parse(req.query.query ?? '{}')});
                if (failRelated && req.path === '/enrolamientos') {
                    failRelated = false;
                    res.status(503).json({error: 'Temporarily unavailable'});
                    return;
                }
            }
            next();
        });
        registerAuthApi(app, pool, auth);
        registerEntityApi(app, pool, auth, publish);
        app.use('/assets', express.static('dist/frontend'));
        app.use(express.static('src/frontend/public'));
        const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
        try {
            await withBrowser(async ({send, evaluate, errors}) => {
                const {inPage, waitFor, click, resize, textOf, valueOf} = pageActions({send, evaluate});
                const ready = () => waitFor(() => document.querySelector('.related-rows')?.getAttribute('aria-busy') === 'false');
                const rowCount = () => inPage(() => document.querySelectorAll('.related-rows tbody tr').length);
                await resize(1440, 900);
                await send('Page.navigate', {url: `http://127.0.0.1:${server.address().port}`});
                await waitFor(() => typeof document.querySelector('#login-form')?.onsubmit === 'function');
                await inPage(() => {
                    document.querySelector('#login-user').value = 'browser';
                    document.querySelector('#identity-form').requestSubmit();
                    document.querySelector('#login-password').value = 'browser-test-password';
                    document.querySelector('#login-form').requestSubmit();
                });
                await waitFor(() => !document.querySelector('#workspace').disabled && document.querySelector('[data-entity=estudiantes]'));
                await click('[data-entity=estudiantes]');
                await waitFor(() => !document.querySelector('#workspace').disabled && document.querySelector('tbody [name=nombre]'));
                await inPage(() => {
                    const input = document.querySelector('tbody [name=nombre]');
                    input.value = 'Unsaved draft';
                    input.dispatchEvent(new Event('input', {bubbles: true}));
                });
                reads.length = 0;
                await click('tbody [aria-label="Ver datos actuales"]');
                await ready();

                await t.test('only the current association page and exact visible target keys are fetched', async () => {
                    assert.equal(await rowCount(), 10);
                    assert.match(await textOf('.related-controls [role=status]'), /201 registros · 1 \/ 21/);
                    assert.match(await textOf('.related-scroll'), /M001 — DC — Materia 1/);
                    assert.match(await textOf('.related-scroll'), /2026/);
                    assert.match(await textOf('.related-scroll'), /1C/);
                    assert.deepEqual(reads.filter(read => read.entity === 'enrolamientos'), [
                        {entity: 'enrolamientos', query: {where: {legajo: 'E001'}, page: 1}},
                    ]);
                    const targets = reads.filter(read => read.entity === 'materias');
                    assert.equal(targets.length, 10);
                    assert.ok(targets.every(({query}) => query.where.cod_dep === 'DC' && /^M0[01]\d$/.test(query.where.cod_mat)));
                });
                await t.test('returning to a visited page uses the dialog cache', async () => {
                    await click('.related-controls [aria-label=Siguiente]');
                    await ready();
                    assert.match(await textOf('.related-controls [role=status]'), /2 \/ 21/);
                    assert.match(await textOf('.related-scroll'), /M011 — DC — Materia 11/);
                    const count = reads.length;
                    await click('.related-controls [aria-label=Anterior]');
                    await ready();
                    assert.match(await textOf('.related-controls [role=status]'), /1 \/ 21/);
                    assert.equal(reads.length, count);
                });
                await t.test('live changes refresh target labels and association membership while preserving drafts', async () => {
                    await pool.query("UPDATE ssot.materias SET materia = 'Updated elsewhere' WHERE cod_mat = 'M001'");
                    publish('materias');
                    await waitFor(() => document.querySelector('.related-scroll').textContent.includes('Updated elsewhere'));
                    await pool.query("INSERT INTO ssot.enrolamientos (legajo, cod_mat, cod_dep, año, cuatrimestre) VALUES ('E001', 'M202', 'DC', 2026, '1C')");
                    publish('enrolamientos');
                    await waitFor(() => document.querySelector('.related-controls [role=status]').textContent.includes('202 registros'));
                    assert.equal(await valueOf('.table-scroll tbody [name=nombre]'), 'Unsaved draft');
                });
                await t.test('a failed related load can retry without closing the review', async () => {
                    failRelated = true;
                    await click('.related-controls [aria-label="Actualizar registros relacionados"]');
                    await ready();
                    assert.match(await textOf('.related-controls [role=status]'), /Temporarily unavailable/);
                    assert.equal(await valueOf('.table-scroll tbody [name=nombre]'), 'Unsaved draft');
                    await click('.related-controls [aria-label="Actualizar registros relacionados"]');
                    await ready();
                    assert.equal(await rowCount(), 10);
                    assert.match(await textOf('.related-controls [role=status]'), /202 registros/);
                });
                await t.test('mobile overflow stays inside the dialog and closing releases subscriptions', async () => {
                    await resize(320, 700);
                    assert.equal(await inPage(() => {
                        const dialog = document.querySelector('.review-dialog');
                        return dialog.scrollWidth <= dialog.clientWidth && document.documentElement.scrollWidth <= innerWidth;
                    }), true);
                    await click('.review-dialog > button');
                    await waitFor(() => !document.querySelector('.review-dialog'));
                    const count = reads.length;
                    publish('materias');
                    // Await an SSE event after the change, instead of assuming delivery timing.
                    publish('estudiantes');
                    await waitFor(() => document.querySelector('#status').textContent.includes('Hay datos nuevos'));
                    assert.equal(reads.length, count);
                    assert.equal(await valueOf('.table-scroll tbody [name=nombre]'), 'Unsaved draft');
                });
                await t.test('ending the session closes the review before clearing cached data', async () => {
                    await click('.table-scroll tbody [aria-label="Ver datos actuales"]');
                    await ready();
                    const count = reads.length;
                    await inPage(() => window.dispatchEvent(new Event('sessionexpired')));
                    await waitFor(() => !document.querySelector('.review-dialog') && document.querySelector('#workspace').hidden);
                    assert.equal(reads.length, count, 'Clearing the session must not start new related-record requests');
                });
                assert.deepEqual(errors, []);
            });
        } finally {
            server.closeAllConnections();
            await new Promise(resolve => server.close(resolve));
        }
    });
});
