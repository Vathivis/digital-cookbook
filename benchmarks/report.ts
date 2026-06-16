import fs from 'fs';
import path from 'path';
import { ensureDir, type BenchmarkOptions } from './config';

export type ApiCallMetric = {
	label: string;
	method: string;
	url: string;
	status: number;
	ok: boolean;
	durationMs: number;
	requestBytes: number;
	responseBytes: number;
	error?: string;
};

export type InteractionMetric = {
	label: string;
	durationMs: number;
	apiCallsBefore: number;
	apiCallsAfter: number;
};

export type IterationMetric = {
	label: string;
	iteration: number;
	durationMs: number;
};

export type QueryPlanMetric = {
	label: string;
	durationMs: number;
	rowCount: number;
	plan: string[];
};

export type MemorySampleMetric = {
	label: string;
	role: string;
	timestampMs: number;
	rssBytes: number;
	privateBytes?: number;
	processCount: number;
};

export type MemoryPhaseMetric = {
	label: string;
	durationMs: number;
};

export type BenchmarkReport = {
	name: string;
	startedAt: string;
	finishedAt: string;
	options: Partial<BenchmarkOptions>;
	totalDurationMs?: number;
	apiCalls?: ApiCallMetric[];
	interactions?: InteractionMetric[];
	iterationTimings?: IterationMetric[];
	queryPlans?: QueryPlanMetric[];
	memorySamples?: MemorySampleMetric[];
	memoryPhases?: MemoryPhaseMetric[];
	notes?: string[];
};

const round = (value: number) => Math.round(value * 100) / 100;
const bytesToMiB = (value: number) => round(value / 1024 / 1024);

export function percentile(values: number[], pct: number) {
	if (!values.length) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
	return sorted[index];
}

export function summarizeDurations(values: number[]) {
	return {
		count: values.length,
		p50: round(percentile(values, 50)),
		p75: round(percentile(values, 75)),
		p95: round(percentile(values, 95)),
		p99: round(percentile(values, 99)),
		max: round(values.length ? Math.max(...values) : 0),
	};
}

export function summarizeApiCalls(calls: ApiCallMetric[]) {
	const byLabel = new Map<string, ApiCallMetric[]>();
	for (const call of calls) {
		const bucket = byLabel.get(call.label) ?? [];
		bucket.push(call);
		byLabel.set(call.label, bucket);
	}
	return [...byLabel.entries()].map(([label, bucket]) => ({
		label,
		...summarizeDurations(bucket.map((call) => call.durationMs)),
		errors: bucket.filter((call) => !call.ok).length,
		avgResponseBytes: Math.round(bucket.reduce((sum, call) => sum + call.responseBytes, 0) / bucket.length),
	}));
}

export function summarizeIterationTimings(iterations: IterationMetric[]) {
	const byLabel = new Map<string, IterationMetric[]>();
	for (const iteration of iterations) {
		const bucket = byLabel.get(iteration.label) ?? [];
		bucket.push(iteration);
		byLabel.set(iteration.label, bucket);
	}
	return [...byLabel.entries()].map(([label, bucket]) => ({
		label,
		...summarizeDurations(bucket.map((iteration) => iteration.durationMs)),
		totalMs: round(bucket.reduce((sum, iteration) => sum + iteration.durationMs, 0)),
	}));
}

export function summarizeMemoryPhases(samples: MemorySampleMetric[], phases: MemoryPhaseMetric[]) {
	const rows: Array<{
		label: string;
		role: string;
		durationMs: number;
		samples: number;
		startRssMiB: number;
		endRssMiB: number;
		peakRssMiB: number;
		deltaRssMiB: number;
		startPrivateMiB: number | '';
		endPrivateMiB: number | '';
		peakPrivateMiB: number | '';
		deltaPrivateMiB: number | '';
		processCountMax: number;
	}> = [];
	for (const phase of phases) {
		const phaseSamples = samples.filter((sample) => sample.label === phase.label);
		const roles = [...new Set(phaseSamples.map((sample) => sample.role))].sort();
		for (const role of roles) {
			const bucket = phaseSamples.filter((sample) => sample.role === role).sort((a, b) => a.timestampMs - b.timestampMs);
			if (!bucket.length) continue;
			const first = bucket[0];
			const last = bucket[bucket.length - 1];
			const peakRssBytes = Math.max(...bucket.map((sample) => sample.rssBytes));
			const privateValues = bucket.map((sample) => sample.privateBytes).filter((value): value is number => typeof value === 'number');
			const firstPrivate = first.privateBytes;
			const lastPrivate = last.privateBytes;
			const peakPrivate = privateValues.length ? Math.max(...privateValues) : undefined;
			rows.push({
				label: phase.label,
				role,
				durationMs: round(phase.durationMs),
				samples: bucket.length,
				startRssMiB: bytesToMiB(first.rssBytes),
				endRssMiB: bytesToMiB(last.rssBytes),
				peakRssMiB: bytesToMiB(peakRssBytes),
				deltaRssMiB: bytesToMiB(last.rssBytes - first.rssBytes),
				startPrivateMiB: firstPrivate == null ? '' : bytesToMiB(firstPrivate),
				endPrivateMiB: lastPrivate == null ? '' : bytesToMiB(lastPrivate),
				peakPrivateMiB: peakPrivate == null ? '' : bytesToMiB(peakPrivate),
				deltaPrivateMiB: firstPrivate == null || lastPrivate == null ? '' : bytesToMiB(lastPrivate - firstPrivate),
				processCountMax: Math.max(...bucket.map((sample) => sample.processCount)),
			});
		}
	}
	return rows;
}

