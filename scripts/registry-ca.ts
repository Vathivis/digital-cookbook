import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { readCertificates } from '../cli/trusted-ca';

function expand(value: string) {
	const expanded = value.replace(/\$\{([^}?]+)(\?)?\}/g, (original, name: string, optional: string) =>
		process.env[name] ?? (optional ? '' : original));
	return expanded.startsWith('~/') ? join(homedir(), expanded.slice(2)) : expanded;
}

function inlineCertificates(value: string | string[]) {
	const pem = (Array.isArray(value) ? value.join('\n') : value).replace(/\\n/g, '\n');
	const certificates = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
	if (!certificates) throw new Error('Registry CA setting contains no PEM certificates');
	return certificates;
}

// Read only CA settings; registry credentials never enter the generated bundle.
export function getRegistryCertificates() {
	let certificates: string[] | undefined;
	const xdg = process.env.XDG_CONFIG_HOME;
	const userNpmrc = process.env.NPM_CONFIG_USERCONFIG
		? resolve(expand(process.env.NPM_CONFIG_USERCONFIG))
		: xdg && existsSync(join(xdg, '.npmrc')) ? join(xdg, '.npmrc') : join(homedir(), '.npmrc');
	for (const file of new Set([userNpmrc, resolve('.npmrc')])) {
		if (!existsSync(file)) continue;
		let cafile: string | undefined;
		let ca: string[] | undefined;
		for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
			const match = line.match(/^\s*(ca(?:\[\])?|cafile)\s*=\s*(.*?)\s*$/);
			if (!match) continue;
			let value = match[2];
			if (value.startsWith('"') || value.startsWith("'")) {
				value = value.slice(1, value.lastIndexOf(value[0]));
			} else value = value.replace(/(?<!\\)[;#].*$/, '').trim();
			value = expand(value.replace(/\\([;#])/g, '$1'));
			if (match[1] === 'cafile') cafile = value;
			else if (match[1] === 'ca') ca = [value];
			else (ca ??= []).push(value);
		}
		if (cafile !== undefined) certificates = readCertificates(resolve(dirname(file), cafile));
		else if (ca !== undefined) certificates = inlineCertificates(ca);
	}
	const globalBunfig = join(xdg && isAbsolute(xdg) ? xdg : homedir(), '.bunfig.toml');
	for (const file of [globalBunfig, resolve('bunfig.toml')]) {
		if (!existsSync(file)) continue;
		const config = Bun.TOML.parse(readFileSync(file, 'utf8')) as { install?: { ca?: string | string[]; cafile?: string } };
		if (config.install?.cafile !== undefined) certificates = readCertificates(resolve(dirname(file), expand(config.install.cafile)));
		else if (config.install?.ca !== undefined) certificates = inlineCertificates(config.install.ca);
	}
	return certificates;
}
