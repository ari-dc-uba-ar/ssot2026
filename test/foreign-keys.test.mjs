import assert from 'node:assert/strict';
import test from 'node:test';
import {referenceOptions} from '../dist/frontend/foreign-keys.js';

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
    ]), [{label: 'Empty code', values: {code: '', enabled: false}}]);
});
