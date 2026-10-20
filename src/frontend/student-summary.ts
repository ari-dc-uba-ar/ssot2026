import type {StudentSummary} from '../backend/api-contract.js';
import {element} from './dom.js';

export function showStudentSummary(summary: StudentSummary): void {
    const dialog = element('dialog');
    dialog.append(element('h2', `${summary.nombre ?? '(sin nombre)'} · legajo ${summary.legajo}`));
    const totals = element('p');
    totals.append(
        element('strong', `Promedio: ${summary.promedio === null ? 'sin materias aprobadas' : summary.promedio.toFixed(2)}`),
        document.createTextNode(` · Créditos completados: ${summary.aprobadas} ${summary.aprobadas === 1 ? 'materia aprobada' : 'materias aprobadas'}`),
    );
    dialog.append(totals);
    if (summary.materias.length) {
        const table = element('table');
        const header = table.createTHead().insertRow();
        for (const label of ['Materia', 'Año', 'Cuatrimestre', 'Nota']) header.append(element('th', label));
        const body = table.createTBody();
        for (const item of summary.materias) {
            const row = body.insertRow();
            for (const text of [item.materia ?? `${item.cod_dep} ${item.cod_mat}`, String(item.año), item.cuatrimestre, String(item.nota)]) row.insertCell().textContent = text;
        }
        dialog.append(table);
    }
    const close = element('button', 'Cerrar');
    close.type = 'button';
    close.onclick = () => dialog.close();
    dialog.onclose = () => dialog.remove();
    dialog.append(close);
    document.body.append(dialog);
    dialog.showModal();
}
