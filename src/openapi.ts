import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  ConfirmUploadSchema,
  CreateUserSchema,
  ImageUrlQuerySchema,
  RequestUploadSchema,
  UserSchema,
  ImageRecordSchema,
} from './db/schema';

// Extend Zod so it knows about OpenAPI metadata
extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

// 1. Phase 1: Request presigned upload URL
registry.registerPath({
  method: 'post',
  path: '/api/uploads/request',
  summary: 'Phase 1: Request presigned upload URL',
  description:
    'Validates file size (max 10MB) and MIME type. Inserts a pending record into PostgreSQL and generates a presigned PUT URL for MinIO.',
  tags: ['Uploads'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: RequestUploadSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Presigned upload URL created',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: z.object({
              uploadUrl: z.string(),
              objectName: z.string(),
              imageId: z.number(),
            }),
          }),
        },
      },
    },
    400: { description: 'Validation error' },
  },
});

// 2. Phase 2: Confirm upload completion
registry.registerPath({
  method: 'post',
  path: '/api/uploads/confirm',
  summary: 'Phase 2: Confirm upload completion',
  description:
    'Transitions the database row from status="pending" to status="ready" once binary finishes streaming to MinIO.',
  tags: ['Uploads'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: ConfirmUploadSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Upload confirmed and ready',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: ImageRecordSchema.extend({
              previewUrl: z.string(),
            }),
          }),
        },
      },
    },
    404: { description: 'No pending upload found for this objectName' },
  },
});

// 3. List images
registry.registerPath({
  method: 'get',
  path: '/api/images',
  summary: 'List confirmed images',
  description:
    'Fetches all confirmed images from PostgreSQL with generated presigned preview URLs in a single batch.',
  tags: ['Images'],
  responses: {
    200: {
      description: 'List of confirmed images',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: z.array(
              ImageRecordSchema.omit({ status: true }).extend({
                previewUrl: z.string(),
              }),
            ),
          }),
        },
      },
    },
  },
});

// 4. Delete image
registry.registerPath({
  method: 'delete',
  path: '/api/images',
  summary: 'Delete image',
  description:
    'Removes the object from MinIO storage and deletes the corresponding record from PostgreSQL.',
  tags: ['Images'],
  request: {
    query: ImageUrlQuerySchema,
  },
  responses: {
    200: {
      description: 'Image deleted successfully',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: z.object({
              objectName: z.string(),
            }),
          }),
        },
      },
    },
    502: { description: 'Storage deletion error' },
  },
});

// 5. Single Image URL
registry.registerPath({
  method: 'get',
  path: '/api/image-url',
  summary: 'Generate single presigned read URL',
  tags: ['Images'],
  request: {
    query: ImageUrlQuerySchema,
  },
  responses: {
    200: {
      description: 'Presigned read URL generated',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: z.object({
              url: z.string(),
            }),
          }),
        },
      },
    },
  },
});

// 6. Cleanup stale uploads
registry.registerPath({
  method: 'post',
  path: '/api/images/cleanup',
  summary: 'Clean up stale pending uploads',
  description:
    'Purges unconfirmed/orphan uploads older than 24 hours from both MinIO storage and PostgreSQL.',
  tags: ['Images'],
  responses: {
    200: {
      description: 'Cleanup completed',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: z.object({
              purged: z.number(),
            }),
          }),
        },
      },
    },
  },
});

// 7. Users
registry.registerPath({
  method: 'get',
  path: '/api/users',
  summary: 'List users',
  tags: ['Users'],
  responses: {
    200: {
      description: 'List of users',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: z.array(UserSchema),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/users',
  summary: 'Create user',
  tags: ['Users'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateUserSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'User created',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: UserSchema,
          }),
        },
      },
    },
  },
});

/**
 * Automatically compiles the OpenAPI 3.1.0 document from registered Zod schemas.
 */
export function generateOpenApiDocument() {
  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'MinIO App & PostgreSQL API',
      version: '1.0.0',
      description:
        'Auto-generated OpenAPI Documentation directly from Zod schemas. Whenever you update or add a Zod schema, the OpenAPI spec and Scalar Playground update automatically.',
    },
    servers: [
      {
        url: 'http://localhost:4000',
        description: 'Local Express Server',
      },
    ],
  });
}

export const openApiSpec = generateOpenApiDocument();

