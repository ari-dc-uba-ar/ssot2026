import {commonTypeDefs, notParsed, parsed, type TypeBehaviour} from 'system-definition';

export const appTypeDefs = {
    ...commonTypeDefs,
    password: {...commonTypeDefs.text, minLength: 12, maxLength: 128},
};

export const passwordBehaviour: TypeBehaviour<string> = {
    check: (value): value is string => typeof value === 'string' &&
        value.length >= appTypeDefs.password.minLength && value.length <= appTypeDefs.password.maxLength,
    deserialize: text => passwordBehaviour.check(text) ? parsed(text) : notParsed('type.password'),
    serialize: value => value,
};

export const inputConstraints = {
    text: {minLength: null, maxLength: null},
    integer: {minLength: null, maxLength: null},
    boolean: {minLength: null, maxLength: null},
    password: {minLength: appTypeDefs.password.minLength, maxLength: appTypeDefs.password.maxLength},
};
