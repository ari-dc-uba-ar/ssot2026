import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import express from 'express';
import {withTestDatabase} from './helpers/database.mjs';
import {withBrowser, until} from './helpers/browser.mjs';
import {initializeUsers} from '../dist/backend/bootstrap.js';
import {createAuthentication, registerAuthApi} from '../dist/backend/auth.js';
import {registerEntityApi} from '../dist/backend/api.js';
import {registerEntityEvents} from '../dist/backend/entity-events.js';

test('theme preferences, row edits and sessions survive navigation and live invalidation', {timeout: 90000}, async t => {
    await withTestDatabase(async ({pool}) => {
        await initializeUsers(pool, {username: 'browser', password: 'browser-test-password'});
        await pool.query("INSERT INTO ssot.estudiantes (legajo, nombre) VALUES ('E001', 'Original')");
        await pool.query("INSERT INTO ssot.departamentos (cod_dep, departamento) VALUES ('DC', 'Computación')");
        await pool.query("INSERT INTO ssot.materias (cod_mat, cod_dep, materia) VALUES ('ALG', 'DC', 'Algoritmos'), ('OTRA', 'DC', 'Otra materia')");
        await pool.query("INSERT INTO ssot.enrolamientos (legajo, cod_mat, cod_dep, año, cuatrimestre) VALUES ('E001', 'ALG', 'DC', 2026, '1C')");
        const app = express(), auth = createAuthentication(pool, 'browser-test-secret-with-at-least-32-bytes');
        const publish = registerEntityEvents(app, auth);
        let interruptReload = false, interrupted = 0, inserts = 0, updates = 0, reads = 0;
        app.use('/api/entities/estudiantes', (req, res, next) => {
            if (req.method === 'GET') reads++;
            if (req.method === 'POST' && req.path === '/') inserts++;
            if (req.method === 'PUT') updates++;
            if (req.method === 'GET' && interruptReload) {
                interruptReload = false;
                const json = res.json.bind(res);
                res.json = body => {
                    interrupted++;
                    publish('estudiantes');
                    setTimeout(() => json(body), 100);
                    return res;
                };
            }
            next();
        });
        let logins = 0, restoreUnavailable = false;
        app.use('/api/auth', (req, res, next) => {
            if (req.method === 'POST' && req.path === '/login') logins++;
            if (req.path === '/me' && restoreUnavailable) {
                restoreUnavailable = false;
                res.status(503).json({error: 'Temporarily unavailable'});
                return;
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
                const inPage = (fn, ...args) => evaluate(`return (${fn})(...${JSON.stringify(args)})`);
                const waitFor = async (fn, ...args) => {
                    try { await until(() => inPage(fn, ...args)); }
                    catch (error) { throw new Error(`Waiting for ${fn}: ${error.message}`, {cause: error}); }
                };
                const click = selector => inPage(selector => document.querySelector(selector).click(), selector);
                const enter = (selector, value) => inPage((selector, value) => {
                    const input = document.querySelector(selector);
                    const none = input.closest('.field').querySelector('input[type=checkbox]');
                    if (none?.checked) none.click();
                    input.value = value;
                    input.dispatchEvent(new Event('input', {bubbles: true}));
                }, selector, value);
                const idle = () => waitFor(() => !document.querySelector('#workspace').disabled);
                const ready = () => waitFor(() => typeof document.querySelector('#login-form')?.onsubmit === 'function');
                const signedIn = () => waitFor(() => !document.querySelector('#workspace')?.disabled &&
                    document.querySelector('#session-user')?.textContent === 'browser' && document.querySelector('table'));
                const signIn = async () => {
                    await inPage(() => {
                        document.querySelector('#login-user').value = 'browser';
                        document.querySelector('#identity-form').requestSubmit();
                        document.querySelector('#login-password').value = 'browser-test-password';
                        document.querySelector('#login-form').requestSubmit();
                    });
                    await signedIn();
                };
                const signedOut = () => waitFor(() => !document.querySelector('#authentication')?.hidden &&
                    document.querySelector('#workspace')?.hidden && !sessionStorage.getItem('ssot-session-token'));
                const base = `http://127.0.0.1:${server.address().port}`;
                await send('Emulation.setDeviceMetricsOverride', {width: 1440, height: 900, deviceScaleFactor: 1, mobile: false});
                await send('Emulation.setEmulatedMedia', {features: [{name: 'prefers-color-scheme', value: 'dark'}]});
                await send('Page.navigate', {url: base});
                await ready();

                await t.test('a header control overrides the system palette and remembers the choice', async () => {
                    assert.equal(await inPage(() => document.documentElement.dataset.theme), 'dark');
                    assert.equal(await inPage(() => getComputedStyle(document.documentElement).colorScheme), 'dark');
                    await click('#theme-toggle');
                    assert.equal(await inPage(() => document.documentElement.dataset.theme), 'light');
                    assert.equal(await inPage(() => getComputedStyle(document.documentElement).colorScheme), 'light');
                    assert.equal(await inPage(() => document.querySelector('#theme-toggle').getAttribute('aria-pressed')), 'false');
                    await send('Page.reload');
                    await ready();
                    assert.equal(await inPage(() => document.documentElement.dataset.theme), 'light');
                    await click('#theme-toggle');
                    await send('Page.reload');
                    await ready();
                    assert.equal(await inPage(() => document.documentElement.dataset.theme), 'dark');
                    await send('Emulation.setDeviceMetricsOverride', {width: 320, height: 700, deviceScaleFactor: 1, mobile: true});
                    assert.equal(await inPage(() => {
                        const rect = document.querySelector('#theme-toggle').getBoundingClientRect();
                        return rect.width >= 44 && rect.height >= 44 && rect.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth;
                    }), true);
                    await send('Emulation.setDeviceMetricsOverride', {width: 1440, height: 900, deviceScaleFactor: 1, mobile: false});
                });

                await signIn();
                await waitFor(() => {
                    if (document.querySelector('#workspace').disabled) return false;
                    document.querySelector('[data-entity=estudiantes]').click();
                    return true;
                });
                await waitFor(() => !document.querySelector('#workspace').disabled && document.querySelector('.sheet-heading h2')?.textContent === 'Estudiantes');

                await t.test('editing fields never saves until Guardar, and Cancelar discards only that draft', async () => {
                    await inPage(() => {
                        const checkbox = document.querySelector('tbody .selection-col input');
                        checkbox.focus();
                        checkbox.click();
                    });
                    assert.equal(await inPage(() => document.activeElement.getAttribute('aria-label')), 'Seleccionar fila E001');
                    await enter('tbody [name=nombre]', 'Draft');
                    await inPage(() => {
                        document.querySelector('tbody [name=nombre]').dispatchEvent(new Event('change', {bubbles: true}));
                        document.querySelector('tbody [name=legajo]').focus();
                    });
                    assert.equal(updates, 0);
                    assert.equal((await pool.query("SELECT nombre FROM ssot.estudiantes WHERE legajo = 'E001'")).rows[0].nombre, 'Original');
                    assert.equal(await inPage(() => document.querySelector('tbody [aria-label=Guardar]').hidden), false);
                    await click('tbody [aria-label=Cancelar]');
                    await click('#confirm-ok');
                    assert.equal(await inPage(() => document.querySelector('tbody [name=nombre]').value), 'Original');
                    assert.equal(await inPage(() => document.querySelector('tbody [aria-label=Guardar]').hidden), true);
                    assert.equal(updates, 0);
                });

                await t.test('saving inserts immediately, removes its actions and preserves another dirty row', async () => {
                    await enter('tbody [name=nombre]', 'Pending edit');
                    const originalId = await inPage(() => document.querySelector('tbody [name=nombre]').id);
                    await inPage(id => {
                        const input = document.getElementById(id);
                        input.focus();
                        input.setSelectionRange(2, 4);
                        document.querySelector('tbody .selection-col input').click();
                        document.querySelector('tbody .selection-col input').click();
                    }, originalId);
                    assert.deepEqual(await inPage(() => [document.activeElement.value, document.activeElement.selectionStart, document.activeElement.selectionEnd]), ['Pending edit', 2, 4]);
                    await click('[aria-label="Agregar fila"]');
                    await enter('tr.new-row [name=legajo]', 'E002');
                    await enter('tr.new-row [name=nombre]', 'Created');
                    interruptReload = true;
                    await click('tr.new-row [aria-label=Guardar]');
                    await waitFor(() => !document.querySelector('#workspace').disabled && !document.querySelector('tr.new-row') &&
                        [...document.querySelectorAll('tbody [name=legajo]')].some(input => input.value === 'E002'));
                    assert.equal(interrupted, 1, 'The reload was invalidated while its response was pending');
                    assert.equal(inserts, 1);
                    assert.equal(await inPage(() => [...document.querySelectorAll('tbody tr')].find(row => row.querySelector('[name=legajo]')?.value === 'E002').querySelector('[aria-label=Guardar]').hidden), true);
                    assert.equal(await inPage(id => document.getElementById(id)?.value, originalId), 'Pending edit');
                    assert.equal(await inPage(() => document.querySelector('tbody tr:not(.new-row) .selection-col input').checked), true);
                    assert.equal((await pool.query("SELECT nombre FROM ssot.estudiantes WHERE legajo = 'E001'")).rows[0].nombre, 'Original');
                    assert.equal((await pool.query("SELECT nombre FROM ssot.estudiantes WHERE legajo = 'E002'")).rows[0].nombre, 'Created');
                    await inPage(id => document.getElementById(id).dispatchEvent(new Event('change', {bubbles: true})), originalId);
                    assert.equal(updates, 0);
                    await click('tbody tr:not(.new-row) [aria-label=Guardar]');
                    await until(async () => !await inPage(() => document.querySelector('#workspace').disabled) &&
                        (await pool.query("SELECT nombre FROM ssot.estudiantes WHERE legajo = 'E001'")).rows[0].nombre === 'Pending edit');
                    assert.equal((await pool.query("SELECT nombre FROM ssot.estudiantes WHERE legajo = 'E001'")).rows[0].nombre, 'Pending edit');
                });

                await t.test('saving an existing row preserves an unfinished insertion', async () => {
                    await idle();
                    await click('[aria-label="Agregar fila"]');
                    await enter('tr.new-row [name=legajo]', 'E003');
                    const untouchedId = await inPage(() => [...document.querySelectorAll('tbody tr')].find(row => row.querySelector('[name=legajo]')?.value === 'E002').querySelector('[name=nombre]').id);
                    await enter('tbody tr:not(.new-row) [name=nombre]', 'Another edit');
                    await inPage(() => document.querySelector('tbody tr:not(.new-row) [name=nombre]').dispatchEvent(new Event('change', {bubbles: true})));
                    await click('tbody tr:not(.new-row) [aria-label=Guardar]');
                    await waitFor(() => !document.querySelector('#workspace').disabled && document.querySelector('#status').textContent === 'Guardado');
                    assert.equal(await inPage(() => document.querySelector('tr.new-row [name=legajo]').value), 'E003');
                    assert.equal(inserts, 1);
                    assert.equal(await inPage(id => document.getElementById(id)?.value, untouchedId), 'Created');
                    await click('tr.new-row [aria-label=Cancelar]');
                    await click('#confirm-ok');
                    await waitFor(() => !document.querySelector('tr.new-row'));
                });
                await t.test('a save reload consumes earlier notifications and retries an invalidated response only once', async () => {
                    await idle();
                    const before = reads;
                    await enter('tbody tr:first-child [name=nombre]', 'One reload');
                    interruptReload = true;
                    await click('tbody tr:first-child [aria-label=Guardar]');
                    await waitFor(() => !document.querySelector('#workspace').disabled &&
                        document.querySelector('tbody tr:first-child [name=nombre]')?.value === 'One reload' &&
                        document.querySelector('tbody tr:first-child [aria-label=Guardar]').hidden);
                    await inPage(() => document.querySelector('#theme-toggle').focus());
                    await idle();
                    assert.equal(reads - before, 2, 'One obsolete response and one successful retry, without a queued duplicate reload');
                });
                await t.test('refreshing another saved row preserves the original version of a conflicting draft', async () => {
                    const previous = (await pool.query("SELECT nombre FROM ssot.estudiantes WHERE legajo = 'E001'")).rows[0].nombre;
                    await enter('tbody tr:first-child [name=nombre]', 'Local conflict');
                    await pool.query("UPDATE ssot.estudiantes SET nombre = 'Remote edit' WHERE legajo = 'E001'");
                    publish('estudiantes');
                    await waitFor(() => document.querySelector('#status').textContent.includes('Hay datos nuevos'));
                    await enter('tbody tr:last-child [name=nombre]', 'Independent edit');
                    await click('tbody tr:last-child [aria-label=Guardar]');
                    await until(async () => !await inPage(() => document.querySelector('#workspace').disabled) &&
                        (await pool.query("SELECT nombre FROM ssot.estudiantes WHERE legajo = 'E002'")).rows[0].nombre === 'Independent edit');
                    await click('tbody tr:first-child [aria-label=Guardar]');
                    await waitFor(() => !document.querySelector('#workspace').disabled && document.querySelector('#status').textContent.includes('Otra persona'));
                    assert.equal(await inPage(() => document.querySelector('tbody tr:first-child [name=nombre]').value), 'Local conflict');
                    assert.equal((await pool.query("SELECT nombre FROM ssot.estudiantes WHERE legajo = 'E001'")).rows[0].nombre, 'Remote edit');
                    await click('tbody tr:first-child [aria-label="Ver datos actuales"]');
                    await waitFor(() => [...document.querySelectorAll('dialog[open] h2')].some(heading => heading.textContent === 'Revisar cambios'));
                    assert.deepEqual(await inPage(() => {
                        const dialog = [...document.querySelectorAll('dialog[open]')].find(dialog => dialog.querySelector('h2')?.textContent === 'Revisar cambios');
                        return [...[...dialog.querySelectorAll('tbody tr')].find(row => row.querySelector('th').textContent === 'Nombre').querySelectorAll('td')].map(cell => cell.textContent);
                    }), [previous, 'Remote edit', 'Local conflict']);
                    await inPage(() => [...document.querySelectorAll('dialog[open]')].find(dialog => dialog.querySelector('h2')?.textContent === 'Revisar cambios').querySelector('button').click());
                    await click('tbody tr:first-child [aria-label=Cancelar]');
                    await click('#confirm-ok');
                    assert.equal(await inPage(() => document.querySelector('tbody tr:first-child [name=nombre]').value), 'Remote edit');
                });
                await t.test('saving a changed primary key preserves its row selection and the next edit uses the new key', async () => {
                    await idle();
                    await click('tbody tr:last-child .selection-col input');
                    await enter('tbody tr:last-child [name=legajo]', 'E002R');
                    await click('tbody tr:last-child [aria-label=Guardar]');
                    await waitFor(() => !document.querySelector('#workspace').disabled && document.querySelector('tbody tr:last-child [name=legajo]')?.value === 'E002R');
                    assert.equal(await inPage(() => document.querySelector('tbody tr:last-child .selection-col input').checked), true);
                    await enter('tbody tr:last-child [name=nombre]', 'After rename');
                    await click('tbody tr:last-child [aria-label=Guardar]');
                    await until(async () => !await inPage(() => document.querySelector('#workspace').disabled) &&
                        (await pool.query("SELECT nombre FROM ssot.estudiantes WHERE legajo = 'E002R'")).rows[0]?.nombre === 'After rename');
                    assert.equal((await pool.query("SELECT count(*)::int AS count FROM ssot.estudiantes WHERE legajo = 'E002'")).rows[0].count, 0);
                });
                await t.test('a rejected key change keeps Guardar visible and never blocks saving another row', async () => {
                    await waitFor(() => {
                        if (document.querySelector('#workspace').disabled) return false;
                        document.querySelector('[data-entity=materias]').click();
                        return true;
                    });
                    await waitFor(() => !document.querySelector('#workspace').disabled && document.querySelector('.sheet-heading h2')?.textContent === 'Materias');
                    const first = 'tbody tr:first-child';
                    await enter(`${first} [name=materia]`, 'Algoritmos editados');
                    await click(`${first} [aria-label=Guardar]`);
                    await until(async () => !await inPage(() => document.querySelector('#workspace').disabled) &&
                        (await pool.query("SELECT materia FROM ssot.materias WHERE cod_mat = 'ALG'")).rows[0].materia === 'Algoritmos editados');
                    await enter(`${first} [name=cod_mat]`, 'RENAMED');
                    await click(`${first} [aria-label=Guardar]`);
                    await waitFor(() => !document.querySelector('#workspace').disabled && document.querySelector('#status').classList.contains('error'));
                    const errorMessage = await inPage(() => document.querySelector('#status').textContent);
                    assert.match(errorMessage, /No se puede cambiar la clave.*Inscripciones/);
                    assert.match(errorMessage, /Tu borrador se conserva/);
                    assert.equal(await inPage(() => document.querySelector('tbody tr:first-child [name=cod_mat]').value), 'RENAMED');
                    assert.equal(await inPage(() => document.querySelector('tbody tr:first-child [aria-label=Guardar]').hidden), false);
                    for (const width of [320, 1440]) {
                        await send('Emulation.setDeviceMetricsOverride', {width, height: 900, deviceScaleFactor: 1, mobile: width === 320});
                        await waitFor(() => getComputedStyle(document.querySelector('tbody tr:first-child [aria-label=Guardar] .action-label')).display !== 'none');
                    }
                    await click(`${first} [aria-label=Guardar]`);
                    await waitFor(message => !document.querySelector('#workspace').disabled && document.querySelector('#status').textContent === message, errorMessage);
                    await enter('tbody tr:last-child [name=materia]', 'Other draft');
                    await click('tbody tr:last-child [aria-label=Guardar]');
                    await until(async () => !await inPage(() => document.querySelector('#workspace').disabled) &&
                        (await pool.query("SELECT materia FROM ssot.materias WHERE cod_mat = 'OTRA'")).rows[0].materia === 'Other draft');
                    assert.equal(await inPage(() => document.querySelector('tbody tr:first-child [name=cod_mat]').value), 'RENAMED');
                    await click(`${first} [aria-label=Guardar]`);
                    await waitFor(message => !document.querySelector('#workspace').disabled && document.querySelector('#status').textContent === message, errorMessage);
                    await enter(`${first} [name=cod_mat]`, 'ALG');
                    await enter(`${first} [name=materia]`, 'Corrected edit');
                    await click(`${first} [aria-label=Guardar]`);
                    await until(async () => !await inPage(() => document.querySelector('#workspace').disabled) &&
                        (await pool.query("SELECT materia FROM ssot.materias WHERE cod_mat = 'ALG'")).rows[0].materia === 'Corrected edit');
                    assert.equal(await inPage(() => document.querySelector('tbody tr:first-child [aria-label=Guardar]').hidden), true);
                    assert.equal((await pool.query("SELECT cod_mat FROM ssot.enrolamientos WHERE legajo = 'E001'")).rows[0].cod_mat, 'ALG');
                });
                await t.test('reloads and returning to the app restore the validated session without another login', async () => {
                    await send('Page.reload');
                    await ready();
                    await signedIn();
                    assert.equal(logins, 1);
                    await send('Page.navigate', {url: `${base}/style.css`});
                    await waitFor(() => location.pathname === '/style.css');
                    await send('Page.navigate', {url: base});
                    await ready();
                    await signedIn();
                    assert.equal(logins, 1);
                });
                await t.test('a temporary restoration failure keeps the token for a later retry', async () => {
                    restoreUnavailable = true;
                    await send('Page.reload');
                    await ready();
                    await waitFor(() => document.querySelector('#auth-status')?.textContent.includes('No se pudo recuperar la sesión'));
                    assert.equal(await inPage(() => !!sessionStorage.getItem('ssot-session-token')), true);
                    assert.equal(await inPage(() => document.querySelector('#workspace').hidden), true);
                    await send('Page.reload');
                    await ready();
                    await signedIn();
                    assert.equal(logins, 1);
                });
                await t.test('revoked sessions are removed instead of restored', async () => {
                    await pool.query('UPDATE ssot.usuarios SET version_sesion = $1 WHERE usuario = $2', [randomUUID(), 'browser']);
                    await send('Page.reload');
                    await ready();
                    await signedOut();
                    assert.equal(logins, 1);
                });
                await t.test('explicit logout removes the saved session and stays logged out after reload', async () => {
                    await signIn();
                    assert.equal(logins, 2);
                    await click('#logout');
                    await click('#confirm-ok');
                    await signedOut();
                    await send('Page.reload');
                    await ready();
                    await signedOut();
                    assert.equal(logins, 2);
                });
                assert.deepEqual(errors, []);
            });
        } finally {
            const closed = new Promise(resolve => server.close(resolve));
            server.closeAllConnections();
            await closed;
        }
    });
});
