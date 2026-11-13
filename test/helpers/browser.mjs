import {spawn} from 'node:child_process';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const delay = () => new Promise(resolve => setTimeout(resolve, 100));

// Adapted from PR #34: readable page actions shared by browser suites.
export function pageActions({send, evaluate}) {
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
    return {inPage, waitFor, resize, click, setValue, submit, valueOf, textOf, isVisible, focusedId, dialogIsOpen, rowCount};
}

export async function until(check) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        if (await check()) return;
        await delay();
    }
    throw new Error(`Timed out: ${check}`);
}

// BROWSER_BIN points to a Chromium browser; no browser automation dependency.
export async function withBrowser(run, {profile: existingProfile} = {}) {
    if (!process.env.BROWSER_BIN) throw new Error('Set BROWSER_BIN to a Chromium browser executable.');
    const profile = existingProfile ?? await mkdtemp(join(tmpdir(), 'ssot-browser-'));
    if (existingProfile) await rm(join(profile, 'DevToolsActivePort'), {force: true});
    const browser = spawn(process.env.BROWSER_BIN, ['--headless=new', '--disable-gpu', '--no-first-run',
        '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
    {windowsHide: true, stdio: 'ignore'});
    let socket;
    const exited = new Promise(resolve => browser.once('exit', resolve));
    try {
        let port;
        await until(async () => {
            try {
                port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
                return Number.isInteger(port) && port > 0;
            } catch (error) { if (!['ENOENT', 'EBUSY'].includes(error.code)) throw error; return false; }
        });
        const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
        socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
        await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
        const pending = new Map(), errors = [];
        let id = 0;
        socket.onmessage = event => {
            const message = JSON.parse(event.data);
            if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
            if (pending.has(message.id)) {
                const {resolve, reject} = pending.get(message.id);
                pending.delete(message.id);
                if (message.error) reject(new Error(JSON.stringify(message.error)));
                else resolve(message.result);
            }
        };
        const send = (method, params = {}) => new Promise((resolve, reject) => {
            const call = ++id;
            pending.set(call, {resolve, reject});
            socket.send(JSON.stringify({id: call, method, params}));
        });
        await send('Runtime.enable');
        const evaluate = async expression => {
            const result = await send('Runtime.evaluate', {expression: `(() => { ${expression} })()`, awaitPromise: true, returnByValue: true});
            if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
            return result.result.value;
        };
        await run({send, evaluate, errors});
    } finally {
        if (socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({id: 999999, method: 'Browser.close'}));
            await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3000))]);
        }
        socket?.close();
        browser.kill();
        await exited;
        // This path is the exact temporary directory created above, outside the repository.
        if (!existingProfile) await rm(profile, {recursive: true, force: true, maxRetries: 20, retryDelay: 200});
    }
}
