import type { Request, Response } from 'express';
import app, { ensureDatabaseInitialized } from './_server.mjs';

export default async function handler(req: Request, res: Response) {
  await ensureDatabaseInitialized();
  return app(req, res);
}
