import assert from 'node:assert/strict';
import test from 'node:test';
import {createReferenceFields, referenceOptions} from '../dist/frontend/foreign-keys.js';
import {loadReferenceSources} from '../dist/frontend/reference-sources.js';

test('FK options display keys and names while preserving the original value types', () => {
    const reference = {entity: 'planes', fields: {plan: 'plan'}, displayFields: ['plan', 'descripcion']};
    assert.deepEqual(referenceOptions(reference, [
        {plan: 0, descripcion: 'Inicial'}, {plan: 2026, descripcion: '<script>text</script>'},
        {plan: 1993, descripcion: null}, {plan: null, descripcion: 'No key'},
    ]), [
        {label: '0 — Inicial', values: {plan: 0}},
        {label: '2026 — <script>text</script>', values: {plan: 2026}},
        {label: '1993', values: {plan: 1993}},
    ]);
});

test('FK options map source aliases and composite keys without collapsing false or empty text to null', () => {
    assert.deepEqual(referenceOptions({fields: {code: 'key', enabled: 'active'}, displayFields: ['key', 'name']}, [
        {key: '', active: false, name: 'Empty code'}, {key: 'A', active: null, name: 'No complete key'},
    ]), [{label: '"" — false — Empty code', values: {code: '', enabled: false}}]);
});

const source = (fields, rows, displayFields = Object.values(fields)) => ({reference: {fields, displayFields}, rows});
const hierarchy = () => [
    source({building: 'id'}, [{id: 'A'}, {id: 'B'}, {id: 'C'}]),
    source({building: 'building', department: 'id'}, [
        {building: 'A', id: 0, name: 'Shared'}, {building: 'A', id: 1, name: 'Only A'},
        {building: 'B', id: 0, name: 'Shared'}, {building: 'B', id: 2, name: 'Only B'},
    ], ['building', 'id', 'name']),
    source({building: 'building', department: 'department', subject: 'id'}, [
        {building: 'A', department: 0, id: 'a'}, {building: 'A', department: 1, id: 'other'},
        {building: 'B', department: 0, id: 'b'}, {building: 'B', department: 2, id: 'another'},
    ]),
];
const options = (fields, name) => fields.options(name).map(option => option.value);
const labels = (fields, name) => fields.options(name).map(({value, label}) => ({value, label}));

test('dropdowns start with unique options and filter related fields in both directions', () => {
    const fields = createReferenceFields(hierarchy());
    assert.deepEqual(options(fields, 'building'), ['A', 'B', 'C']);
    assert.deepEqual(options(fields, 'department'), [0, 1, 2]);
    assert.deepEqual(options(fields, 'subject'), ['a', 'other', 'b', 'another']);
    fields.change('department', 1);
    assert.deepEqual(options(fields, 'building'), ['A']);
    assert.deepEqual(options(fields, 'subject'), ['other']);
    fields.change('department', null);
    fields.change('building', 'A');
    assert.deepEqual(options(fields, 'department'), [0, 1]);
    fields.change('department', 0);
    assert.deepEqual(options(fields, 'subject'), ['a']);
    assert.equal(fields.value('department'), 0);
});

test('changing a parent preserves compatible children and clears incompatible descendants', () => {
    const fields = createReferenceFields(hierarchy(), {building: 'A', department: 0, subject: 'a'});
    fields.change('building', 'B');
    assert.equal(fields.value('department'), 0);
    assert.equal(fields.value('subject'), null);
    assert.deepEqual(options(fields, 'subject'), ['b']);
    fields.change('subject', 'b');
    fields.change('department', 2);
    assert.equal(fields.value('subject'), null);
    fields.change('building', null);
    assert.equal(fields.value('department'), 2);
    assert.equal(fields.value('subject'), null);
    assert.deepEqual(options(fields, 'building'), ['B']);
    assert.deepEqual(options(fields, 'department'), [0, 1, 2]);
});

