import type {Problem} from 'system-definition';

const typeNames: Readonly<Record<string, string>> = {
    text: 'texto',
    integer: 'un número entero',
    boolean: 'verdadero o falso',
};

const messages: Readonly<Record<string, (details: Problem['details']) => string>> = {
    'field.required': () => 'Este campo es obligatorio.',
    'field.notOfItsType': ({type}) => `Debe ser ${typeNames[type ?? ''] ?? 'un valor válido'}.`,
    'record.notAnObject': () => 'Los datos enviados no son válidos.',
};

export function messageOf(problem: Problem): string {
    return messages[problem.messageKey]?.(problem.details) ?? problem.messageKey;
}
