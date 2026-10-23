import { pgTable, text, integer, jsonb, timestamp, bigint } from 'drizzle-orm/pg-core';

// Single-document application state (the full TMM/BMA dataset), guarded by an optimistic version counter
export const appState = pgTable('app_state', {
  id: text().primaryKey(),
  data: jsonb().notNull(),
  version: integer().notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Login sessions (persisted so they survive across serverless function instances)
export const sessions = pgTable('sessions', {
  token: text().primaryKey(),
  userId: text('user_id').notNull(),
  username: text().notNull(),
  name: text().notNull(),
  role: text().notNull(),
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
});

// Backup snapshots of the full dataset
export const backupSnapshots = pgTable('backup_snapshots', {
  filename: text().primaryKey(),
  data: jsonb().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
