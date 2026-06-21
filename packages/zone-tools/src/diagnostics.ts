import type { Diagnostic } from '@mmo/shared';

/**
 * Format validator Diagnostics into actionable, location-tagged lines (one per
 * finding). Empty in → empty string out, so the caller can print a clean bill of
 * health instead. Pure.
 */
export function formatDiagnostics(diags: Diagnostic[]): string {
	return diags
		.map((d) => {
			const sev = d.severity === 'error' ? 'error  ' : 'warning';
			const at = d.cell ? ` (${d.cell.x},${d.cell.y})` : '';
			return `${sev} ${d.zoneId}${at}: ${d.message}`;
		})
		.join('\n');
}
