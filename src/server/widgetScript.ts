/**
 * Generates the self-contained, zero-dependency external floating widget script (/widget.js)
 * and a lightweight static verification page (/demo-site-externo).
 */

export function buildExternalWidgetScript(defaultOrigin: string): string {
  const safeOriginJson = JSON.stringify(defaultOrigin.replace(/\/+$/, ''));

  return `(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__armazemAgentWidgetLoaded) return;
  window.__armazemAgentWidgetLoaded = true;

  var scriptEl = document.currentScript || (function () {
    var scripts = document.querySelectorAll('script[src*="widget.js"]');
    return scripts[scripts.length - 1] || null;
  })();

  var resolvedOrigin = ${safeOriginJson};
  try {
    if (scriptEl && scriptEl.src) {
      resolvedOrigin = new URL(scriptEl.src, window.location.href).origin;
    }
  } catch (e) {}

  var storeSlug = (scriptEl && scriptEl.getAttribute('data-loja')) || 'armazem-do-carro';
  var attrVehicle = (scriptEl && scriptEl.getAttribute('data-veiculo')) || '';
  var attrPosition = (scriptEl && scriptEl.getAttribute('data-posicao')) || '';
  var attrLabel = (scriptEl && scriptEl.getAttribute('data-rotulo')) || '';

  // Never render on the host app's own /chat page
  try {
    if (window.location.origin === resolvedOrigin && /^\\/chat(\\/|$)/i.test(window.location.pathname)) {
      return;
    }
  } catch (e) {}

  var configUrl =
    resolvedOrigin +
    '/api/public/widget-config?loja=' + encodeURIComponent(storeSlug) +
    '&origin=' + encodeURIComponent(window.location.origin) +
    '&pageUrl=' + encodeURIComponent(window.location.href) +
    (attrVehicle ? '&veiculo=' + encodeURIComponent(attrVehicle) : '');

  function injectStyles() {
    if (document.getElementById('armazem-agent-widget-styles')) return;
    var style = document.createElement('style');
    style.id = 'armazem-agent-widget-styles';
    style.textContent = [
      '.armazem-w-root{position:fixed;bottom:22px;z-index:2147483000;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Inter,sans-serif;box-sizing:border-box;line-height:1.25;}',
      '.armazem-w-root *{box-sizing:border-box;}',
      '.armazem-w-pos-right{right:22px;left:auto;}',
      '.armazem-w-pos-left{left:22px;right:auto;}',
      '.armazem-w-trigger{appearance:none;border:1px solid rgba(255,255,255,0.22);background:linear-gradient(155deg,#27272c 0%,#141418 58%,#0b0b0e 100%);color:#ffffff;border-radius:999px;padding:7px 18px 7px 8px;display:inline-flex;align-items:center;gap:11px;cursor:pointer;position:relative;box-shadow:0 16px 34px -10px rgba(0,0,0,0.58),0 6px 14px -4px rgba(220,38,38,0.28),inset 0 1px 1px rgba(255,255,255,0.24),inset 0 -2px 5px rgba(0,0,0,0.45);transition:transform 220ms cubic-bezier(0.22,1,0.36,1),box-shadow 220ms ease;}',
      '.armazem-w-trigger:hover{transform:translateY(-2px);box-shadow:0 22px 42px -10px rgba(0,0,0,0.65),0 10px 20px -6px rgba(220,38,38,0.42),inset 0 1px 1px rgba(255,255,255,0.34),inset 0 -2px 5px rgba(0,0,0,0.5);}',
      '.armazem-w-trigger:active{transform:translateY(0px) scale(0.98);}',
      '.armazem-w-trigger:focus-visible{outline:3px solid #ef4444;outline-offset:3px;}',
      '.armazem-w-orb{width:42px;height:42px;border-radius:999px;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:radial-gradient(circle at 30% 24%,#ff6b6b 0%,#dc2626 52%,#8b1111 100%);box-shadow:inset 0 2px 3px rgba(255,255,255,0.42),inset 0 -3px 6px rgba(69,10,10,0.65),0 6px 14px -3px rgba(220,38,38,0.55);border:1px solid rgba(255,255,255,0.28);}',
      '.armazem-w-copy{display:flex;flex-direction:column;align-items:flex-start;text-align:left;padding-right:4px;}',
      '.armazem-w-label{font-size:13.5px;font-weight:700;letter-spacing:-0.01em;color:#ffffff;white-space:nowrap;}',
      '.armazem-w-sub{font-size:10.5px;font-weight:500;color:#d4d4d8;white-space:nowrap;margin-top:1px;}',
      '.armazem-w-panel{position:fixed;bottom:86px;width:min(410px,calc(100vw - 32px));height:min(640px,calc(100vh - 118px));background:#111114;border:1px solid rgba(255,255,255,0.14);border-radius:20px;overflow:hidden;box-shadow:0 28px 65px -15px rgba(0,0,0,0.68),0 0 0 1px rgba(0,0,0,0.25);display:none;flex-direction:column;z-index:2147483001;}',
      '.armazem-w-panel.open{display:flex;}',
      '.armazem-w-panel.pos-right{right:22px;left:auto;}',
      '.armazem-w-panel.pos-left{left:22px;right:auto;}',
      '.armazem-w-head{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#16161b;border-bottom:1px solid rgba(255,255,255,0.1);color:#ffffff;gap:10px;}',
      '.armazem-w-head-title{font-size:13px;font-weight:700;color:#ffffff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.armazem-w-head-actions{display:flex;align-items:center;gap:8px;flex-shrink:0;}',
      '.armazem-w-head-link{font-size:11.5px;font-weight:600;color:#fca5a5;text-decoration:none;padding:4px 8px;border-radius:8px;border:1px solid rgba(252,165,165,0.25);}',
      '.armazem-w-head-link:hover{background:rgba(220,38,38,0.16);color:#ffffff;}',
      '.armazem-w-close{appearance:none;border:none;background:rgba(255,255,255,0.08);color:#e4e4e7;width:28px;height:28px;border-radius:8px;cursor:pointer;font-size:16px;line-height:1;display:inline-flex;align-items:center;justify-content:center;}',
      '.armazem-w-close:hover{background:rgba(255,255,255,0.16);color:#ffffff;}',
      '.armazem-w-close:focus-visible{outline:2px solid #ef4444;outline-offset:2px;}',
      '.armazem-w-frame{width:100%;height:100%;border:0;flex:1;background:#f8fafc;}',
      '@media (max-width:640px){.armazem-w-root{bottom:16px;}.armazem-w-pos-right{right:14px;}.armazem-w-pos-left{left:14px;}.armazem-w-trigger{padding:6px 14px 6px 6px;gap:9px;}.armazem-w-orb{width:38px;height:38px;}.armazem-w-sub{display:none;}}',
      '@media (prefers-reduced-motion:reduce){.armazem-w-trigger{transition:none !important;}.armazem-w-trigger:hover,.armazem-w-trigger:active{transform:none !important;}}'
    ].join('');
    document.head.appendChild(style);
  }

  function buildEmblemSvg() {
    return '<svg width="22" height="22" viewBox="0 0 28 28" fill="none" aria-hidden="true">' +
      '<defs>' +
      '<linearGradient id="azmBody" x1="4" y1="4" x2="24" y2="24" gradientUnits="userSpaceOnUse">' +
      '<stop offset="0%" stop-color="#ffffff"/>' +
      '<stop offset="100%" stop-color="#ffe4e6"/>' +
      '</linearGradient>' +
      '</defs>' +
      '<path d="M5.5 7.5C5.5 5.84 6.84 4.5 8.5 4.5H19.5C21.16 4.5 22.5 5.84 22.5 7.5V15.5C22.5 17.16 21.16 18.5 19.5 18.5H12.2L7.5 22.5V18.5H8.5C6.84 18.5 5.5 17.16 5.5 15.5V7.5Z" fill="url(#azmBody)" fill-opacity="0.16" stroke="#ffffff" stroke-width="1.8" stroke-linejoin="round"/>' +
      '<path d="M8.8 13.4L10.3 9.9C10.55 9.35 11.1 9 11.7 9H16.3C16.9 9 17.45 9.35 17.7 9.9L19.2 13.4" stroke="#ffffff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<rect x="8.2" y="12.6" width="11.6" height="3.1" rx="1.4" fill="#ffffff"/>' +
      '<circle cx="10.8" cy="14.15" r="0.85" fill="#dc2626"/>' +
      '<circle cx="17.2" cy="14.15" r="0.85" fill="#dc2626"/>' +
      '</svg>';
  }

  function mountWidget(cfg) {
    if (!cfg || cfg.enabled === false) return;
    if (document.getElementById('armazem-agent-widget-root')) return;
    injectStyles();

    var position = (attrPosition === 'bottom-left' || attrPosition === 'bottom-right')
      ? attrPosition
      : (cfg.position === 'bottom-left' ? 'bottom-left' : 'bottom-right');
    var label = (attrLabel || cfg.label || 'Fale com o agente').slice(0, 48);
    var tradeName = (cfg.tradeName || 'Atendimento').slice(0, 60);
    var chatBase = (cfg.chatBaseUrl || (resolvedOrigin + '/chat')).replace(/\\/+$/, '');
    var matchedVehicle = cfg.matchedVehicle || null;
    var embedAllowed = cfg.embedAllowed !== false;

    function buildChatUrl(isEmbed) {
      var params = [];
      if (isEmbed) params.push('embed=1');
      params.push('origem=widget_externo');
      if (matchedVehicle && matchedVehicle.id) {
        params.push('veiculo=' + encodeURIComponent(String(matchedVehicle.id)));
      }
      return chatBase + '?' + params.join('&');
    }

    var fullChatUrl = buildChatUrl(false);
    var embedChatUrl = buildChatUrl(true);

    var root = document.createElement('div');
    root.id = 'armazem-agent-widget-root';
    root.className = 'armazem-w-root ' + (position === 'bottom-left' ? 'armazem-w-pos-left' : 'armazem-w-pos-right');

    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'armazem-w-trigger';
    trigger.setAttribute('aria-label', label + ' — ' + tradeName);
    trigger.setAttribute('aria-expanded', 'false');
    trigger.innerHTML =
      '<span class="armazem-w-orb">' + buildEmblemSvg() + '</span>' +
      '<span class="armazem-w-copy">' +
      '<span class="armazem-w-label"></span>' +
      '<span class="armazem-w-sub"></span>' +
      '</span>';

    var labelEl = trigger.querySelector('.armazem-w-label');
    var subEl = trigger.querySelector('.armazem-w-sub');
    if (labelEl) labelEl.textContent = label;
    if (subEl) {
      subEl.textContent = matchedVehicle && matchedVehicle.label
        ? matchedVehicle.label
        : tradeName;
    }

    var panel = null;
    var iframeLoaded = false;
    var isOpen = false;

    function closePanel() {
      if (!panel || !isOpen) return;
      isOpen = false;
      panel.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.focus();
    }

    function ensurePanel() {
      if (panel) return panel;
      panel = document.createElement('div');
      panel.className = 'armazem-w-panel ' + (position === 'bottom-left' ? 'pos-left' : 'pos-right');
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', 'Atendimento — ' + tradeName);

      var head = document.createElement('div');
      head.className = 'armazem-w-head';

      var title = document.createElement('div');
      title.className = 'armazem-w-head-title';
      title.textContent = matchedVehicle && matchedVehicle.label
        ? tradeName + ' · ' + matchedVehicle.label
        : tradeName + ' · Atendimento';

      var actions = document.createElement('div');
      actions.className = 'armazem-w-head-actions';

      var fullLink = document.createElement('a');
      fullLink.className = 'armazem-w-head-link';
      fullLink.href = fullChatUrl;
      fullLink.target = '_blank';
      fullLink.rel = 'noopener noreferrer';
      fullLink.textContent = 'Tela cheia';

      var closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'armazem-w-close';
      closeBtn.setAttribute('aria-label', 'Fechar atendimento');
      closeBtn.textContent = '×';
      closeBtn.addEventListener('click', closePanel);

      actions.appendChild(fullLink);
      actions.appendChild(closeBtn);
      head.appendChild(title);
      head.appendChild(actions);
      panel.appendChild(head);
      document.body.appendChild(panel);
      return panel;
    }

    function onKeyDown(ev) {
      if (ev.key === 'Escape' && isOpen) {
        closePanel();
      }
    }
    document.addEventListener('keydown', onKeyDown);

    trigger.addEventListener('click', function () {
      var isMobile = window.innerWidth < 768;
      if (isMobile || !embedAllowed) {
        window.location.assign(fullChatUrl);
        return;
      }

      var p = ensurePanel();
      if (isOpen) {
        closePanel();
        return;
      }

      if (!iframeLoaded) {
        var iframe = document.createElement('iframe');
        iframe.className = 'armazem-w-frame';
        iframe.src = embedChatUrl;
        iframe.title = 'Atendimento — ' + tradeName;
        iframe.setAttribute('allow', 'microphone');
        iframe.setAttribute('loading', 'lazy');
        p.appendChild(iframe);
        iframeLoaded = true;
      }

      isOpen = true;
      p.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
    });

    root.appendChild(trigger);
    document.body.appendChild(root);
  }

  function start() {
    fetch(configUrl, { method: 'GET', credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (cfg) {
        if (cfg) {
          mountWidget(cfg);
        } else {
          mountWidget({
            enabled: true,
            embedAllowed: false,
            position: attrPosition || 'bottom-right',
            label: attrLabel || 'Fale com o agente',
            tradeName: 'Atendimento',
            chatBaseUrl: resolvedOrigin + '/chat',
          });
        }
      })
      .catch(function () {
        mountWidget({
          enabled: true,
          embedAllowed: false,
          position: attrPosition || 'bottom-right',
          label: attrLabel || 'Fale com o agente',
          tradeName: 'Atendimento',
          chatBaseUrl: resolvedOrigin + '/chat',
        });
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
`;
}

