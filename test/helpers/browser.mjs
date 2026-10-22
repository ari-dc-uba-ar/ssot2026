import {spawn} from 'node:child_process';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const delay = () => new Promise(resolve => setTimeout(resolve, 100));
export async function until(check) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        if (await check()) return;
        await delay();
    }
    throw new Error(`Timed out: ${check}`);
}

// BROWSER_BIN points to a Chromium browser; no browser automation dependency.
export async function withBrowser(run) {
    if (!process.env.BROWSER_BIN) throw new Error('Set BROWSER_BIN to a Chromium browser executable.');
    const profile = await mkdtemp(join(tmpdir(), 'ssot-browser-'));
    const browser = spawn(process.env.BROWSER_BIN, ['--headless=new', '--disable-gpu', '--no-first-run',
        '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
    {windowsHide: true, stdio: 'ignore'});
    let socket;
    const exited = new Promise(resolve => browser.once('exit', resolve));
    try {
        let port;
        await until(async () => {
            try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; return true; }
            catch (error) { if (error.code !== 'ENOENT') throw error; return false; }
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
        await rm(profile, {recursive: true, force: true, maxRetries: 20, retryDelay: 200});
    }
}
