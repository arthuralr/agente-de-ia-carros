import webpush from 'web-push';
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

let lastConfiguredSignature = '';

function getVapidConfig(): {
  publicKey: string;
  privateKey: string;
  subject: string;
} | null {
  const publicKey = (process.env.VAPID_PUBLIC_KEY || '').trim();
  const privateKey = (process.env.VAPID_PRIVATE_KEY || '').trim();
  const subject =
    (process.env.VAPID_SUBJECT || '').trim() ||
    'mailto:contato@armazemdocarro.com.br';

  if (!publicKey || !privateKey) {
    return null;
  }
  return { publicKey, privateKey, subject };
}

function ensureWebPushConfigured(): boolean {
  const cfg = getVapidConfig();
  if (!cfg) return false;
  const sig = `${cfg.subject}|${cfg.publicKey}|${cfg.privateKey}`;
  if (lastConfiguredSignature !== sig) {
    try {
      webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
      lastConfiguredSignature = sig;
    } catch (err) {
      console.error('[WebPush] Invalid VAPID configuration:', err);
      return false;
    }
  }
  return true;
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
    if (!ensureWebPushConfigured()) {
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

    const serializedPayload = JSON.stringify({
      title: options.payload.title.slice(0, 120),
      body: options.payload.body.slice(0, 220),
      icon: options.payload.icon || '/pwa-192x192.png',
      badge: options.payload.badge || '/pwa-192x192.png',
      tag: options.payload.tag || `armazem-${options.role}`,
      url: options.payload.url || (options.role === 'admin' ? '/admin' : '/chat'),
      data: {
        url: options.payload.url || (options.role === 'admin' ? '/admin' : '/chat'),
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
    console.error('[WebPush Dispatch Error]', err);
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
  });
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
  });
}

export function triggerAllVisitorsPushInBackground(
  payload: PushNotificationPayload
): void {
  if (!isWebPushConfigured()) return;
  void sendPushToSubscribers({
    role: 'visitor',
    payload,
  });
}
