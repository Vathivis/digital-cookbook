import { describe, expect, test } from 'bun:test';
import {
	DEFAULT_PHOTO_THUMBNAIL_MAX_DATA_URL_LENGTH,
	PHOTO_THUMBNAIL_MAX_DATA_URL_LENGTH,
	parsePhotoThumbnailMaxDataUrlLength,
	selectPhotoThumbnailDataUrl
} from '@/lib/image';

describe('parsePhotoThumbnailMaxDataUrlLength', () => {
	test('uses the default thumbnail cap when no build env override is set', () => {
		expect(parsePhotoThumbnailMaxDataUrlLength(undefined)).toBe(DEFAULT_PHOTO_THUMBNAIL_MAX_DATA_URL_LENGTH);
	});

	test('accepts positive integer build env overrides', () => {
		expect(parsePhotoThumbnailMaxDataUrlLength('12345')).toBe(12345);
	});

	test('ignores invalid build env overrides', () => {
		expect(parsePhotoThumbnailMaxDataUrlLength('0')).toBe(DEFAULT_PHOTO_THUMBNAIL_MAX_DATA_URL_LENGTH);
		expect(parsePhotoThumbnailMaxDataUrlLength('nope')).toBe(DEFAULT_PHOTO_THUMBNAIL_MAX_DATA_URL_LENGTH);
	});
});

describe('selectPhotoThumbnailDataUrl', () => {
	test('omits fallback thumbnails that match the full photo data URL', () => {
		const fullPhoto = 'data:image/jpeg;base64,original';

		expect(selectPhotoThumbnailDataUrl(fullPhoto, fullPhoto)).toBeUndefined();
	});

	test('omits thumbnails that exceed the server thumbnail cap', () => {
		const fullPhoto = 'data:image/jpeg;base64,original';
		const oversizedThumbnail = `data:image/jpeg;base64,${'x'.repeat(PHOTO_THUMBNAIL_MAX_DATA_URL_LENGTH)}`;

		expect(selectPhotoThumbnailDataUrl(fullPhoto, oversizedThumbnail)).toBeUndefined();
	});

	test('keeps resized thumbnails that are distinct and under the cap', () => {
		const thumbnail = 'data:image/jpeg;base64,thumb';

		expect(selectPhotoThumbnailDataUrl('data:image/jpeg;base64,original', thumbnail)).toBe(thumbnail);
	});
});
