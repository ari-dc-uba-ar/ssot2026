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

// The real API and frontend on a random port, recording login requests.
async function startServer(pool) {
    const app = express(), auth = createAuthentication(pool, 'browser-test-secret-with-at-least-32-bytes');
    const loginRequests = [];
    app.use('/api/auth/login', (req, _res, next) => { loginRequests.push(req.method); next(); });
    const publish = registerEntityEvents(app, auth);
    registerAuthApi(app, pool, auth);
    registerEntityApi(app, pool, auth, publish);
    app.use('/assets', express.static('dist/frontend'));
    app.use(express.static('src/frontend/public'));
    const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
    return {url: `http://127.0.0.1:${server.address().port}`, loginRequests, close: async () => {
        const closed = new Promise(resolve => server.close(resolve));
        server.closeAllConnections();
        await closed;
    }};
}

// The steps share one browser session and run in order: each one starts where the previous one ended.
test('table navigation and spreadsheet work with the real API', {timeout: 90000}, async t => {
    await withTestDatabase(async ({pool}) => {
        await initializeUsers(pool, {username: 'browser', password: 'browser-test-password'});
        await pool.query("INSERT INTO ssot.planes (plan, descripcion) SELECT i, 'Plan ' || i FROM generate_series(1,201) i");
        await pool.query("INSERT INTO ssot.departamentos (cod_dep, departamento) VALUES ('DC', 'Computación')");
        await pool.query("INSERT INTO ssot.materias (cod_mat, cod_dep, materia, plan, obligatoria) VALUES ('ALG', 'DC', 'Algoritmos', 1, true)");
        await pool.query("INSERT INTO ssot.estudiantes (legajo, nombre) VALUES ('E001', 'Estudiante')");
        await pool.query("INSERT INTO ssot.enrolamientos (legajo, cod_mat, cod_dep, año, cuatrimestre, nota, regularidad) VALUES ('E001', 'ALG', 'DC', 2026, '1C', 8, 'Regular')");
        const server = await startServer(pool);
        try {
            await withBrowser(async ({send, evaluate, errors}) => {
                // Runs `fn` inside the page. It cannot see test variables: pass them as arguments.
                const inPage = (fn, ...args) => evaluate(`return (${fn})(...${JSON.stringify(args)})`);
                const waitFor = async (fn, ...args) => {
                    try { await until(() => inPage(fn, ...args)); }
                    catch (error) { throw error.message.startsWith('Timed out') ? new Error(`Timed out waiting for: ${fn}`) : error; }
                };
                const resize = (width, height) => send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: width < 1000});
                const click = selector => inPage(selector => document.querySelector(selector).click(), selector);
                const setValue = (selector, value) => inPage((selector, value) => { document.querySelector(selector).value = value; }, selector, value);
                const submit = selector => inPage(selector => document.querySelector(selector).requestSubmit(), selector);
                const valueOf = selector => inPage(selector => document.querySelector(selector).value, selector);
                const textOf = selector => inPage(selector => document.querySelector(selector).textContent, selector);
                const isVisible = selector => inPage(selector => !document.querySelector(selector).hidden, selector);
                const focusedId = () => inPage(() => document.activeElement.id);
                const dialogIsOpen = () => inPage(() => !!document.querySelector('dialog[open]'));
                const rowCount = () => inPage(() => document.querySelectorAll('tbody tr').length);
                const sheetIsReady = heading => waitFor(heading => !document.querySelector('#workspace').disabled &&
                    document.querySelector('.sheet-heading h2')?.textContent === heading, heading);
                // The menu ignores clicks while the sheet is busy, so wait until it is idle.
                const openTable = async (entity, heading) => {
                    await waitFor(() => !document.querySelector('#workspace').disabled);
                    await click(`[data-entity=${entity}]`);
                    await sheetIsReady(heading);
                };
                const login = async password => { await setValue('#login-password', password); await submit('#login-form'); };
                const loginAnswered = () => waitFor(() => !document.querySelector('#login-password').disabled && document.querySelector('#auth-status').textContent !== '');
                // Header and row checkboxes line up, and every active scroll arrow sits over the data columns and can be clicked.
                const checkHeaderControls = async () => {
                    const layout = await inPage(() => {
                        const header = document.querySelector('thead .selection-col input').getBoundingClientRect();
                        const row = document.querySelector('tbody .selection-col input').getBoundingClientRect();
                        const left = (document.querySelector('thead .pinned-col') ?? document.querySelector('thead .selection-col')).getBoundingClientRect().right;
                        const right = document.querySelector('thead .row-actions').getBoundingClientRect().left;
                        return {alignment: Math.abs(header.left - row.left),
                            selectionWidth: document.querySelector('thead .selection-col').getBoundingClientRect().width,
                            cues: [...document.querySelectorAll('.scroll-cue')].filter(button => !button.disabled).map(button => {
                                const box = button.getBoundingClientRect();
                                return {withinData: box.left >= left - 1 && box.right <= right + 1,
                                    clickable: document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('.scroll-cue') === button};
                            })};
                    });
                    assert.ok(layout.alignment < 1, JSON.stringify(layout));
                    assert.equal(layout.selectionWidth, 44);
                    assert.ok(layout.cues.every(cue => cue.withinData && cue.clickable), JSON.stringify(layout));
                };

                await t.test('login asks for the user, then the password, and gives one generic error', async () => {
                    await resize(390, 844);
                    await send('Page.navigate', {url: server.url});
                    await waitFor(() => typeof document.querySelector('#login-form')?.onsubmit === 'function');
                    assert.equal(await isVisible('#authentication'), true);
                    assert.equal(await isVisible('#identity-form'), true);
                    assert.equal(await isVisible('#login-form'), false);
                    assert.equal(await dialogIsOpen(), false);

                    // Moving to the password step makes no server request.
                    await setValue('#login-user', 'missing-user');
                    await submit('#identity-form');
                    assert.equal(server.loginRequests.length, 0);
                    assert.equal(await focusedId(), 'login-password');
                    assert.equal(await isVisible('#identity-form'), false);
                    assert.equal(await isVisible('#login-form'), true);

                    // An unknown user gets the generic error and the password is cleared.
                    await login('browser-test-password');
                    await loginAnswered();
                    const genericError = await textOf('#auth-status');
                    assert.equal(genericError, 'No existe usuario con esas credenciales.');
                    assert.equal(await valueOf('#login-password'), '');

                    // Going back to change the user discards the typed password.
                    await setValue('#login-password', 'discard-me');
                    await click('#change-identity');
                    assert.equal(await isVisible('#identity-form'), true);
                    assert.equal(await focusedId(), 'login-user');
                    assert.equal(await valueOf('#login-password'), '');

                    // A wrong password gets the same error as an unknown user.
                    await setValue('#login-user', 'browser');
                    await submit('#identity-form');
                    await login('wrong');
                    await loginAnswered();
                    assert.equal(await textOf('#auth-status'), genericError);

                    // Recovery keeps the typed user.
                    await click('#show-recovery');
                    assert.equal(await isVisible('#recovery-form'), true);
                    assert.equal(await valueOf('#recover-user'), 'browser');
                    assert.equal(await dialogIsOpen(), false);

                    await click('#show-login');
                    await login('browser-test-password');
                    await waitFor(() => !document.querySelector('#workspace').disabled && !!document.querySelector('table'));
                    assert.equal(await inPage(() => document.querySelectorAll('#login-form h3').length), 0);
                });

                await t.test('value fields read null, false and list options', async () => {
                    assert.deepEqual(await inPage(async () => {
                        const {createValueField} = await import('/assets/value-field.js');
                        const column = {name: 'choice', label: 'Choice', type: 'regularidad', nullable: true, optionalOnUpdate: false,
                            constraints: {minLength: null, maxLength: null, options: ['Libre', 'Regular']}};
                        const nullable = createValueField(column, null), required = createValueField({...column, nullable: false});
                        const bool = createValueField({...column, type: 'boolean'}, false);
                        return {value: nullable.read(), none: nullable.input.options[0].text,
                            checkboxes: nullable.field.querySelectorAll('input[type=checkbox]').length,
                            optionalValid: nullable.input.checkValidity(), requiredValid: required.input.checkValidity(), falseValue: bool.read()};
                    }), {value: null, none: 'Ninguna', checkboxes: 0, optionalValid: true, requiredValid: false, falseValue: false});
                });

                await t.test('the table menu searches by name and opens a table', async () => {
                    await click('#open-tables');
                    assert.equal(await inPage(() => document.querySelector('#tables-panel').matches(':modal')), true);
                    await inPage(() => {
                        const search = document.querySelector('#table-search');
                        search.value = 'planes';
                        search.dispatchEvent(new Event('input'));
                    });
                    assert.deepEqual(await inPage(() => [...document.querySelectorAll('#table-list button')].filter(b => !b.hidden).map(b => b.textContent)),
                        ['Planes de Estudio']);
                    await openTable('planes', 'Planes de Estudio');
                    assert.equal(await inPage(() => document.querySelector('#tables-panel').open), false);
                    assert.equal(await rowCount(), 10);
                });

                await t.test('column filters narrow the rows and can be removed', async () => {
                    await inPage(() => {
                        document.querySelector('[aria-label^="Filtrar por columnas"]').click();
                        const plan = document.querySelector('.column-filters [name=plan]');
                        plan.closest('fieldset').previousElementSibling.querySelector('input').click(); // enables the plan filter
                        plan.value = '201';
                        document.querySelector('.column-filters form').requestSubmit();
                    });
                    await waitFor(() => !document.querySelector('.column-filters') && document.querySelectorAll('tbody tr').length === 1);
                    assert.equal(await valueOf('tbody [name=plan]'), '201');

                    await inPage(() => {
                        document.querySelector('[aria-label^="Filtrar por columnas"]').click();
                        [...document.querySelectorAll('.column-filters button')].find(b => b.textContent === 'Quitar filtros').click();
                        document.querySelector('.column-filters form').requestSubmit();
                    });
                    await waitFor(() => !document.querySelector('.column-filters') && document.querySelectorAll('tbody tr').length === 10);
                });

                await t.test('on a short phone screen the sheet scrolls inside a fixed frame', async () => {
                    await resize(390, 500);
                    await inPage(() => {
                        const scroll = document.querySelector('.table-scroll');
                        scroll.scrollTop = 100;
                        scroll.scrollLeft = 100;
                    });
                    await waitFor(() => document.querySelector('.table-scroll').scrollTop > 0);
                    const geometry = await inPage(() => {
                        const scroll = document.querySelector('.table-scroll'), bounds = scroll.getBoundingClientRect();
                        return {overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
                            header: Math.abs(document.querySelector('thead th').getBoundingClientRect().top - bounds.top),
                            selection: Math.abs(document.querySelector('tbody .selection-col').getBoundingClientRect().left - bounds.left),
                            actions: Math.abs(document.querySelector('tbody .row-actions').getBoundingClientRect().right - bounds.right),
                            controls: document.querySelector('.sheet-controls').getBoundingClientRect().bottom <= bounds.top,
                            bottom: innerHeight - bounds.bottom, horizontal: scroll.scrollWidth > scroll.clientWidth};
                    });
                    assert.equal(geometry.overflow, false, 'the page itself does not scroll sideways');
                    assert.equal(geometry.controls, true, 'the controls stay above the sheet');
                    assert.equal(geometry.horizontal, true, 'the sheet scrolls sideways');
                    // The header, selection column and actions column stay stuck to the frame edges.
                    for (const key of ['header', 'selection', 'actions']) assert.ok(geometry[key] <= 2, JSON.stringify(geometry));
                    assert.ok(geometry.bottom <= 10, JSON.stringify(geometry));
                    // Row buttons are labelled and big enough to touch.
                    assert.equal(await inPage(() => [...document.querySelectorAll('tbody button')]
                        .every(b => b.getAttribute('aria-label') && b.getBoundingClientRect().height >= 44)), true);
                });

                await t.test('a pinned column stays next to the row selectors on every screen size', async () => {
                    await click('th[data-column=descripcion] .column-pin');
                    await waitFor(() => document.querySelector('th.pinned-col')?.dataset.column === 'descripcion');
                    assert.equal(await inPage(() => document.querySelectorAll('th[aria-sort=ascending], th[aria-sort=descending]').length), 0,
                        'pinning does not sort');
                    await inPage(() => {
                        const scroll = document.querySelector('.table-scroll');
                        scroll.scrollLeft = scroll.scrollWidth;
                        scroll.scrollTop = 100;
                    });
                    await waitFor(() => Math.abs(document.querySelector('tbody .pinned-col').getBoundingClientRect().left -
                        document.querySelector('tbody .selection-col').getBoundingClientRect().right) < 2);
                    const pinnedFits = () => document.querySelector('tbody .pinned-col').getBoundingClientRect().right <
                        document.querySelector('tbody .row-actions').getBoundingClientRect().left && document.documentElement.scrollWidth <= document.documentElement.clientWidth;
                    assert.equal(await inPage(pinnedFits), true);
                    await resize(320, 700);
                    await waitFor(pinnedFits);
                    await checkHeaderControls();
                    await resize(1440, 900);
                    await waitFor(() => {
                        const scroll = document.querySelector('.table-scroll');
                        return document.querySelector('#workspace').classList.contains('docked') && scroll.scrollWidth <= scroll.clientWidth;
                    });
                    await resize(390, 500);
                });

                await t.test('paging, editing and adding keep the pinned column', async () => {
                    await click('.pagination [aria-label=Siguiente]');
                    await waitFor(() => document.querySelector('tbody [name=plan]')?.value === '11');
                    assert.equal(await valueOf('tbody .pinned-col [name=descripcion]'), 'Plan 11');

                    // Editing a pinned cell saves it to the database.
                    await inPage(() => {
                        const input = document.querySelector('tbody .pinned-col [name=descripcion]');
                        input.value = 'Edited while pinned';
                        input.dispatchEvent(new Event('change', {bubbles: true}));
                    });
                    await until(async () => (await pool.query('SELECT descripcion FROM ssot.planes WHERE plan=11')).rows[0]?.descripcion === 'Edited while pinned');
                    await waitFor(() => !document.querySelector('#workspace').disabled &&
                        document.querySelector('tbody .pinned-col [name=descripcion]')?.value === 'Edited while pinned');

                    // Moving the pin keeps what was typed in a new row.
                    await click('[aria-label="Agregar fila"]');
                    await setValue('tr.new-row [name=descripcion]', 'Keep draft');
                    await click('th[data-column=plan] .column-pin');
                    assert.equal(await valueOf('tr.new-row [name=descripcion]'), 'Keep draft');
                    assert.equal(await inPage(() => document.querySelectorAll('th.pinned-col').length), 1);
                    assert.equal(await inPage(() => document.querySelector('tr.new-row .pinned-col').dataset.column), 'plan');
                    await click('tr.new-row [aria-label=Cancelar]');
                    await click('#confirm-ok');
                    await waitFor(() => !document.querySelector('tr.new-row'));

                    // Sorting keeps the pin; unpinning restores the API column order.
                    await click('th[data-column=plan] .column-label');
                    await waitFor(() => document.querySelector('th[data-column=plan]').getAttribute('aria-sort') === 'ascending' &&
                        document.querySelector('tbody [name=plan]')?.value === '1');
                    await click('th[data-column=plan] .column-pin');
                    assert.equal(await inPage(() => document.querySelectorAll('.pinned-col').length), 0);
                    assert.deepEqual(await inPage(() => [...document.querySelectorAll('thead [data-column]')].map(cell => cell.dataset.column)), ['plan', 'descripcion']);
                });

                await t.test('arrows show hidden columns and scroll to them', async () => {
                    const arrowsAre = (left, right) => waitFor((left, right) => {
                        const enabled = direction => !document.querySelector(`.scroll-cue[data-direction=${direction}]`).disabled;
                        return enabled('left') === left && enabled('right') === right;
                    }, left, right);
                    const scrollTo = position => inPage(position => {
                        const scroll = document.querySelector('.table-scroll');
                        scroll.scrollLeft = position === 'middle' ? (scroll.scrollWidth - scroll.clientWidth) / 2 : position;
                    }, position);

                    await scrollTo(0);
                    await arrowsAre(false, true);
                    assert.equal(await inPage(() => getComputedStyle(document.querySelector('.scroll-cue[data-direction=right]')).visibility), 'visible');
                    await checkHeaderControls();
                    await click('.scroll-cue[data-direction=right]');
                    await waitFor(() => document.querySelector('.table-scroll').scrollLeft > 0 && !document.querySelector('.scroll-cue[data-direction=left]').disabled);
                    await scrollTo('middle');
                    await arrowsAre(true, true);
                    await checkHeaderControls();
                    await scrollTo(1e6);
                    await arrowsAre(true, false);
                    await checkHeaderControls();
                    await click('.scroll-cue[data-direction=left]');
                    await waitFor(() => !document.querySelector('.scroll-cue[data-direction=right]').disabled);
                });

                await t.test('on a wide screen the table menu becomes a sidebar when its labels fit', async () => {
                    if (process.env.UI_SCREENSHOT) {
                        const {data} = await send('Page.captureScreenshot');
                        await writeFile(process.env.UI_SCREENSHOT, Buffer.from(data, 'base64'));
                    }
                    // Escape closes the table menu.
                    await click('#open-tables');
                    await send('Input.dispatchKeyEvent', {type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27});
                    await waitFor(() => !document.querySelector('#tables-panel').open);

                    await resize(1440, 900);
                    await waitFor(() => document.querySelector('#workspace').classList.contains('docked'));
                    assert.equal(await isVisible('#open-tables'), false);
                    assert.equal(await inPage(() => document.querySelector('#tables-panel').matches(':modal')), false);
                    assert.equal(await inPage(() => {
                        const scroll = document.querySelector('.table-scroll');
                        return scroll.scrollWidth <= scroll.clientWidth;
                    }), true);
                    assert.equal(await inPage(() => getComputedStyle(document.querySelector('tbody .row-actions .action-label')).display !== 'none'), true,
                        'action buttons show their text');
                    await waitFor(() => [...document.querySelectorAll('.scroll-cue')].every(button => getComputedStyle(button).display === 'none'));

                    // Long API labels must make docking depend on content, not just screen size.
                    await inPage(() => { document.querySelector('#table-list [data-entity=planes]').textContent = 'A very long table label '.repeat(20); });
                    await waitFor(() => !document.querySelector('#workspace').classList.contains('docked'));
                    await resize(390, 844);
                    await waitFor(() => !document.querySelector('#open-tables').hidden);
                });

                await t.test('on phones, sheets with data scroll inside their frame, never the page', async () => {
                    for (const [entity, heading] of [['materias', 'Materias'], ['enrolamientos', 'Inscripciones']]) {
                        await openTable(entity, heading);
                        for (const width of [320, 390]) {
                            await resize(width, 844);
                            const bounds = await inPage(() => ({page: document.documentElement.scrollWidth,
                                sheet: document.querySelector('.table-scroll').scrollWidth,
                                clipped: document.querySelector('.table-scroll').clientWidth}));
                            assert.ok(bounds.page <= width, JSON.stringify({entity, width, ...bounds}));
                            assert.ok(bounds.sheet > bounds.clipped);
                            await inPage(() => {
                                const scroll = document.querySelector('.table-scroll');
                                scroll.scrollLeft = (scroll.scrollWidth - scroll.clientWidth) / 2;
                            });
                            await waitFor(() => [...document.querySelectorAll('.scroll-cue')].every(button => !button.disabled));
                            await checkHeaderControls();
                        }
                        if (process.env.UI_SCREENSHOT) {
                            const {data} = await send('Page.captureScreenshot');
                            await writeFile(`${process.env.UI_SCREENSHOT}.${entity}.png`, Buffer.from(data, 'base64'));
                        }
                    }
                });

                await t.test('missing required references block new rows and link to the required table', async () => {
                    // This step removes the fixtures, so keep it after all populated-sheet checks.
                    const notice = () => inPage(() => [document.querySelector('[aria-label="Agregar fila"]').disabled,
                        ...[...document.querySelectorAll('.reference-notice > *')].map(node => node.getAttribute('aria-label') ?? node.textContent)]);
                    await pool.query('DELETE FROM ssot.enrolamientos; DELETE FROM ssot.materias; DELETE FROM ssot.estudiantes; DELETE FROM ssot.departamentos');
                    await openTable('enrolamientos', 'Inscripciones');
                    await click('[aria-label=Actualizar]');
                    await until(async () => !await inPage(() => document.querySelector('#workspace').disabled) && (await notice()).length > 1);
                    assert.deepEqual(await notice(), [true, '⚠ Para agregar inscripciones primero tiene que haber al menos 1 estudiante y 1 materia.', 'Ir a Estudiantes', 'Ir a Materias']);
                    await click('.reference-notice [aria-label="Ir a Materias"]');
                    await sheetIsReady('Materias');
                    assert.deepEqual(await notice(), [true, '⚠ Para agregar materias primero tiene que haber al menos 1 departamento.', 'Ir a Departamentos']);
                    await pool.query("INSERT INTO ssot.departamentos (cod_dep, departamento) VALUES ('D1', 'Computación')");
                    await click('[aria-label=Actualizar]');
                    await until(async () => !await inPage(() => document.querySelector('#workspace').disabled) && (await notice()).length === 1);
                    await click('[aria-label="Agregar fila"]');
                    await waitFor(() => [...document.querySelectorAll('tr.new-row select[aria-label]')].every(select => select.options.length));
                    assert.deepEqual(await inPage(() => [...document.querySelectorAll('tr.new-row select[aria-label]')].map(select => select.options[0].text)), ['Elegí una opción…', 'Ninguna']);
                    await click('tr.new-row [aria-label=Cancelar]');
                    await click('#confirm-ok');
                    await waitFor(() => !document.querySelector('tr.new-row'));
                });

                await t.test('the account dialog opens, and an expired session returns to an empty login', async () => {
                    await click('#manage-account');
                    assert.equal(await inPage(() => document.querySelector('#account').matches(':modal')), true);
                    assert.equal(await isVisible('#account-management'), true);
                    assert.equal(await isVisible('#authentication'), false);

                    await click('#close-account');
                    await inPage(() => { window.dispatchEvent(new Event('sessionexpired')); });
                    assert.equal(await isVisible('#authentication'), true);
                    assert.equal(await isVisible('#identity-form'), true);
                    assert.equal(await isVisible('#workspace'), false);
                    assert.equal(await valueOf('#login-user'), '');
                    assert.equal(await dialogIsOpen(), false);
                });

                await t.test('the page threw no JavaScript errors', () => {
                    assert.deepEqual(errors, []);
                });
            });
        } finally {
            await server.close();
        }
    });
});
