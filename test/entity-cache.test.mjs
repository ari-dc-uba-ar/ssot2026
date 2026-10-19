import assert from 'node:assert/strict';
import test from 'node:test';
import {createEntityCache} from '../dist/frontend/entity-cache.js';

const complete = {name: 'planes', rows: [], window: {kind: 'complete'}};
const page = {name: 'planes', rows: [], window: {kind: 'page', total: 201, matched: 201, page: 1}};
const deferred = () => Promise.withResolvers();

test('tabs and references share complete datasets and concurrent requests', async () => {
    const request = deferred();
    let calls = 0;
    const cache = createEntityCache(async () => { calls++; return request.promise; });
    const first = cache.load('planes'), second = cache.load('planes');
    request.resolve(complete);
    assert.equal(await first, complete);
    assert.equal(await second, complete);
    assert.equal(await cache.load('planes', {filter: 'local', page: 3}), complete);
    assert.equal(calls, 1);
});

test('server pages are keyed by the whole query and only the latest result is retained', async () => {
    const queries = [];
    const cache = createEntityCache(async (_name, query) => { queries.push(query); return page; });
    await cache.load('planes', {page: 1});
    await cache.load('planes', {page: 1});
    await cache.load('planes', {page: 2});
    await cache.load('planes', {filter: 'x', page: 2});
    await cache.load('planes', {filter: 'x', page: 2, sort: 'plan'});
    assert.equal(queries.length, 4);
    await cache.load('planes', {page: 1});
    assert.equal(queries.length, 5);
});

test('invalidation and logout reject every waiter on an obsolete in-flight response', async () => {
    for (const invalidate of [cache => cache.invalidate('planes'), cache => cache.invalidate(null), cache => cache.clear()]) {
        const request = deferred();
        let calls = 0;
        const cache = createEntityCache(async () => { calls++; return request.promise; });
        const first = cache.load('planes'), second = cache.load('planes');
        const checks = [assert.rejects(first, {name: 'AbortError'}), assert.rejects(second, {name: 'AbortError'})];
        invalidate(cache);
        request.resolve(complete);
        await Promise.all(checks);
        assert.equal(await cache.load('planes'), complete);
        assert.equal(calls, 2);
    }
});

test('failed requests can retry and unrelated entities survive targeted invalidation', async () => {
    let fail = true, calls = 0;
    const cache = createEntityCache(async name => { calls++; if (fail) throw new Error('offline'); return {...complete, name}; });
    await assert.rejects(cache.load('planes'), /offline/);
    fail = false;
    await cache.load('planes');
    await cache.load('materias');
    cache.invalidate('planes');
    await cache.load('materias');
    await cache.load('planes');
    assert.equal(calls, 4);
});
