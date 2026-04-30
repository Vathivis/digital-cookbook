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

await run('benchmark:backend', ['bun', 'benchmarks/backend.ts', ...args]);
await run('benchmark:frontend', ['bun', 'benchmarks/frontend.ts', ...args]);
