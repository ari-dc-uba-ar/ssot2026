import type {ErrorRequestHandler} from 'express';
import {isPlainObject, type Problem} from 'system-definition';
import type {ApiError} from './api-contract.js';

export class ApiFailure extends Error {
    readonly status: number;
    readonly problems: readonly Problem[];
    constructor(status: number, message: string, problems: readonly Problem[] = []) {
        super(message);
        this.status = status;
        this.problems = problems;
    }
}

export function readObject(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
    if (!isPlainObject(value) || required.some(name => !Object.hasOwn(value, name)) ||
        Object.keys(value).some(name => !required.includes(name) && !optional.includes(name))) {
        throw new ApiFailure(400, 'Se deben enviar exactamente los campos indicados por la API.');
    }
    return value;
}

export const apiErrorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    const conflicts: Record<string, string> = {
        '23505': 'Ya existe un registro con esa clave.',
        '23503': 'El registro tiene una referencia inválida o está siendo utilizado.',
        '23502': 'Falta un campo obligatorio.',
        '23514': 'Los datos no cumplen una restricción.',
        '22003': 'Un número está fuera del rango permitido.',
        '40P01': 'Otra operación modificó la cuenta. Volvé a intentar.',
    };
    const code = error instanceof Error && 'code' in error ? String(error.code) : '';
    const conflict = conflicts[code];
    const malformed = error instanceof SyntaxError && 'body' in error;
    const tooLarge = error instanceof Error && 'type' in error && error.type === 'entity.too.large';
    const status = error instanceof ApiFailure ? error.status : conflict ? 409 : malformed ? 400 : tooLarge ? 413 : 500;
    const message = error instanceof ApiFailure ? error.message : conflict ?? (malformed ? 'JSON inválido.' : tooLarge ? 'Solicitud demasiado grande.' : 'No se pudieron procesar los datos.');
    // Database exceptions may include submitted credentials in their detail. Never log the exception.
    if (status === 500) console.error('API operation failed.');
    res.status(status).json({error: message, ...(error instanceof ApiFailure && error.problems.length ? {problems: error.problems} : {})} satisfies ApiError);
};
