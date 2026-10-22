import type {EntityResponse} from '../backend/browser-contract.js';
import type {Row, Value} from './row-editor.js';
import {element} from './dom.js';

export function reviewRow(entity: EntityResponse, original: Row, draft: Readonly<Record<string, Value>>, current?: Row): void {
    const dialog = element('dialog');
    dialog.append(element('h2', 'Revisar cambios'), element('p', 'Tu borrador se conserva. Actualizar la planilla permite cargar los datos actuales después de revisarlos.'));
    if (!current) dialog.append(element('p', 'El registro ya no existe con su clave original.'));
    const table = element('table');
    const header = table.createTHead().insertRow();
    for (const label of ['Campo', 'Original', 'Actual', 'Tu borrador']) header.append(element('th', label));
    const body = table.createTBody();
    for (const column of entity.columns) {
        const row = body.insertRow();
        row.append(element('th', column.label));
        for (const values of [original, current, draft]) {
            const value: unknown = values && Reflect.get(values, column.name);
            row.insertCell().textContent = value == null ? 'Ninguna' : value === '' ? '""' : String(value);
        }
    }
    const close = element('button', 'Cerrar');
    close.type = 'button';
    close.onclick = () => dialog.close();
    dialog.onclose = () => dialog.remove();
    dialog.append(table, close);
    document.body.append(dialog);
    dialog.showModal();
}
