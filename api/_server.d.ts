import type { Express } from 'express';

declare const app: Express;
export function ensureDatabaseInitialized(): Promise<void>;
export default app;
