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
        const loginRequests = [];
        app.use('/api/auth/login', (req, _res, next) => { loginRequests.push(req.method); next(); });
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
                assert.equal(await evaluate("return !document.querySelector('#authentication').hidden && !document.querySelector('#identity-form').hidden && document.querySelector('#login-form').hidden && !document.querySelector('dialog[open]')"), true);
                await evaluate("document.querySelector('#login-user').value='missing-user'; document.querySelector('#identity-form').requestSubmit();");
                assert.equal(loginRequests.length, 0);
                assert.equal(await evaluate("return document.activeElement.id === 'login-password' && document.querySelector('#identity-form').hidden && !document.querySelector('#login-form').hidden"), true);
                await evaluate("document.querySelector('#login-password').value='browser-test-password'; document.querySelector('#login-form').requestSubmit();");
                await until(() => evaluate("return !document.querySelector('#login-password').disabled && document.querySelector('#auth-status').textContent !== ''"));
                const unknownUserError = await evaluate("return document.querySelector('#auth-status').textContent");
                assert.equal(unknownUserError, 'No existe usuario con esas credenciales.');
                assert.equal(await evaluate("return document.querySelector('#login-password').value"), '');
                await evaluate("document.querySelector('#login-password').value='discard-me'; document.querySelector('#change-identity').click()");
                assert.equal(await evaluate("return !document.querySelector('#identity-form').hidden && document.activeElement.id === 'login-user' && document.querySelector('#login-password').value === ''"), true);
                await evaluate("document.querySelector('#login-user').value='browser'; document.querySelector('#identity-form').requestSubmit(); document.querySelector('#login-password').value='wrong'; document.querySelector('#login-form').requestSubmit();");
                await until(() => evaluate("return !document.querySelector('#login-password').disabled && document.querySelector('#auth-status').textContent !== ''"));
                assert.equal(await evaluate("return document.querySelector('#auth-status').textContent"), unknownUserError);
                await evaluate("document.querySelector('#show-recovery').click()");
                assert.equal(await evaluate("return !document.querySelector('#recovery-form').hidden && document.querySelector('#recover-user').value === 'browser' && !document.querySelector('dialog[open]')"), true);
                await evaluate("document.querySelector('#show-login').click(); document.querySelector('#login-password').value='browser-test-password'; document.querySelector('#login-form').requestSubmit();");
                await until(() => evaluate("return !document.querySelector('#workspace').disabled && !!document.querySelector('table')"));
                assert.equal(await evaluate("return document.querySelectorAll('#login-form h3').length"), 0);
                assert.deepEqual(await evaluate(`return import('/assets/value-field.js').then(({createValueField}) => {
                    const column={name:'choice',label:'Choice',type:'regularidad',nullable:true,optionalOnUpdate:false,constraints:{minLength:null,maxLength:null,options:['Libre','Regular']}};
                    const nullable=createValueField(column,null), required=createValueField({...column,nullable:false});
                    const bool=createValueField({...column,type:'boolean'},false);
                    return {value:nullable.read(),none:nullable.input.options[0].text,
                        checkboxes:nullable.field.querySelectorAll('input[type=checkbox]').length,
                        optionalValid:nullable.input.checkValidity(),requiredValid:required.input.checkValidity(),falseValue:bool.read()};
                })`), {value:null,none:'Ninguna',checkboxes:0,optionalValid:true,requiredValid:false,falseValue:false});
                await evaluate("document.querySelector('#open-tables').click()");
                assert.equal(await evaluate("return document.querySelector('#tables-panel').matches(':modal')"), true);
                await evaluate("const input=document.querySelector('#table-search'); input.value='planes'; input.dispatchEvent(new Event('input'))");
                assert.deepEqual(await evaluate("return [...document.querySelectorAll('#table-list button')].filter(b=>!b.hidden).map(b=>b.textContent)"), ['Planes de Estudio']);
                await evaluate("document.querySelector('[data-entity=planes]').click()");
                await until(() => evaluate("return !document.querySelector('#workspace').disabled && document.querySelector('.sheet-heading h2')?.textContent === 'Planes de Estudio'"));
                assert.equal(await evaluate("return document.querySelector('#tables-panel').open"), false);
                assert.equal(await evaluate("return document.querySelectorAll('tbody tr').length"), 10);
                await evaluate(`document.querySelector('[aria-label^="Filtrar por columnas"]').click();
                    const input=document.querySelector('.column-filters [name=plan]');
                    input.closest('fieldset').previousElementSibling.querySelector('input').click();
                    input.value='201'; document.querySelector('.column-filters form').requestSubmit();`);
                await until(() => evaluate("return !document.querySelector('.column-filters') && document.querySelectorAll('tbody tr').length === 1"));
                assert.equal(await evaluate("return document.querySelector('tbody [name=plan]').value"), '201');
                await evaluate(`document.querySelector('[aria-label^="Filtrar por columnas"]').click();
                    [...document.querySelectorAll('.column-filters button')].find(b=>b.textContent==='Quitar filtros').click();
                    document.querySelector('.column-filters form').requestSubmit();`);
                await until(() => evaluate("return !document.querySelector('.column-filters') && document.querySelectorAll('tbody tr').length === 10"));
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
                await evaluate("document.querySelector('th[data-column=descripcion] .column-pin').click()");
                await until(() => evaluate("return document.querySelector('th.pinned-col')?.dataset.column === 'descripcion'"));
                assert.equal(await evaluate("return document.querySelectorAll('th[aria-sort=ascending], th[aria-sort=descending]').length"), 0);
                await evaluate("const scroll=document.querySelector('.table-scroll'); scroll.scrollLeft=scroll.scrollWidth; scroll.scrollTop=100");
                await until(() => evaluate(`const cell=document.querySelector('tbody .pinned-col').getBoundingClientRect();
                    return Math.abs(cell.left-document.querySelector('tbody .selection-col').getBoundingClientRect().right) < 2`));
                assert.equal(await evaluate(`const pinned=document.querySelector('tbody .pinned-col').getBoundingClientRect();
                    const actions=document.querySelector('tbody .row-actions').getBoundingClientRect();
                    return pinned.right < actions.left && document.documentElement.scrollWidth <= innerWidth`), true);
                await send('Emulation.setDeviceMetricsOverride', {width: 320, height: 700, deviceScaleFactor: 1, mobile: true});
                await until(() => evaluate(`const pinned=document.querySelector('tbody .pinned-col').getBoundingClientRect();
                    return pinned.right < document.querySelector('tbody .row-actions').getBoundingClientRect().left && document.documentElement.scrollWidth <= innerWidth`));
                await send('Emulation.setDeviceMetricsOverride', {width: 1440, height: 900, deviceScaleFactor: 1, mobile: false});
                await until(() => evaluate("const scroll=document.querySelector('.table-scroll'); return document.querySelector('#workspace').classList.contains('docked') && scroll.scrollWidth <= scroll.clientWidth"));
                await send('Emulation.setDeviceMetricsOverride', {width: 390, height: 500, deviceScaleFactor: 1, mobile: true});
                // Paging, editing and adding reuse the existing editors while retaining the pin.
                await evaluate("document.querySelector('.pagination [aria-label=Siguiente]').click()");
                await until(() => evaluate("return document.querySelector('tbody [name=plan]')?.value === '11'"));
                assert.equal(await evaluate("return document.querySelector('tbody .pinned-col [name=descripcion]').value"), 'Plan 11');
                await evaluate("const input=document.querySelector('tbody .pinned-col [name=descripcion]'); input.value='Edited while pinned'; input.dispatchEvent(new Event('change',{bubbles:true}))");
                await until(async () => (await pool.query('SELECT descripcion FROM ssot.planes WHERE plan=11')).rows[0]?.descripcion === 'Edited while pinned');
                await until(() => evaluate("return !document.querySelector('#workspace').disabled && document.querySelector('tbody .pinned-col [name=descripcion]')?.value === 'Edited while pinned'"));
                await evaluate("document.querySelector('[aria-label=\"Agregar fila\"]').click(); document.querySelector('tr.new-row [name=descripcion]').value='Keep draft'; document.querySelector('th[data-column=plan] .column-pin').click()");
                assert.equal(await evaluate("return document.querySelector('tr.new-row [name=descripcion]').value"), 'Keep draft');
                assert.equal(await evaluate("return document.querySelectorAll('th.pinned-col').length === 1 && document.querySelector('tr.new-row .pinned-col').dataset.column === 'plan'"), true);
                await evaluate("document.querySelector('tr.new-row [aria-label=Cancelar]').click(); document.querySelector('#confirm-ok').click()");
                await until(() => evaluate("return !document.querySelector('tr.new-row')"));
                await evaluate("document.querySelector('th[data-column=plan] .column-label').click()");
                await until(() => evaluate("return document.querySelector('th[data-column=plan]').getAttribute('aria-sort') === 'ascending' && document.querySelector('tbody [name=plan]')?.value === '1'"));
                await evaluate("document.querySelector('th[data-column=plan] .column-pin').click()");
                assert.equal(await evaluate("return document.querySelectorAll('.pinned-col').length"), 0);
                assert.deepEqual(await evaluate("return [...document.querySelectorAll('thead [data-column]')].map(cell=>cell.dataset.column)"), ['plan','descripcion']);
                await evaluate("document.querySelector('.table-scroll').scrollLeft=0");
                await until(() => evaluate("return document.querySelector('.scroll-cue[data-direction=left]').disabled && !document.querySelector('.scroll-cue[data-direction=right]').disabled"));
                assert.equal(await evaluate("return getComputedStyle(document.querySelector('.scroll-cue[data-direction=right]')).visibility"), 'visible');
                await evaluate("document.querySelector('.scroll-cue[data-direction=right]').click()");
                await until(() => evaluate("return document.querySelector('.table-scroll').scrollLeft > 0 && !document.querySelector('.scroll-cue[data-direction=left]').disabled"));
                await evaluate("const scroll=document.querySelector('.table-scroll'); scroll.scrollLeft=(scroll.scrollWidth-scroll.clientWidth)/2");
                await until(() => evaluate("return [...document.querySelectorAll('.scroll-cue')].every(button=>!button.disabled)"));
                await evaluate("document.querySelector('.table-scroll').scrollLeft=1e6");
                await until(() => evaluate("return document.querySelector('.scroll-cue[data-direction=right]').disabled && !document.querySelector('.scroll-cue[data-direction=left]').disabled"));
                await evaluate("document.querySelector('.scroll-cue[data-direction=left]').click()");
                await until(() => evaluate("return !document.querySelector('.scroll-cue[data-direction=right]').disabled"));
                if (process.env.UI_SCREENSHOT) {
                    const {data} = await send('Page.captureScreenshot');
                    await writeFile(process.env.UI_SCREENSHOT, Buffer.from(data, 'base64'));
                }
                await evaluate("document.querySelector('#open-tables').click()");
                await send('Input.dispatchKeyEvent', {type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27});
                await until(() => evaluate("return !document.querySelector('#tables-panel').open"));
                await send('Emulation.setDeviceMetricsOverride', {width: 1440, height: 900, deviceScaleFactor: 1, mobile: false});
                await until(() => evaluate("return document.querySelector('#workspace').classList.contains('docked')"));
                assert.equal(await evaluate("return document.querySelector('#open-tables').hidden && !document.querySelector('#tables-panel').matches(':modal')"), true);
                assert.equal(await evaluate("const scroll=document.querySelector('.table-scroll'); return scroll.scrollWidth <= scroll.clientWidth"), true);
                assert.equal(await evaluate("return getComputedStyle(document.querySelector('tbody .row-actions .action-label')).display !== 'none'"), true);
                await until(() => evaluate("return [...document.querySelectorAll('.scroll-cue')].every(button=>getComputedStyle(button).display === 'none')"));
                // Long API labels must make docking depend on content, not just screen size.
                await evaluate("document.querySelector('#table-list [data-entity=planes]').textContent='A very long table label '.repeat(20)");
                await until(() => evaluate("return !document.querySelector('#workspace').classList.contains('docked')"));
                await send('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 1, mobile: true});
                await until(() => evaluate("return !document.querySelector('#open-tables').hidden"));
                assert.deepEqual(errors, []);
                await evaluate("document.querySelector('#manage-account').click()");
                assert.equal(await evaluate("return document.querySelector('#account').matches(':modal') && !document.querySelector('#account-management').hidden && document.querySelector('#authentication').hidden"), true);
                await evaluate("document.querySelector('#close-account').click(); window.dispatchEvent(new Event('sessionexpired'))");
                assert.equal(await evaluate("return !document.querySelector('#authentication').hidden && !document.querySelector('#identity-form').hidden && document.querySelector('#workspace').hidden && document.querySelector('#login-user').value === '' && !document.querySelector('dialog[open]')"), true);
            });
        } finally {
            const closed = new Promise(resolve => server.close(resolve));
            server.closeAllConnections();
            await closed;
        }
    });
});
