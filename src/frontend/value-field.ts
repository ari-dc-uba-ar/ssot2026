import type {EntityInputColumn, FieldValue} from '../backend/browser-contract.js';
import {element} from './dom.js';

type Column = EntityInputColumn;
type Value = FieldValue;
type Editor = {input: HTMLInputElement | HTMLSelectElement; read: () => Value; requiredWhenEnabled?: boolean};

function integerEditor(constraints: Column['constraints']): Editor {
    const input = element('input');
    input.type = 'number';
    input.step = '1';
    if (constraints.minimum !== undefined) input.min = String(constraints.minimum);
    return {input, read: () => input.valueAsNumber, requiredWhenEnabled: true};
}

function enumEditor(constraints: Column['constraints']): Editor {
    const input = element('select');
    input.add(new Option('Ninguna', ''));
    for (const value of constraints.options ?? []) input.add(new Option(value, value));
    return {input, read: () => input.value, requiredWhenEnabled: true};
}

// Each supported display type has one editor. Adding a backend type requires a renderer.
const editors = {
    text: (_constraints) => {
        const input = element('input');
        return {input, read: () => input.value};
    },
    password: constraints => {
        const input = element('input');
        input.type = 'password';
        input.autocomplete = 'new-password';
        input.minLength = constraints.minLength ?? 0;
        input.maxLength = constraints.maxLength ?? 524288;
        return {input, read: () => input.value};
    },
    integer: integerEditor,
    posInteger: integerEditor,
    regularidad: enumEditor,
    cuatrimestre: enumEditor,
    boolean: (_constraints) => {
        const input = element('select');
        input.add(new Option('No', 'false'));
        input.add(new Option('Sí', 'true'));
        return {input, read: () => input.value === 'true'};
    },
} satisfies Record<Column['type'], (constraints: Column['constraints']) => Editor>;

// Shared by row editing and equality filters; null remains distinct from empty text.
export function createValueField(column: Column, value?: Value, optional = false) {
    const editor: Editor = editors[column.type](column.constraints);
    const input = editor.input;
    const select = input instanceof HTMLSelectElement;
    input.id = `field-${crypto.randomUUID()}`;
    input.name = column.name;
    if (select && column.nullable && ![...input.options].some(option => option.value === '')) {
        input.add(new Option('Ninguna', ''), 0);
    }
    input.value = String(value ?? (column.type === 'boolean' && !column.nullable ? false : ''));
    input.required = (!column.nullable || (!select && !!editor.requiredWhenEnabled)) && !optional;
    if (optional && input instanceof HTMLInputElement) input.placeholder = 'Sin cambios';
    const label = element('label', column.label + (optional ? ' (opcional)' : ''));
    label.htmlFor = input.id;
    const field = element('div');
    field.className = 'field';
    field.append(label, input);
    const empty = element('input');
    empty.type = 'checkbox';
    empty.checked = column.nullable && !select && value == null;
    if (column.nullable && !select) {
        const nullLabel = element('label');
        nullLabel.className = 'null-option';
        nullLabel.append(empty, document.createTextNode(' Ninguna'));
        field.append(nullLabel);
        empty.onchange = () => { input.disabled = empty.checked; };
    }
    input.disabled = empty.checked;
    return {field, label: label.textContent!, input, read: (): Value | undefined => {
        if (optional && input.value === '') return undefined;
        return empty.checked || (select && column.nullable && input.value === '') ? null : editor.read();
    }};
}
