import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express, { Request, Response } from 'express';
import { Client } from 'minio';
import { join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { desc, eq, and, lt } from 'drizzle-orm';
import { db } from './db';
import {
  ConfirmUploadSchema,
  CreateUserSchema,
  ImageUrlQuerySchema,
  RequestUploadSchema,
  imagesTable,
  usersTable,
} from './db/schema';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

// --- Standard Response Helpers ---
function ok<T>(res: Response, data: T, statusCode = 200): void {
  res.status(statusCode).json({ success: true, data });
}

function fail(
  res: Response,
  statusCode: number,
  message: string,
  details?: unknown,
): void {
  res.status(statusCode).json({ success: false, error: { message, details } });
}

// --- MinIO client setup ---
const minioClient = new Client({
  endPoint: process.env['MINIO_ENDPOINT'] ?? 'localhost',
  port: Number(process.env['MINIO_PORT'] ?? 9000),
  useSSL: process.env['MINIO_USE_SSL'] === 'true',
  accessKey: process.env['MINIO_ACCESS_KEY'] ?? '',
  secretKey: process.env['MINIO_SECRET_KEY'] ?? '',
});
const BUCKET = 'images';

app.use(express.json());

// --- API routes ---

/**
 * Phase 1 of 2: Request a presigned upload URL.
 *
 * Fix #2 — Validates size & mimeType before issuing the URL.
 * Fix #3 — Uses crypto.randomUUID() for collision-proof object keys.
 * Fix #4 — Creates a DB row with status='pending'.
 */
app.post('/api/uploads/request', async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = RequestUploadSchema.safeParse(req.body);
    if (!parsed.success) {
      fail(res, 400, 'Invalid upload request', parsed.error.flatten());
      return;
    }

    const { filename, size, mimeType } = parsed.data;

    // Fix #3: UUID-based, URL-safe object key
    const ext = extname(filename).toLowerCase() || '.bin';
    const objectName = `uploads/${randomUUID()}${ext}`;

    // Fix #4: Insert a 'pending' record into the DB
    const inserted = await db
      .insert(imagesTable)
      .values({
        objectName,
        originalName: filename,
        size,
        mimeType,
        status: 'pending',
      })
      .returning();

    // Generate presigned PUT URL (5 min expiry)
    const url = await minioClient.presignedPutObject(BUCKET, objectName, 300);

    ok(res, {
      uploadUrl: url,
      objectName,
      imageId: inserted[0].id,
    }, 201);
  } catch (err) {
    console.error('Error creating upload request:', err);
    fail(res, 500, 'Could not create upload request');
  }
});

/**
 * Phase 2 of 2: Confirm that the binary upload completed.
 *
 * Fix #4 — Transitions the DB row from 'pending' → 'ready'.
 * Returns the complete image record with a presigned preview URL.
 */
app.post('/api/uploads/confirm', async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = ConfirmUploadSchema.safeParse(req.body);
    if (!parsed.success) {
      fail(res, 400, 'Invalid confirmation request', parsed.error.flatten());
      return;
    }

    const { objectName } = parsed.data;

    // Verify the row exists and is still pending
    const rows = await db
      .select()
      .from(imagesTable)
      .where(and(eq(imagesTable.objectName, objectName), eq(imagesTable.status, 'pending')));

    if (rows.length === 0) {
      fail(res, 404, 'No pending upload found for this objectName');
      return;
    }

    // Update to 'ready'
    const updated = await db
      .update(imagesTable)
      .set({ status: 'ready' })
      .where(eq(imagesTable.objectName, objectName))
      .returning();

    // Generate a presigned read URL so the client can display immediately
    const previewUrl = await minioClient.presignedGetObject(BUCKET, objectName, 3600);

    ok(res, { ...updated[0], previewUrl });
  } catch (err) {
    console.error('Error confirming upload:', err);
    fail(res, 500, 'Could not confirm upload');
  }
});

/**
 * List images from DB.
 *
 * Fix #1 — Returns presigned preview URLs inline (no N+1 requests).
 * Fix #5 — DB is the single source of truth; only 'ready' images are returned.
 */
