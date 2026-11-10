export type CsvValue = string | number | boolean | null;

const invalidCsv = (): never => { throw new Error('CSV format error.'); };

export function parseCsv(text: string): string[][] {
    const source = text.startsWith('\uFEFF') ? text.slice(1) : text;
    if (!source) return [];

    const records: string[][] = [];
    let record: string[] = [];
    let field = '';
    let state: 'start' | 'unquoted' | 'quoted' | 'after-quote' = 'start';
    let recordStarted = false;

    const finishField = () => {
        record.push(field);
        field = '';
        state = 'start';
    };
    const finishRecord = () => {
        finishField();
        records.push(record);
        record = [];
        recordStarted = false;
    };

    for (let i = 0; i < source.length; i++) {
        const character = source[i]!;
        if (state === 'quoted') {
            if (character === '"') {
                if (source[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    state = 'after-quote';
                }
            } else {
                field += character;
            }
            recordStarted = true;
            continue;
        }

        if (character === '\r' || character === '\n') {
            if (character === '\r' && source[i + 1] !== '\n') invalidCsv();
            if (character === '\r') i++;
            finishRecord();
            continue;
        }
        if (state === 'after-quote') {
            if (character === ',') finishField();
            else invalidCsv();
            recordStarted = true;
            continue;
        }
        if (character === ',') {
            finishField();
            recordStarted = true;
        } else if (character === '"') {
            if (state !== 'start') invalidCsv();
            state = 'quoted';
            recordStarted = true;
        } else {
            field += character;
            state = 'unquoted';
            recordStarted = true;
        }
    }

    if (state === 'quoted') invalidCsv();
    if (recordStarted || field !== '' || record.length > 0) {
        finishField();
        records.push(record);
    }

    if (records.length > 0) {
        const width = records[0]!.length;
        if (records.some(row => row.length !== width)) invalidCsv();
    }
    return records;
}

export function stringifyCsv(rows: readonly (readonly CsvValue[])[]): string {
    if (!rows.length) return '';
    const width = rows[0]!.length;
    if (rows.some(row => row.length !== width)) invalidCsv();

    return `${rows.map(row => row.map(value => {
        const text = value === null ? '' : String(value);
        return `"${text.replaceAll('"', '""')}"`;
    }).join(',')).join('\r\n')}\r\n`;
}
