import { useEffect, useState } from 'react';
import { listCookbooks, createCookbook, renameCookbook, deleteCookbook } from '../lib/api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Pencil, Check, X } from 'lucide-react';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from './ui/alert-dialog';
import { deriveNextCookbookId } from './cookbook-helpers';

interface Props {
	activeCookbookId: number | null;
	onSelect: (id: number | null) => void;
}

export function CookbookLayoutSidebar({ activeCookbookId, onSelect }: Props) {
	const [cookbooks, setCookbooks] = useState<{ id: number; name: string }[]>([]);
	const [adding, setAdding] = useState(false);
	const [name, setName] = useState('');
	const [renameId, setRenameId] = useState<number | null>(null);
	const [renameVal, setRenameVal] = useState('');
	const [deleteId, setDeleteId] = useState<number | null>(null);
	const [deleteConfirm, setDeleteConfirm] = useState('');

	useEffect(() => {
		(async () => {
			setCookbooks(await listCookbooks());
		})();
	}, []);

	useEffect(() => {
		const next = deriveNextCookbookId(activeCookbookId, cookbooks);
		if (next !== activeCookbookId) onSelect(next);
	}, [cookbooks, activeCookbookId, onSelect]);

	const submit = async () => {
		if (!name.trim()) return;
		await createCookbook(name.trim());
		setName('');
		setAdding(false);
		setCookbooks(await listCookbooks());
	};

	const alertError = (error: unknown, fallback: string) => {
		const message = error instanceof Error && error.message ? error.message : fallback;
		alert(message);
	};

	return (
		<div className="min-h-screen flex flex-col gap-4 p-4 bg-sidebar border-r border-border/70 dark:border-border w-64 shrink-0">
			<h2 className="text-lg font-semibold">Cookbooks</h2>
			<ul className="flex flex-col gap-1 overflow-auto">
				{cookbooks.map(cb => {
					const active = cb.id === activeCookbookId;
					const isRenaming = renameId === cb.id;
					const commitRename = async () => {
						if (!renameVal.trim()) return;
						try {
							await renameCookbook(cb.id, renameVal.trim());
							setRenameId(null);
							setRenameVal('');
							setCookbooks(await listCookbooks());
						} catch (error) {
							alertError(error, 'Rename failed');
						}
					};
					return (
						<li key={cb.id} className="group">
							<div
								className={`flex items-center gap-1 rounded-md px-1 py-1 text-sm transition-colors border surface-transition
                  ${active
										? 'bg-primary/12 text-foreground border-primary/30 ring-1 ring-primary/20 dark:bg-accent dark:text-accent-foreground dark:border-input dark:ring-input/40'
										: 'bg-transparent text-foreground/90 hover:bg-primary/8 hover:text-foreground dark:hover:bg-accent/60 dark:hover:text-accent-foreground border-transparent'
									}`}
							>
								{isRenaming ? (
									<>
										<Input
											value={renameVal}
											onChange={e => setRenameVal(e.target.value)}
											className="h-8 flex-1 text-sm px-2"
											autoFocus
											onKeyDown={e => {
												if (e.key === 'Enter') {
													void commitRename();
												} else if (e.key === 'Escape') {
													setRenameId(null);
													setRenameVal('');
												}
											}}
										/>
										<Button
											aria-label="Save"
											size="icon"
											className="h-8 w-8"
											onClick={() => {
												void commitRename();
											}}
										>
											<Check className="h-4 w-4" />
										</Button>
										<Button aria-label="Cancel" size="icon" variant="outline" className="h-8 w-8" onClick={() => { setRenameId(null); setRenameVal(''); }}>
											<X className="h-4 w-4" />
										</Button>
									</>
								) : (
									<>
										<button
											aria-current={active ? 'page' : undefined}
											onClick={() => onSelect(cb.id)}
											className="flex-1 text-left rounded-md px-2 py-1.5 text-sm"
										>
											{cb.name}
										</button>
										<Button
											aria-label={`Rename ${cb.name}`}
											size="icon"
											variant="ghost"
											className={`h-8 w-8 rounded-md text-muted-foreground hover:text-foreground transition-colors ${active ? 'hover:bg-foreground/15 dark:hover:bg-white/15' : 'hover:bg-primary/20 dark:hover:bg-white/10'}`}
											onClick={() => { setRenameId(cb.id); setRenameVal(cb.name); }}
										>
											<Pencil className="h-4 w-4" />
										</Button>
									</>
								)}
							</div>
						</li>
					);
				})}
			</ul>
			{adding ? (
				<div className="mt-auto flex flex-col gap-2">
					<Input value={name} placeholder="Name" onChange={e => setName(e.target.value)} />
					<div className="flex gap-2">
						<Button size="sm" onClick={submit}>Save</Button>
						<Button size="sm" variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
					</div>
				</div>
			) : (
				<Button variant="default" className="mt-auto w-full" onClick={() => setAdding(true)}>Add Cookbook</Button>
			)}

			<Button
				variant="destructive"
				className="mt-2 w-full"
				disabled={!activeCookbookId}
				onClick={() => { if (activeCookbookId) { setDeleteId(activeCookbookId); setDeleteConfirm(''); } }}
			>
				Remove Selected Cookbook
			</Button>

			<AlertDialog open={deleteId != null} onOpenChange={value => { if (!value) { setDeleteId(null); setDeleteConfirm(''); } }}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Cookbook</AlertDialogTitle>
						<AlertDialogDescription>
							{(() => {
								const target = cookbooks.find(c => c.id === deleteId);
								return target ? (
									<>This will permanently delete "{target.name}" including all its recipes. Type the cookbook name to confirm.</>
								) : (
									<>This will permanently delete the selected cookbook and its recipes. Type its name to confirm.</>
								);
							})()}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<Input
						value={deleteConfirm}
						onChange={e => setDeleteConfirm(e.target.value)}
						placeholder={cookbooks.find(c => c.id === deleteId)?.name || ''}
						className="mt-2"
					/>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive hover:bg-destructive/90"
							onClick={async e => {
								const target = cookbooks.find(c => c.id === deleteId);
								if (!target || deleteConfirm.trim() !== target.name) {
									e.preventDefault();
									return;
								}
								try {
									await deleteCookbook(target.id);
									const list = await listCookbooks();
									setCookbooks(list);
									setDeleteId(null);
									setDeleteConfirm('');
									if (activeCookbookId === target.id) {
										if (list[0]) onSelect(list[0].id);
										else onSelect(null);
									}
								} catch (error) {
									e.preventDefault();
									alertError(error, 'Delete failed');
								}
							}}
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
