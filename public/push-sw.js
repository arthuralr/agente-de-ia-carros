// Native Web Push listener loaded by the PWA Service Worker (Workbox importScripts)

self.addEventListener('push', (event) => {
  let payload = {
    title: 'Armazém do Carro',
    body: 'Você recebeu uma nova atualização no atendimento.',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    url: '/chat',
    tag: 'armazem-push',
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      payload = {
        title: parsed.title || payload.title,
        body: parsed.body || payload.body,
        icon: parsed.icon || payload.icon,
        badge: parsed.badge || payload.badge,
        url: parsed.url || (parsed.data && parsed.data.url) || payload.url,
        tag: parsed.tag || payload.tag,
      };
    } catch {
      const text = event.data.text();
      if (text) {
        payload.body = text;
      }
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: payload.icon,
      badge: payload.badge,
      tag: payload.tag,
      renotify: true,
      vibrate: [120, 60, 120],
      data: {
        url: payload.url,
      },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const rawUrl =
    (event.notification &&
      event.notification.data &&
      event.notification.data.url) ||
    '/';
  const targetUrl = new URL(rawUrl, self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if (client.url === targetUrl && 'focus' in client) {
            return client.focus();
          }
        }
        for (const client of windowClients) {
          if (
            client.url.startsWith(self.location.origin) &&
            'focus' in client
          ) {
            if ('navigate' in client) {
              return client.navigate(targetUrl).then((navigated) => {
                return navigated ? navigated.focus() : client.focus();
              });
            }
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return undefined;
      })
  );
});
