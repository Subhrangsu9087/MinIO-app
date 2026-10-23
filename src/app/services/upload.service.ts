import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface UploadedImage {
  objectName: string;
  previewUrl: string;
}

@Injectable({ providedIn: 'root' })
export class UploadService {
  private readonly http = inject(HttpClient);

  readonly uploading = signal(false);
  readonly progress = signal(0);
  readonly error = signal<string | null>(null);

  async uploadFile(file: File): Promise<UploadedImage | null> {
    this.uploading.set(true);
    this.error.set(null);
    this.progress.set(0);

    try {
      const { url, objectName } = await firstValueFrom(
        this.http.get<{ url: string; objectName: string }>(
          '/api/upload-url',
          { params: { filename: file.name } },
        ),
      );

      await this.putWithProgress(url, file);

      const { url: previewUrl } = await firstValueFrom(
        this.http.get<{ url: string }>('/api/image-url', {
          params: { objectName },
        }),
      );

      return { objectName, previewUrl };
    } catch {
      this.error.set('Upload failed. Please try again.');
      return null;
    } finally {
      this.uploading.set(false);
    }
  }

  private putWithProgress(url: string, file: File): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url);
      xhr.setRequestHeader('Content-Type', file.type);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          this.progress.set(Math.round((event.loaded / event.total) * 100));
        }
      };

      xhr.onload = () =>
        xhr.status >= 200 && xhr.status < 300
          ? resolve()
          : reject(new Error('Upload failed'));
      xhr.onerror = () => reject(new Error('Upload failed'));
      xhr.send(file);
    });
  }
}