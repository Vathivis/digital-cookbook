const MAX_DIMENSION = 1600;

const readFileAsDataUrl = (file: File) =>
	new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => reject(reader.error);
		reader.onload = () => resolve(reader.result as string);
		reader.readAsDataURL(file);
	});

export async function loadImageDataUrl(file: File, maxDimension = MAX_DIMENSION) {
	if (typeof window === 'undefined') {
		return readFileAsDataUrl(file);
	}
	if ('createImageBitmap' in window) {
		try {
			const bitmap = await createImageBitmap(file);
			const largestSide = Math.max(bitmap.width, bitmap.height) || 1;
			const scale = Math.min(1, maxDimension / largestSide);
			const width = Math.max(1, Math.round(bitmap.width * scale));
			const height = Math.max(1, Math.round(bitmap.height * scale));
			const canvas = document.createElement('canvas');
			canvas.width = width;
			canvas.height = height;
			const ctx = canvas.getContext('2d');
			if (ctx) {
				ctx.drawImage(bitmap, 0, 0, width, height);
				return canvas.toDataURL('image/jpeg', 0.9);
			}
		} catch (error) {
			console.warn('Falling back to raw image data URL', error);
		}
	}
	return readFileAsDataUrl(file);
}
