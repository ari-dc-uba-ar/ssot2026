import type {EntityResponse, EntityQuery, FieldValue} from '../backend/browser-contract.js';
import {element} from './dom.js';
import {createValueField} from './value-field.js';

export function editColumnFilters(entity: EntityResponse, applied: EntityQuery['where'], apply: (where: Record<string, FieldValue>) => Promise<boolean>): void {
    const dialog = element('dialog');
    const title = element('h2', 'Filtrar por columnas');
    title.id = `filters-${crypto.randomUUID()}`;
    dialog.setAttribute('aria-labelledby', title.id);
    dialog.className = 'column-filters';
    const form = element('form');
    const fields = entity.columns.map(column => {
        const enabled = element('input');
        enabled.type = 'checkbox';
        enabled.checked = Object.hasOwn(applied ?? {}, column.name);
        const label = element('label');
        label.append(enabled, document.createTextNode(` Filtrar ${column.label}`));
        const group = element('fieldset');
        group.disabled = !enabled.checked;
        enabled.onchange = () => { group.disabled = !enabled.checked; };
        const editor = createValueField({...column, optionalOnUpdate: false}, applied?.[column.name]);
        group.append(editor.field);
        form.append(label, group);
        return {name: column.name, enabled, group, editor};
    });
    const actions = element('div');
    actions.className = 'actions';
    const submit = element('button', 'Aplicar');
    submit.type = 'submit';
    submit.className = 'primary';
    const clear = element('button', 'Quitar filtros');
    clear.type = 'button';
    clear.onclick = () => fields.forEach(({enabled, group}) => { enabled.checked = false; group.disabled = true; });
    const cancel = element('button', 'Cancelar');
    cancel.type = 'button';
    cancel.onclick = () => dialog.close();
    actions.append(submit, clear, cancel);
    form.append(actions);
    form.onsubmit = event => {
        event.preventDefault();
        const where = Object.fromEntries(fields.filter(({enabled}) => enabled.checked)
            .map(({name, editor}) => [name, editor.read() as FieldValue]));
        submit.disabled = true;
        void apply(where).then(accepted => { if (accepted) dialog.close(); })
            .finally(() => { submit.disabled = false; });
    };
    dialog.append(title, form);
    dialog.addEventListener('close', () => dialog.remove(), {once: true});
    document.body.append(dialog);
    dialog.showModal();
}
