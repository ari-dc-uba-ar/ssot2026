import { defineTypes, type CoreFieldDef, completeCoreField, defineRecord,
    withRecords, defineEntity, defineEntities, captureSystemSnapshot,
    sqlTypes, type SqlTypeMapping,
    type Problem, type HumanProvider,
    withValidators
} from 'system-definition'
import { humanBehaviours } from "system-definition/examples";
import {appTypeDefs, appTypeBehaviours, inputConstraints} from './value-types.js';
export {migrationAuthoring} from './migration-authoring.js';

const myHumanBehaviours: HumanProvider<typeof appTypeDefs> = {...humanBehaviours};

type MyFieldDef = CoreFieldDef<typeof appTypeDefs> & {
    isName?: boolean
    label?: string
    description?: string
    maxLength?: number
    readable?: boolean
    visible?: boolean
    writable?: boolean
    inputName?: string
    inputType?: keyof typeof appTypeDefs
    transform?: 'username' | 'password' | null
    onCreate?: 'uuid' | 'empty-array' | null
    onUpdate?: 'uuid' | null
    onPasswordChange?: 'empty-array' | null
}

const myTypes = defineTypes({
    types: appTypeDefs,
    behaviours: appTypeBehaviours,
    human: myHumanBehaviours,
    completeField: (fieldDef: MyFieldDef, name: string) => ({
        ...completeCoreField(fieldDef, name),
        isName     : fieldDef.isName ?? false,
        label      : fieldDef.label ?? name.replace(/_/g,' '),
        description: fieldDef.description ?? '',
        maxLength  : fieldDef.maxLength ?? 100,
        readable   : fieldDef.readable ?? true,
        visible    : fieldDef.visible ?? true,
        writable   : fieldDef.writable ?? true,
        inputName  : fieldDef.inputName ?? name,
        inputType  : fieldDef.inputType ?? fieldDef.type,
        inputConstraints: inputConstraints[fieldDef.inputType ?? fieldDef.type],
        transform  : fieldDef.transform ?? null,
        onCreate   : fieldDef.onCreate ?? null,
        onUpdate   : fieldDef.onUpdate ?? null,
        onPasswordChange: fieldDef.onPasswordChange ?? null,
    }),
})

const plan = defineRecord(myTypes,{
    plan        :{ type:'integer', label: 'Plan' },
    descripcion :{ type:'text', label: 'Descripción', isName: true },
})

const materia = defineRecord(myTypes,{
    cod_mat     :{ type:'text', label: 'Código' },
    cod_dep     :{ type:'text', label: 'Código de departamento' },
    materia     :{ type:'text', label: 'Materia', isName: true },
    plan        :{ type:'integer', label: 'Plan' },
    obligatoria :{ type:'boolean', label: 'Obligatoria' },
})

const departamento = defineRecord(myTypes,{
    cod_dep     :{ type:'text', label: 'Código' },
    departamento:{ type:'text', label: 'Departamento', isName: true },
    pabellon    :{ type:'text', label: 'Código de pabellón' },
})

const estudiante = defineRecord(myTypes,{
    legajo       :{ type:'text', label: 'Legajo' },
    nombre       :{ type:'text', label: 'Nombre', isName: true },
})

const enrolamiento = defineRecord(myTypes,{
    legajo       :{ type:'text', label: 'Legajo' },
    cod_mat      :{ type:'text', label: 'Código de materia' },
    cod_dep      :{ type:'text', label: 'Código de departamento' },
    año          :{ type:'posInteger', label: 'Año' },
    cuatrimestre :{ type:'cuatrimestre', label: 'Cuatrimestre' },
    nota         :{ type:'integer', label: 'Nota' },
    regularidad  :{ type:'regularidad', label: 'Regularidad' },
})

const regularidad = defineRecord(myTypes,{
    regularidad  :{ type:'regularidad', label: 'Regularidad' },
    descripcion  :{ type:'text', label: 'Descripción' },
})

const pabellon = defineRecord(myTypes,{
    pab          :{ type:'text', label: 'Código' },
    pabellon     :{ type:'text', label: 'Pabellón' },
    pisos        :{ type:'integer', label: 'Pisos' },
});

