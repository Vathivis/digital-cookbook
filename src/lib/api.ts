export interface StructuredIngredient {
	line?: string | null;
	quantity?: number | null;
	unit?: string | null;
	name?: string | null;
}
export type IngredientInput = string | StructuredIngredient;

export type RecipeInput = {
	cookbook_id: number;
	title: string;
	description: string;
	author: string;
	servings?: number;
	ingredients: IngredientInput[];
	steps: string[];
	notes?: string;
	photoDataUrl?: string;
	tags?: string[];
};

export type Cookbook = { id: number; name: string };

export type RecipeSummary = {
	id: number;
	cookbook_id: number;
	title: string;
	description: string;
	author: string;
	photo: string | null;
	uses: number;
	servings: number;
	created_at: string;
	tags: string[];
	likes: string[];
	ingredientNames: string[];
};

export type RecipeDetail = RecipeSummary & {
	ingredients: StructuredIngredient[];
	steps: string[];
	notes: string;
};

export type AuthStatus =
	| { enabled: false; authenticated: true }
	| { enabled: true; authenticated: false }
	| { enabled: true; authenticated: true; username: string };

export type LoginInput = {
	username: string;
	password: string;
	rememberPermanently?: boolean;
};

export const AUTH_EXPIRED_EVENT = 'dc-auth-expired';

export class AuthExpiredError extends Error {
	constructor(message = 'unauthorized') {
		super(message);
		this.name = 'AuthExpiredError';
	}
}

const base = '/api';

const parseErrorMessage = async (response: Response) => {
	let message = `Request failed (${response.status})`;
	try {
		const text = await response.text();
		if (text) {
			try {
				const data = JSON.parse(text);
				if (data && typeof data.error === 'string') {
					message = data.error;
				} else {
					message = text;
				}
			} catch {
				message = text;
			}
		}
	} catch {
		// ignore body parsing failures
	}
	return message;
};

type RequestOptions = {
	suppressAuthEvent?: boolean;
};

const dispatchAuthExpired = () => {
	if (typeof window === 'undefined') return;
	window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
};

async function request(path: string, init?: RequestInit, options?: RequestOptions) {
	const response = await fetch(path, init);
	if (response.status === 401) {
		const message = await parseErrorMessage(response);
		if (!options?.suppressAuthEvent) {
			dispatchAuthExpired();
		}
		throw new AuthExpiredError(message);
	}
	if (!response.ok) {
		throw new Error(await parseErrorMessage(response));
	}
	return response;
}

async function requestJson<T>(path: string, init?: RequestInit, options?: RequestOptions) {
	const response = await request(path, init, options);
	return response.json() as Promise<T>;
}

export async function getAuthStatus() {
	return requestJson<AuthStatus>(`${base}/auth/status`, undefined, { suppressAuthEvent: true });
}

export async function login(input: LoginInput) {
	await request(
		`${base}/auth/login`,
		{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) },
		{ suppressAuthEvent: true }
	);
}

export async function logout() {
	await request(`${base}/auth/logout`, { method: 'POST' }, { suppressAuthEvent: true });
}

export async function listCookbooks(): Promise<Cookbook[]> {
	return requestJson<Cookbook[]>(`${base}/cookbooks`);
}

export async function createCookbook(name: string) {
	await request(`${base}/cookbooks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
}

export async function renameCookbook(id: number, name: string) {
    await request(`${base}/cookbooks/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
}

export async function deleteCookbook(id: number) {
    await request(`${base}/cookbooks/${id}`, { method: 'DELETE' });
}

export async function getRecipes(cookbookId: number) {
	return requestJson<RecipeSummary[]>(`${base}/recipes?cookbookId=${cookbookId}`);
}

export async function searchRecipes(cookbookId: number, q: string) {
	return requestJson<RecipeSummary[]>(`${base}/recipes/search?cookbookId=${cookbookId}&q=${encodeURIComponent(q)}`);
}

export async function createRecipe(input: RecipeInput) {
	return requestJson<{ id: number }>(`${base}/recipes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
}

export async function incrementUses(recipeId: number) {
	const response = await request(`${base}/recipes/${recipeId}/increment-uses`, { method: 'POST' });
	const data = await response.json().catch(() => ({} as { uses?: number }));
	return typeof data.uses === 'number' ? data.uses : undefined;
}

export async function decrementUses(recipeId: number) {
	const response = await request(`${base}/recipes/${recipeId}/decrement-uses`, { method: 'POST' });
	const data = await response.json().catch(() => ({} as { uses?: number }));
	return typeof data.uses === 'number' ? data.uses : undefined;
}


export async function addTagToRecipe(recipeId: number, name: string) {
	await request(`${base}/recipes/${recipeId}/tags`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
}

export async function removeTagFromRecipe(recipeId: number, name: string) {
	await request(`${base}/recipes/${recipeId}/tags/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

export async function getRecipe(id: number) {
	return requestJson<RecipeDetail>(`${base}/recipes/${id}`);
}

export async function updateRecipe(id: number, patch: Partial<RecipeInput>) {
	await request(`${base}/recipes/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
}

export async function addLike(recipeId: number, name: string) {
	await request(`${base}/recipes/${recipeId}/likes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
}

export async function removeLike(recipeId: number, name: string) {
	await request(`${base}/recipes/${recipeId}/likes/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

export async function deleteRecipe(id: number) {
	await request(`${base}/recipes/${id}`, { method: 'DELETE' });
}

export async function listTags(): Promise<string[]> {
	return requestJson<string[]>(`${base}/tags`);
}

export async function listIngredients(options?: { cookbookId?: number; q?: string; limit?: number }): Promise<string[]> {
	const params = new URLSearchParams();
	if (options?.cookbookId != null) params.set('cookbookId', String(options.cookbookId));
	if (options?.q != null) params.set('q', options.q);
	if (options?.limit != null) params.set('limit', String(options.limit));
	const suffix = params.toString();
	return requestJson<string[]>(`${base}/ingredients${suffix ? `?${suffix}` : ''}`);
}
