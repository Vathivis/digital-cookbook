import { afterEach, describe, expect, test } from 'bun:test';
import { render, waitFor, cleanup } from '@testing-library/react';
import { useEffect } from 'react';
import { AnimatedItemState, useAnimatedItems } from '@/hooks/useAnimatedItems';

type MinimalRecipe = { id: number; title: string };

afterEach(() => cleanup());

function HookHarness({ recipes, onItems }: { recipes: MinimalRecipe[]; onItems: (items: AnimatedItemState<MinimalRecipe>[]) => void }) {
	const items = useAnimatedItems(recipes, 0);
	useEffect(() => {
		onItems(items);
	}, [items, onItems]);
	return null;
}

describe('useAnimatedItems', () => {
	test('updates cached recipes when ids stay stable', async () => {
		const snapshots: string[] = [];
		const handleItems = (items: AnimatedItemState<MinimalRecipe>[]) => {
			if (!items.length) return;
			snapshots.push(items[0].recipe.title);
		};
		const { rerender } = render(<HookHarness recipes={[{ id: 1, title: 'Original' }]} onItems={handleItems} />);
		await waitFor(() => expect(snapshots.some(title => title === 'Original')).toBe(true));
		rerender(<HookHarness recipes={[{ id: 1, title: 'Edited' }]} onItems={handleItems} />);
		await waitFor(() => expect(snapshots.at(-1)).toBe('Edited'));
	});
});
