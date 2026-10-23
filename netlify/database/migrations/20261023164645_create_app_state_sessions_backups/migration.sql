CREATE TABLE "app_state" (
	"id" text PRIMARY KEY,
	"data" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_snapshots" (
	"filename" text PRIMARY KEY,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"username" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"expires_at" bigint NOT NULL
);
