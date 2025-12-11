import { useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { incrementUses, decrementUses, getRecipe, updateRecipe, addTagToRecipe, removeTagFromRecipe, addLike, removeLike, deleteRecipe, listTags, type StructuredIngredient } from '../lib/api';
import { loadImageDataUrl } from '../lib/image';
import { useReorderDrag } from '../hooks/useReorderDrag';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from './ui/select';
import { ThumbsUp, X as XIcon, GripVertical, Minus, Plus, ImagePlus } from 'lucide-react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { TagSuggestions } from './TagSuggestions';

type BaseIngredient = StructuredIngredient & { line?: string | null };

interface RecipeSummary {
	id: number;
	cookbook_id: number;
	title: string;
	description: string;
	author: string;
	photo?: string | null;
	uses?: number;
	servings?: number;
	created_at?: string;
	tags: string[];
	likes: string[];
}

interface RecipeDetail extends RecipeSummary {
	ingredients: BaseIngredient[];
	steps: string[];
	notes: string;
}

type EditableIngredient = BaseIngredient & { _k: string };
type EditableStep = { _k: string; text: string };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const normalizeName = (value: string) => value.trim().toLowerCase();
const uniqNames = (list: string[]) => {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const name of list) {
		const key = normalizeName(name);
		if (!key || seen.has(key)) continue;
		seen.add(key);
		result.push(name.trim());
	}
	return result;
};

const normalizeIngredients = (ingredients?: unknown): BaseIngredient[] => {
	if (!Array.isArray(ingredients)) return [];
	return ingredients
		.map<BaseIngredient | null>((item) => {
			if (typeof item === 'string') return { line: item };
			if (!isRecord(item)) return null;
			const normalized: BaseIngredient = {};
			if (typeof item.line === 'string') normalized.line = item.line;
			else if (item.line === null) normalized.line = null;
			if (isFiniteNumber(item.quantity)) normalized.quantity = item.quantity;
			if (typeof item.unit === 'string') normalized.unit = item.unit;
			else if (item.unit === null) normalized.unit = null;
			if (typeof item.name === 'string') normalized.name = item.name;
			else if (item.name === null) normalized.name = null;
			if (
				normalized.line !== undefined ||
				normalized.name !== undefined ||
				normalized.unit !== undefined ||
				normalized.quantity !== undefined
			) {
				return normalized;
			}
			return null;
		})
		.filter((value): value is BaseIngredient => value !== null);
};

const normalizeRecipeDetail = (summary: RecipeSummary, data: Partial<RecipeDetail>): RecipeDetail => {
	return {
		...summary,
		...data,
		photo: data.photo ?? summary.photo ?? null,
		uses: data.uses ?? summary.uses ?? 0,
		servings: data.servings ?? summary.servings ?? 1,
		tags: data.tags ?? summary.tags ?? [],
		likes: uniqNames(data.likes ?? summary.likes ?? []),
		ingredients: normalizeIngredients(data.ingredients),
		steps: Array.isArray(data.steps) ? data.steps : [],
		notes: data.notes ?? ''
	};
};

const toEditableIngredient = (ingredient: BaseIngredient | string, keyFactory: () => string): EditableIngredient => {
	if (typeof ingredient === 'string') {
		return { line: ingredient, _k: keyFactory() };
	}
	return { ...ingredient, _k: keyFactory() };
};

const toEditableStep = (value: string, keyFactory: () => string): EditableStep => ({
	_k: keyFactory(),
	text: value
});

interface RecipeCardProps {
	recipe: RecipeSummary;
	onChange: () => void;
}

