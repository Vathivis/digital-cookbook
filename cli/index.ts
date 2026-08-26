#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { CookbookApi, CookbookApiError, type FetchLike, type JsonObject } from './api';

type OptionValue = boolean | string | string[];
type ParsedArguments = {
	positionals: string[];
	options: Record<string, OptionValue>;
};

type CliEnvironment = Record<string, string | undefined>;

export type CliRuntime = {
	env?: CliEnvironment;
	fetchFn?: FetchLike;
	stdout?: (text: string) => void;
	stderr?: (text: string) => void;
	readFile?: (path: string) => Promise<string>;
	readStdin?: () => Promise<string>;
};

const BOOLEAN_OPTIONS = new Set([
	'help',
	'compact',
	'yes',
	'clear-ingredients',
	'clear-steps',
	'clear-tags',
	'clear-notes',
	'clear-photo'
]);

const GLOBAL_OPTIONS = ['url', 'username', 'password', 'compact', 'help'];
const PAYLOAD_SOURCE_OPTIONS = ['file', 'json'];
const RECIPE_FIELD_OPTIONS = [
	'cookbook',
	'title',
	'description',
	'author',
	'servings',
	'ingredient',
	'step',
	'tag',
	'notes',
	'clear-ingredients',
	'clear-steps',
	'clear-tags',
	'clear-notes',
	'clear-photo'
];

const GENERAL_HELP = `Digital Cookbook CLI

Usage:
  bun run cookbook -- <resource> <action> [arguments] [options]

Resources and actions:
  cookbook list
  cookbook get <id>
  cookbook create --name <name>
  cookbook update <id> --name <name>
  cookbook delete <id> --yes

  recipe list --cookbook <id>
  recipe search --cookbook <id> --query <text>
  recipe get <id>
  recipe create [recipe flags | --file <path> | --file - | --json <object>]
  recipe update <id> [recipe flags | --file <path> | --file - | --json <object>]
  recipe delete <id> --yes

Global options:
  --url <url>          API base URL (default: COOKBOOK_URL or http://localhost:4000)
  --username <name>    Shared-auth username (or COOKBOOK_USERNAME / AUTH_USERNAME)
  --password <value>   Shared-auth password (or COOKBOOK_PASSWORD / AUTH_PASSWORD)
  --compact            Emit compact JSON instead of indented JSON
  --help, -h           Show help

All successful commands emit {"ok":true,"data":...} JSON on stdout.
Errors emit {"ok":false,"error":...} JSON on stderr and return a non-zero exit code.

Examples:
  bun run cookbook -- cookbook list
  bun run cookbook -- recipe list --cookbook 1
  bun run cookbook -- recipe search --cookbook 1 --query tomato
  bun run cookbook -- recipe create --cookbook 1 --title "Toast" --ingredient "2 slices bread" --step "Toast it"
  bun run cookbook -- recipe update 7 --json '{"title":"Better Toast","tags":["Quick"]}'
  bun run cookbook -- recipe create --file recipe.json
  bun run cookbook -- recipe update 7 --file -
`;

const COOKBOOK_HELP = `Cookbook commands

  cookbook list
      List every cookbook.

  cookbook get <id>
      Read one cookbook by numeric ID.

  cookbook create --name <name>
      Create a cookbook.

  cookbook update <id> --name <name>
      Rename a cookbook.

  cookbook delete <id> --yes
      Delete a cookbook and its recipes. --yes is required.
`;

