import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CookbookApi } from '../../cli/api';
import { getTrustedCertificates } from '../../cli/trusted-ca';

// Opt in: these tests perform real TLS handshakes with the incident test servers.
const tlsTest = test.skipIf(process.env.COOKBOOK_TLS_INTEGRATION !== '1');
const endpoints = [
	'https://dv-g3b-emudhra.we-have-a-problem.com',
	'https://dv-g3b-aaa-emudhra.we-have-a-problem.com'
];
const certificateError = /unable to get local issuer certificate|unable to verify the first certificate/i;

// The localhost private key is a disposable test fixture, never a production credential.
test('CLI keeps private HTTPS CAs configured through SSL_CERT_FILE', async () => {
	const cert = resolve('tests/fixtures/localhost.pem');
	const server = Bun.serve({
		hostname: 'localhost',
		port: 0,
		tls: { cert: readFileSync(cert), key: readFileSync(resolve('tests/fixtures/localhost.key')) },
		fetch(request) {
			return Response.json(new URL(request.url).pathname === '/api/auth/status'
				? { enabled: false, authenticated: true }
				: [{ id: 1, name: 'Private CA cookbook' }]);
		}
	});
	const apiUrl = pathToFileURL(resolve('cli/api.ts')).href;
	const child = Bun.spawn([
		process.execPath, '--cwd', process.cwd(), '--eval',
		`import { CookbookApi } from ${JSON.stringify(apiUrl)}; console.log(JSON.stringify(await new CookbookApi({baseUrl:${JSON.stringify(server.url.origin)}}).listCookbooks()));`
	], {
		env: { ...process.env, SSL_CERT_FILE: cert, SSL_CERT_DIR: '', NODE_EXTRA_CA_CERTS: undefined },
		stdout: 'pipe',
		stderr: 'pipe'
	});
	try {
		const output = await new Response(child.stdout).text();
		expect(await child.exited).toBe(0);
		expect(JSON.parse(output)).toEqual([{ id: 1, name: 'Private CA cookbook' }]);
	} finally {
		child.kill();
		server.stop(true);
	}
}, 15000);

for (const endpoint of endpoints) {
	tlsTest(`CLI rejects compromised CA chain at ${endpoint}`, async () => {
		await expect(new CookbookApi({ baseUrl: endpoint }).listCookbooks()).rejects.toThrow(certificateError);
	}, 15000);

	tlsTest(`extra CA roots cannot restore trust at ${endpoint}`, () => {
		const apiUrl = pathToFileURL(resolve('cli/api.ts')).href;
		const script = `
			import { CookbookApi } from ${JSON.stringify(apiUrl)};
			try {
				await new CookbookApi({baseUrl:${JSON.stringify(endpoint)}}).listCookbooks();
				console.log('Unexpected successful connection');
				process.exitCode = 1;
			} catch (error) { console.log(error.message); }
		`;
		const result = spawnSync(process.execPath, ['--cwd', process.cwd(), '--eval', script], {
			env: {
				...process.env,
				NODE_TLS_REJECT_UNAUTHORIZED: '0',
				NODE_EXTRA_CA_CERTS: resolve('tests/fixtures/emudhra-roots.pem')
			},
			encoding: 'utf8',
			timeout: 15000
		});
		expect(result.error).toBeUndefined();
		expect(result.status).toBe(0);
		expect(result.stdout).toMatch(certificateError);
	}, 20000);
}

tlsTest('filtered trust still accepts a valid public HTTPS certificate', async () => {
	const response = await fetch('https://example.com/', {
		tls: { ca: getTrustedCertificates() },
		signal: AbortSignal.timeout(10000)
	});
	expect(response.status).toBe(200);
	await response.body?.cancel();
}, 15000);
