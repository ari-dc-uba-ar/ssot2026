import type {EntityResponse} from '../backend/browser-contract.js';
import {exportEntityCsv, importEntityCsv} from './api.js';
import {actionButton} from './action-button.js';
import {showResultDialog} from './confirm.js';
import {element} from './dom.js';

// Adapted from PR #40; available actions and upload limits come from the API.
export function createCsvActions(entity: Pick<EntityResponse, 'name' | 'csv'>, refresh: () => Promise<void>,
    run: (work: () => Promise<void>) => Promise<void>): DocumentFragment {
    const controls = document.createDocumentFragment();
    if (entity.csv.export) controls.append(actionButton('Exportar CSV', 'download', () => { void run(async () => {
        const url = URL.createObjectURL(await exportEntityCsv(entity.name));
        const link = element('a');
        link.href = url;
        link.download = `${entity.name}.csv`;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }); }));
    if (entity.csv.import) {
        const fileInput = element('input');
        fileInput.type = 'file';
        fileInput.accept = '.csv,text/csv';
        fileInput.hidden = true;
        fileInput.onchange = () => {
            const file = fileInput.files?.[0];
            fileInput.value = '';
            if (!file) return;
            void run(async () => {
                try {
                    if (file.size > entity.csv.maxBytes) throw new Error(`El archivo CSV supera el límite de ${entity.csv.maxBytes / (1024 * 1024)} MB.`);
                    const result = await importEntityCsv(entity.name, await file.text());
                    let refreshMessage = '';
                    try { await refresh(); }
                    catch { refreshMessage = ' La tabla no pudo actualizarse; usá “Actualizar” para ver los cambios.'; }
                    await showResultDialog({title: 'Importación completa',
                        message: `${result.inserted} filas agregadas y ${result.unchanged} ya existentes.${refreshMessage}`, success: true});
                } catch (error) {
                    await showResultDialog({title: 'No se pudo importar el CSV',
                        message: error instanceof Error ? error.message : 'No se pudo completar la importación.', success: false});
                }
            });
        };
        controls.append(fileInput, actionButton('Importar CSV', 'upload', () => fileInput.click()));
    }
    return controls;
}
