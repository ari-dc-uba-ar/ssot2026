import { commonTypeDefs, defineTypes, type CoreFieldDef, completeCoreField, defineRecord,
    withRecords, defineEntity, defineEntities, captureSystemSnapshot,
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

const materia = defineRecord(myTypes,{
    cod_mat     :{ type:'text'   },
    materia     :{ type:'text'   },
    obligatoria :{ type:'boolean'},
})

const pabellon = defineRecord(myTypes,{
    pab         : {type:'text'   },
    pabellon    : {type:'text'   },
    pisos       : {type:'integer'},
});

const usuario = defineRecord(myTypes,{
    usuario     : {type:'text'   },
    clave       : {type:'text'   },
});

export const myRecords = withRecords(myTypes, {materia, pabellon, usuario})

function validarPlan1993SinObligatorias(dato:{plan?:number, obligatoria?:boolean}){
    var problemas: Problem[] = []
    if (dato.plan == 1993) {
        if (dato.obligatoria) problemas.push({
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
    // validators: ['validarPlan1993SinObligatorias']
})

const pabellones = defineEntity(myReordsValidators, {
    name: 'pabellones',
    record: 'pabellon',
    pk: ['pab']
})

const usuarios = defineEntity(myReordsValidators, {
    name: 'usuarios',
    record: 'usuario',
    pk: ['usuario']
})


export const myEntities = defineEntities({materias, pabellones, usuarios})

export function captureSnapshot() {
    return captureSystemSnapshot(myRecords, {
        systemId: 'ssot2026',
        entities: myEntities,
        records: myRecords.records,
    });
}
