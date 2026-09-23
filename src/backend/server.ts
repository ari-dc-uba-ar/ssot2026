import express from "express";
import { Pool } from 'pg'

import { commonTypeDefs, defineTypes, type CoreFieldDef, completeCoreField, defineRecord, 
    withRecords, defineEntity, defineEntities,
    completeEntity, type Problem,
    withValidators
} from 'system-definition'
import { humanBehaviours, typeBehaviours } from "system-definition/examples";

export type MyFieldDef = CoreFieldDef<typeof commonTypeDefs> & {
    isName?: boolean
    label?: string
    description?: string
    maxLength?: number
}

export const myTypes = defineTypes({
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
    plan        :{ type:'integer'},
})

const pabellon = defineRecord(myTypes,{
    pab         : {type:'text'   },
    pabellon    : {type:'text'   },
    pisos       : {type:'integer'},
});

const myRecords = withRecords(myTypes, {materia, pabellon})

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

var myEntities = defineEntities({materias, pabellones})

const pool = new Pool();

const app = express();

app.use(express.urlencoded({ extended: true }));

app.get('/menu', (_, res) => {
    res.send('SSOT2026 - Solo Somos Otros Tenaces en 2026');
})

app.get('/poc/inter', (_, res) => {
    res.send(`
        <form method=post action="/poc/api/inter">
            <p>Esta es una prueba de concepto</p>
            <p><label>dato:<input name=dato></label></p>
            <input type=submit value="Procesar">
        </form>
    `)
})

app.post('/poc/api/inter', async (req, res) => {
    console.log('POST', '/poc/api/inter')
    console.log(req.query);
    res.send(`
        <H2>recibido</H2>
    `)
    console.log(await req.body);
})

Object.values(myEntities).forEach(entityDef => {
    const entity = completeEntity(myRecords, entityDef);
    const tabla = entity.name;

app.get(`/poc/lista-${tabla}`, async (_, res) => {
    const result = await pool.query(`
        SELECT ${Object.keys(entity.fields).join(',')} 
            FROM ssot.${tabla}
            ORDER BY ${entity.pk}
    `);
    res.send(`<table>
            <tr>
                ${Object.values(entity.fields).map(campo => 
                    `<th>${campo.label}</th>`
                ).join('')}
            </tr>
        ${result.rows.map((row:Record<string,any>)=>
            `<tr>
                ${Object.entries(row).map(([_, value]:string[])=>
                    `<td>${value}</td>`
                ).join('')}
            </tr>`
        ).join('')}
    </table>`)
})

})

const port = 3000;

app.listen(port, (error) => {
    if (error) throw error;
    console.log(`SSOT2026 escuchando en http://localhost:${port}/menu`);
})
