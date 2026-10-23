import serverless from 'serverless-http';
import { createApp } from '../server/app.ts';

const handler = serverless(createApp(), {
  binary: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'],
});

export default handler;
