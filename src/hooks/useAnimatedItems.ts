import { useEffect, useState } from 'react';

export interface AnimatedItemState<T extends { id: number }> {
	id: T['id'];
	recipe: T;
	exiting?: boolean;
}

export function useAnimatedItems<T extends { id: number }>(recipes: T[], exitMs = 300) {
	const sorted = recipes;
	const [items, setItems] = useState<AnimatedItemState<T>[]>(() => sorted.map(recipe => ({ id: recipe.id, recipe })));

	useEffect(() => {
		setItems(prev => {
			const nextIds = new Set(sorted.map(recipe => recipe.id));
			const updated: AnimatedItemState<T>[] = [];

			prev.forEach(item => {
				if (nextIds.has(item.id)) {
					const fresh = sorted.find(recipe => recipe.id === item.id);
					if (fresh) updated.push({ ...item, recipe: fresh, exiting: false });
				} else {
					updated.push({ ...item, exiting: true });
				}
			});

			sorted.forEach(recipe => {
				if (!prev.some(previous => previous.id === recipe.id)) updated.push({ id: recipe.id, recipe, exiting: false });
			});

			return updated;
		});
	}, [sorted]);

	useEffect(() => {
		if (items.some(item => item.exiting)) return;

		const aliveIds = items.map(item => item.id);
		const desired = sorted.map(recipe => recipe.id);
		const sameOrder = aliveIds.length === desired.length && aliveIds.every((id, idx) => id === desired[idx]);

		if (sameOrder) return;

		setItems(prev => {
			const map = new Map(prev.filter(item => !item.exiting).map(item => [item.id, item]));
			return desired
				.map(id => map.get(id))
				.filter((item): item is AnimatedItemState<T> => Boolean(item));
		});
	}, [items, sorted]);

	useEffect(() => {
		if (!items.some(item => item.exiting)) return;

		const timeout = setTimeout(() => {
			setItems(prev => prev.filter(item => !item.exiting));
		}, exitMs);

		return () => clearTimeout(timeout);
	}, [items, exitMs]);

	return items;
}
