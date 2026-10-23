import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { Client } from 'minio';
import { join } from 'node:path';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

// --- MinIO client setup ---
const minioClient = new Client({
  endPoint: 'localhost',
  port: 9000,
  useSSL: false,
  accessKey: 'devadmin',
  secretKey: 'devpassword123',
});

const BUCKET = 'images';

app.use(express.json());

// --- API routes (must come before the Angular catch-all) ---
app.get('/api/upload-url', async (req, res) => {
  try {
    const filename = String(req.query['filename'] ?? 'file');
    const objectName = `uploads/${Date.now()}-${filename}`;
    const url = await minioClient.presignedPutObject(BUCKET, objectName, 300); // 5 min
    res.json({ url, objectName });
  } catch (err) {
    res.status(500).json({ error: 'Could not generate upload URL' });
  }
});

// 
app.get('/api/image-url', async (req, res) => {
  try {
    const objectName = String(req.query['objectName'] ?? '');
    const url = await minioClient.presignedGetObject(BUCKET, objectName, 3600); // 1 hr
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: 'Could not generate image URL' });
  }
});

// Lists objects straight from the MinIO bucket (no DB involved yet)
app.get('/api/images', async (req, res) => {
  try {
    const objects: { objectName: string; size: number; lastModified: Date }[] = [];
    const stream = minioClient.listObjectsV2(BUCKET, 'uploads/', true);

    stream.on('data', (obj) => {
      if (obj.name) {
        objects.push({
          objectName: obj.name,
          size: obj.size,
          lastModified: obj.lastModified,
        });
      }
    });

    stream.on('error', (err) => {
      res.status(500).json({ error: 'Could not list images' });
    });

    stream.on('end', () => {
      // Newest first
      objects.sort(
        (a, b) =>
          new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime(),
      );
      res.json(objects);
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not list images' });
  }
});

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
