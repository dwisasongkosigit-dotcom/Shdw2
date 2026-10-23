import type { Request, Response } from 'express';
import { createApp } from '../server/app.ts';

const app = createApp();

export default function handler(req: Request, res: Response) {
  const rewrittenUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const originalPath = rewrittenUrl.searchParams.get('__path');

  if (originalPath?.startsWith('/api/')) {
    rewrittenUrl.searchParams.delete('__path');
    req.url = `${originalPath}${rewrittenUrl.search}`;
  }

  return app(req, res);
}