const usuario = defineRecord(myTypes, {
    id: {type: 'text', nullable: false, writable: false as const, visible: false as const, onCreate: 'uuid' as const},
    usuario: {type: 'text', label: 'Usuario', nullable: false, transform: 'username' as const},
    contrasena_hash: {type: 'text', nullable: false, label: 'Contraseña', readable: false as const,
        inputName: 'contrasena' as const, inputType: 'password' as const, transform: 'password' as const},
    recuperacion_hashes: {type: 'text', nullable: false, readable: false as const, writable: false as const,
        onCreate: 'empty-array' as const, onPasswordChange: 'empty-array' as const},
    version_sesion: {type: 'text', nullable: false, readable: false as const, writable: false as const,
        onCreate: 'uuid' as const, onUpdate: 'uuid' as const},
});

export const myRecords = withRecords(myTypes, {materia, pabellon, plan, usuario, departamento, estudiante, enrolamiento, regularidad})

function validarPlan1993SinObligatorias(materia:{plan?:number | null, obligatoria?:boolean | null}){
    var problemas: Problem[] = []
    if (materia.plan == 1993) {
        if (materia.obligatoria) problemas.push({
            field: 'obligatoria',
            messageKey: 'plan 1993 no puede tener obligatorias',
            severity: 'regular',
            details: {}
        } satisfies Problem)
    }
    return problemas;
}

export const myContext = withValidators(myRecords, {validarPlan1993SinObligatorias})

const pabellones = defineEntity(myContext, {
    name: 'pabellones',
    record: 'pabellon',
    pk: ['pab']
})

const departamentos = defineEntity(myContext, {
    name: 'departamentos',
    record: 'departamento',
    pk: ['cod_dep'],
    fks: {pabellon: {entity: 'pabellones', fields: {pabellon: 'pab'}}}
})

const materias = defineEntity(myContext, {
    name: 'materias',
    record: 'materia',
    pk: ['cod_mat', 'cod_dep'],
    fks: {plan: {entity: 'planes', fields: ['plan']}, departamento: {entity: 'departamentos', fields: ['cod_dep']}},
    validators: ['validarPlan1993SinObligatorias']
})

const estudiantes = defineEntity(myContext, {
    name: 'estudiantes',
    record: 'estudiante',
    pk: ['legajo']
})

const enrolamientos = defineEntity(myContext, {
    name: 'enrolamientos',
    record: 'enrolamiento',
    pk: ['legajo', 'cod_mat', 'cod_dep', 'año', 'cuatrimestre'],
    fks: {estudiante: {entity: 'estudiantes', fields: ['legajo']}, materia: {entity: 'materias', fields: ['cod_mat', 'cod_dep']}}
})

const planes = defineEntity(myContext, {
    name: 'planes',
    record: 'plan',
    pk: ['plan']
})

// Required by authentication, including the narrowly scoped anonymous login/recovery operations.
export const authenticationEntity = 'usuarios';
const usuarios = defineEntity(myContext, {
    name: authenticationEntity,
    record: 'usuario',
    pk: ['id'],
    uks: {usuario_unico: ['usuario']},
});

export const myEntities = defineEntities({materias, pabellones, planes, usuarios, departamentos, estudiantes, enrolamientos})

// Presentation is app-owned metadata; browsers receive it through the API.
export const entityLabels = {
    materias: 'Materias', pabellones: 'Pabellones', planes: 'Planes de Estudio', usuarios: 'Usuarios',
    departamentos: 'Departamentos', estudiantes: 'Estudiantes', enrolamientos: 'Inscripciones',
} satisfies Record<keyof typeof myEntities, string>;

const snapshot = captureSystemSnapshot(myContext, {
    systemId: 'ssot2026',
    entities: myEntities,
    records: myRecords.records,
});
if (!snapshot.ok) throw new Error(JSON.stringify(snapshot.problems));
export const ssot = snapshot.value;

export const sqlMapping = {
    text: sqlTypes.text,
    integer: sqlTypes.integer,
    posInteger: sqlTypes.integer,
    regularidad: sqlTypes.text,
    cuatrimestre: sqlTypes.text,
    boolean: sqlTypes.boolean,
    password: sqlTypes.text,
} satisfies SqlTypeMapping<typeof ssot>;
