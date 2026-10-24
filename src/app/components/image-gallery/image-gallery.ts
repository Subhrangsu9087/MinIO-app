import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ImageService, ImageObject } from '../../services/image.service';

@Component({
  selector: 'app-image-gallery',
  imports: [DatePipe],
  templateUrl: './image-gallery.html',
  styleUrl: './image-gallery.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImageGallery implements OnInit {
  protected readonly imageService = inject(ImageService);

  // Search & filter state
  readonly searchQuery = signal('');

  // Selected image for modal preview
  readonly selectedImage = signal<ImageObject | null>(null);

  // Copied indicator
  readonly copiedUrl = signal<string | null>(null);

  // Filtered images signal
  readonly filteredImages = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const list = this.imageService.images();
    if (!q) return list;
    return list.filter((img) =>
      img.originalName.toLowerCase().includes(q),
    );
  });

  // Total storage used
  readonly totalStorageFormatted = computed(() => {
    const totalBytes = this.imageService.images().reduce((acc, img) => acc + (img.size || 0), 0);
    return this.formatSize(totalBytes);
  });

  ngOnInit(): void {
    this.imageService.loadImages();
  }

  reload(): void {
    this.imageService.loadImages();
  }

  onSearch(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.searchQuery.set(input.value);
  }

  clearSearch(): void {
    this.searchQuery.set('');
  }

  openPreview(image: ImageObject): void {
    this.selectedImage.set(image);
  }

  closePreview(): void {
    this.selectedImage.set(null);
  }

  async copyLink(url: string, event?: Event): Promise<void> {
    if (event) {
      event.stopPropagation();
    }
    try {
      await navigator.clipboard.writeText(url);
      this.copiedUrl.set(url);
      setTimeout(() => this.copiedUrl.set(null), 2000);
    } catch {
      // fallback
    }
  }

  formatSize(bytes: number): string {
    if (!bytes || bytes === 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