const RECIPE_HELP = `Recipe commands

  recipe list --cookbook <id>
      List recipe summaries in a cookbook.

  recipe search --cookbook <id> --query <text>
      Search title, description, tags, likes, and ingredients.

  recipe get <id>
      Read a complete recipe.

  recipe create [options]
      Create a recipe and return the complete stored recipe.

  recipe update <id> [options]
      Partially update a recipe and return the complete stored recipe.

  recipe delete <id> --yes
      Delete a recipe. --yes is required.

Recipe flags:
  --cookbook <id>      Cookbook ID (required for flag-based create)
  --title <text>       Recipe title (required for flag-based create)
  --description <text>
  --author <text>
  --servings <number>
  --ingredient <line>  Repeat for ordered ingredient lines
  --step <text>        Repeat for ordered steps
  --tag <name>         Repeat for tags
  --notes <text>
  --clear-ingredients  Set ingredients to [] on update
  --clear-steps        Set steps to [] on update
  --clear-tags         Set tags to [] on update
  --clear-notes        Set notes to "" on update
  --clear-photo        Set photoDataUrl to null on update

JSON input:
  --file <path>        Read a complete recipe object or update patch from a file
  --file -             Read JSON from stdin
  --json <object>      Read an inline JSON object

JSON input supports the complete API shape, including structured ingredients,
photoDataUrl, photoThumbnailDataUrl, cookingWaterRule, ordered steps, and tags.
Do not mix --file or --json with recipe field flags.
On update, supplied --ingredient, --step, and --tag values replace the complete corresponding list.
`;

class CliUsageError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'CliUsageError';
	}
}

const appendOption = (options: Record<string, OptionValue>, name: string, value: boolean | string) => {
	const existing = options[name];
	if (existing === undefined) {
		options[name] = value;
	} else if (Array.isArray(existing)) {
		existing.push(String(value));
	} else {
		options[name] = [String(existing), String(value)];
	}
};

const parseArguments = (rawArguments: string[]): ParsedArguments => {
	const argumentsToParse = rawArguments[0] === '--' ? rawArguments.slice(1) : rawArguments;
	const positionals: string[] = [];
	const options: Record<string, OptionValue> = {};

	for (let index = 0; index < argumentsToParse.length; index += 1) {
		const token = argumentsToParse[index];
		if (token === '-h') {
			appendOption(options, 'help', true);
			continue;
		}
		if (!token.startsWith('--')) {
			positionals.push(token);
			continue;
		}

		const equalsIndex = token.indexOf('=');
		const name = token.slice(2, equalsIndex === -1 ? undefined : equalsIndex);
		if (!name) throw new CliUsageError('Invalid empty option');
		if (equalsIndex !== -1) {
			appendOption(options, name, token.slice(equalsIndex + 1));
			continue;
		}
		if (BOOLEAN_OPTIONS.has(name)) {
			appendOption(options, name, true);
			continue;
		}

		const value = argumentsToParse[index + 1];
		if (value === undefined || value.startsWith('--')) {
			throw new CliUsageError(`Option --${name} requires a value`);
		}
		appendOption(options, name, value);
		index += 1;
	}

	return { positionals, options };
};

const singleOption = (options: Record<string, OptionValue>, name: string) => {
	const value = options[name];
	if (value === undefined) return undefined;
	if (typeof value !== 'string') {
		throw new CliUsageError(`Option --${name} must be supplied exactly once with a value`);
	}
	return value;
};

const requiredOption = (options: Record<string, OptionValue>, name: string) => {
	const value = singleOption(options, name);
	if (value === undefined || value.length === 0) throw new CliUsageError(`Missing required option --${name}`);
	return value;
};

const optionValues = (options: Record<string, OptionValue>, name: string) => {
	const value = options[name];
	if (value === undefined) return undefined;
	if (value === true) throw new CliUsageError(`Option --${name} requires a value`);
	return Array.isArray(value) ? value : [value];
};

const hasBooleanOption = (options: Record<string, OptionValue>, name: string) => {
	const value = options[name];
	if (value === undefined) return false;
	if (value !== true) throw new CliUsageError(`Option --${name} does not accept a value`);
	return true;
};

const assertAllowedOptions = (options: Record<string, OptionValue>, allowed: string[]) => {
	const allowedSet = new Set([...GLOBAL_OPTIONS, ...allowed]);
	const unknown = Object.keys(options).find((name) => !allowedSet.has(name));
	if (unknown) throw new CliUsageError(`Unknown option --${unknown}`);
};