app.get('/api/images', async (_req: Request, res: Response): Promise<void> => {
  try {
    // Fix #5: Only query the DB, only return confirmed images
    const dbImages = await db
      .select()
      .from(imagesTable)
      .where(eq(imagesTable.status, 'ready'))
      .orderBy(desc(imagesTable.createdAt));

    // Fix #1: Generate presigned URLs server-side in a single response
    const imagesWithUrls = await Promise.all(
      dbImages.map(async (img) => {
        const previewUrl = await minioClient.presignedGetObject(BUCKET, img.objectName, 3600);
        return {
          id: img.id,
          objectName: img.objectName,
          originalName: img.originalName,
          size: img.size,
          mimeType: img.mimeType,
          createdAt: img.createdAt,
          previewUrl,
        };
      }),
    );

    ok(res, imagesWithUrls);
  } catch (err) {
    console.error('Failed to list images:', err);
    fail(res, 500, 'Could not list images');
  }
});

/**
 * Get a single presigned read URL (kept for direct-link sharing use cases).
 */
app.get('/api/image-url', async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = ImageUrlQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      fail(res, 400, 'Invalid query parameters', parsed.error.flatten());
      return;
    }

    const { objectName } = parsed.data;
    const url = await minioClient.presignedGetObject(BUCKET, objectName, 3600);
    ok(res, { url });
  } catch (err) {
    console.error('Error generating image URL:', err);
    fail(res, 500, 'Could not generate image URL');
  }
});

/**
 * Delete an image — removes from MinIO first, then from the DB.
 */
app.delete('/api/images', async (req: Request, res: Response): Promise<void> => {
  const parsed = ImageUrlQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    fail(res, 400, 'Invalid query parameters', parsed.error.flatten());
    return;
  }
  const { objectName } = parsed.data;

  try {
    await minioClient.removeObject(BUCKET, objectName);
  } catch (minioErr) {
    console.error('Could not remove object from MinIO:', minioErr);
    fail(res, 502, 'Could not delete file from storage');
    return;
  }

  try {
    await db.delete(imagesTable).where(eq(imagesTable.objectName, objectName));
    ok(res, { objectName });
  } catch (dbErr) {
    console.error('Failed to delete image record from DB:', dbErr);
    fail(res, 500, 'Could not delete image from database');
  }
});

/**
 * Cleanup: Purge stale 'pending' uploads older than 24 hours.
 *
 * Fix #4 — Prevents orphan files from accumulating.
 * Call this from a cron job or on-demand via POST /api/images/cleanup.
 */
app.post('/api/images/cleanup', async (_req: Request, res: Response): Promise<void> => {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago

    const staleRows = await db
      .select({ objectName: imagesTable.objectName })
      .from(imagesTable)
      .where(and(eq(imagesTable.status, 'pending'), lt(imagesTable.createdAt, cutoff)));

    let removedCount = 0;
    for (const row of staleRows) {
      try {
        await minioClient.removeObject(BUCKET, row.objectName);
      } catch {
        // Object may already be gone — that's fine
      }
      removedCount++;
    }

    // Delete all stale DB rows in one query
    if (staleRows.length > 0) {
      await db
        .delete(imagesTable)
        .where(and(eq(imagesTable.status, 'pending'), lt(imagesTable.createdAt, cutoff)));
    }

    ok(res, { purged: removedCount });
  } catch (err) {
    console.error('Cleanup failed:', err);
    fail(res, 500, 'Could not run cleanup');
  }
});

// --- Users endpoints ---
app.get('/api/users', async (_req: Request, res: Response): Promise<void> => {
  try {
    const users = await db.select().from(usersTable);
    ok(res, users);
  } catch (err) {
    console.error('Failed to list users:', err);
    fail(res, 500, 'Could not retrieve users');
  }
});

app.post('/api/users', async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = CreateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      fail(res, 400, 'Invalid request body', parsed.error.flatten());
      return;
    }

    const inserted = await db.insert(usersTable).values(parsed.data).returning();
    ok(res, inserted[0], 201);
  } catch (err) {
    console.error('Failed to create user:', err);
    fail(res, 500, 'Could not create user');
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