test('editing preserves initial values and a parent with no children remains selectable', () => {
    const fields = createReferenceFields(hierarchy(), {building: 'A', department: 1, subject: 'other'});
    assert.equal(fields.value('subject'), 'other');
    fields.change('building', 'C');
    assert.equal(fields.value('building'), 'C');
    assert.equal(fields.value('department'), null);
    assert.equal(fields.value('subject'), null);
    assert.deepEqual(options(fields, 'department'), []);
});

test('local composite key columns form one selection and retain false and empty text', () => {
    const fields = createReferenceFields([source({parent: 'key', child: 'code'}, [
        {key: '', code: false}, {key: '', code: true}, {key: 'B', code: false},
    ])]);
    assert.deepEqual(fields.names, ['parent', 'child']);
    assert.deepEqual(fields.groups.map(group => group.fields), [['parent', 'child']]);
    const option = fields.options('parent').find(option => option.values.parent === '' && option.values.child === false);
    assert.equal(option.label, '"" / false');
    fields.change('parent', '', option.key);
    assert.equal(fields.value('parent'), '');
    assert.equal(fields.value('child'), false);
    const other = fields.options('parent').find(option => option.values.parent === 'B');
    fields.change('parent', 'B', other.key);
    assert.equal(fields.value('child'), false);
});

test('overlapping FKs share one value per field and intersect the applicable options', () => {
    const fields = createReferenceFields([
        source({building: 'id'}, [{id: 'A'}, {id: 'B'}]),
        source({department: 'id'}, [{id: 0}, {id: 1}, {id: 2}]),
        source({building: 'building', department: 'id'}, [{building: 'A', id: 0}, {building: 'B', id: 2}]),
        source({unrelated: 'id'}, [{id: 'keep'}]),
    ], {building: 'A', department: 0, unrelated: 'missing'});
    assert.deepEqual(options(fields, 'department'), [0]);
    fields.change('building', 'B');
    assert.equal(fields.value('department'), null);
    assert.deepEqual(options(fields, 'department'), [2]);
    assert.equal(fields.value('unrelated'), 'missing');
    assert.equal(fields.names.filter(name => name === 'department').length, 1);
});

test('narrower parent relationships determine the hierarchy regardless of FK declaration order', () => {
    const sources = hierarchy().reverse().map(source => ({...source, reference: {...source.reference,
        fields: Object.fromEntries(Object.entries(source.reference.fields).reverse())}}));
    const fields = createReferenceFields(sources, {building: 'B'});
    assert.deepEqual(options(fields, 'building'), ['A', 'B', 'C']);
    assert.deepEqual(options(fields, 'department'), [0, 2]);
    fields.change('department', 2);
    assert.deepEqual(options(fields, 'subject'), ['another']);
});

test('referenced entities supply their parent relationships without redundant FKs on the edited entity', async () => {
    const calls = [];
    const entities = {
        departments: {rows: [{building_id: 'A', department_id: 0, name: 'Math'}], foreignKeys: [
            {name: 'building', entity: 'buildings', fields: {building_id: 'id'}, displayFields: ['id', 'name']},
        ]},
        buildings: {rows: [{id: 'A', name: 'North'}, {id: 'B', name: 'South'}], foreignKeys: []},
    };
    const sources = await loadReferenceSources([
        {name: 'department', entity: 'departments', fields: {building: 'building_id', department: 'department_id'}, displayFields: ['building_id', 'department_id', 'name']},
    ], async name => { calls.push(name); return entities[name]; });
    const fields = createReferenceFields(sources);
    assert.deepEqual(calls, ['departments', 'buildings']);
    assert.deepEqual(labels(fields, 'building'), [{value: 'A', label: 'A — North'}, {value: 'B', label: 'B — South'}]);
    fields.change('building', 'A');
    assert.deepEqual(options(fields, 'department'), [0]);
    fields.change('department', 0);
    fields.change('building', 'B');
    assert.equal(fields.value('department'), null);
    assert.deepEqual(options(fields, 'department'), []);
});

