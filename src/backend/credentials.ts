import {createHash, randomBytes, scrypt, timingSafeEqual} from 'node:crypto';
import {ApiFailure} from './api-errors.js';

const options = {N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024};
const derive = (password: string, salt: string): Promise<Buffer> => new Promise((resolve, reject) => {
    scrypt(password, salt, 64, options, (error, key) => error ? reject(error) : resolve(key));
});

export function readPassword(value: unknown): string {
    if (typeof value !== 'string' || value.length < 12 || value.length > 128) {
        throw new ApiFailure(400, 'La contraseña debe tener entre 12 y 128 caracteres.');
    }
    return value;
}

export function readUsername(value: unknown): string {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_.-]{3,64}$/.test(value)) {
        throw new ApiFailure(400, 'El usuario debe tener entre 3 y 64 letras, números, puntos, guiones o guiones bajos.');
    }
    return value.toLowerCase();
}

export async function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    return `scrypt$32768$8$3$${salt}$${(await derive(password, salt)).toString('hex')}`;
}

// Missing users do the same expensive work as users with a password.
const dummyHash = `scrypt$32768$8$3$${'0'.repeat(32)}$${'0'.repeat(128)}`;
export async function verifyPassword(password: string, encoded: string = dummyHash): Promise<boolean> {
    const match = /^scrypt\$32768\$8\$3\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(encoded);
    if (!match) return verifyPassword(password);
    const actual = await derive(password, match[1]!);
    return timingSafeEqual(actual, Buffer.from(match[2]!, 'hex')) && encoded !== dummyHash;
}

export function hashRecoveryCode(code: string): string {
    return createHash('sha256').update(code).digest('hex');
}

export function createRecoveryCodes(): {codes: string[]; hashes: string} {
    const codes = Array.from({length: 8}, () => randomBytes(16).toString('hex').match(/.{8}/g)!.join('-'));
    return {codes, hashes: JSON.stringify(codes.map(hashRecoveryCode))};
}
