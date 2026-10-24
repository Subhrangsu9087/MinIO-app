CREATE TABLE "images" (
	"id" serial PRIMARY KEY,
	"object_name" text NOT NULL UNIQUE,
	"original_name" text NOT NULL,
	"size" integer NOT NULL,
	"mime_type" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY,
	"name" text NOT NULL,
	"age" integer NOT NULL,
	"email" text NOT NULL UNIQUE
);