test('reference loading caches shared targets and terminates self references', async () => {
    let calls = 0;
    const reference = {name: 'parent', entity: 'nodes', fields: {parent: 'id'}, displayFields: ['id']};
    const sources = await loadReferenceSources([reference, {...reference, fields: {other: 'id'}}], async () => {
        calls++;
        return {rows: [{id: 0}], foreignKeys: [{...reference, fields: {id: 'id'}}]};
    });
    assert.equal(calls, 1);
    assert.equal(sources.length, 2);
    const fields = createReferenceFields(sources);
    assert.deepEqual(fields.names, ['parent', 'other']);
    fields.change('parent', 0);
    assert.equal(fields.value('other'), null);
});

test('the same code and isName produce one option across multiple parent contexts', () => {
    const fields = createReferenceFields([
        source({building: 'id'}, [{id: 'A'}, {id: 'B'}]),
        source({building: 'building', department: 'id'}, [
            {building: 'A', id: 0, name: 'Shared'}, {building: 'B', id: 0, name: 'Shared'},
        ], ['name']),
    ]);
    assert.deepEqual(labels(fields, 'department'), [{value: 0, label: '0 — Shared'}]);
    fields.change('department', 0);
    assert.deepEqual(options(fields, 'building'), ['A', 'B']);
    fields.change('building', 'A');
    assert.deepEqual(labels(fields, 'department'), [{value: 0, label: '0 — Shared'}]);
    fields.change('building', 'B');
    assert.deepEqual(labels(fields, 'department'), [{value: 0, label: '0 — Shared'}]);
    assert.equal(fields.value('department'), 0);
});

test('individual dropdown labels omit the inherited components of a composite FK', () => {
    const fields = createReferenceFields([
        source({building: 'b', department: 'd', subject: 's'}, [{b: 'A', d: 0, s: 'first'}, {b: 'B', d: 0, s: 'second'}]),
        source({building: 'b', department: 'd'}, [{b: 'A', d: 0}, {b: 'B', d: 0}]),
        source({building: 'b'}, [{b: 'A'}, {b: 'B'}]),
    ]);
    fields.change('building', 'A');
    assert.deepEqual(labels(fields, 'department'), [{value: 0, label: '0'}]);
    fields.change('department', 0);
    assert.deepEqual(labels(fields, 'subject'), [{value: 'first', label: 'first'}]);
});

test('enrolment has Department, Subject, Period and Student selectors with month/year selected together', () => {
    const fields = createReferenceFields([
        source({month: 'month', year: 'year', subject: 'subject', department: 'department'}, [
            {month: 3, year: 2026, subject: '101', department: 'DC'},
            {month: 3, year: 2027, subject: '101', department: 'DM'},
            {month: 8, year: 2026, subject: '201', department: 'DC'},
        ]),
        source({subject: 'code', department: 'department'}, [
            {code: '101', department: 'DC', name: 'Programming'}, {code: '101', department: 'DM', name: 'Algebra'},
            {code: '201', department: 'DC', name: 'Algorithms'},
        ], ['code', 'department', 'name']),
        source({department: 'code'}, [{code: 'DC', name: 'Computación'}, {code: 'DM', name: 'Matemática'}, {code: 'DF', name: 'Física'}], ['code', 'name']),
        source({student: 'id'}, [{id: 1, name: 'Ana'}, {id: 2, name: 'Luis'}], ['id', 'name']),
    ]);
    assert.equal(fields.groups.length, 4);
    assert.deepEqual(fields.group('month').fields, ['month', 'year']);
    fields.change('student', 2);
    const period = fields.options('month').find(option => option.values.month === 3 && option.values.year === 2027);
    assert.equal(period.label, '3 / 2027');
    fields.change('month', period.value, period.key);
    assert.deepEqual(options(fields, 'department'), ['DM']);
    assert.deepEqual(labels(fields, 'subject'), [{value: '101', label: '101 — Algebra'}]);
    assert.equal(fields.value('month'), 3);
    assert.equal(fields.value('year'), 2027);
    assert.equal(fields.value('student'), 2);
    fields.change('month', null);
    fields.change('department', 'DC');
    assert.deepEqual(labels(fields, 'subject'), [{value: '101', label: '101 — Programming'}, {value: '201', label: '201 — Algorithms'}]);
    fields.change('subject', '201');
    assert.deepEqual(fields.options('month').map(option => option.values), [{month: 8, year: 2026}]);
    assert.equal(fields.value('student'), 2);
});

