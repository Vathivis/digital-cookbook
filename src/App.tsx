import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { CookbookLayoutSidebar } from './components/CookbookLayout';
import { getRecipes, searchRecipes } from './lib/api';
import { RecipeCard } from './components/RecipeCard';
import { RecipeCreateCard } from './components/RecipeCreateCard';
import { Input } from './components/ui/input';
import { Switch } from './components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select';
import { Label } from './components/ui/label';
import { Sun, Moon } from 'lucide-react';
import { useFlipList } from './hooks/useFlipList';
import { useAnimatedItems } from './hooks/useAnimatedItems';
import { filterAndSortRecipes, type SortMode, type FilterMode } from './lib/filters';

interface Recipe {
	id: number;
	cookbook_id: number;
	title: string;
	description: string;
	author: string;
	photo?: string | null;
	uses: number;
	created_at: string;
	tags: string[];
	likes: string[];
	ingredientNames: string[];
}

const computePillStyle = (value: string, selected: boolean, theme: 'light' | 'dark'): CSSProperties => {
	let hash = 0;
	for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0;
	const hue = Math.abs(hash) % 360;
	const dark = theme === 'dark';
	const saturation = 70;
	const bgSelected = dark ? 38 : 78;
	const bgUnselected = dark ? 26 : 90;
	if (selected) {
		return {
			backgroundColor: `hsl(${hue},${saturation}%,${bgSelected}%)`,
			borderColor: `hsl(${hue},${saturation}%,${dark ? bgSelected + 8 : bgSelected - 12}%)`,
			color: dark ? '#fff' : '#111'
		};
	}
	return {
		backgroundColor: `hsl(${hue},${Math.round(saturation * 0.55)}%,${bgUnselected}%)`,
		borderColor: `hsl(${hue},${Math.round(saturation * 0.55)}%,${dark ? bgUnselected + 10 : bgUnselected - 14}%)`,
		color: dark ? '#e6e6e6' : '#222',
		opacity: 0.95
	};
};