const positiveInteger = (value: string, label: string) => {
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new CliUsageError(`${label} must be a positive integer`);
	return parsed;
};

const requirePositionals = (positionals: string[], expected: number, usage: string) => {
	if (positionals.length !== expected) throw new CliUsageError(`Usage: ${usage}`);
};

const parseJsonObject = (text: string, source: string): JsonObject => {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new CliUsageError(`Invalid JSON from ${source}: ${message}`);
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new CliUsageError(`JSON from ${source} must be an object`);
	}
	return value as JsonObject;
};

const defaultReadStdin = async () => {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	return Buffer.concat(chunks).toString('utf8');
};

const readPayloadSource = async (
	options: Record<string, OptionValue>,
	readPath: (path: string) => Promise<string>,
	readStdin: () => Promise<string>
) => {
	const file = singleOption(options, 'file');
	const inline = singleOption(options, 'json');
	if (file !== undefined && inline !== undefined) throw new CliUsageError('Use only one of --file or --json');
	if (inline !== undefined) return parseJsonObject(inline, '--json');
	if (file !== undefined) {
		try {
			const text = file === '-' ? await readStdin() : await readPath(file);
			return parseJsonObject(text, file === '-' ? 'stdin' : file);
		} catch (error) {
			if (error instanceof CliUsageError) throw error;
			const message = error instanceof Error ? error.message : String(error);
			throw new CliUsageError(`Unable to read ${file}: ${message}`);
		}
	}
	return undefined;
};

const assertPayloadSourceIsExclusive = (options: Record<string, OptionValue>) => {
	if (options.file === undefined && options.json === undefined) return;
	const mixed = RECIPE_FIELD_OPTIONS.find((name) => options[name] !== undefined);
	if (mixed) throw new CliUsageError(`Do not mix --file or --json with --${mixed}`);
};

const addStringField = (payload: JsonObject, options: Record<string, OptionValue>, option: string, field = option) => {
	const value = singleOption(options, option);
	if (value !== undefined) payload[field] = value;
};

const assertNoClearConflict = (options: Record<string, OptionValue>, valueOption: string, clearOption: string) => {
	if (options[valueOption] !== undefined && options[clearOption] !== undefined) {
		throw new CliUsageError(`Do not combine --${valueOption} with --${clearOption}`);
	}
};

const recipePayloadFromFlags = (options: Record<string, OptionValue>, create: boolean): JsonObject => {
	const payload: JsonObject = {};
	const cookbook = singleOption(options, 'cookbook');
	const title = singleOption(options, 'title');
	if (create) {
		if (cookbook === undefined) throw new CliUsageError('Missing required option --cookbook');
		if (!title) throw new CliUsageError('Missing required option --title');
	}
	if (cookbook !== undefined) payload.cookbook_id = positiveInteger(cookbook, '--cookbook');
	if (title !== undefined) payload.title = title;
	addStringField(payload, options, 'description');
	addStringField(payload, options, 'author');
	addStringField(payload, options, 'notes');

	const servings = singleOption(options, 'servings');
	if (servings !== undefined) payload.servings = positiveInteger(servings, '--servings');

	assertNoClearConflict(options, 'ingredient', 'clear-ingredients');
	assertNoClearConflict(options, 'step', 'clear-steps');
	assertNoClearConflict(options, 'tag', 'clear-tags');
	assertNoClearConflict(options, 'notes', 'clear-notes');

	const ingredients = optionValues(options, 'ingredient');
	const steps = optionValues(options, 'step');
	const tags = optionValues(options, 'tag');
	if (ingredients !== undefined) payload.ingredients = ingredients;
	if (steps !== undefined) payload.steps = steps;
	if (tags !== undefined) payload.tags = tags;
	if (hasBooleanOption(options, 'clear-ingredients')) payload.ingredients = [];
	if (hasBooleanOption(options, 'clear-steps')) payload.steps = [];
	if (hasBooleanOption(options, 'clear-tags')) payload.tags = [];
	if (hasBooleanOption(options, 'clear-notes')) payload.notes = '';
	if (hasBooleanOption(options, 'clear-photo')) payload.photoDataUrl = null;

	if (!create && Object.keys(payload).length === 0) {
		throw new CliUsageError('Recipe update requires at least one field, --file, or --json');
	}
	return payload;
};

