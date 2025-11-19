import { useState, useRef, useCallback, useEffect } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { createRecipe, listTags, type StructuredIngredient } from '../lib/api';
import { loadImageDataUrl } from '../lib/image';
import { useReorderDrag } from '../hooks/useReorderDrag';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from './ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { GripVertical, X as XIcon, ImagePlus } from 'lucide-react';
import { TagSuggestions } from './TagSuggestions';

type EditableIngredient = StructuredIngredient & { _k: string };
type EditableStep = { _k: string; text: string };

const genKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2));

const createBlankIngredient = (): EditableIngredient => ({ quantity: undefined, unit: undefined, name: '', line: '', _k: genKey() });
const createBlankStep = (): EditableStep => ({ _k: genKey(), text: '' });

function reorderArray<T>(arr: T[], from: number, to: number): T[] {
	if (from === to) return arr;
	const copy = arr.slice();
	const [item] = copy.splice(from, 1);
	copy.splice(to, 0, item);
	return copy;
}

interface Props {
	cookbookId: number;
	onCreated: () => void;
}

export function RecipeCreateCard({ cookbookId, onCreated }: Props) {
	const [open, setOpen] = useState(false);
	const [title, setTitle] = useState('');
	const [author, setAuthor] = useState('');
	const [description, setDescription] = useState('');
	const [servings, setServings] = useState<number>(1);
	const [ingredients, setIngredients] = useState<EditableIngredient[]>([createBlankIngredient()]);
	const [steps, setSteps] = useState<EditableStep[]>([createBlankStep()]);
	const [notes, setNotes] = useState('');
	const [photo, setPhoto] = useState<string | undefined>();
	const imageTaskRef = useRef(0);
	const [tagList, setTagList] = useState<string[]>([]);
	const [addingTag, setAddingTag] = useState(false);
	const [tagValue, setTagValue] = useState('');
	const [allTags, setAllTags] = useState<string[]>([]);
	const [filteredTags, setFilteredTags] = useState<string[]>([]);
	const [highlight, setHighlight] = useState(-1);
	const [tagSuggestionsNode, setTagSuggestionsNode] = useState<HTMLElement | null>(null);
	const tagBoxRef = useRef<HTMLDivElement | null>(null);
	const tagInputRef = useRef<HTMLInputElement | null>(null);
	const [darkMode, setDarkMode] = useState<boolean>(() => (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')));
	useEffect(() => {
		if (typeof document === 'undefined') return;
		const root = document.documentElement;
		const observer = new MutationObserver(() => {
			setDarkMode(root.classList.contains('dark'));
		});
		observer.observe(root, { attributes: true, attributeFilter: ['class'] });
		return () => observer.disconnect();
	}, []);
	const tagStyles = useCallback((t: string): CSSProperties => {
		let hash = 0;
		for (let i = 0; i < t.length; i++) hash = (hash * 31 + t.charCodeAt(i)) | 0;
		const hue = Math.abs(hash) % 360;
		const sat = 70;
		const bgLightness = darkMode ? 38 : 78;
		const borderLightness = darkMode ? bgLightness + 6 : bgLightness - 12;
		const textColor = darkMode ? '#fff' : '#111';
		return {
			backgroundColor: `hsl(${hue},${sat}%,${bgLightness}%)`,
			borderColor: `hsl(${hue},${sat}%,${borderLightness}%)`,
			color: textColor,
		};
	}, [darkMode]);
	const resetForm = useCallback(() => {
		setTitle('');
		setAuthor('');
		setDescription('');
		setServings(1);
		setIngredients([createBlankIngredient()]);
		setSteps([createBlankStep()]);
		setNotes('');
		setPhoto(undefined);
		setTagList([]);
		setTagValue('');
		setAddingTag(false);
		setFilteredTags(allTags);
		setHighlight(-1);
	}, [allTags]);
	const submit = async () => {
	if (!title.trim()) return;
	const cleanedIngredients = ingredients
		.filter(i=> (i.name||'').trim() || (i.line||'').trim())
		.map(({ _k, ...rest }) => {
			void _k;
			return rest;
		});
	const cleanedSteps = steps.map(s=>s.text.trim()).filter(Boolean);
	await createRecipe({
		cookbook_id: cookbookId,
		title: title.trim(),
		author: author.trim(),
		description: description.trim(),
		servings,
		ingredients: cleanedIngredients,
		steps: cleanedSteps,
		notes: notes.trim(),
		photoDataUrl: photo,
		tags: tagList
	});
	resetForm();
	setOpen(false);
	onCreated();
	};
	const onPickImage = useCallback((file?: File) => {
		if (!file) return;
		const taskId = ++imageTaskRef.current;
		loadImageDataUrl(file)
			.then((dataUrl) => {
				if (imageTaskRef.current === taskId) {
					setPhoto(dataUrl);
				}
			})
			.catch((error) => console.error('Failed to process image', error));
	}, []);
	const [photoDrag, setPhotoDrag] = useState(false);
	const photoInputRef = useRef<HTMLInputElement | null>(null);
	useEffect(() => {
		if (!open) return;
		const handlePaste = (event: ClipboardEvent) => {
			const clipboardData = event.clipboardData;
			if (!clipboardData) return;
			const files = clipboardData.files;
			const primaryFile = files && files.length > 0 ? files[0] : undefined;
			if (primaryFile && primaryFile.type.startsWith('image/')) {
				event.preventDefault();
				onPickImage(primaryFile);
				return;
			}
			const items = clipboardData.items;
			if (!items?.length) return;
			for (let i = 0; i < items.length; i++) {
				const item = items[i];
				if (!item || !item.type.startsWith('image/')) continue;
				const file = item.getAsFile();
				if (!file) continue;
				event.preventDefault();
				onPickImage(file);
				return;
			}
		};
		window.addEventListener('paste', handlePaste);
		return () => window.removeEventListener('paste', handlePaste);
	}, [open, onPickImage]);
	const ingredientListRef = useRef<HTMLDivElement | null>(null);
	const stepListRef = useRef<HTMLDivElement | null>(null);
	const ingredientDrag = useReorderDrag({
		containerRef: ingredientListRef,
		addControlSelector: '[data-add-control="ing"]',
		onReorder: (from, to) => setIngredients(prev => reorderArray(prev, from, to))
	});
	const stepDrag = useReorderDrag({
		containerRef: stepListRef,
		addControlSelector: '[data-add-control="step"]',
		onReorder: (from, to) => setSteps(prev => reorderArray(prev, from, to))
	});

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

	useEffect(() => { setHighlight(-1); }, [filteredTags]);
	useEffect(() => {
		if (!addingTag) return;
		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target as Node;
			if (tagBoxRef.current?.contains(target)) return;
			if (tagSuggestionsNode?.contains(target as HTMLElement)) return;
			setAddingTag(false);
		};
		document.addEventListener('pointerdown', handlePointerDown);
		return () => document.removeEventListener('pointerdown', handlePointerDown);
	}, [addingTag, tagSuggestionsNode]);

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
		if (addingTag) return;
		setTagValue('');
		setFilteredTags(allTags);
		setHighlight(-1);
	}, [addingTag, allTags]);

	const submitTag = useCallback((nameOverride?: string) => {
		const raw = (nameOverride ?? tagValue).trim();
		if (!raw) return;
		setTagList(prev => {
			if (prev.some(t => t.toLowerCase() === raw.toLowerCase())) return prev;
			return [...prev, raw];
		});
		setTagValue('');
		setAddingTag(false);
	}, [tagValue]);

	const onRemoveTag = useCallback((name: string) => {
		setTagList(prev => prev.filter(t => t !== name));
	}, []);

	const onKeyDownTag = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
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
	}, [filteredTags, highlight, submitTag]);
	return (
		<>
			<button onClick={()=>setOpen(true)} className="border border-dashed border-slate-400/70 rounded-lg min-h-[23rem] w-full flex items-center justify-center bg-card text-muted-foreground hover:bg-accent/30 transition-colors surface-transition cursor-pointer">
				<div className="flex flex-col items-center gap-1">
					<span className="text-4xl">➕</span>
					<span className="text-sm">Add Recipe</span>
				</div>
			</button>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="sm:max-w-3xl">
					<DialogHeader>
						<DialogTitle>New Recipe</DialogTitle>
					</DialogHeader>
					<div className="max-h-[70vh] overflow-auto">
						<div className="flex gap-4">
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
								{photo ? (
									<>
										<img src={photo} alt="Recipe photo preview" className="object-cover w-full h-full" />
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
							<div className="flex-1 flex flex-col gap-2">
								<Input placeholder="Title" value={title} onChange={e=>setTitle(e.target.value)} className="text-xl font-semibold" />
								<Input placeholder="Author" value={author} onChange={e=>setAuthor(e.target.value)} />
								<Textarea placeholder="Short description" value={description} onChange={e=>setDescription(e.target.value)} className="resize-none h-20" />
								<div className="flex items-center gap-2">
									<label className="text-xs font-medium text-muted-foreground">Servings:</label>
									<Select value={String(servings)} onValueChange={(v)=>setServings(Number(v))}>
										<SelectTrigger size="sm" className="h-8 w-20">
											<SelectValue placeholder="1" />
										</SelectTrigger>
										<SelectContent>
											{Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
												<SelectItem key={n} value={String(n)}>{n}</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							</div>
						</div>
							<div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
								<div>
									<h4 className="font-semibold mb-2">Ingredients</h4>
									<div ref={ingredientListRef} className="space-y-2">
										{ingredients.map((ing, idx) => (
											<div key={ing._k} data-drag-item className="flex gap-2 items-center bg-background/40 rounded p-1 pr-2">
												<button type="button" aria-label="Reorder ingredient" onPointerDown={(ev)=>ingredientDrag(ev,idx)} className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-1">
													<GripVertical className="h-4 w-4" />
												</button>
												<Input placeholder="#" type="text" inputMode="decimal" value={ing.quantity ?? ''} onChange={e=>{
													const raw = e.target.value.replace(/,/g,'.');
													const trimmed = raw.trim();
													const parsed = trimmed === '' ? undefined : Number(trimmed);
													const quantityValue = parsed === undefined || Number.isNaN(parsed) ? undefined : parsed;
													setIngredients(prev => prev.map((p,i)=> i===idx ? { ...p, quantity: quantityValue } : p));
												}} className="w-16" />
												<Select value={ing.unit || 'none'} onValueChange={(v)=>setIngredients(prev=>prev.map((p,i)=> i===idx ? { ...p, unit: v==='none'? undefined : v } : p))}>
													<SelectTrigger size="sm" className="h-8 w-20">
														<SelectValue placeholder="-" />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="none">-</SelectItem>
														{['g','kg','ml','l','u','tbsp','tsp','cup','pcs'].map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
													</SelectContent>
												</Select>
												<Input placeholder="Ingredient" value={ing.name || ''} onChange={e=>setIngredients(prev=>prev.map((p,i)=> i===idx ? { ...p, name: e.target.value, line: `${p.quantity ?? ''} ${p.unit ?? ''} ${e.target.value}`.trim() } : p))} className="flex-1" />
												<button type="button" onClick={()=>setIngredients(prev => prev.filter((_,i)=>i!==idx))} className="text-xs text-muted-foreground hover:text-destructive px-1 cursor-pointer">✕</button>
											</div>
										))}
										<button data-add-control="ing" type="button" onClick={()=>setIngredients(prev=>[...prev, createBlankIngredient()])} className="text-xs text-primary hover:underline cursor-pointer">+ Add ingredient</button>
									</div>
								</div>
								<div>
									<h4 className="font-semibold mb-2">Steps</h4>
									<div ref={stepListRef} className="space-y-2">
										{steps.map((st, idx) => (
											<div key={st._k} data-drag-item className="flex gap-2 items-start bg-background/40 rounded p-1 pr-2">
												<button type="button" aria-label="Reorder step" onPointerDown={(ev)=>stepDrag(ev,idx)} className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-1 mt-1">
													<GripVertical className="h-4 w-4" />
												</button>
												<Textarea value={st.text} onChange={e=>setSteps(prev=>prev.map((p,i)=> i===idx ? { ...p, text: e.target.value } : p))} placeholder={`Step ${idx+1}`} className="min-h-16 flex-1" />
												<button type="button" onClick={()=>setSteps(prev=>prev.filter((_,i)=>i!==idx))} className="text-xs text-muted-foreground hover:text-destructive px-1 mt-1 cursor-pointer">✕</button>
											</div>
										))}
										<button data-add-control="step" type="button" onClick={()=>setSteps(prev=>[...prev, createBlankStep()])} className="text-xs text-primary hover:underline cursor-pointer">+ Add step</button>
									</div>
								</div>
							</div>
						<div className="mt-4">
							<h4 className="font-semibold mb-2">Notes</h4>
							<Textarea value={notes} onChange={e=>setNotes(e.target.value)} className="min-h-24" />
						</div>
						<div className="mt-4">
							<h4 className="font-semibold mb-2">Tags</h4>
							<div className="flex flex-wrap gap-2 items-center">
								{tagList.map(t => (
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
												ref={tagInputRef}
												autoFocus
												value={tagValue}
												onChange={e=>setTagValue(e.target.value)}
												onKeyDown={(e)=>{ if (e.key === 'Escape') { setTagValue(''); setAddingTag(false); } else { onKeyDownTag(e); } }}
												placeholder="Add tag"
												className="h-7 text-xs px-2 w-40"
											/>
											<Button type="submit" className="h-7 px-3 text-xs" disabled={!tagValue.trim()}>Add</Button>
										</form>
										{tagInputRef.current && createPortal(
											<TagSuggestions
												anchor={tagInputRef.current}
												items={filteredTags}
												highlight={highlight}
												onHighlight={setHighlight}
												existing={tagList}
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
						<div className="mt-4 flex items-center gap-4">
							<Button onClick={submit}>Save Recipe</Button>
							<Button variant="outline" onClick={()=>{ resetForm(); setOpen(false); }}>Cancel</Button>
						</div>
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}
