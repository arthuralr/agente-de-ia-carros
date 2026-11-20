import { createRequire } from 'node:module';
import { pool } from '../db/pool';

export type PushSubscriptionRole = 'admin' | 'visitor';

export interface PushNotificationPayload {
  title: string;
  body: string;
  url: string;
  tag?: string;
  icon?: string;
  badge?: string;
}

export interface UpsertPushSubscriptionInput {
  role: PushSubscriptionRole;
  sessionId?: string | null;
  endpoint: string;
  p256dh: string;
  auth: string;
}

interface DbPushSubscriptionRow {
  id: number;
  role: PushSubscriptionRole;
  session_id: string | null;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: Date;
}

interface WebPushClientLike {
  setVapidDetails: (subject: string, publicKey: string, privateKey: string) => void;
  sendNotification: (
    subscription: {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    },
    payload?: string,
    options?: { TTL?: number }
  ) => Promise<unknown>;
}

type WebPushModuleShape =
  | (Partial<WebPushClientLike> & { default?: Partial<WebPushClientLike> })
  | undefined;

let cachedWebPushClient: WebPushClientLike | null = null;
let lastConfiguredSignature = '';

function isPlausibleVapidKey(value: string): boolean {
  if (!value || value.length < 20) return false;
  if (/^(MY_|YOUR_|CHANGE_ME|PLACEHOLDER)/i.test(value)) return false;
  return /^[A-Za-z0-9_-]+=*$/.test(value);
}

function getVapidConfig(): {
  publicKey: string;
  privateKey: string;
  subject: string;
} | null {
  try {
    const publicKey = (process.env.VAPID_PUBLIC_KEY || '').trim();
    const privateKey = (process.env.VAPID_PRIVATE_KEY || '').trim();
    const rawSubject = (process.env.VAPID_SUBJECT || '').trim();
    const subject =
      rawSubject && (/^(mailto:|https?:\/\/)/i.test(rawSubject))
        ? rawSubject
        : 'mailto:contato@armazemdocarro.com.br';

    if (!isPlausibleVapidKey(publicKey) || !isPlausibleVapidKey(privateKey)) {
      return null;
    }
    return { publicKey, privateKey, subject };
  } catch {
    return null;
  }
}

function normalizeWebPushExport(loaded: WebPushModuleShape): WebPushClientLike | null {
  const candidate = loaded?.default ?? loaded;
  if (
    candidate &&
    typeof candidate.setVapidDetails === 'function' &&
    typeof candidate.sendNotification === 'function'
  ) {
    return candidate as WebPushClientLike;
  }
  return null;
}

/**
 * Lazily loads `web-push` exclusively when sending a push notification
 * (never during module startup). Tries `createRequire(import.meta.url)` first
 * and falls back to dynamic `await import('web-push')` (for runtimes like Node 20
 * where `require()` on pure-ESM `web-push@4` throws ERR_REQUIRE_ESM), always
 * normalizing `loaded?.default ?? loaded`.
 */
async function loadWebPushClient(): Promise<WebPushClientLike | null> {
  try {
    const require = createRequire(import.meta.url);
    const loaded = require('web-push') as WebPushModuleShape;
    const normalized = normalizeWebPushExport(loaded);
    if (normalized) return normalized;
  } catch {
    // Fallback to native dynamic ESM import
  }

  try {
    const loaded = (await import('web-push')) as unknown as WebPushModuleShape;
    const normalized = normalizeWebPushExport(loaded);
    if (normalized) return normalized;
  } catch (err) {
    console.warn('[WebPush] Falha silenciosa ao importar web-push:', err);
  }

  return null;
}

async function getConfiguredWebPushClient(): Promise<WebPushClientLike | null> {
  const cfg = getVapidConfig();
  if (!cfg) return null;

  try {
    if (!cachedWebPushClient) {
      const client = await loadWebPushClient();
      if (!client) {
        console.warn('[WebPush] Módulo web-push indisponível neste runtime.');
        return null;
      }
      cachedWebPushClient = client;
    }

    const sig = `${cfg.subject}|${cfg.publicKey}|${cfg.privateKey}`;
    if (lastConfiguredSignature !== sig) {
      cachedWebPushClient.setVapidDetails(
        cfg.subject,
        cfg.publicKey,
        cfg.privateKey
      );
      lastConfiguredSignature = sig;
    }

    return cachedWebPushClient;
  } catch (err) {
    console.warn('[WebPush] Falha silenciosa ao configurar web-push:', err);
    lastConfiguredSignature = '';
    return null;
  }
}

export function getPublicVapidKey(): string | null {
  const cfg = getVapidConfig();
  return cfg ? cfg.publicKey : null;
}

export function isWebPushConfigured(): boolean {
  return Boolean(getVapidConfig());
}

