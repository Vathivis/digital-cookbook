export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type Cookbook = {
	id: number;
	name: string;
};

export type Recipe = {
	id: number;
	cookbook_id: number;
	title: string;
	[key: string]: unknown;
};

export type JsonObject = Record<string, unknown>;

export class CookbookApiError extends Error {
	status?: number;
	details?: unknown;

	constructor(message: string, status?: number, details?: unknown) {
		super(message);
		this.name = 'CookbookApiError';
		this.status = status;
		this.details = details;
	}
}

type CookbookApiOptions = {
	baseUrl: string;
	username?: string;
	password?: string;
	fetchFn?: FetchLike;
};

const normalizeBaseUrl = (value: string) => {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new CookbookApiError(`Invalid cookbook URL: ${value}`);
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new CookbookApiError('Cookbook URL must use http:// or https://');
	}
	return url.toString().replace(/\/$/, '');
};

const responseBody = async (response: Response): Promise<unknown> => {
	const text = await response.text();
	if (!text) return null;
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return text;
	}
};

const errorMessage = (body: unknown, status: number) => {
	if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
		return body.error;
	}
	if (typeof body === 'string' && body.trim()) return body;
	return `Request failed (${status})`;
};

export class CookbookApi {
	private readonly baseUrl: string;
	private readonly username?: string;
	private readonly password?: string;
	private readonly fetchFn: FetchLike;
	private cookie?: string;
	private authChecked = false;

	constructor(options: CookbookApiOptions) {
		this.baseUrl = normalizeBaseUrl(options.baseUrl);
		this.username = options.username;
		this.password = options.password;
		this.fetchFn = options.fetchFn ?? fetch;
	}

	private async send(path: string, init?: RequestInit) {
		const headers = new Headers(init?.headers);
		headers.set('Accept', 'application/json');
		if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
		if (this.cookie) headers.set('Cookie', this.cookie);

		try {
			return await this.fetchFn(`${this.baseUrl}${path}`, { ...init, headers });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new CookbookApiError(
				`Unable to reach ${this.baseUrl}: ${message}. Start the server with "bun run server" or set COOKBOOK_URL.`
			);
		}
	}

	private async ensureAuthenticated() {
		if (this.authChecked) return;
		this.authChecked = true;

		const statusResponse = await this.send('/api/auth/status');
		const statusBody = await responseBody(statusResponse);
		if (!statusResponse.ok) {
			throw new CookbookApiError(errorMessage(statusBody, statusResponse.status), statusResponse.status, statusBody);
		}

		const status = statusBody as { enabled?: boolean; authenticated?: boolean } | null;
		if (!status?.enabled || status.authenticated) return;
		if (!this.username || this.password === undefined) {
			throw new CookbookApiError(
				'Authentication is enabled. Set COOKBOOK_USERNAME and COOKBOOK_PASSWORD or pass --username and --password.',
				401
			);
		}

		const loginResponse = await this.send('/api/auth/login', {
			method: 'POST',
			body: JSON.stringify({ username: this.username, password: this.password })
		});
		const loginBody = await responseBody(loginResponse);
		if (!loginResponse.ok) {
			throw new CookbookApiError(errorMessage(loginBody, loginResponse.status), loginResponse.status, loginBody);
		}

		const setCookie = loginResponse.headers.get('set-cookie');
		const cookie = setCookie?.split(';', 1)[0]?.trim();
		if (!cookie) throw new CookbookApiError('Login succeeded without returning a session cookie', 500);
		this.cookie = cookie;
	}

	private async request<T>(path: string, init?: RequestInit): Promise<T> {
		await this.ensureAuthenticated();
		const response = await this.send(path, init);
		const body = await responseBody(response);
		if (!response.ok) {
			throw new CookbookApiError(errorMessage(body, response.status), response.status, body);
		}
		return body as T;
	}

	listCookbooks() {
		return this.request<Cookbook[]>('/api/cookbooks');
	}

	async getCookbook(id: number) {
		const cookbook = (await this.listCookbooks()).find((candidate) => candidate.id === id);
		if (!cookbook) throw new CookbookApiError('cookbook not found', 404);
		return cookbook;
	}

	createCookbook(name: string) {
		return this.request<Cookbook>('/api/cookbooks', {
			method: 'POST',
			body: JSON.stringify({ name })
		});
	}

	async updateCookbook(id: number, name: string) {
		await this.request('/api/cookbooks/' + id, {
			method: 'PATCH',
			body: JSON.stringify({ name })
		});
		return { id, name } satisfies Cookbook;
	}

	async deleteCookbook(id: number) {
		await this.request('/api/cookbooks/' + id, { method: 'DELETE' });
		return { id, deleted: true };
	}

	listRecipes(cookbookId: number) {
		return this.request<Recipe[]>(`/api/recipes?cookbookId=${cookbookId}`);
	}

	searchRecipes(cookbookId: number, query: string) {
		return this.request<Recipe[]>(
			`/api/recipes/search?cookbookId=${cookbookId}&q=${encodeURIComponent(query)}`
		);
	}

	getRecipe(id: number) {
		return this.request<Recipe>(`/api/recipes/${id}`);
	}

	async createRecipe(input: JsonObject) {
		const created = await this.request<{ id: number }>('/api/recipes', {
			method: 'POST',
			body: JSON.stringify(input)
		});
		return this.getRecipe(created.id);
	}

	async updateRecipe(id: number, patch: JsonObject) {
		await this.request(`/api/recipes/${id}`, {
			method: 'PATCH',
			body: JSON.stringify(patch)
		});
		return this.getRecipe(id);
	}

	async deleteRecipe(id: number) {
		await this.request(`/api/recipes/${id}`, { method: 'DELETE' });
		return { id, deleted: true };
	}
}
