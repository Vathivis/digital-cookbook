import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { filterTrustedCertificates, getTrustedCertificates } from '../cli/trusted-ca';
import { getRegistryCertificates } from './registry-ca';

const output = process.argv[2];
if (!output) throw new Error('Usage: bun scripts/export-trusted-ca.ts <output.pem>');
mkdirSync(dirname(output), { recursive: true });
const registryCertificates = getRegistryCertificates();
const certificates = registryCertificates === undefined ? getTrustedCertificates() : filterTrustedCertificates(registryCertificates);
writeFileSync(output, certificates.join('\n') + '\n', 'utf8');
