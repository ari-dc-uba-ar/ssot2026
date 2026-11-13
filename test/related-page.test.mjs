import assert from 'node:assert/strict';
import test from 'node:test';
import {loadRelatedPage} from '../dist/frontend/related-page.js';
import {createEntityCache} from '../dist/frontend/entity-cache.js';

const relationship = {name: 'warehouse', entity: 'stock', label: 'Stock', fields: {warehouse: 'code', region: 'region'}};
const reference = {name: 'product', entity: 'products', fields: {product: 'code', region: 'region'}, displayFields: ['code', 'region', 'title']};
const response = (name, rows, extra = {}) => ({name, rows, versions: rows.map(() => 'v'), pk: ['id'],
    browsing: {pageSize: 2}, window: {kind: 'complete'}, references: [],
    columns: ['warehouse', 'region', 'product', 'quantity'].map(name => ({name, label: name})), ...extra});

test('related pages use composite filters, retain association attributes and resolve only visible records', async () => {
    const calls = [];
    const cache = createEntityCache(async (name, query) => {
        calls.push({name, query});
        if (name === 'products') return response(name, [{code: 'P', region: 'N', title: 'Product'}],
            {window: {kind: 'page', page: 1, total: 250, matched: 1}});
        return response(name, [{product: 'P', region: 'N', quantity: 3}, {product: 'P', region: 'N', quantity: 7}],
            {references: [reference], window: {kind: 'page', page: query.page, matched: 5, total: 300}});
    }, {retainPages: true});
    const result = await loadRelatedPage(relationship, {code: 'W', region: 'N'}, 2, cache.load);
    assert.deepEqual(calls, [
        {name: 'stock', query: {where: {warehouse: 'W', region: 'N'}, page: 2}},
        {name: 'products', query: {where: {code: 'P', region: 'N'}}},
    ]);
    assert.equal(result.totalPages, 3);
    assert.deepEqual(result.columns, [
        {label: 'product', values: ['P — N — Product', 'P — N — Product']},
        {label: 'quantity', values: ['3', '7']},
    ]);
    await loadRelatedPage(relationship, {code: 'W', region: 'N'}, 1, cache.load);
    await loadRelatedPage(relationship, {code: 'W', region: 'N'}, 2, cache.load);
    assert.equal(calls.length, 3, 'Previously visited pages and repeated target keys are cached');
});

test('complete datasets filter and paginate locally; null links and unavailable targets keep their values', async () => {
    const rows = [
        {id: 1, warehouse: 'W', region: 'N', product: null, quantity: 0},
        {id: 2, warehouse: 'W', region: 'N', product: 'missing', quantity: ''},
        {id: 3, warehouse: 'W', region: 'N', product: 'next', quantity: 9},
        {id: 4, warehouse: 'other', region: 'N', product: 'excluded', quantity: 1},
    ];
    const calls = [];
    const load = async (name, query) => {
        calls.push({name, query});
        return name === 'stock' ? response(name, rows, {references: [reference]}) : response(name, []);
    };
    const result = await loadRelatedPage(relationship, {code: 'W', region: 'N'}, 1, load);
    assert.equal(result.matched, 3);
    assert.equal(result.totalPages, 2);
    assert.deepEqual(result.columns, [
        {label: 'product', values: ['Ninguna / N', 'missing / N']},
        {label: 'quantity', values: ['0', '""']},
    ]);
    assert.equal(calls.length, 2, 'Null links and off-page rows require no target lookup');
    assert.equal(await loadRelatedPage(relationship, {code: null, region: 'N'}, 1, load), null);
    assert.equal(calls.length, 2, 'A null parent key establishes no relationship');
});

test('overlapping foreign keys retain both labels and ordinary 1:N records need no target lookups', async () => {
    const load = async name => name === 'stock'
        ? response(name, [{warehouse: 'W', region: 'N', product: 'P', quantity: 2}], {references: [reference,
            {...reference, name: 'alternate', entity: 'alternates'}]})
        : response(name, [{code: 'P', region: 'N', title: name}]);
    const result = await loadRelatedPage(relationship, {code: 'W', region: 'N'}, 1, load);
    assert.deepEqual(result.columns.map(column => column.values), [['P — N — products'], ['P — N — alternates'], ['2']]);
    assert.deepEqual(result.columns.map(column => column.label), ['product · product', 'product · alternate', 'quantity']);
    let calls = 0;
    const plain = await loadRelatedPage(relationship, {code: 'W', region: 'N'}, 1, async name => {
        calls++;
        return response(name, [{warehouse: 'W', region: 'N', product: 'P', quantity: 2}]);
    });
    assert.equal(calls, 1);
    assert.equal(plain.columns[0].values[0], 'P');
});
