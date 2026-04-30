const args = Bun.argv.slice(2);

async function run(label: string, command: string[]) {
	const child = Bun.spawn(command, {
		stdout: 'inherit',
		stderr: 'inherit',
		stdin: 'inherit',
	});
	const exitCode = await child.exited;
	if (exitCode !== 0) {
		throw new Error(`${label} failed with exit code ${exitCode}`);
	}
}

await run('benchmark:seed', ['bun', 'benchmarks/seed.ts', ...args]);
await run('benchmark:api', ['bun', 'benchmarks/api.ts', ...args]);
await run('benchmark:sql', ['bun', 'benchmarks/sql.ts', ...args]);
