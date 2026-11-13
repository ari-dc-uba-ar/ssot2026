import type {ReportJoin} from '../backend/browser-contract.js';

// Remove an occurrence and its descendants; keep other branches with updated indices.
export function removeReportJoin(joins: readonly ReportJoin[], occurrence: number): ReportJoin[] {
    const indices = new Map([[0, 0]]);
    const retained: ReportJoin[] = [];
    joins.forEach((join, index) => {
        const source = indices.get(join.source);
        if (index + 1 === occurrence || source === undefined) return;
        retained.push({...join, source});
        indices.set(index + 1, retained.length);
    });
    return retained;
}