const markdownTable = (headers: string[], rows: (string | number)[][]) => {
	const line = `| ${headers.join(' | ')} |`;
	const sep = `| ${headers.map(() => '---').join(' | ')} |`;
	const body = rows.map((row) => `| ${row.join(' | ')} |`).join('\n');
	return [line, sep, body].filter(Boolean).join('\n');
};

const safeFilePart = (value: string) =>
	value
		.trim()
		.replace(/[^a-z0-9_-]+/gi, '-')
		.replace(/^-+|-+$/g, '')
		.toLowerCase();

export function formatReportMarkdown(report: BenchmarkReport) {
	const lines: string[] = [];
	lines.push(`# ${report.name}`);
	lines.push('');
	lines.push(`Started: ${report.startedAt}`);
	lines.push(`Finished: ${report.finishedAt}`);
	lines.push('');
	lines.push('## Options');
	lines.push('');
	lines.push('```json');
	lines.push(JSON.stringify(report.options, null, 2));
	lines.push('```');

	if (report.totalDurationMs != null || report.iterationTimings?.length) {
		lines.push('');
		lines.push('## Run Timing');
		lines.push('');
		if (report.totalDurationMs != null) {
			lines.push(`Total measured time: ${round(report.totalDurationMs)} ms`);
		}
		if (report.iterationTimings?.length) {
			lines.push('');
			lines.push(
				markdownTable(
					['Label', 'Count', 'Total ms', 'p50 ms', 'p75 ms', 'p95 ms', 'p99 ms', 'Max ms'],
					summarizeIterationTimings(report.iterationTimings).map((row) => [
						row.label,
						row.count,
						row.totalMs,
						row.p50,
						row.p75,
						row.p95,
						row.p99,
						row.max,
					])
				)
			);
		}
	}

	if (report.apiCalls?.length) {
		lines.push('');
		lines.push('## API Calls');
		lines.push('');
		lines.push(
			markdownTable(
				['Label', 'Count', 'p50 ms', 'p75 ms', 'p95 ms', 'p99 ms', 'Max ms', 'Errors', 'Avg bytes'],
				summarizeApiCalls(report.apiCalls).map((row) => [
					row.label,
					row.count,
					row.p50,
					row.p75,
					row.p95,
					row.p99,
					row.max,
					row.errors,
					row.avgResponseBytes,
				])
			)
		);
	}

	if (report.interactions?.length) {
		lines.push('');
		lines.push('## UI Interactions');
		lines.push('');
		lines.push(
			markdownTable(
				['Label', 'Duration ms', 'API calls'],
				report.interactions.map((row) => [
					row.label,
					round(row.durationMs),
					row.apiCallsAfter - row.apiCallsBefore,
				])
			)
		);
	}

	if (report.queryPlans?.length) {
		lines.push('');
		lines.push('## SQL Query Plans');
		lines.push('');
		for (const query of report.queryPlans) {
			lines.push(`### ${query.label}`);
			lines.push('');
			lines.push(`Duration: ${round(query.durationMs)} ms`);
			lines.push(`Rows: ${query.rowCount}`);
			lines.push('');
			lines.push('```text');
			lines.push(...query.plan);
			lines.push('```');
			lines.push('');
		}
	}

	if (report.memorySamples?.length && report.memoryPhases?.length) {
		lines.push('');
		lines.push('## Memory Phases');
		lines.push('');
		lines.push(
			markdownTable(
				[
					'Label',
					'Role',
					'Duration ms',
					'Samples',
					'Start RSS MiB',
					'End RSS MiB',
					'Peak RSS MiB',
					'Delta RSS MiB',
					'Start Private MiB',
					'End Private MiB',
					'Peak Private MiB',
					'Delta Private MiB',
					'Max processes',
				],
				summarizeMemoryPhases(report.memorySamples, report.memoryPhases).map((row) => [
					row.label,
					row.role,
					row.durationMs,
					row.samples,
					row.startRssMiB,
					row.endRssMiB,
					row.peakRssMiB,
					row.deltaRssMiB,
					row.startPrivateMiB,
					row.endPrivateMiB,
					row.peakPrivateMiB,
					row.deltaPrivateMiB,
					row.processCountMax,
				])
			)
		);
	}

	if (report.notes?.length) {
		lines.push('');
		lines.push('## Notes');
		lines.push('');
		for (const note of report.notes) lines.push(`- ${note}`);
	}

	return `${lines.join('\n')}\n`;
}

export function writeBenchmarkReport(options: BenchmarkOptions, report: Omit<BenchmarkReport, 'finishedAt'>) {
	const finishedAt = new Date().toISOString();
	const fullReport: BenchmarkReport = { ...report, finishedAt };
	const historyDir = path.join(options.resultsDir, 'history');
	ensureDir(historyDir);
	const safeName = safeFilePart(report.name);
	const safeRunName = options.runName ? safeFilePart(options.runName) : '';
	const fileStem = safeRunName ? `${safeRunName}-${safeName}` : safeName;
	const timestamp = fullReport.startedAt.replace(/[:.]/g, '-');
	const jsonPath = path.join(historyDir, `${timestamp}-${fileStem}.json`);
	const mdPath = path.join(historyDir, `${timestamp}-${fileStem}.md`);
	fs.writeFileSync(jsonPath, `${JSON.stringify(fullReport, null, 2)}\n`);
	fs.writeFileSync(mdPath, formatReportMarkdown(fullReport));
	fs.writeFileSync(path.join(options.resultsDir, `latest-${fileStem}.json`), `${JSON.stringify(fullReport, null, 2)}\n`);
	fs.writeFileSync(path.join(options.resultsDir, `latest-${fileStem}.md`), formatReportMarkdown(fullReport));
	return { jsonPath, mdPath, report: fullReport };
}