export function buildDemoExternalSiteHtml(params: {
  storeSlug: string;
  vehicleAttr?: string;
  duplicateScript?: boolean;
}): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const slug = esc(params.storeSlug || 'armazem-do-carro');
  const vehiclePart = params.vehicleAttr
    ? ` data-veiculo="${esc(params.vehicleAttr)}"`
    : '';
  const scriptTag = `<script src="/widget.js" data-loja="${slug}"${vehiclePart} async></script>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Demonstração — Site Oficial da Revenda</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; color: #0f172a; }
    header { background: #111114; color: #fff; padding: 18px 28px; display: flex; justify-content: space-between; align-items: center; }
    main { max-width: 920px; margin: 40px auto; padding: 0 20px; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 28px; box-shadow: 0 8px 24px -12px rgba(15,23,42,0.12); }
    h1 { margin: 0 0 10px; font-size: 26px; }
    p { color: #475569; line-height: 1.6; }
    code { background: #f1f5f9; padding: 2px 6px; border-radius: 6px; font-size: 13px; }
  </style>
</head>
<body>
  <header>
    <strong>Site Oficial da Revenda (Página de Teste do Widget)</strong>
    <span>Loja: ${slug}</span>
  </header>
  <main>
    <div class="card">
      <h1>Ambiente de Validação do Botão Flutuante Externo</h1>
      <p>Esta página estática simula o site institucional/vitrine externa de uma revenda utilizando apenas o snippet público <code>/widget.js</code>.</p>
      <p>Clique no botão flutuante no canto da tela para verificar a abertura do painel do agente em desktop (ou abertura direta em <code>/chat</code> no celular) sem duplicação de instância.</p>
    </div>
  </main>
  ${scriptTag}
  ${params.duplicateScript ? scriptTag : ''}
</body>
</html>`;
}
