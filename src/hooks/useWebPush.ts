import { useCallback, useEffect, useState } from 'react';
import { adminFetch } from '../utils/authSession';

export type WebPushRole = 'admin' | 'visitor';

interface UseWebPushOptions {
  role: WebPushRole;
  sessionId?: string | null;
  enabled?: boolean;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function getReadyServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }

  // Wait up to 4 seconds for VitePWA's registered Service Worker
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<ServiceWorkerRegistration>((resolve) =>
        window.setTimeout(() => resolve(existing), 3000)
      ),
    ]);
  }

  return await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 3500)),
  ]);
}

function serializeSubscription(sub: PushSubscription): {
  endpoint: string;
  keys: { p256dh: string; auth: string };
} | null {
  const json = sub.toJSON();
  const endpoint = json.endpoint || sub.endpoint;
  const p256dh = json.keys?.p256dh || '';
  const auth = json.keys?.auth || '';
  if (!endpoint || !p256dh || !auth) return null;
  return {
    endpoint,
    keys: { p256dh, auth },
  };
}

export function useWebPush({
  role,
  sessionId,
  enabled = true,
}: UseWebPushOptions) {
  const [isSupported, setIsSupported] = useState<boolean>(false);
  const [vapidConfigured, setVapidConfigured] = useState<boolean | null>(null);
  const [vapidPublicKey, setVapidPublicKey] = useState<string | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    () => {
      if (typeof window !== 'undefined' && 'Notification' in window) {
        return Notification.permission;
      }
      return 'unsupported';
    }
  );
  const [isSubscribed, setIsSubscribed] = useState<boolean>(false);
  const [isSubscribing, setIsSubscribing] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const storageFlagKey = `armazem_webpush_active_${role}_v1`;

  const syncSubscriptionToBackend = useCallback(
    async (sub: PushSubscription, targetSessionId?: string | null) => {
      const payload = serializeSubscription(sub);
      if (!payload) {
        throw new Error('Não foi possível ler as chaves da inscrição push.');
      }

      if (role === 'admin') {
        const res = await adminFetch('/api/push/subscribe/admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: payload }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(
            err.error || 'Falha ao salvar inscrição push do administrador.'
          );
        }
      } else {
        const cleanSession = (targetSessionId || '').trim();
        if (!cleanSession) return;
        const res = await fetch('/api/push/subscribe/visitor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: cleanSession,
            subscription: payload,
          }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(
            err.error || 'Falha ao ativar alertas push para sua conversa.'
          );
        }
      }
    },
    [role]
  );

  // Detect browser support, fetch VAPID public key, and check existing subscription
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    let active = true;

    const supported =
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window;
    setIsSupported(supported);
    if ('Notification' in window) {
      setPermission(Notification.permission);
    }

    async function hydratePushState() {
      try {
        const cfgRes = await fetch('/api/push/vapid-public-key');
        if (active && cfgRes.ok) {
          const cfg = (await cfgRes.json()) as {
            configured?: boolean;
            publicKey?: string | null;
          };
          setVapidConfigured(Boolean(cfg.configured && cfg.publicKey));
          setVapidPublicKey(cfg.publicKey || null);
        } else if (active) {
          setVapidConfigured(false);
        }
      } catch {
        if (active) setVapidConfigured(false);
      }

      if (!supported) return;

      try {
        const reg = await getReadyServiceWorkerRegistration();
        if (!active || !reg) return;
        const existingSub = await reg.pushManager.getSubscription();
        if (!active) return;

        if (existingSub && Notification.permission === 'granted') {
          let wasRegisteredForRole = false;
          try {
            wasRegisteredForRole =
              window.localStorage.getItem(storageFlagKey) === '1';
          } catch {
            // Ignore storage issues
          }

          if (wasRegisteredForRole) {
            setIsSubscribed(true);
            // Keep session_id synced when visitor changes session or refreshes
            if (role === 'visitor' && sessionId) {
              void syncSubscriptionToBackend(existingSub, sessionId).catch(
                () => {}
              );
            } else if (role === 'admin') {
              void syncSubscriptionToBackend(existingSub, null).catch(() => {});
            }
          }
        }
      } catch {
        // Silent fallback
      }
    }

    void hydratePushState();
    return () => {
      active = false;
    };
  }, [enabled, role, sessionId, storageFlagKey, syncSubscriptionToBackend]);

  const subscribe = useCallback(async (): Promise<boolean> => {
    if (typeof window === 'undefined') return false;
    setStatusMessage(null);

    if (
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !('Notification' in window)
    ) {
      setStatusMessage(
        'Este navegador não suporta notificações Web Push. No iPhone, instale o app na Tela de Início primeiro.'
      );
      return false;
    }

    setIsSubscribing(true);
    try {
      let currentKey = vapidPublicKey;
      if (!currentKey) {
        const cfgRes = await fetch('/api/push/vapid-public-key');
        if (cfgRes.ok) {
          const cfg = (await cfgRes.json()) as {
            configured?: boolean;
            publicKey?: string | null;
          };
          currentKey = cfg.publicKey || null;
          setVapidPublicKey(currentKey);
          setVapidConfigured(Boolean(cfg.configured && currentKey));
        }
      }

      if (!currentKey) {
        setStatusMessage(
          'Chaves VAPID ainda não configuradas no servidor (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).'
        );
        return false;
      }

      const perm =
        Notification.permission === 'granted'
          ? 'granted'
          : await Notification.requestPermission();
      setPermission(perm);

      if (perm !== 'granted') {
        setStatusMessage(
          'Permissão de notificações bloqueada no navegador. Libere nas configurações do site para ativar.'
        );
        return false;
      }

      const reg = await getReadyServiceWorkerRegistration();
      if (!reg) {
        setStatusMessage(
          'Service Worker do PWA ainda não está pronto. Recarregue a página e tente novamente.'
        );
        return false;
      }

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(currentKey),
        });
      }

      await syncSubscriptionToBackend(sub, sessionId);
      setIsSubscribed(true);
      try {
        window.localStorage.setItem(storageFlagKey, '1');
      } catch {
        // Ignore storage errors
      }
      return true;
    } catch (err: unknown) {
      setStatusMessage(
        err instanceof Error
          ? err.message
          : 'Não foi possível ativar as notificações push neste aparelho.'
      );
      return false;
    } finally {
      setIsSubscribing(false);
    }
  }, [sessionId, storageFlagKey, syncSubscriptionToBackend, vapidPublicKey]);

  return {
    isSupported,
    vapidConfigured,
    permission,
    isSubscribed,
    isSubscribing,
    statusMessage,
    clearStatusMessage: () => setStatusMessage(null),
    subscribe,
  };
}
