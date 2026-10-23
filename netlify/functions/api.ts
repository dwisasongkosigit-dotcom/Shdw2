import serverless from 'serverless-http';
import { createApp } from '../../server/app.ts';

// Express API served as a Netlify Function; /api/* is routed here via netlify.toml
export const handler = serverless(createApp(), {
  binary: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'],
});
