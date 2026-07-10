import type { Diagnostic } from '@mmo/core/zones';

export function formatDiagnostics(diags: Diagnostic[]): string {
	return diags
		.map((d) => {
			const sev = d.severity === 'error' ? 'error  ' : 'warning';
			const at = d.cell ? ` (${d.cell.x},${d.cell.y})` : '';
			return `${sev} ${d.zoneId}${at}: ${d.message}`;
		})
		.join('\n');
}