function App() {
	const [activeCookbook, setActiveCookbook] = useState<number | null>(null);
	const [recipes, setRecipes] = useState<Recipe[]>([]);
	const [query, setQuery] = useState('');
	const [allRecipes, setAllRecipes] = useState<Recipe[]>([]);
	const [selectedTags, setSelectedTags] = useState<string[]>([]);
	const [tagMode, setTagMode] = useState<FilterMode>('AND');
	const [selectedIngredients, setSelectedIngredients] = useState<string[]>([]);
	const [ingredientMode, setIngredientMode] = useState<FilterMode>('AND');
	const [sortMode, setSortMode] = useState<SortMode>('AZ');
	const [theme, setTheme] = useState<'light' | 'dark'>(() => {
		if (typeof localStorage !== 'undefined') {
			const saved = localStorage.getItem('theme') as 'light' | 'dark' | null;
			if (saved === 'light' || saved === 'dark') return saved;
		}
		if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
			return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
		}
		return 'light';
	});
	const queryRef = useRef(query);
	useEffect(() => {
		queryRef.current = query;
	}, [query]);
	const reload = useCallback(
		(overrideQuery?: string) => {
			if (!activeCookbook) return Promise.resolve();
			const q = (overrideQuery ?? queryRef.current).trim();
			const run = async () => {
				const data = q ? await searchRecipes(activeCookbook, q) : await getRecipes(activeCookbook);
				setAllRecipes(data);
			};
			return run();
		},
		[activeCookbook]
	);
	const handleCookbookSelect = useCallback((id: number | null) => {
		setActiveCookbook(id);
	}, []);
	useEffect(() => { reload(); }, [reload]);
	useEffect(() => { setSelectedTags([]); setSelectedIngredients([]); }, [activeCookbook]);
	useEffect(() => {
		const h = setTimeout(() => { reload(query); }, 200);
		return () => clearTimeout(h);
	}, [query, reload]);
	const allTags = useMemo(() => {
		const set = new Set<string>();
		allRecipes.forEach(r => (r.tags||[]).forEach((t:string)=>set.add(t)));
		return Array.from(set).sort((a,b)=>a.localeCompare(b));
	}, [allRecipes]);
	const allIngredients = useMemo(() => {
		const set = new Set<string>();
		allRecipes.forEach(r => (r.ingredientNames || []).forEach((ing: string) => set.add(ing)));
		return Array.from(set).sort((a, b) => a.localeCompare(b));
	}, [allRecipes]);
	const filtered = useMemo(
		() =>
			filterAndSortRecipes(allRecipes, {
				selectedTags,
				tagMode,
				selectedIngredients,
				ingredientMode,
				sortMode
			}),
		[allRecipes, selectedTags, tagMode, selectedIngredients, ingredientMode, sortMode]
	);
	useEffect(()=>{ setRecipes(filtered); }, [filtered]);
	useEffect(() => {
		if (typeof document === 'undefined') return;
		const root = document.documentElement;
		root.classList.add('theming');
		if (theme === 'dark') root.classList.add('dark'); else root.classList.remove('dark');
		if (typeof localStorage !== 'undefined') {
			try {
				localStorage.setItem('theme', theme);
			} catch {
				// Ignore storage errors when unavailable
			}
		}
		const t = setTimeout(()=>root.classList.remove('theming'), 240);
		return () => clearTimeout(t);
	}, [theme]);
	const toggleTag = (t: string) => {
		setSelectedTags(prev => prev.includes(t) ? prev.filter(x=>x!==t) : [...prev, t]);
	};
	const toggleIngredient = (value: string) => {
		setSelectedIngredients(prev => prev.includes(value) ? prev.filter(x => x !== value) : [...prev, value]);
	};
	return (
		<div className="min-h-screen flex app-bg">
			<CookbookLayoutSidebar activeCookbookId={activeCookbook} onSelect={handleCookbookSelect} />
			<div className="flex-1 flex flex-col">
				<header className="p-4 flex items-center gap-4 border-b bg-card/90 backdrop-blur supports-[backdrop-filter]:bg-card/70">
					<h1 className="text-xl font-semibold">Recipes</h1>
					<div className="ml-auto flex items-center gap-4 text-muted-foreground">
						<Sun className={`h-4 w-4 ${theme==='light'?'text-primary':''}`} />
						<Switch checked={theme==='dark'} onCheckedChange={(c)=>setTheme(c?'dark':'light')} aria-label="Toggle dark mode" />
						<Moon className={`h-4 w-4 ${theme==='dark'?'text-primary':''}`} />
					</div>
				</header>
				<main className="flex flex-1 overflow-hidden">
					<div className="flex-1 p-6 overflow-auto">
						{activeCookbook && (
							<AnimatedRecipeGrid recipes={recipes} onChange={reload} cookbookId={activeCookbook} />
						)}
					</div>
					<aside className="w-72 border-l border-border p-4 flex flex-col gap-4 bg-sidebar/60 backdrop-blur supports-[backdrop-filter]:bg-sidebar/40 overflow-y-auto">
						<div>
							<Label className="text-xs uppercase font-semibold tracking-wide text-black dark:text-muted-foreground">Search</Label>
							<Input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search recipes..." className="mt-1" />
						</div>
						<div>
							<Label className="text-xs uppercase font-semibold tracking-wide text-black dark:text-muted-foreground">Sort</Label>
							<Select value={sortMode} onValueChange={value => setSortMode(value as SortMode)}>
								<SelectTrigger className="mt-1">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="AZ">A-Z</SelectItem>
									<SelectItem value="ZA">Z-A</SelectItem>
									<SelectItem value="MOST">Most cooked</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="flex items-center justify-between">
							<Label className="text-xs uppercase font-semibold tracking-wide text-black dark:text-muted-foreground">Tag Filter</Label>
							<div className="flex gap-1 rounded border overflow-hidden">
								{(['AND','OR'] as const).map(m => (
									<button key={m} onClick={()=>setTagMode(m)} className={`px-2 py-1 text-[11px] font-medium ${tagMode===m?'bg-accent text-accent-foreground':'text-muted-foreground hover:bg-accent/40'}`}>{m}</button>
								))}
							</div>
						</div>
						<div className="flex flex-wrap gap-1">
							{allTags.map(t => {
								const selected = selectedTags.includes(t);
								const style = computePillStyle(t, selected, theme);
								return (
									<button key={t} onClick={()=>toggleTag(t)} style={style} className={`text-[11px] px-2.5 py-0.5 rounded-full border leading-none transition-colors ${selected?'ring-1 ring-border':''}`}>{t}</button>
								);
							})}
							{!allTags.length && (
								<p className="text-xs text-muted-foreground">No tags yet</p>
							)}
						</div>
						{selectedTags.length > 0 && (
							<button onClick={()=>setSelectedTags([])} className="self-start text-xs text-muted-foreground hover:text-foreground underline">Clear tags</button>
						)}
						<div className="border-t border-border/70 my-4" />
						<div className="flex items-center justify-between">
							<Label className="text-xs uppercase font-semibold tracking-wide text-black dark:text-muted-foreground">Ingredient Filter</Label>
							<div className="flex gap-1 rounded border overflow-hidden">
								{(['AND','OR'] as const).map(m => (
									<button key={m} onClick={()=>setIngredientMode(m)} className={`px-2 py-1 text-[11px] font-medium ${ingredientMode===m?'bg-accent text-accent-foreground':'text-muted-foreground hover:bg-accent/40'}`}>{m}</button>
								))}
							</div>
						</div>
						<div className="flex flex-wrap gap-1">
							{allIngredients.map(ing => {
								const selected = selectedIngredients.includes(ing);
								const style = computePillStyle(ing, selected, theme);
								return (
									<button key={ing} onClick={()=>toggleIngredient(ing)} style={style} className={`text-[11px] px-2.5 py-0.5 rounded-full border leading-none transition-colors ${selected?'ring-1 ring-border':''}`}>{ing}</button>
								);
							})}
							{!allIngredients.length && (
								<p className="text-xs text-muted-foreground">No ingredients yet</p>
							)}
						</div>
						{selectedIngredients.length > 0 && (
							<button onClick={()=>setSelectedIngredients([])} className="self-start text-xs text-muted-foreground hover:text-foreground underline">Clear ingredients</button>
						)}
					</aside>
				</main>
			</div>
		</div>
	);
}

