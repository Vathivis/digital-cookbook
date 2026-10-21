import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const privateCa = readFileSync(resolve('tests/fixtures/localhost.pem'), 'utf8').trim();
const affectedRoots = readFileSync(resolve('tests/fixtures/emudhra-roots.pem'), 'utf8');
const exportScript = resolve('scripts/export-trusted-ca.ts');

for (const source of ['npmrc file', 'npmrc inline', 'bunfig file', 'bunfig inline', 'affected roots only']) {
	test(`trusted install handles ${source} without restoring compromised trust`, async () => {
		mkdirSync(resolve('.tmp-tests'), { recursive: true });
		const directory = mkdtempSync(resolve('.tmp-tests/registry-ca-'));
		writeFileSync(join(directory, 'private.pem'), privateCa);
		writeFileSync(join(directory, 'affected.pem'), affectedRoots);
		if (source === 'npmrc file') {
			writeFileSync(join(directory, '.npmrc'), 'cafile="${COOKBOOK_TEST_CA_FILE}" # private registry\n');
		} else if (source === 'npmrc inline') {
			writeFileSync(join(directory, '.npmrc'), `ca[]=${JSON.stringify(affectedRoots)}\nca[]=${JSON.stringify(privateCa)}\n`);
		} else if (source === 'affected roots only') {
			writeFileSync(join(directory, '.npmrc'), 'cafile=affected.pem\n');
		} else {
			// The project bunfig must replace the lower-priority .npmrc CA setting.
			writeFileSync(join(directory, '.npmrc'), 'cafile=affected.pem\n');
			writeFileSync(join(directory, 'bunfig.toml'), source === 'bunfig file'
				? '[install]\ncafile="private.pem"\n'
				: `[install]\nca=${JSON.stringify(privateCa)}\n`);
		}
		const output = join(directory, 'filtered.pem');
		const child = Bun.spawn([process.execPath, '--cwd', directory, exportScript, output], {
			env: {
				...process.env,
				COOKBOOK_TEST_CA_FILE: 'private.pem',
				NPM_CONFIG_USERCONFIG: join(directory, 'absent.npmrc'),
				XDG_CONFIG_HOME: directory
			},
			stdout: 'pipe',
			stderr: 'pipe'
		});
		const error = await new Response(child.stderr).text();
		if (source === 'affected roots only') {
			expect(await child.exited).not.toBe(0);
			expect(error).toContain('No trusted CA certificates');
		} else {
			expect(await child.exited).toBe(0);
			expect(error).toBe('');
			expect(readFileSync(output, 'utf8').trim()).toBe(privateCa);
		}
	});
}
