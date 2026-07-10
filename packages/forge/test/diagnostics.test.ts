import { describe, expect, test } from 'bun:test';
import type { Diagnostic } from '@mmo/core/zones';
import { formatDiagnostics } from '../src/diagnostics';

describe('formatDiagnostics', () => {
	test('renders severity, zone, cell, and message per finding', () => {
		const diags: Diagnostic[] = [
			{
				severity: 'error',
				zoneId: 'field-01',
				cell: { x: 3, y: 5 },
				message: 'spawn is floating',
			},
			{
				severity: 'warning',
				zoneId: 'field-01',
				message: 'one-way portal',
			},
		];
		const out = formatDiagnostics(diags);
		expect(out).toContain('error');
		expect(out).toContain('field-01');
		expect(out).toContain('(3,5)');
		expect(out).toContain('spawn is floating');
		expect(out).toContain('warning');
		expect(out).toContain('one-way portal');
	});

	test('empty diagnostics render as empty string', () => {
		expect(formatDiagnostics([])).toBe('');
	});
});