export function RecipeCard({ recipe, onChange }: RecipeCardProps) {
	const [likes, setLikes] = useState<string[]>(uniqNames(recipe.likes || []));
	const [usesCount, setUsesCount] = useState<number>(recipe.uses ?? 0);
	const [open, setOpen] = useState(false);
	const [full, setFull] = useState<RecipeDetail | null>(null);
	const [editing, setEditing] = useState(false);
	const [etitle, setETitle] = useState('');
	const [eauthor, setEAuthor] = useState('');
	const [edesc, setEDesc] = useState('');
	const [eing, setEIng] = useState<EditableIngredient[]>([]);
	const [esteps, setESteps] = useState<EditableStep[]>([]);
	const genKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2));
	const [eservings, setEServings] = useState<number>(1);
	const [viewServings, setViewServings] = useState<number>(1);
	const [enotes, setENotes] = useState('');
	const [addingTag, setAddingTag] = useState(false);
	const [tagValue, setTagValue] = useState('');
	const [allTags, setAllTags] = useState<string[]>([]);
	const [filteredTags, setFilteredTags] = useState<string[]>([]);
	const tagBoxRef = useRef<HTMLDivElement | null>(null);
	const [tagSuggestionsNode, setTagSuggestionsNode] = useState<HTMLElement | null>(null);
	const inputRef = useRef<HTMLInputElement | null>(null);
	useEffect(() => {
		setUsesCount(recipe.uses ?? 0);
	}, [recipe.uses]);
	useEffect(() => {
		setLikes(uniqNames(recipe.likes ?? []));
	}, [recipe.likes]);
	useEffect(() => {
		if (!open) {
			setAddingTag(false);
			setTagValue('');
			setFilteredTags(allTags);
			setHighlight(-1);
		}
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open]);
	useEffect(() => {
		if (!addingTag) return;
		let active = true;
		(async () => {
			try {
				const tags = await listTags();
				if (!active) return;
				setAllTags(tags);
				setFilteredTags(tags);
			} catch (error) {
				console.error('Failed to load tags', error);
			}
		})();
		return () => { active = false; };
	}, [addingTag]);
	useEffect(() => {
		if (!addingTag) return;
		const q = tagValue.trim().toLowerCase();
		if (!q) { setFilteredTags(allTags); return; }
		const scored = allTags
			.filter(t => t.toLowerCase().includes(q))
			.map(t => {
				const lt = t.toLowerCase();
				let score = 0;
				if (lt === q) score += 100;
				if (lt.startsWith(q)) score += 50;
				const idx = lt.indexOf(q);
				score += Math.max(0, 30 - idx);
				score -= Math.max(0, lt.length - q.length);
				return { t, score };
			})
			.sort((a,b) => b.score - a.score)
			.map(x => x.t)
			.slice(0, 50);
		setFilteredTags(scored);
	}, [tagValue, addingTag, allTags]);
	const [highlight, setHighlight] = useState<number>(-1);
	useEffect(() => { setHighlight(-1); }, [filteredTags]);
	const onKeyDownTag = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(filteredTags.length - 1, h + 1)); }
		else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(-1, h - 1)); }
		else if (e.key === 'Enter') {
			e.preventDefault();
			if (highlight >= 0 && filteredTags[highlight]) {
				submitTag(filteredTags[highlight]);
			} else {
				submitTag();
			}
		}
	};
	useEffect(() => {
		if (highlight < 0 || !tagSuggestionsNode) return;
		const container = tagSuggestionsNode;
		const el = container.querySelector(`[data-idx="${highlight}"]`) as HTMLElement | null;
		if (!el) return;
		const top = el.offsetTop;
		const bottom = top + el.offsetHeight;
		if (top < container.scrollTop) container.scrollTop = top;
		else if (bottom > container.scrollTop + container.clientHeight) container.scrollTop = bottom - container.clientHeight;
	}, [highlight, tagSuggestionsNode]);
	useEffect(() => {
		if (!addingTag) return;
		const handlePointerDown = (event: PointerEvent) => {
			const node = event.target as Node;
			if (tagBoxRef.current?.contains(node)) return;
			if (tagSuggestionsNode?.contains(node as HTMLElement)) return;
			setAddingTag(false);
		};
		document.addEventListener('pointerdown', handlePointerDown);
		return () => document.removeEventListener('pointerdown', handlePointerDown);
	}, [addingTag, tagSuggestionsNode]);
	const [photo, setPhoto] = useState<string | undefined>();
	const [photoDrag, setPhotoDrag] = useState(false);
	const photoInputRef = useRef<HTMLInputElement | null>(null);
	const [quickLikeActive, setQuickLikeActive] = useState(false);
	const [quickLikeValue, setQuickLikeValue] = useState('');
	const [addingLike, setAddingLike] = useState(false);
	const [likeValue, setLikeValue] = useState('');
	const likeInputRef = useRef<HTMLInputElement | null>(null);
	const quickLikeInputRef = useRef<HTMLInputElement | null>(null);
	useEffect(() => {
		if (quickLikeActive) {
			quickLikeInputRef.current?.focus();
		} else {
			setQuickLikeValue('');
		}
	}, [quickLikeActive]);
	const ingredientListRef = useRef<HTMLDivElement | null>(null);
	const stepListRef = useRef<HTMLDivElement | null>(null);
	const imageTaskRef = useRef(0);
	const ingredientDrag = useReorderDrag({
		containerRef: ingredientListRef,
		addControlSelector: '[data-add-control="ing"]',
		onReorder: (from, to) => setEIng((prev) => reorderArray(prev, from, to))
	});
	const stepDrag = useReorderDrag({
		containerRef: stepListRef,
		addControlSelector: '[data-add-control="step"]',
		onReorder: (from, to) => setESteps((prev) => reorderArray(prev, from, to))
	});
	const applyDetail = useCallback((detail: RecipeDetail) => {
		setFull(detail);
		setLikes(uniqNames(detail.likes || []));
		setUsesCount(detail.uses ?? 0);
		return detail;
	}, []);
	const fetchAndApplyDetail = useCallback(async (fallback: RecipeSummary, id: number) => {
		const data = await getRecipe(id);
		const detail = normalizeRecipeDetail(fallback, data as Partial<RecipeDetail>);
		return applyDetail(detail);
	}, [applyDetail]);

	const updateUses = (value: number) => {
		setUsesCount(value);
		setFull(prev => (prev ? { ...prev, uses: value } : prev));
	};
	const incrementCookCount = async () => {
		try {
			const result = await incrementUses(recipe.id);
			const next = typeof result === 'number' ? result : usesCount + 1;
			updateUses(next);
			onChange();
		} catch (error) {
			console.error('Failed to increment cook count', error);
		}
	};
	const decrementCookCount = async () => {
		if (usesCount <= 0) return;
		try {
			const result = await decrementUses(recipe.id);
			const next = typeof result === 'number' ? result : Math.max(usesCount - 1, 0);
			updateUses(next);
			onChange();
		} catch (error) {
			console.error('Failed to decrement cook count', error);
		}
	};
	const openDialog = async () => {
		setOpen(true);
		try {
			const detail = await fetchAndApplyDetail(recipe, recipe.id);
			setEditing(false);
			setPhoto(undefined);
			setViewServings(detail.servings ?? 1);
		} catch (error) {
			console.error('Failed to load recipe details', error);
			setFull(null);
		}
	};
	const startEdit = () => {
		if (!full) return;
		setETitle(full.title || '');
		setEAuthor(full.author || '');
		setEDesc(full.description || '');
		setEIng((full.ingredients || []).map((ingredient) => toEditableIngredient(ingredient, genKey)));
		setESteps((full.steps || []).map((s) => toEditableStep(s, genKey)));
		setENotes(full.notes || '');
		setEServings(full.servings || 1);
		setViewServings(full.servings || 1);
		setLikes(full.likes || likes);
		setEditing(true);
	};
	const saveEdit = async () => {
		if (!full) return;
		await updateRecipe(full.id, {
			title: etitle.trim(),
			author: eauthor.trim(),
			description: edesc,
			servings: eservings,
				ingredients: eing.map(({ _k, ...rest }) => {
					void _k;
					return rest;
				}),
				steps: esteps.map(s => s.text),
			notes: enotes,
			photoDataUrl: photo,
		});
		await fetchAndApplyDetail(full, full.id);
		setEditing(false);
		onChange();
	};
	const pushLike = useCallback((name: string) => {
		let changed = false;
		let snapshot: string[] | null = null;
		setLikes((prev) => {
			if (prev.some((existing) => normalizeName(existing) === normalizeName(name))) {
				snapshot = prev;
				return prev;
			}
			changed = true;
			snapshot = [...prev, name];
			return snapshot;
		});
		if (changed && snapshot) {
			setFull((detail) => (detail ? { ...detail, likes: snapshot as string[] } : detail));
		}
	}, []);
	const pullLike = useCallback((name: string) => {
		let changed = false;
		let snapshot: string[] | null = null;
		setLikes((prev) => {
			if (!prev.some((existing) => normalizeName(existing) === normalizeName(name))) {
				snapshot = prev;
				return prev;
			}
			changed = true;
			snapshot = prev.filter((entry) => normalizeName(entry) !== normalizeName(name));
			return snapshot;
		});
		if (changed && snapshot) {
			setFull((detail) => (detail ? { ...detail, likes: snapshot as string[] } : detail));
		}
	}, []);
	const persistLike = useCallback(
		async (name: string, targetId?: number) => {
			const normalized = name.trim();
			if (!normalized) return;
			const target = targetId ?? (full?.id ?? recipe.id);
			pushLike(normalized);
			try {
				await addLike(target, normalized);
				onChange();
			} catch (error) {
				console.error('Failed to add like', error);
				pullLike(normalized);
				if (full) {
					try {
						await fetchAndApplyDetail(full, full.id);
					} catch (detailError) {
						console.error('Failed to refresh recipe detail', detailError);
					}
				}
			}
		},
		[fetchAndApplyDetail, full, onChange, pullLike, pushLike, recipe.id]
	);
	const addLikeInline = async () => {
		if (!full || !likeValue.trim()) return;
		const name = likeValue.trim();
		setLikeValue('');
		setAddingLike(false);
		await persistLike(name, full.id);
	};
	const removeLikeInline = async (name: string) => {
		if (!full) return;
		pullLike(name);
		try {
			await removeLike(full.id, name);
			onChange();
		} catch (error) {
			console.error('Failed to remove like', error);
			pushLike(name);
		}
	};
	const handleQuickLikeSubmit = async () => {
		const name = quickLikeValue.trim();
		if (!name) return;
		setQuickLikeActive(false);
		setQuickLikeValue('');
		await persistLike(name, recipe.id);
	};
	const cancelQuickLike = () => {
		setQuickLikeActive(false);
		setQuickLikeValue('');
	};
	const onPickImage = (file?: File) => {
		if (!file) return;
		const taskId = ++imageTaskRef.current;
		loadImageDataUrl(file)
			.then((dataUrl) => {
				if (imageTaskRef.current === taskId) {
					setPhoto(dataUrl);
				}
			})
			.catch((error) => console.error('Failed to process image', error));
	};

	useEffect(() => {
		if (!open || !editing) return;
		const handlePaste = (event: ClipboardEvent) => {
			const { files, items } = event.clipboardData || {};
			const file = files?.[0];
			if (file && file.type.startsWith('image/')) {
				event.preventDefault();
				onPickImage(file);
				return;
			}
			if (items?.length) {
				for (let i = 0; i < items.length; i++) {
					const item = items[i];
					if (item && item.type.startsWith('image/')) {
						const f = item.getAsFile();
						if (f) {
							event.preventDefault();
							onPickImage(f);
							return;
						}
					}
				}
			}
		};
		window.addEventListener('paste', handlePaste);
		return () => window.removeEventListener('paste', handlePaste);
	}, [open, editing, onPickImage]);
	const submitTag = async (nameOverride?: string) => {
		if (!full) return;
		const raw = (nameOverride ?? tagValue).trim();
		if (!raw) return;
		try {
			await addTagToRecipe(full.id, raw);
			setFull((detail) => {
				if (!detail) return detail;
				if (detail.tags.includes(raw)) return detail;
				return { ...detail, tags: [...detail.tags, raw] };
			});
			setTagValue('');
			setAddingTag(false);
			onChange();
		} catch (error) {
			console.error('Failed to add tag', error);
		}
	};
	const onRemoveTag = async (t: string) => {
		if (!full) return;
		const previousTags = [...full.tags];
		setFull((detail) => (detail ? { ...detail, tags: detail.tags.filter((tag) => tag !== t) } : detail));
		try {
			await removeTagFromRecipe(full.id, t);
			onChange();
		} catch (error) {
			console.error('Failed to remove tag', error);
			setFull((detail) => (detail ? { ...detail, tags: previousTags } : detail));
		}
	};
	const [darkMode, setDarkMode] = useState<boolean>(() => (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')));
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const [scrollFade, setScrollFade] = useState<{ top: boolean; bottom: boolean }>({ top: false, bottom: false });
	const updateScrollFade = useCallback(() => {
		const el = scrollRef.current;
		if (!el) return;
		const maxScroll = el.scrollHeight - el.clientHeight;
		const hasOverflow = maxScroll > 1;
		const threshold = 2;
		const atTop = el.scrollTop <= threshold;
		const atBottom = maxScroll - el.scrollTop <= threshold;
		setScrollFade({ top: hasOverflow && !atTop, bottom: hasOverflow && !atBottom });
	}, []);
	useEffect(() => {
		if (!open) { setScrollFade({ top: false, bottom: false }); return; }
		const el = scrollRef.current;
		if (!el) return;
		const handler = () => updateScrollFade();
		handler();
		el.addEventListener('scroll', handler);
		window.addEventListener('resize', handler);
		return () => {
			el.removeEventListener('scroll', handler);
			window.removeEventListener('resize', handler);
		};
	}, [open, updateScrollFade]);
	useEffect(() => {
		if (!open) return;
		updateScrollFade();
	}, [open, editing, eing.length, esteps.length, enotes, likes.length, full?.tags?.length, updateScrollFade]);
	useEffect(() => {
		if (typeof document === 'undefined') return;
		const el = document.documentElement;
		const observer = new MutationObserver(() => {
			setDarkMode(el.classList.contains('dark'));
		});
		observer.observe(el, { attributes: true, attributeFilter: ['class'] });
		return () => observer.disconnect();
	}, []);
	const tagStyles = useCallback((t: string) => {
		let hash = 0;
		for (let i = 0; i < t.length; i++) hash = (hash * 31 + t.charCodeAt(i)) | 0;
		const hue = Math.abs(hash) % 360;
		const dark = darkMode;
		const sat = 70;
		const bgLightness = dark ? 38 : 78;
		const borderLightness = dark ? bgLightness + 6 : bgLightness - 12;
		const textColor = dark ? '#fff' : '#111';
		return {
			backgroundColor: `hsl(${hue},${sat}%,${bgLightness}%)`,
			borderColor: `hsl(${hue},${sat}%,${borderLightness}%)`,
			color: textColor,
		} as React.CSSProperties;
	}, [darkMode]);
	const likeStyles = useCallback((n: string) => tagStyles(n), [tagStyles]);
	const tagContainerRef = useRef<HTMLDivElement | null>(null);
	const [tagClamp, setTagClamp] = useState<{ visible: string[]; hidden: number }>({ visible: recipe.tags || [], hidden: 0 });
	useLayoutEffect(() => {
		const tags: string[] = recipe.tags || [];
		if (!tags.length) { setTagClamp({ visible: [], hidden: 0 }); return; }
		const el = tagContainerRef.current;
		if (!el) return;
		const meas = document.createElement('div');
		meas.style.position = 'absolute';
		meas.style.visibility = 'hidden';
		meas.style.pointerEvents = 'none';
		meas.style.top = '0';
		meas.style.left = '0';
		meas.style.width = el.clientWidth + 'px';
		meas.style.fontSize = getComputedStyle(el).fontSize;
		meas.className = el.className;
		document.body.appendChild(meas);
		tags.forEach(t => {
			const span = document.createElement('span');
			span.textContent = t;
			span.className = 'text-[11px] px-2.5 py-0.5 rounded-full border leading-none inline-block mr-1 mb-1';
			meas.appendChild(span);
		});
		const maxLines = 2;
		const children = Array.from(meas.children) as HTMLElement[];
		if (!children.length) { document.body.removeChild(meas); return; }
		const lineTops: number[] = [];
		let allowedLastIndex = children.length - 1;
		for (let i = 0; i < children.length; i++) {
			const top = children[i].offsetTop;
			if (!lineTops.includes(top)) lineTops.push(top);
			if (lineTops.length > maxLines) { allowedLastIndex = i - 1; break; }
		}
		let hidden = 0;
		if (lineTops.length > maxLines) hidden = tags.length - (allowedLastIndex + 1);
		if (hidden > 0) {
			const plus = document.createElement('span');
			plus.textContent = '+' + hidden;
			plus.className = 'text-[11px] px-2.5 py-0.5 rounded-full border leading-none inline-block mr-1 mb-1';
			meas.appendChild(plus);
			const lastTop = children[allowedLastIndex]?.offsetTop || 0;
			const availableWidth = meas.clientWidth;
			const lastLineChildren = children.filter(c => c.offsetTop === lastTop && c.offsetLeft < availableWidth);
			const plusWidth = plus.offsetWidth + 4;
			let lineWidth = lastLineChildren.reduce((acc, c) => acc + c.offsetWidth + 4, 0);
			while (allowedLastIndex >=0 && (lineWidth + plusWidth) > availableWidth) {
				const child = children[allowedLastIndex];
				if (!child) break;
				if (child.offsetTop !== lastTop) break;
				lineWidth -= child.offsetWidth + 4;
				allowedLastIndex--;
				hidden++;
			}
		}
		setTagClamp({ visible: tags.slice(0, allowedLastIndex + 1), hidden });
		document.body.removeChild(meas);
	}, [recipe.tags]);

	return (
		<>
		<div onClick={openDialog} role="button" tabIndex={0} className="min-h-[23rem] text-left relative group rounded-lg border border-border bg-card shadow-sm flex flex-col overflow-hidden hover:shadow-md transition-shadow cursor-pointer focus:outline-hidden focus:ring-2 focus:ring-ring">
		<div className="relative h-40 w-full flex-shrink-0 overflow-hidden">
			{recipe.photo ? (
				<img src={recipe.photo} alt={recipe.title} className="h-full w-full object-cover" />
			) : (
				<div className="h-full w-full bg-muted flex items-center justify-center text-[11px] uppercase tracking-wide text-muted-foreground">No photo</div>
			)}
			{likes.length > 0 && (
				<div className="absolute top-1.5 right-1.5 z-10 flex flex-wrap gap-1 max-w-[65%] justify-end pointer-events-none">
					{likes.map(name => (
						<span key={name} style={likeStyles(name)} className="pointer-events-auto text-[10px] px-2 py-0.5 rounded-full border leading-none shadow-sm">
							{name}
						</span>
					))}
				</div>
			)}
			<Button
				variant="secondary"
				type="button"
				size="sm"
				className="absolute bottom-1.5 right-1.5 z-10 h-8 rounded-full px-3 text-xs font-mono bg-background/90 backdrop-blur-sm border border-border/70 shadow-md flex items-center gap-1"
				onClick={(e)=>{e.stopPropagation(); incrementCookCount();}}
				title="Increment uses"
			>
				<Plus className="h-3 w-3" />
				<span>{usesCount}</span>
			</Button>
		</div>
			<div className="p-3 flex flex-col gap-2 flex-1 min-h-0">
			<div className="flex flex-col gap-1">
				<h3 className="font-semibold text-base leading-snug line-clamp-2 break-all pr-2">{recipe.title}</h3>
				<p className="text-xs text-muted-foreground line-clamp-3 break-all">{recipe.description}</p>
			</div>
				<div ref={tagContainerRef} className="flex flex-wrap gap-1 mt-auto pt-1 overflow-hidden">
					{tagClamp.visible.map((t: string) => (
						<span key={t} style={tagStyles(t)} className="text-[11px] px-2.5 py-0.5 rounded-full border leading-none">
							{t}
						</span>
					))}
					{tagClamp.hidden > 0 && (
						<span className="text-[11px] px-2.5 py-0.5 rounded-full border leading-none bg-muted/40" style={{}}>
							+{tagClamp.hidden}
						</span>
					)}
				</div>
				<div className="flex flex-wrap gap-1">
					{quickLikeActive ? (
						<form
							onSubmit={(e) => {
								e.preventDefault();
								handleQuickLikeSubmit();
							}}
							onClick={(e) => e.stopPropagation()}
							className="flex flex-1 items-center gap-1"
						>
							<Input
								ref={quickLikeInputRef}
								value={quickLikeValue}
								onChange={(e) => setQuickLikeValue(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === 'Escape') {
										e.preventDefault();
										cancelQuickLike();
									}
								}}
								placeholder="Name who likes this"
								className="h-7 flex-1 min-w-0 text-[11px] px-2"
							/>
							<Button type="submit" size="sm" className="h-7 px-2 text-[11px]" disabled={!quickLikeValue.trim()}>
								Add
							</Button>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								className="h-7 px-2 text-[11px]"
								onClick={(e) => {
									e.stopPropagation();
									cancelQuickLike();
								}}
							>
								Cancel
							</Button>
						</form>
					) : (
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								setQuickLikeActive(true);
							}}
							className="text-[10px] flex items-center gap-1 text-muted-foreground hover:text-foreground"
						>
							<ThumbsUp className="h-3 w-3" /> like
						</button>
					)}
				</div>
			</div>
		</div>

			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="sm:max-w-3xl p-4 sm:p-5">
					<DialogHeader>
						<DialogTitle>{editing ? 'Edit Recipe' : (full?.title ?? recipe.title)}</DialogTitle>
					</DialogHeader>
					<div
						ref={scrollRef}
						className={`max-h-[70vh] overflow-auto thin-scrollbar fade-scroll pr-2 ${scrollFade.top ? 'fade-top' : ''} ${scrollFade.bottom ? 'fade-bottom' : ''}`}
					>
					{!editing && (
										<div className="relative">
											{full?.photo ? (
												<img src={full.photo} alt={full.title} className="w-full max-h-80 object-cover rounded" />
											) : (
												<div className="w-full max-h-80 rounded bg-muted flex items-center justify-center text-[11px] uppercase tracking-wide text-muted-foreground">No photo</div>
											)}
											{likes.length > 0 && (
												<div className="absolute top-2 right-2 z-10 flex flex-wrap gap-1.5 max-w-[70%] justify-end pointer-events-none">
													{likes.map(name => (
														<span key={name} style={likeStyles(name)} className="text-[12px] px-3 py-1.5 rounded-full border leading-none shadow-sm">
															{name}
														</span>
													))}
												</div>
											)}
											<div className="absolute bottom-3 right-3 z-10 flex items-center gap-1.5 rounded-full bg-background/90 backdrop-blur-sm border border-border/70 shadow-md px-3 py-1">
												<span className="text-[11px] uppercase tracking-wide text-muted-foreground">Cook count</span>
												<Button variant="ghost" type="button" size="icon" className="h-7 w-7 rounded-full border border-border/60 bg-background/70 hover:bg-background" onClick={decrementCookCount} disabled={usesCount <= 0} aria-label="Decrease cook count">
													<Minus className="h-4 w-4" />
												</Button>
												<span className="min-w-[2.5rem] text-center font-mono text-sm text-foreground">{usesCount}</span>
												<Button variant="ghost" type="button" size="icon" className="h-7 w-7 rounded-full border border-border/60 bg-background/70 hover:bg-background" onClick={incrementCookCount} aria-label="Increase cook count">
													<Plus className="h-4 w-4" />
												</Button>
											</div>
										</div>
									)}
						
					{!editing && <div className="mt-3 text-sm text-muted-foreground">{full?.description ?? recipe.description}</div>}
						
					{full && !editing && (
												<div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-6">
													<div>
														<div className="flex items-center justify-between mb-2">
															<h4 className="font-semibold">Ingredients</h4>
															<div className="flex items-center gap-1 text-xs">
																<span className="text-muted-foreground">Servings</span>
																<Select value={String(viewServings)} onValueChange={(v)=>setViewServings(Number(v))}>
																	<SelectTrigger size="sm" className="h-8 w-20">
																		<SelectValue />
																	</SelectTrigger>
																	<SelectContent>
																		{Array.from({ length: 10 }, (_,i)=>i+1).map(n=> <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
																	</SelectContent>
																</Select>
															</div>
														</div>
														<ul className="list-disc pl-5 space-y-1 text-sm">
															{full.ingredients?.map((ing, i) => {
																const baseServings = full.servings && full.servings > 0 ? full.servings : 1;
																const factor = viewServings / baseServings;
																const qty = typeof ing.quantity === 'number' ? Math.round(ing.quantity * factor * 100) / 100 : null;
																const parts = [qty, ing.unit, ing.name]
																	.filter((part): part is string | number => part !== null && part !== undefined && part !== '')
																	.join(' ');
																const fallback = ing.line ?? '';
																return <li key={`${ing.line ?? ing.name ?? i}`}>{parts || fallback}</li>;
															})}
														</ul>
													</div>
													<div>
														<h4 className="font-semibold mb-2">Steps</h4>
														<ol className="list-decimal pl-5 space-y-1 text-sm">
															{full.steps?.map((st: string, i: number) => (<li key={i}>{st}</li>))}
														</ol>
													</div>
													{full.notes && (
														<div className="md:col-span-2">
															<h4 className="font-semibold mb-2">Notes</h4>
															<div className="text-sm whitespace-pre-wrap">{full.notes}</div>
														</div>
													)}
												</div>
											)}
						
					{!editing && (
												<div className="mt-4 flex flex-wrap gap-2 items-center">
													{(full?.tags ?? recipe.tags ?? []).map((t: string) => (
														<span key={t} style={tagStyles(t)} className="text-[11px] px-3 py-1 rounded-full border flex items-center gap-1.5 leading-none">
															<span>{t}</span>
															<button aria-label={`Remove tag ${t}`} onClick={() => onRemoveTag(t)} className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
																<XIcon className="h-3.5 w-3.5" />
															</button>
														</span>
													))}
													{addingTag ? (
														<div ref={tagBoxRef} className="relative">
															<form onSubmit={(e)=>{e.preventDefault(); submitTag();}} className="text-xs flex items-center gap-1.5 border border-dashed border-slate-400 rounded-full px-2 py-1 bg-background">
								<Input
									ref={inputRef}
									autoFocus
									value={tagValue}
									onChange={e=>setTagValue(e.target.value)}
									onKeyDown={(e)=>{ if (e.key === 'Escape') { setTagValue(''); setAddingTag(false); } else { onKeyDownTag(e); } }}
									placeholder="Add tag"
									className="h-7 text-xs px-2 w-40"
								/>
																<Button type="submit" className="h-7 px-3 text-xs" disabled={!tagValue.trim()}>Add</Button>
															</form>
															{inputRef.current && createPortal(
																<TagSuggestions
																	anchor={inputRef.current}
																	items={filteredTags}
																	highlight={highlight}
																	onHighlight={setHighlight}
																	existing={(full?.tags)||[]}
																	onPick={(t)=> submitTag(t)}
																	query={tagValue.trim()}
																	allTags={allTags}
																	onContainerChange={setTagSuggestionsNode}
																/>, document.body
															)}
														</div>
													) : (
														<button onClick={()=>setAddingTag(true)} className="text-xs border border-dashed border-slate-400 rounded-full px-2.5 py-1 text-muted-foreground hover:bg-accent/40">+ tag</button>
													)}
												</div>
											)}
						
									{editing && (
												<div className="space-y-4">
													<div className="flex gap-4 items-start flex-wrap">
														<div className="flex flex-col gap-2">
															<input
																ref={photoInputRef}
																type="file"
																accept="image/*"
																className="hidden"
																onChange={e=>{
																	onPickImage(e.target.files?.[0] || undefined);
																	e.target.value = '';
																}}
															/>
															<button
																type="button"
																aria-label={photo ? 'Change recipe photo' : 'Add a recipe photo'}
																onClick={()=>photoInputRef.current?.click()}
																className={`w-40 h-40 bg-slate-100 dark:bg-slate-700 flex items-center justify-center overflow-hidden border rounded relative transition ring-offset-2 ring-offset-background focus-visible:ring-2 focus-visible:ring-primary/60 focus:outline-none cursor-pointer ${photoDrag?'ring-2 ring-primary/60':''}`}
																onDragOver={e=>{e.preventDefault(); setPhotoDrag(true);}}
																onDragEnter={e=>{e.preventDefault(); setPhotoDrag(true);}}
																onDragLeave={()=>setPhotoDrag(false)}
																onDrop={e=>{
																	e.preventDefault();
																	setPhotoDrag(false);
																	const file = e.dataTransfer.files?.[0];
																	if (file) onPickImage(file);
																}}
															>
																{(photo || full?.photo) ? (
																	<>
																		<img src={photo || full?.photo || ''} alt="Recipe photo preview" className="object-cover w-full h-full" />
																		<div className="pointer-events-none absolute top-2 right-2 rounded-full bg-black/50 p-1 text-white">
																			<ImagePlus className="h-4 w-4" />
																		</div>
																	</>
															) : (
																<div className="flex flex-col items-center gap-2 px-4 text-center text-xs text-muted-foreground">
																	<ImagePlus className="h-6 w-6" />
																	<span>Click, paste (Ctrl+V), or drop an image</span>
																</div>
															)}
														</button>
													</div>
													<div className="flex-1 min-w-[16rem] flex flex-col gap-2">
														<Input value={etitle} onChange={e=>setETitle(e.target.value)} placeholder="Title" className="font-semibold" />
														<Input value={eauthor} onChange={e=>setEAuthor(e.target.value)} placeholder="Author" />
														<Textarea value={edesc} onChange={e=>setEDesc(e.target.value)} placeholder="Short description" className="h-20 md:h-24" />
														</div>
													</div>
													<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
														<div>
															<div className="flex items-center justify-between mb-2">
																<h4 className="font-semibold">Ingredients</h4>
																<div className="flex items-center gap-1 text-xs">
																	<span className="text-muted-foreground">Servings</span>
																	<Select value={String(eservings)} onValueChange={(v)=>setEServings(Number(v))}>
																		<SelectTrigger size="sm" className="h-8 w-20">
																			<SelectValue />
																		</SelectTrigger>
																		<SelectContent>
																			{Array.from({ length: 10 }, (_,i)=>i+1).map(n=> <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
																		</SelectContent>
																	</Select>
																</div>
															</div>
															<div ref={ingredientListRef} className="space-y-2">
																{eing.map((ing, idx) => (
																	<div key={ing._k} data-drag-item className="flex gap-2 items-center bg-background/40 rounded p-1 pr-2">
																		<button type="button" aria-label="Drag ingredient" onPointerDown={(ev)=>ingredientDrag(ev,idx)} className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-1">
																			<GripVertical className="h-4 w-4" />
																		</button>
																		<Input aria-label="Quantity" placeholder="#" type="text" inputMode="decimal" value={ing.quantity ?? ''} onChange={e=>{
																			const raw = e.target.value.replace(/,/g,'.');
																			const trimmed = raw.trim();
																			const parsed = trimmed === '' ? undefined : Number(trimmed);
																			const quantityValue = parsed === undefined || Number.isNaN(parsed) ? undefined : parsed;
																			setEIng(prev => prev.map((p,i)=> i===idx ? { ...p, quantity: quantityValue } : p));
																		}} className="w-16" />
																		<Select value={ing.unit || 'none'} onValueChange={(v)=>setEIng(prev=>prev.map((p,i)=> i===idx ? { ...p, unit: v==='none'? undefined : v } : p))}>
																			<SelectTrigger size="sm" className="h-8 w-20">
																				<SelectValue placeholder="-" />
																			</SelectTrigger>
																			<SelectContent>
																				<SelectItem value="none">-</SelectItem>
																				{['g','kg','ml','l','u','tbsp','tsp','cup','pcs'].map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
																			</SelectContent>
																		</Select>
																		<Input aria-label="Ingredient" placeholder="Ingredient" value={ing.name || ing.line || ''} onChange={e=>setEIng(prev=>prev.map((p,i)=> i===idx ? { ...p, name: e.target.value, line: `${p.quantity ?? ''} ${p.unit ?? ''} ${e.target.value}`.trim() } : p))} className="flex-1" />
																		<button type="button" onClick={()=>setEIng(prev => prev.filter((_,i)=>i!==idx))} className="text-xs text-muted-foreground hover:text-destructive px-1">✕</button>
																	</div>
																))}
																<button data-add-control="ing" type="button" onClick={()=>setEIng(prev=>[...prev, { quantity: undefined, unit: undefined, name: '', line: '', _k: genKey() }])} className="text-xs text-primary hover:underline">+ Add ingredient</button>
															</div>
														</div>
														<div>
															<h4 className="font-semibold mb-2">Steps</h4>
															<div ref={stepListRef} className="space-y-2">
																{esteps.map((st, idx) => (
																	<div key={st._k} data-drag-item className="flex gap-2 items-start bg-background/40 rounded p-1 pr-2">
																		<button type="button" aria-label="Drag step" onPointerDown={(ev)=>stepDrag(ev,idx)} className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-1 mt-1">
																			<GripVertical className="h-4 w-4" />
																		</button>
																		<Textarea value={st.text} onChange={e=>setESteps(prev=>prev.map((p,i)=> i===idx ? { ...p, text: e.target.value } : p))} placeholder={`Step ${idx+1}`} className="min-h-16 flex-1" />
																		<button type="button" onClick={()=>setESteps(prev=>prev.filter((_,i)=>i!==idx))} className="text-xs text-muted-foreground hover:text-destructive px-1 mt-1">✕</button>
																	</div>
																))}
																<button data-add-control="step" type="button" onClick={()=>setESteps(prev=>[...prev, { _k: genKey(), text: '' }])} className="text-xs text-primary hover:underline">+ Add step</button>
															</div>
														</div>
													</div>
													<div>
														<h4 className="font-semibold mb-2">Notes</h4>
														<Textarea value={enotes} onChange={e=>setENotes(e.target.value)} className="min-h-24" />
													</div>
													<div className="flex items-center gap-2 rounded-md border border-border/70 bg-muted/40 px-3 py-2 w-fit">
														<span className="text-[11px] uppercase tracking-wide text-muted-foreground">Cook count</span>
														<Button variant="ghost" type="button" size="icon" className="h-8 w-8 rounded-full border border-border/60 bg-background/70 hover:bg-background" onClick={decrementCookCount} disabled={usesCount <= 0} aria-label="Decrease cook count">
															<Minus className="h-4 w-4" />
														</Button>
														<span className="min-w-[2.5rem] text-center font-mono text-base text-foreground">{usesCount}</span>
														<Button variant="ghost" type="button" size="icon" className="h-8 w-8 rounded-full border border-border/60 bg-background/70 hover:bg-background" onClick={incrementCookCount} aria-label="Increase cook count">
															<Plus className="h-4 w-4" />
														</Button>
													</div>
													<div>
														<h4 className="font-semibold mb-2">Tags</h4>
														<div className="flex flex-wrap gap-2 items-center">
															{(full?.tags ?? []).map(t => (
																<span key={t} style={tagStyles(t)} className="text-[11px] px-3 py-1 rounded-full border flex items-center gap-1.5 leading-none">
																	<span>{t}</span>
																	<button type="button" aria-label={`Remove tag ${t}`} onClick={()=>onRemoveTag(t)} className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
																		<XIcon className="h-3.5 w-3.5" />
																	</button>
																</span>
															))}
															{addingTag ? (
																<div ref={tagBoxRef} className="relative">
																	<form onSubmit={(e)=>{e.preventDefault(); submitTag();}} className="text-xs flex items-center gap-1.5 border border-dashed border-slate-400 rounded-full px-2 py-1 bg-background">
									<Input
										ref={inputRef}
										autoFocus
										value={tagValue}
										onChange={e=>setTagValue(e.target.value)}
										onKeyDown={(e)=>{ if (e.key === 'Escape') { setTagValue(''); setAddingTag(false); } else { onKeyDownTag(e); } }}
										placeholder="Add tag"
										className="h-7 text-xs px-2 w-40"
									/>
																		<Button type="submit" className="h-7 px-3 text-xs" disabled={!tagValue.trim()}>Add</Button>
																	</form>
																	{inputRef.current && createPortal(
																		<TagSuggestions
																			anchor={inputRef.current}
																			items={filteredTags}
																			highlight={highlight}
																			onHighlight={setHighlight}
																			existing={(full?.tags)||[]}
																			onPick={(t)=> submitTag(t)}
																			query={tagValue.trim()}
																			allTags={allTags}
																			onContainerChange={setTagSuggestionsNode}
																		/>, document.body
																	)}
																</div>
															) : (
																<button type="button" onClick={()=>setAddingTag(true)} className="text-xs border border-dashed border-slate-400 rounded-full px-2.5 py-1 text-muted-foreground hover:bg-accent/40 cursor-pointer">
																	+ tag
																</button>
															)}
														</div>
													</div>
													<div>
														<h4 className="font-semibold mb-2">Likes</h4>

														<div className="flex flex-wrap gap-2 items-center">

															{likes.map(name => (

																<span key={name} style={likeStyles(name)} className="text-[11px] px-3 py-1 rounded-full border flex items-center gap-1.5 leading-none">

																	<span>{name}</span>

																	<button type="button" aria-label={`Remove like ${name}`} onClick={()=>removeLikeInline(name)} className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive">

																		<XIcon className="h-3.5 w-3.5" />

																	</button>

																</span>

															))}
{addingLike ? (
																<form
																	onSubmit={(e)=>{e.preventDefault(); addLikeInline();}}
																	className="text-xs flex items-center gap-1.5 border border-dashed border-slate-400 rounded-full px-2 py-1 bg-background"
																>
																	<Input
																		ref={likeInputRef}
																		autoFocus
																		value={likeValue}
																		onChange={e=>setLikeValue(e.target.value)}
																		onKeyDown={e=>{
																			if (e.key === 'Escape') {
																				setLikeValue('');
																				setAddingLike(false);
																			}
																		}}
																		placeholder="Name who likes this"
																		className="h-7 text-xs px-2 w-44"
																	/>
																	<Button type="submit" className="h-7 px-3 text-xs" disabled={!likeValue.trim()}>Add</Button>
																</form>
															) : (
																<button
																	type="button"
																	onClick={()=>{ setAddingLike(true); setTimeout(()=>likeInputRef.current?.focus(), 0); }}
																	className="text-xs border border-dashed border-slate-400 rounded-full px-2.5 py-1 text-muted-foreground hover:bg-accent/40 cursor-pointer"
																>
																	+ like
																</button>
															)}
														</div>
													</div>
													</div>
												)}
										
										<div className="mt-4 flex gap-2 pr-2">
												{!editing ? (
													<>
														<Button onClick={startEdit}>Edit</Button>
														<Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
													</>
												) : (
													<>
														<Button onClick={saveEdit}>Save</Button>
														<Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
														<Button variant="destructive" className="ml-auto" type="button" onClick={async ()=>{
															if (!full) return;
															const sure = confirm(`Delete recipe "${full.title}"? This cannot be undone.`);
															if (!sure) return;
															try {
																await deleteRecipe(full.id);
															} catch (error) {
																console.error('Failed to delete recipe', error);
															}
															setOpen(false);
															onChange();
														}}>Delete</Button>
													</>
												)}
				</div>
				</div>
			</DialogContent>
		</Dialog>
		</>
	);
}

function reorderArray<T>(arr: T[], from: number, to: number): T[] {
	if (from === to) return arr;
	const copy = arr.slice();
	const [item] = copy.splice(from, 1);
	copy.splice(to, 0, item);
	return copy;
}


