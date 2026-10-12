import { commonTypeDefs, defineTypes, type CoreFieldDef, completeCoreField, defineRecord,
    withRecords, defineEntity, defineEntities, captureSystemSnapshot,
    sqlTypes, type SqlTypeMapping,
    type Problem,
    withValidators
} from 'system-definition'
import { humanBehaviours, typeBehaviours } from "system-definition/examples";

type MyFieldDef = CoreFieldDef<typeof commonTypeDefs> & {
    isName?: boolean
    label?: string
    description?: string
    maxLength?: number
}

const myTypes = defineTypes({
    types: commonTypeDefs,
    behaviours: typeBehaviours,
    human: humanBehaviours,
    completeField: (fieldDef: MyFieldDef, name: string) => ({
        ...completeCoreField(fieldDef, name),
        isName     : fieldDef.isName ?? false,
        label      : fieldDef.label ?? name.replace(/_/g,' '),
        description: fieldDef.description ?? '',
        maxLength  : fieldDef.maxLength ?? 100
    }),
})

const plan = defineRecord(myTypes,{
    plan        :{ type:'integer'},
    descripcion :{ type:'text'   },
})

const materia = defineRecord(myTypes,{
    cod_mat     :{ type:'text'   },
    materia     :{ type:'text'   },
    plan        :{ type:'integer'},
    obligatoria :{ type:'boolean'},
})
const pabellon = defineRecord(myTypes,{
    pab         : {type:'text'   },
    pabellon    : {type:'text'   },
    pisos       : {type:'integer'},
});

export const myRecords = withRecords(myTypes, {materia, pabellon, plan})

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

const myReordsValidators = withValidators(myRecords, {validarPlan1993SinObligatorias})

const materias = defineEntity(myReordsValidators, {
    name: 'materias',
    record: 'materia',
    pk: ['materia'],
    validators: ['validarPlan1993SinObligatorias']
})

const pabellones = defineEntity(myReordsValidators, {
    name: 'pabellones',
    record: 'pabellon',
    pk: ['pab']
})

const planes = defineEntity(myReordsValidators, {
    name: 'planes',
    record: 'plan',
    pk: ['plan']
})

export const myEntities = defineEntities({materias, pabellones, planes})

const snapshot = captureSystemSnapshot(myReordsValidators, {
    systemId: 'ssot2026',
    entities: myEntities,
    records: myRecords.records,
});
if (!snapshot.ok) throw new Error(JSON.stringify(snapshot.problems));
export const ssot = snapshot.value;

export const sqlMapping = {
    text: sqlTypes.text,
    integer: sqlTypes.integer,
    boolean: sqlTypes.boolean,
} satisfies SqlTypeMapping<typeof ssot>;
