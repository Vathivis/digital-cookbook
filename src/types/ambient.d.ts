declare module 'sql.js' {
	type SqlJsValue = string | number | Uint8Array | null;
	type SqlJsParameter = SqlJsValue | boolean;

	export interface SqlJsConfig {
		locateFile?(file: string): string;
	}

	export interface QueryExecResult {
		columns: string[];
		values: SqlJsValue[][];
	}

	export interface SqlJsStatement {
		bind(params?: SqlJsParameter[]): void;
		getAsObject<T = Record<string, SqlJsValue>>(): T;
		step(): boolean;
		free(): void;
	}

	export class Database {
		constructor(data?: Uint8Array);
		exec(sql: string, params?: SqlJsParameter[]): QueryExecResult[];
		run(sql: string, params?: SqlJsParameter[]): void;
		prepare(sql: string): SqlJsStatement;
		export(): Uint8Array;
		close(): void;
	}

	export default function initSqlJs(config?: SqlJsConfig): Promise<{ Database: typeof Database }>;
}
