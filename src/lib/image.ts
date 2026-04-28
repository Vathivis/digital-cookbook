const MAX_DIMENSION = 1600;
export const THUMBNAIL_MAX_DIMENSION = 480;
export const DEFAULT_PHOTO_THUMBNAIL_MAX_DATA_URL_LENGTH = 2_000_000;

export function parsePhotoThumbnailMaxDataUrlLength(value: string | undefined) {
	if (!value) return DEFAULT_PHOTO_THUMBNAIL_MAX_DATA_URL_LENGTH;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_PHOTO_THUMBNAIL_MAX_DATA_URL_LENGTH;
}

export const PHOTO_THUMBNAIL_MAX_DATA_URL_LENGTH = parsePhotoThumbnailMaxDataUrlLength(
	import.meta.env.VITE_PHOTO_THUMBNAIL_MAX_DATA_URL_LENGTH
);

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

export function selectPhotoThumbnailDataUrl(
	photoDataUrl: string | null | undefined,
	thumbnailDataUrl: string | null | undefined
) {
	if (!photoDataUrl || !thumbnailDataUrl) return undefined;
	if (thumbnailDataUrl === photoDataUrl) return undefined;
	if (thumbnailDataUrl.length > PHOTO_THUMBNAIL_MAX_DATA_URL_LENGTH) return undefined;
	return thumbnailDataUrl;
}
