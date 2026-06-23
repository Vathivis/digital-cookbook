import { webcrypto } from 'node:crypto';
import { Window as HappyWindow } from 'happy-dom';

const happyWindow = new HappyWindow();
const testWindow = happyWindow as unknown as Window & typeof globalThis;

testWindow.Error = Error;
testWindow.SyntaxError = SyntaxError;
testWindow.TypeError = TypeError;

class ResizeObserverStub {
	observe() {}
	unobserve() {}
	disconnect() {}
}

class MutationObserverStub {
	observe() {}
	disconnect() {}
	takeRecords(): MutationRecord[] {
		return [];
	}
}

const requestAnimationFrameStub = (callback: FrameRequestCallback) => {
	return setTimeout(() => callback(Date.now()), 0) as unknown as number;
};
const cancelAnimationFrameStub = (id: number) => {
	clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
};

Object.assign(testWindow, {
	requestAnimationFrame: requestAnimationFrameStub,
	cancelAnimationFrame: cancelAnimationFrameStub,
});

Object.assign(globalThis, {
	window: testWindow,
	document: testWindow.document,
	navigator: testWindow.navigator,
	location: testWindow.location,
	history: testWindow.history,
	Element: testWindow.Element,
	HTMLElement: testWindow.HTMLElement,
	HTMLButtonElement: testWindow.HTMLButtonElement,
	HTMLFormElement: testWindow.HTMLFormElement,
	HTMLInputElement: testWindow.HTMLInputElement,
	HTMLSelectElement: testWindow.HTMLSelectElement,
	HTMLTextAreaElement: testWindow.HTMLTextAreaElement,
	SVGElement: testWindow.SVGElement,
	DocumentFragment: testWindow.DocumentFragment,
	getComputedStyle: testWindow.getComputedStyle.bind(testWindow),
	localStorage: testWindow.localStorage,
	sessionStorage: testWindow.sessionStorage,
	Node: testWindow.Node,
	NodeFilter: testWindow.NodeFilter,
	Event: testWindow.Event,
	CustomEvent: testWindow.CustomEvent,
	InputEvent: testWindow.InputEvent,
	KeyboardEvent: testWindow.KeyboardEvent,
	MouseEvent: testWindow.MouseEvent,
	PointerEvent: testWindow.PointerEvent,
	SubmitEvent: testWindow.SubmitEvent,
	FormData: testWindow.FormData,
	MutationObserver: testWindow.MutationObserver ?? MutationObserverStub,
	ResizeObserver: ResizeObserverStub,
	requestAnimationFrame: requestAnimationFrameStub,
	cancelAnimationFrame: cancelAnimationFrameStub,
});

if (!globalThis.crypto) {
	Object.defineProperty(globalThis, 'crypto', {
		value: webcrypto,
		configurable: true,
	});
}
