import { useCallback, useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

interface Options {
	containerRef: React.RefObject<HTMLElement | null>;
	addControlSelector?: string;
	onReorder: (from: number, to: number) => void;
}

export function useReorderDrag({ containerRef, addControlSelector, onReorder }: Options) {
	const teardownRef = useRef<(() => void) | null>(null);

	useEffect(() => {
		return () => {
			if (teardownRef.current) {
				teardownRef.current();
				teardownRef.current = null;
			}
		};
	}, []);

	return useCallback(
		(event: ReactPointerEvent<HTMLElement>, index: number) => {
			if (event.button !== 0) return;
			event.preventDefault();
			event.stopPropagation();

			if (teardownRef.current) {
				teardownRef.current();
				teardownRef.current = null;
			}

			const list = containerRef.current;
			if (!list) return;

			const items = Array.from(list.querySelectorAll('[data-drag-item]')) as HTMLElement[];
			const row = items[index];
			if (!row) return;

			const rect = row.getBoundingClientRect();
			const offsetY = event.clientY - rect.top;
			const placeholder = document.createElement('div');
			placeholder.style.height = `${rect.height}px`;
			placeholder.style.border = '2px dashed var(--border)';
			placeholder.style.borderRadius = '0.5rem';
			placeholder.style.background = 'var(--accent)';
			placeholder.style.opacity = '0.25';
			placeholder.setAttribute('data-drag-placeholder', '');
			row.parentElement?.insertBefore(placeholder, row);
			row.style.display = 'none';

			const clone = row.cloneNode(true) as HTMLElement;
			clone.style.position = 'fixed';
			clone.style.top = `${rect.top}px`;
			clone.style.left = `${rect.left}px`;
			clone.style.width = `${rect.width}px`;
			clone.style.zIndex = '1000';
			clone.style.pointerEvents = 'none';
			clone.style.boxShadow = '0 4px 16px -2px rgba(0,0,0,0.35)';
			clone.style.background = 'var(--card)';
			clone.classList.add('drag-follow');
			document.body.appendChild(clone);
			document.body.style.cursor = 'grabbing';

			const button = event.currentTarget;
			const pointerId = event.pointerId;
			button.setPointerCapture(pointerId);

			const onMove = (ev: PointerEvent) => {
				const y = ev.clientY - offsetY;
				clone.style.top = `${y}px`;
				const centerY = y + rect.height / 2;
				const siblings = Array.from(list.querySelectorAll('[data-drag-item]')).filter((el) => el !== row) as HTMLElement[];
				let inserted = false;
				for (const sib of siblings) {
					if (sib.style.display === 'none') continue;
					const siblingRect = sib.getBoundingClientRect();
					const mid = siblingRect.top + siblingRect.height / 2;
					if (centerY < mid) {
						if (sib.previousSibling !== placeholder) {
							list.insertBefore(placeholder, sib);
						}
						inserted = true;
						break;
					}
				}
				if (!inserted) {
					if (addControlSelector) {
						const addControl = list.querySelector(addControlSelector);
						if (addControl && addControl.parentElement) {
							list.insertBefore(placeholder, addControl);
							return;
						}
					}
					list.appendChild(placeholder);
				}
			};

			let finished = false;
			const cleanup = () => {
				try {
					button.releasePointerCapture(pointerId);
				} catch {
					// ignore
				}
				button.removeEventListener('pointermove', onMove);
				button.removeEventListener('pointerup', finishDrag);
				button.removeEventListener('pointercancel', finishDrag);
				button.removeEventListener('lostpointercapture', finishDrag);
				document.body.style.cursor = '';
				clone.remove();
				row.style.display = '';
				placeholder.remove();
				teardownRef.current = null;
			};

			const finishDrag = () => {
				if (finished) return;
				finished = true;
				const children = Array.from(list.children);
				const phIndex = children.indexOf(placeholder);
				let targetIndex = phIndex;
				if (targetIndex > index) targetIndex -= 1;
				cleanup();
				if (phIndex === -1 || targetIndex === index || targetIndex === undefined) return;
				onReorder(index, targetIndex);
			};

			button.addEventListener('pointermove', onMove);
			button.addEventListener('pointerup', finishDrag);
			button.addEventListener('pointercancel', finishDrag);
			button.addEventListener('lostpointercapture', finishDrag);

			teardownRef.current = cleanup;
		},
		[addControlSelector, containerRef, onReorder]
	);
}
