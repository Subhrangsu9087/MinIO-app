import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface ImageObject {
  objectName: string;
  size: number;
  lastModified: string;
}

export interface ImageWithUrl extends ImageObject {
  previewUrl: string;
}

@Injectable({ providedIn: 'root' })
export class ImageService {
  private readonly http = inject(HttpClient);

  private readonly _images = signal<ImageWithUrl[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly images = this._images.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly isEmpty = computed(() => !this._loading() && this._images().length === 0);

  async loadImages(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);

    try {
      const objects = await firstValueFrom(
        this.http.get<ImageObject[]>('/api/images'),
      );

      const withUrls = await Promise.all(
        objects.map(async (obj) => {
          const { url } = await firstValueFrom(
            this.http.get<{ url: string }>('/api/image-url', {
              params: { objectName: obj.objectName },
            }),
          );
          return { ...obj, previewUrl: url };
        }),
      );

      this._images.set(withUrls);
    } catch {
      this._error.set('Failed to load images. Please try again.');
    } finally {
      this._loading.set(false);
    }
  }
}

