import {boxType, commonTypeBehaviours, commonTypeDefs, notParsed, parsed, type TypeBehaviour, type TypeProvider} from 'system-definition';

const regularidadValues = ['Libre', 'Regular'] as const;
const cuatrimestreValues = ['1C', '2C'] as const;

export const appTypeDefs = {
    ...commonTypeDefs,
    posInteger: {...commonTypeDefs.integer, minimum: 1},
    regularidad: {tsType: boxType<typeof regularidadValues[number]>(), values: regularidadValues},
    cuatrimestre: {tsType: boxType<typeof cuatrimestreValues[number]>(), values: cuatrimestreValues},
    password: {...commonTypeDefs.text, minLength: 12, maxLength: 128},
};

const posIntegerBehaviour: TypeBehaviour<number> = {
    check: (value): value is number => commonTypeBehaviours.integer.check(value) && value >= appTypeDefs.posInteger.minimum,
    deserialize: text => {
        const result = commonTypeBehaviours.integer.deserialize(text);
        return result.ok && posIntegerBehaviour.check(result.value) ? result : notParsed('type.posInteger');
    },
    serialize: commonTypeBehaviours.integer.serialize,
};

function enumBehaviour<T extends readonly string[]>(values: T, name: string): TypeBehaviour<T[number]> {
    const check = (value: unknown): value is T[number] => typeof value === 'string' && values.includes(value);
    return {
        check,
        deserialize: text => check(text) ? parsed(text) : notParsed(`type.${name}`),
        serialize: value => value,
    };
}

export const passwordBehaviour: TypeBehaviour<string> = {
    check: (value): value is string => typeof value === 'string' &&
        value.length >= appTypeDefs.password.minLength && value.length <= appTypeDefs.password.maxLength,
    deserialize: text => passwordBehaviour.check(text) ? parsed(text) : notParsed('type.password'),
    serialize: value => value,
};

export const appTypeBehaviours = {
    ...commonTypeBehaviours,
    posInteger: posIntegerBehaviour,
    regularidad: enumBehaviour(appTypeDefs.regularidad.values, 'regularidad'),
    cuatrimestre: enumBehaviour(appTypeDefs.cuatrimestre.values, 'cuatrimestre'),
    password: passwordBehaviour,
} satisfies TypeProvider<typeof appTypeDefs>;

export type InputConstraints = {
    minLength: number | null;
    maxLength: number | null;
    minimum?: number;
    options?: readonly string[];
};

export const inputConstraints = {
    text: {minLength: null, maxLength: null},
    integer: {minLength: null, maxLength: null},
    boolean: {minLength: null, maxLength: null},
    posInteger: {minLength: null, maxLength: null, minimum: appTypeDefs.posInteger.minimum},
    regularidad: {minLength: null, maxLength: null, options: appTypeDefs.regularidad.values},
    cuatrimestre: {minLength: null, maxLength: null, options: appTypeDefs.cuatrimestre.values},
    password: {minLength: appTypeDefs.password.minLength, maxLength: appTypeDefs.password.maxLength},
} satisfies Record<keyof typeof appTypeDefs, InputConstraints>;
