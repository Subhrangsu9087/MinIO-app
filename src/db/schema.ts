import { integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { z } from 'zod';

// --- Allowed MIME types & upload limits ---
export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
] as const;

/** Max file size: 10 MB */
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

// --- Drizzle Tables ---

export const usersTable = pgTable('users', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  age: integer('age').notNull(),
  email: text('email').notNull().unique(),
});

export const imagesTable = pgTable('images', {
  id: serial('id').primaryKey(),
  objectName: text('object_name').notNull().unique(),
  originalName: text('original_name').notNull(),
  size: integer('size').notNull(),
  mimeType: text('mime_type'),
  status: text('status').notNull().default('pending'), // 'pending' | 'ready'
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// --- Zod Schemas ---

export const UserSchema = z.object({
  id: z.number().int(),
  name: z.string().min(1, 'Name is required'),
  age: z.number().int().min(0, 'Age must be positive'),
  email: z.string().email('Invalid email address'),
});

export const CreateUserSchema = UserSchema.omit({ id: true });
export type User = z.infer<typeof UserSchema>;
export type NewUser = z.infer<typeof CreateUserSchema>;

export const ImageRecordSchema = z.object({
  id: z.number().int(),
  objectName: z.string().min(1),
  originalName: z.string().min(1),
  size: z.number().int().nonnegative(),
  mimeType: z.string().nullable().optional(),
  status: z.enum(['pending', 'ready']),
  createdAt: z.coerce.date(),
});

export type ImageRecord = z.infer<typeof ImageRecordSchema>;

// Fix #2: Pre-upload validation — client sends filename, size, mimeType
export const RequestUploadSchema = z.object({
  filename: z.string().min(1, 'Filename is required'),
  size: z.number().int().positive('File size must be positive').max(MAX_FILE_SIZE, `File size must not exceed ${MAX_FILE_SIZE / 1024 / 1024} MB`),
  mimeType: z.enum(ALLOWED_MIME_TYPES, {
    message: `Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`,
  }),
});

// Fix #4: Confirm upload — client sends objectName after binary upload
export const ConfirmUploadSchema = z.object({
  objectName: z.string().min(1, 'objectName is required'),
});

export const ImageUrlQuerySchema = z.object({
  objectName: z.string().min(1, 'objectName is required'),
});
