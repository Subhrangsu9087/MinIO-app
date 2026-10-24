import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiResponse } from '../models/api-response';

export interface UploadedImage {
  objectName: string;
  previewUrl: string;
}

interface UploadRequestResponse {
  uploadUrl: string;
  objectName: string;
  imageId: number;
}

interface ConfirmUploadResponse {
  id: number;
  objectName: string;
  originalName: string;
  size: number;
  mimeType: string | null;
  status: string;
  createdAt: string;
  previewUrl: string;
}

@Injectable({ providedIn: 'root' })
export class UploadService {
  private readonly http = inject(HttpClient);

  readonly uploading = signal(false);
  readonly progress = signal(0);
  readonly error = signal<string | null>(null);

  /**
   * Two-phase upload flow:
   *
   * Phase 1: POST /api/uploads/request  → validates size & mimeType, creates DB row (status=pending), returns presigned URL
   * Phase 2: PUT binary to MinIO        → direct client-to-storage upload
   * Phase 3: POST /api/uploads/confirm  → transitions DB row to status=ready, returns previewUrl
   */
  async uploadFile(file: File): Promise<UploadedImage | null> {
    this.uploading.set(true);
    this.error.set(null);
    this.progress.set(0);

    try {
      // Phase 1: Request upload — server validates size & mimeType, creates pending DB row
      const requestRes = await firstValueFrom(
        this.http.post<ApiResponse<UploadRequestResponse>>('/api/uploads/request', {
          filename: file.name,
          size: file.size,
          mimeType: file.type || 'application/octet-stream',
        }),
      );

      if (!requestRes.success) {
        this.error.set(requestRes.error?.message ?? 'Upload request rejected');
        return null;
      }

      const { uploadUrl, objectName } = requestRes.data;

      // Phase 2: Upload binary directly to MinIO via presigned URL
      await this.putWithProgress(uploadUrl, file);

      // Phase 3: Confirm upload — server transitions DB row to 'ready'
      const confirmRes = await firstValueFrom(
        this.http.post<ApiResponse<ConfirmUploadResponse>>('/api/uploads/confirm', {
          objectName,
        }),
      );

      if (!confirmRes.success) {
        this.error.set(confirmRes.error?.message ?? 'Upload confirmation failed');
        return null;
      }

      return {
        objectName: confirmRes.data.objectName,
        previewUrl: confirmRes.data.previewUrl,
      };
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
