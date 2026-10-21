import { createHash, X509Certificate } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { getCACertificates } from 'node:tls';

// Public-key hashes cover reissued certificates and cross-signs, not just one encoding.
// Sources: https://emudhra.we-have-a-problem.com/{roots,impacted-intermediates}.json
const distrustedKeys = new Set([
	'C619E4780ED8E0ABEDA24AD732567DE4383A7EA941338F6D1A7D1B49AC792FE9', // emSign Root TLS CA - G3
	'0A6C2B2CA5B364207954171987AC9D2178561569D8205457E77CA90C32EDE282', // emSign Root CS CA - G3
	'BD153ED7B0434F6886B17BCE8BBE84ED340C7132D702A8F4FA318F756ECBD6F3', // AAA Certificate Services
	'8D417DB2DD8BF5E3084D1E3F196D583849D81BDD4C00C70B9D39369E96B8C782', // emSign ECC Root CA - G3
	'EBED6475C2C2D80FCB199F3FE8DD6E6B3CE60B77EB15D4E42C3DEC0C6F5B5105', // EM DV TLS CA - G3B
	'43BFFA19D6EF651451F6841E019931E96F6F2EAEFF28AB4B6F1CE4576DE2717B', // EM OV TLS CA - G3B
	'E0254C7FCDC265E2F0F8A428DABB75AB4AE039B4872D62F5EE57F0877D5A8A41', // EM EV TLS CA - G3B
	'49DD353DC2B919A3770645117D0E60C16115E7D1BC259EEFE734B00EA434FE5F', // EM DV TLS CA - G3C
	'63ECEFEE431D49523BC1136C4E72D0206A477086CAF606CD5CF025686C109CF8', // EM OV TLS CA - G3C
	'5C0660A2B164910D8FF589C18E14552E9E0EC237DCEFE2CB736D41A4811F81A0', // EM EV TLS CA - G3C
	'EC4FFA1AD0AC88081314B7AAFFEF6A91F97CD57291BB5BA686C5415F5EB4F6B6', // EM OV CS CA - G3B
	'92C063D67E8F14DB71D288E11266FFDAF69CBF115F7BAB14F3BC2F68D25E0E30' // EM OV CS CA - G3C
]);

let certificates: string[] | undefined;

export function readCertificates(file: string) {
	const pem = readFileSync(file, 'utf8').match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
	if (!pem) throw new Error(`CA file contains no PEM certificates: ${file}`);
	return pem;
}

export function filterTrustedCertificates(candidates: readonly string[]) {
	const trusted = [...new Set(candidates)].filter((pem) => {
		const key = new X509Certificate(pem).publicKey.export({ type: 'spki', format: 'der' });
		return !distrustedKeys.has(createHash('sha256').update(key).digest('hex').toUpperCase());
	});
	if (trusted.length === 0) throw new Error('No trusted CA certificates are available');
	return trusted;
}

export function getTrustedCertificates() {
	if (certificates) return certificates;
	const candidates = [...getCACertificates('default')];
	// Native fetch also loads OpenSSL's file and hashed-directory sources. Keep
	// private CAs from those sources, but filter them before replacing the store.
	const file = process.env.SSL_CERT_FILE ?? '/etc/ssl/cert.pem';
	if (file && (process.env.SSL_CERT_FILE !== undefined || existsSync(file))) {
		candidates.push(...readCertificates(file));
	}
	for (const directory of (process.env.SSL_CERT_DIR ?? '/etc/ssl/certs').split(delimiter).filter(Boolean)) {
		if (process.env.SSL_CERT_DIR === undefined && !existsSync(directory)) continue;
		for (const entry of readdirSync(directory)) {
			if (/^[a-f\d]{8}\.\d+$/i.test(entry)) candidates.push(...readCertificates(join(directory, entry)));
		}
	}
	certificates = filterTrustedCertificates(candidates);
	return certificates;
}
