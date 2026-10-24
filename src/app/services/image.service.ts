import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiResponse } from '../models/api-response';

export interface ImageObject {
  id: number;
  objectName: string;
  originalName: string;
  size: number;
  mimeType: string | null;
  createdAt: string;
  previewUrl: string;
}

@Injectable({ providedIn: 'root' })
export class ImageService {
  private readonly http = inject(HttpClient);

  private readonly _images = signal<ImageObject[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly images = this._images.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly isEmpty = computed(() => !this._loading() && this._images().length === 0);

  /**
   * Fix #1: Single request to load all images with presigned URLs.
   * No more N+1 — the server returns previewUrl inline.
   */
  async loadImages(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);

    try {
      const response = await firstValueFrom(
        this.http.get<ApiResponse<ImageObject[]>>('/api/images'),
      );

      this._images.set(response.data ?? []);
    } catch {
      this._error.set('Failed to load images. Please try again.');
    } finally {
      this._loading.set(false);
    }
  }

  async deleteImage(objectName: string): Promise<boolean> {
    try {
      await firstValueFrom(
        this.http.delete<ApiResponse<{ objectName: string }>>('/api/images', {
          params: { objectName },
        }),
      );
      this._images.update((list) => list.filter((img) => img.objectName !== objectName));
      return true;
    } catch {
      this._error.set('Failed to delete image. Please try again.');
      return false;
    }
  }
}
