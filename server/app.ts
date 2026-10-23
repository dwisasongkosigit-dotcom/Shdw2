import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { apiRouter } from './routes.ts';
import { runWithDb, loadDatabase, isDbDirty, persistDatabase } from './db.ts';

// Load the dataset for each API request and persist any changes before the JSON response is sent
function databaseContext(_req: Request, res: Response, next: NextFunction): void {
  runWithDb(() => {
    const originalJson = res.json.bind(res);
    res.json = (body?: any) => {
      if (!isDbDirty()) return originalJson(body);
      persistDatabase()
        .then(() => originalJson(body))
        .catch((err: any) => {
          console.error('[DB] Gagal menyimpan perubahan:', err);
          const isConflict = err?.message?.includes('diubah oleh pengguna lain');
          res.status(isConflict ? 409 : 500);
          originalJson({ error: err?.message || 'Gagal menyimpan data ke database.' });
        });
      return res;
    };

    loadDatabase()
      .then(() => next())
      .catch((err) => {
        console.error('[DB] Gagal memuat database:', err);
        res.status(503);
        originalJson({ error: 'Database tidak dapat diakses saat ini. Silakan coba beberapa saat lagi.' });
      });
  });
}

export function createApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: '15mb' }));
  app.use(express.urlencoded({ extended: true, limit: '15mb' }));

  // Requests reaching the Netlify Function directly keep the function prefix; normalize to /api
  app.use((req, _res, next) => {
    req.url = req.url.replace(/^\/\.netlify\/functions\/api(?=\/|$)/, '/api');
    next();
  });

  // Mount API endpoints
  app.use('/api', databaseContext, apiRouter);

  // API Error handling middleware
  app.use('/api', (err: any, _req: Request, res: Response, _next: NextFunction) => {
    const isForbidden =
      err.message?.includes('HAK AKSES') ||
      err.message?.includes('Akses ditolak') ||
      err.message?.includes('tidak memiliki izin');
    const statusCode = isForbidden ? 403 : 400;
    res.status(statusCode).json({ error: err.message || 'Terjadi kesalahan pada server.' });
  });

  return app;
}
