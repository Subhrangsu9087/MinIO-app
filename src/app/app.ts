import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ImageUpload } from './components/image-upload/image-upload';
import { ImageGallery } from './components/image-gallery/image-gallery';
import { ImageService } from './services/image.service';
import { UploadedImage } from './services/upload.service';

@Component({
  selector: 'app-root',
  imports: [ImageUpload, ImageGallery],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  private readonly imageService = inject(ImageService);

  onUploaded(_image: UploadedImage): void {
    // Refresh gallery after a new upload
    this.imageService.loadImages();
  }
}