test('different isName values for the same code remain distinct and filter their matching contexts', () => {
    const fields = createReferenceFields([
        source({building: 'id'}, [{id: 'A'}, {id: 'B'}, {id: 'C'}]),
        source({building: 'building', department: 'id'}, [
            {building: 'A', id: 0, name: 'Math'}, {building: 'B', id: 0, name: 'Math'}, {building: 'C', id: 0, name: 'Science'},
        ], ['building', 'id', 'name']),
    ]);
    assert.deepEqual(labels(fields, 'department'), [{value: 0, label: '0 — Math'}, {value: 0, label: '0 — Science'}]);
    const [math, science] = fields.options('department');
    fields.change('department', math.value, math.key);
    assert.deepEqual(options(fields, 'building'), ['A', 'B']);
    fields.change('building', 'A');
    fields.change('department', science.value, science.key);
    assert.equal(fields.value('building'), null);
    assert.deepEqual(options(fields, 'building'), ['C']);
    assert.equal(fields.value('department'), 0);
    assert.equal(fields.selection('department'), science.key);
});

test('independent FKs on a join table stay independent while sharing their parent context', () => {
    const fields = createReferenceFields([
        ...hierarchy().slice(0, 2),
        source({building: 'building', course: 'id'}, [{building: 'A', id: 'x'}, {building: 'B', id: 'y'}]),
    ], {building: 'A', department: 0, course: 'x'});
    fields.change('department', 1);
    assert.equal(fields.value('course'), 'x');
    fields.change('building', 'B');
    assert.equal(fields.value('department'), null);
    assert.equal(fields.value('course'), null);
    assert.deepEqual(options(fields, 'department'), [0, 2]);
    assert.deepEqual(options(fields, 'course'), ['y']);
});

test('an explicit Period entity joins through Course and filters complete month/year tuples', () => {
    const fields = createReferenceFields([
        source({month: 'm', year: 'y', subject: 's', department: 'd'}, [
            {m: 3, y: 2026, s: '101', d: 'DC'}, {m: 8, y: 2027, s: '101', d: 'DM'},
        ]),
        source({month: 'm', year: 'y'}, [{m: 3, y: 2026}, {m: 8, y: 2027}, {m: 3, y: 2027}, {m: 8, y: 2026}]),
        source({subject: 's', department: 'd'}, [{s: '101', d: 'DC', name: 'Programming'}, {s: '101', d: 'DM', name: 'Algebra'}], ['s', 'd', 'name']),
        source({department: 'd'}, [{d: 'DC'}, {d: 'DM'}]),
    ]);
    const period = fields.options('month').find(option => option.values.month === 3 && option.values.year === 2026);
    fields.change('month', period.value, period.key);
    assert.deepEqual(options(fields, 'department'), ['DC']);
    assert.deepEqual(labels(fields, 'subject'), [{value: '101', label: '101 — Programming'}]);
    fields.change('month', null);
    fields.change('subject', '101', fields.options('subject').find(option => option.label === '101 — Algebra').key);
    assert.deepEqual(fields.options('month').map(option => option.values), [{month: 8, year: 2027}]);
});