const recipePayload = async (
	options: Record<string, OptionValue>,
	create: boolean,
	readPath: (path: string) => Promise<string>,
	readStdin: () => Promise<string>
) => {
	assertPayloadSourceIsExclusive(options);
	const source = await readPayloadSource(options, readPath, readStdin);
	if (source) {
		if (!create && Object.keys(source).length === 0) throw new CliUsageError('Recipe update JSON cannot be empty');
		return source;
	}
	return recipePayloadFromFlags(options, create);
};

const helpFor = (resource?: string) => {
	if (resource === 'cookbook' || resource === 'cookbooks') return COOKBOOK_HELP;
	if (resource === 'recipe' || resource === 'recipes') return RECIPE_HELP;
	return GENERAL_HELP;
};

const normalizeResource = (resource: string | undefined) => {
	if (resource === 'cookbooks') return 'cookbook';
	if (resource === 'recipes') return 'recipe';
	return resource;
};

export async function runCli(rawArguments: string[], runtime: CliRuntime = {}) {
	const stdout = runtime.stdout ?? ((text: string) => process.stdout.write(`${text}\n`));
	const stderr = runtime.stderr ?? ((text: string) => process.stderr.write(`${text}\n`));
	const environment = runtime.env ?? process.env;
	const readPath = runtime.readFile ?? ((path: string) => readFile(path, 'utf8'));
	const readStdin = runtime.readStdin ?? defaultReadStdin;

	try {
		const parsed = parseArguments(rawArguments);
		const [rawResource, rawAction, ...remainingPositionals] = parsed.positionals;
		const resource = normalizeResource(rawResource);
		const action = rawAction?.toLowerCase();

		if (resource === 'help') {
			stdout(helpFor(normalizeResource(action)));
			return 0;
		}
		if (!resource || hasBooleanOption(parsed.options, 'help')) {
			stdout(helpFor(resource));
			return 0;
		}
		if (resource !== 'cookbook' && resource !== 'recipe') {
			throw new CliUsageError(`Unknown resource "${resource}". Use --help to list commands.`);
		}
		if (!action) {
			stdout(helpFor(resource));
			return 0;
		}

		const baseUrl = singleOption(parsed.options, 'url') ?? environment.COOKBOOK_URL ?? `http://localhost:${environment.PORT || '4000'}`;
		const username = singleOption(parsed.options, 'username') ?? environment.COOKBOOK_USERNAME ?? environment.AUTH_USERNAME;
		const password = singleOption(parsed.options, 'password') ?? environment.COOKBOOK_PASSWORD ?? environment.AUTH_PASSWORD;
		const compact = hasBooleanOption(parsed.options, 'compact');
		const api = new CookbookApi({ baseUrl, username, password, fetchFn: runtime.fetchFn });
		let data: unknown;

		if (resource === 'cookbook') {
			switch (action) {
				case 'list':
					assertAllowedOptions(parsed.options, []);
					requirePositionals(remainingPositionals, 0, 'cookbook list');
					data = await api.listCookbooks();
					break;
				case 'get': {
					assertAllowedOptions(parsed.options, []);
					requirePositionals(remainingPositionals, 1, 'cookbook get <id>');
					data = await api.getCookbook(positiveInteger(remainingPositionals[0], 'cookbook ID'));
					break;
				}
				case 'create':
					assertAllowedOptions(parsed.options, ['name']);
					requirePositionals(remainingPositionals, 0, 'cookbook create --name <name>');
					data = await api.createCookbook(requiredOption(parsed.options, 'name'));
					break;
				case 'update': {
					assertAllowedOptions(parsed.options, ['name']);
					requirePositionals(remainingPositionals, 1, 'cookbook update <id> --name <name>');
					data = await api.updateCookbook(
						positiveInteger(remainingPositionals[0], 'cookbook ID'),
						requiredOption(parsed.options, 'name')
					);
					break;
				}
				case 'delete': {
					assertAllowedOptions(parsed.options, ['yes']);
					requirePositionals(remainingPositionals, 1, 'cookbook delete <id> --yes');
					if (!hasBooleanOption(parsed.options, 'yes')) throw new CliUsageError('Cookbook delete requires --yes');
					data = await api.deleteCookbook(positiveInteger(remainingPositionals[0], 'cookbook ID'));
					break;
				}
				default:
					throw new CliUsageError(`Unknown cookbook action "${action}". Use "cookbook --help".`);
			}
		} else {
			switch (action) {
				case 'list':
					assertAllowedOptions(parsed.options, ['cookbook']);
					requirePositionals(remainingPositionals, 0, 'recipe list --cookbook <id>');
					data = await api.listRecipes(positiveInteger(requiredOption(parsed.options, 'cookbook'), '--cookbook'));
					break;
				case 'search':
					assertAllowedOptions(parsed.options, ['cookbook', 'query']);
					requirePositionals(remainingPositionals, 0, 'recipe search --cookbook <id> --query <text>');
					data = await api.searchRecipes(
						positiveInteger(requiredOption(parsed.options, 'cookbook'), '--cookbook'),
						requiredOption(parsed.options, 'query')
					);
					break;
				case 'get':
					assertAllowedOptions(parsed.options, []);
					requirePositionals(remainingPositionals, 1, 'recipe get <id>');
					data = await api.getRecipe(positiveInteger(remainingPositionals[0], 'recipe ID'));
					break;
				case 'create':
					assertAllowedOptions(parsed.options, [...PAYLOAD_SOURCE_OPTIONS, ...RECIPE_FIELD_OPTIONS]);
					requirePositionals(remainingPositionals, 0, 'recipe create [recipe flags | --file <path> | --json <object>]');
					data = await api.createRecipe(await recipePayload(parsed.options, true, readPath, readStdin));
					break;
				case 'update': {
					assertAllowedOptions(parsed.options, [...PAYLOAD_SOURCE_OPTIONS, ...RECIPE_FIELD_OPTIONS]);
					requirePositionals(remainingPositionals, 1, 'recipe update <id> [recipe flags | --file <path> | --json <object>]');
					const id = positiveInteger(remainingPositionals[0], 'recipe ID');
					data = await api.updateRecipe(id, await recipePayload(parsed.options, false, readPath, readStdin));
					break;
				}
				case 'delete':
					assertAllowedOptions(parsed.options, ['yes']);
					requirePositionals(remainingPositionals, 1, 'recipe delete <id> --yes');
					if (!hasBooleanOption(parsed.options, 'yes')) throw new CliUsageError('Recipe delete requires --yes');
					data = await api.deleteRecipe(positiveInteger(remainingPositionals[0], 'recipe ID'));
					break;
				default:
					throw new CliUsageError(`Unknown recipe action "${action}". Use "recipe --help".`);
			}
		}

		stdout(JSON.stringify({ ok: true, data }, null, compact ? 0 : 2));
		return 0;
	} catch (error) {
		if (error instanceof CliUsageError) {
			stderr(JSON.stringify({ ok: false, error: error.message, type: 'usage' }));
			return 2;
		}
		if (error instanceof CookbookApiError) {
			stderr(
				JSON.stringify({
					ok: false,
					error: error.message,
					type: 'api',
					...(error.status === undefined ? {} : { status: error.status }),
					...(error.details === undefined ? {} : { details: error.details })
				})
			);
			return 1;
		}
		const message = error instanceof Error ? error.message : String(error);
		stderr(JSON.stringify({ ok: false, error: message, type: 'internal' }));
		return 1;
	}
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === invokedPath) {
	process.exitCode = await runCli(process.argv.slice(2));
}
