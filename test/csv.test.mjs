import assert from 'node:assert/strict';
import test from 'node:test';
import {parseCsv, stringifyCsv} from '../dist/backend/csv.js';

test('parses commas, escaped quotes, and embedded line breaks', () => {
    assert.deepEqual(parseCsv('a,b\r\n"one,two","said ""hello"""\r\n"line one\r\nline two",end\r\n'), [
        ['a', 'b'],
        ['one,two', 'said "hello"'],
        ['line one\r\nline two', 'end'],
    ]);
});

test('accepts UTF-8 BOM, LF records, empty fields, and a final record without newline', () => {
    assert.deepEqual(parseCsv('\uFEFFa,b\n,\nlast,'), [['a', 'b'], ['', ''], ['last', '']]);
});

test('rejects malformed quoting, bare carriage returns, and inconsistent row widths', () => {
    for (const csv of ['"unfinished', 'un"escaped', '"closed"x', 'a\rb', 'a,b\r\nc']) {
        assert.throws(() => parseCsv(csv), {message: 'CSV format error.'});
    }
});

test('stringifies all values with RFC-style escaping and round-trips null as empty', () => {
    const rows = [
        ['Header', 'Text', 'Nullable'],
        ['1', 'comma, quote " and\r\nnewline', null],
    ];
    const csv = stringifyCsv(rows);
    assert.equal(csv, '"Header","Text","Nullable"\r\n"1","comma, quote "" and\r\nnewline",""\r\n');
    assert.deepEqual(parseCsv(csv), [['Header', 'Text', 'Nullable'], ['1', 'comma, quote " and\r\nnewline', '']]);
});