export async function upsertPushSubscription(
  input: UpsertPushSubscriptionInput
): Promise<DbPushSubscriptionRow> {
  const cleanSessionId =
    input.role === 'admin'
      ? null
      : (input.sessionId || '').trim().slice(0, 128) || null;

  const result = await pool.query<DbPushSubscriptionRow>(
    `INSERT INTO push_subscriptions (role, session_id, endpoint, p256dh, auth, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (endpoint)
     DO UPDATE SET
       role = EXCLUDED.role,
       session_id = EXCLUDED.session_id,
       p256dh = EXCLUDED.p256dh,
       auth = EXCLUDED.auth,
       created_at = NOW()
     RETURNING id, role, session_id, endpoint, p256dh, auth, created_at`,
    [input.role, cleanSessionId, input.endpoint, input.p256dh, input.auth]
  );

  return result.rows[0];
}

export async function sendPushToSubscribers(options: {
  role: PushSubscriptionRole;
  sessionId?: string | null;
  payload: PushNotificationPayload;
}): Promise<{ configured: boolean; sent: number; removed: number }> {
  try {
    const webpush = await getConfiguredWebPushClient();
    if (!webpush) {
      return { configured: false, sent: 0, removed: 0 };
    }

    let rows: DbPushSubscriptionRow[] = [];
    if (options.role === 'admin') {
      const res = await pool.query<DbPushSubscriptionRow>(
        `SELECT id, role, session_id, endpoint, p256dh, auth, created_at
         FROM push_subscriptions
         WHERE role = 'admin'`
      );
      rows = res.rows;
    } else if (options.sessionId && options.sessionId.trim()) {
      const res = await pool.query<DbPushSubscriptionRow>(
        `SELECT id, role, session_id, endpoint, p256dh, auth, created_at
         FROM push_subscriptions
         WHERE role = 'visitor' AND session_id = $1`,
        [options.sessionId.trim()]
      );
      rows = res.rows;
    } else {
      const res = await pool.query<DbPushSubscriptionRow>(
        `SELECT id, role, session_id, endpoint, p256dh, auth, created_at
         FROM push_subscriptions
         WHERE role = 'visitor'`
      );
      rows = res.rows;
    }

    if (rows.length === 0) {
      return { configured: true, sent: 0, removed: 0 };
    }

    const targetUrl =
      options.payload.url || (options.role === 'admin' ? '/admin' : '/chat');

    const serializedPayload = JSON.stringify({
      title: options.payload.title.slice(0, 120),
      body: options.payload.body.slice(0, 220),
      icon: options.payload.icon || '/pwa-192x192.png',
      badge: options.payload.badge || '/pwa-192x192.png',
      tag: options.payload.tag || `armazem-${options.role}`,
      url: targetUrl,
      data: {
        url: targetUrl,
      },
    });

    let sent = 0;
    let removed = 0;

    await Promise.allSettled(
      rows.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: {
                p256dh: sub.p256dh,
                auth: sub.auth,
              },
            },
            serializedPayload,
            { TTL: 60 * 60 }
          );
          sent += 1;
        } catch (err: unknown) {
          const statusCode =
            typeof err === 'object' &&
            err !== null &&
            'statusCode' in err &&
            typeof (err as { statusCode?: unknown }).statusCode === 'number'
              ? (err as { statusCode: number }).statusCode
              : 0;

          // Automatically prune expired/revoked endpoints (410 Gone / 404 Not Found)
          if (statusCode === 410 || statusCode === 404) {
            try {
              await pool.query(
                'DELETE FROM push_subscriptions WHERE id = $1',
                [sub.id]
              );
              removed += 1;
            } catch {
              // Ignore cleanup errors
            }
          }
        }
      })
    );

    return { configured: true, sent, removed };
  } catch (err) {
    console.warn('[WebPush Dispatch Error]', err);
    return { configured: isWebPushConfigured(), sent: 0, removed: 0 };
  }
}

export function triggerAdminPushInBackground(
  payload: PushNotificationPayload
): void {
  if (!isWebPushConfigured()) return;
  void sendPushToSubscribers({
    role: 'admin',
    payload,
  }).catch(() => {});
}

export function triggerVisitorSessionPushInBackground(
  sessionId: string,
  payload: PushNotificationPayload
): void {
  if (!isWebPushConfigured() || !sessionId.trim()) return;
  void sendPushToSubscribers({
    role: 'visitor',
    sessionId: sessionId.trim(),
    payload,
  }).catch(() => {});
}

export function triggerAllVisitorsPushInBackground(
  payload: PushNotificationPayload
): void {
  if (!isWebPushConfigured()) return;
  void sendPushToSubscribers({
    role: 'visitor',
    payload,
  }).catch(() => {});
}
