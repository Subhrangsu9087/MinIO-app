import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { UploadedImage, UploadService } from '../../services/upload.service';

@Component({
  selector: 'app-image-upload',
  imports: [],
  templateUrl: './image-upload.html',
  styleUrl: './image-upload.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImageUpload {
  protected readonly uploadService = inject(UploadService);
  protected readonly preview = signal<UploadedImage | null>(null);
  protected readonly isDragging = signal(false);
  protected readonly selectedFileName = signal<string | null>(null);

  readonly uploaded = output<UploadedImage>();

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);
  }

  async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);

    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      await this.handleFile(files[0]);
    }
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    await this.handleFile(file);
    input.value = '';
  }

  private async handleFile(file: File): Promise<void> {
    if (!file.type.startsWith('image/')) {
      return;
    }
    this.selectedFileName.set(file.name);
    const result = await this.uploadService.uploadFile(file);
    if (result) {
      this.preview.set(result);
      this.uploaded.emit(result);
    }
  }

  clearPreview(): void {
    this.preview.set(null);
    this.selectedFileName.set(null);
  }
}