function AnimatedRecipeGrid({ recipes, onChange, cookbookId }: { recipes: Recipe[]; onChange: () => Promise<void> | void; cookbookId: number }) {
	const EXIT_MS = 300;
	const items = useAnimatedItems(recipes, EXIT_MS);
	const ids = items.filter(i=>!i.exiting).map(i => i.id);
	const { register } = useFlipList(ids, { duration: EXIT_MS });
	return (
		<div className="grid gap-6 grid-cols-[repeat(auto-fill,minmax(260px,1fr))] items-start">
			<div className="min-h-[23rem] surface-transition">
				<RecipeCreateCard cookbookId={cookbookId} onCreated={() => { void onChange(); }} />
			</div>
			{items.map(it => {
				const common = `min-h-[23rem] transition-all ${it.exiting ? 'opacity-0 scale-95' : 'opacity-100 scale-100'}`;
				const style: CSSProperties = { 
					transitionDuration: it.exiting ? EXIT_MS + 'ms' : '300ms',
					transitionProperty: it.exiting ? 'opacity, transform' : 'background-color, color, border-color, background, box-shadow, opacity, transform'
				};
				
				return (
					<div
						key={it.id}
						ref={it.exiting ? undefined : register(it.id)}
						className={common + ' surface-transition'}
						style={style}
					>
						<RecipeCard recipe={it.recipe} onChange={() => { void onChange(); }} />
					</div>
				);
			})}
		</div>
	);
}

export default App;
