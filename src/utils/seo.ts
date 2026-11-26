import type {
  AppViewMode,
  DealershipSettings,
  NavModule,
  Vehicle,
} from '../types';
import {
  buildDealershipPoliciesSummary,
  buildVehicleSheetPath,
  formatBrlCurrency,
  formatDealershipAddress,
  formatDealershipHours,
  formatKmBr,
  getVehicleDisplayTitle,
  isVehicleAvailable,
} from './vehicleDomain';

export interface RouteSeoPayload {
  title: string;
  description: string;
  robots: 'index, follow' | 'noindex, nofollow';
  canonicalUrl: string | null;
  ogType: 'website' | 'product';
  ogImage: string | null;
  siteName: string;
  jsonLd: Record<string, unknown>[];
}

const MODULE_TITLE_LABELS: Record<NavModule, string> = {
  hoje: 'Hoje',
  atendimentos: 'Atendimentos',
  estoque: 'Estoque',
  agenda_trocas: 'Agenda e Trocas',
  divulgacao: 'Divulgação',
  documentos: 'Documentos',
  gestao: 'Gestão',
  configuracoes: 'Configurações',
  dashboard: 'Hoje',
  inventory: 'Estoque',
  crm: 'Atendimentos',
  chat_audit: 'Atendimentos',
  contracts: 'Documentos',
  social_ai: 'Divulgação',
  settings: 'Configurações',
};

function sanitizeOrigin(origin?: string | null): string {
  const clean = (origin || '').trim().replace(/\/+$/, '');
  if (!clean) return '';
  if (/^https?:\/\//i.test(clean)) return clean;
  return '';
}

function isHttpImageUrl(url?: string | null): boolean {
  if (!url) return false;
  return /^https?:\/\//i.test(url.trim());
}

export function buildAutoDealerJsonLd(
  settings: DealershipSettings,
  origin: string
): Record<string, unknown> {
  const formattedAddress = formatDealershipAddress(settings);
  const hours = formatDealershipHours(settings);
  const policies = buildDealershipPoliciesSummary(settings);
  const phoneDigits = (settings.salesWhatsapp || settings.whatsapp || settings.phone || '').replace(
    /\D/g,
    ''
  );
  const formattedIntlPhone = phoneDigits
    ? phoneDigits.startsWith('55')
      ? `+${phoneDigits}`
      : `+55${phoneDigits}`
    : undefined;

  const openingHours: string[] = [];
  if (hours.weekdays) openingHours.push(`Mo-Fr ${hours.weekdays}`);
  if (hours.saturday) openingHours.push(`Sa ${hours.saturday}`);
  if (hours.sunday && !/fechado/i.test(hours.sunday)) {
    openingHours.push(`Su ${hours.sunday}`);
  }

  const dealer: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'AutoDealer',
    name: settings.tradeName || 'Armazém do Carro',
    legalName: settings.legalName || settings.tradeName || 'Armazém do Carro',
    description: `${settings.tradeName || 'Armazém do Carro'} — Revenda de veículos seminovos selecionados com atendimento digital. ${policies.warrantyLine} ${policies.visitPolicyLine} ${policies.tradeInPolicyLine}`,
    ...(origin ? { url: origin } : {}),
    ...(formattedIntlPhone ? { telephone: formattedIntlPhone } : {}),
    ...(settings.email?.trim() ? { email: settings.email.trim() } : {}),
    ...(formattedAddress
      ? {
          address: {
            '@type': 'PostalAddress',
            streetAddress: settings.address?.trim() || formattedAddress,
            ...(settings.city?.trim() ? { addressLocality: settings.city.trim() } : {}),
            ...(settings.state?.trim() ? { addressRegion: settings.state.trim().toUpperCase() } : {}),
            addressCountry: 'BR',
          },
        }
      : {}),
    ...(openingHours.length > 0 ? { openingHours } : {}),
    makesOffer: [
      {
        '@type': 'Offer',
        name: 'Venda de veículos seminovos selecionados',
        description: policies.warrantyLine,
      },
      {
        '@type': 'Offer',
        name: 'Avaliação de veículo usado na troca',
        description: policies.tradeInPolicyLine,
      },
      {
        '@type': 'Offer',
        name: 'Simulação de financiamento automotivo',
        description: policies.financingPolicyLine,
      },
    ],
  };

  return dealer;
}

export function buildVehicleJsonLd(
  vehicle: Vehicle,
  settings: DealershipSettings,
  origin: string
): Record<string, unknown> {
  const title = getVehicleDisplayTitle(vehicle);
  const sheetPath = buildVehicleSheetPath(vehicle.id);
  const fullUrl = origin ? `${origin}${sheetPath}` : sheetPath;
  const available = isVehicleAvailable(vehicle);
  const yearModel = vehicle.year?.split('/').pop()?.trim() || vehicle.year || '';

  const node: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': ['Car', 'Vehicle'],
    name: `${title}${vehicle.year ? ` ${vehicle.year}` : ''}`.trim(),
    brand: {
      '@type': 'Brand',
      name: vehicle.brand,
    },
    model: vehicle.model,
    ...(vehicle.version?.trim() ? { vehicleConfiguration: vehicle.version.trim() } : {}),
    ...(yearModel ? { vehicleModelDate: yearModel } : {}),
    ...(vehicle.color?.trim() ? { color: vehicle.color.trim() } : {}),
    ...(vehicle.fuel?.trim() ? { fuelType: vehicle.fuel.trim() } : {}),
    ...(vehicle.transmission?.trim() ? { vehicleTransmission: vehicle.transmission.trim() } : {}),
    ...(vehicle.km > 0
      ? {
          mileageFromOdometer: {
            '@type': 'QuantitativeValue',
            value: vehicle.km,
            unitCode: 'KMT',
          },
        }
      : {}),
    ...(isHttpImageUrl(vehicle.imageUrl) ? { image: vehicle.imageUrl } : {}),
    url: fullUrl,
    itemCondition: 'https://schema.org/UsedCondition',
    offers: {
      '@type': 'Offer',
      url: fullUrl,
      priceCurrency: 'BRL',
      ...(vehicle.price > 0 && vehicle.priceConfirmed !== false
        ? { price: Math.round(vehicle.price) }
        : {}),
      availability: available
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/UsedCondition',
      seller: {
        '@type': 'AutoDealer',
        name: settings.tradeName || 'Armazém do Carro',
        ...(origin ? { url: origin } : {}),
      },
    },
  };

  return node;
}

export function buildInventoryItemListJsonLd(
  vehicles: Vehicle[],
  origin: string
): Record<string, unknown> {
  const available = vehicles.filter(isVehicleAvailable).slice(0, 20);
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Estoque de Seminovos Disponíveis',
    numberOfItems: available.length,
    itemListElement: available.map((v, idx) => {
      const sheetPath = buildVehicleSheetPath(v.id);
      return {
        '@type': 'ListItem',
        position: idx + 1,
        url: origin ? `${origin}${sheetPath}` : sheetPath,
        name: `${getVehicleDisplayTitle(v)} ${v.year}`.trim(),
      };
    }),
  };
}

export function buildRouteSeoPayload(params: {
  viewMode: AppViewMode;
  activeModule?: NavModule;
  settings: DealershipSettings;
  origin?: string | null;
  vehicle?: Vehicle | null;
  vehicles?: Vehicle[];
}): RouteSeoPayload {
  const { viewMode, activeModule = 'hoje', settings, vehicle, vehicles = [] } = params;
  const origin = sanitizeOrigin(params.origin);
  const storeName = (settings.tradeName || 'Armazém do Carro').trim();
  const formattedAddress = formatDealershipAddress(settings);
  const locationSuffix = formattedAddress ? ` em ${settings.city || formattedAddress}` : '';
  const defaultOgImage = origin ? `${origin}/apple-touch-icon.png` : null;

  if (viewMode === 'login') {
    return {
      title: `Entrar na Central da Revenda | ${storeName}`,
      description: `Acesso restrito para a equipe comercial e administrativa da ${storeName}.`,
      robots: 'noindex, nofollow',
      canonicalUrl: null,
      ogType: 'website',
      ogImage: defaultOgImage,
      siteName: storeName,
      jsonLd: [],
    };
  }

  if (viewMode === 'admin') {
    const moduleLabel = MODULE_TITLE_LABELS[activeModule] || 'Painel';
    return {
      title: `Central da Revenda — ${moduleLabel} | ${storeName}`,
      description: `Central operacional interna da ${storeName} para gestão de estoque, atendimentos, agenda, trocas e documentos.`,
      robots: 'noindex, nofollow',
      canonicalUrl: null,
      ogType: 'website',
      ogImage: defaultOgImage,
      siteName: storeName,
      jsonLd: [],
    };
  }

  if (viewMode === 'vehicle_detail' && vehicle) {
    const vehicleTitle = getVehicleDisplayTitle(vehicle);
    const pricePart =
      vehicle.price > 0 && vehicle.priceConfirmed !== false
        ? ` por ${formatBrlCurrency(vehicle.price)}`
        : '';
    const kmPart = vehicle.km > 0 ? `, ${formatKmBr(vehicle.km)}` : '';
    const transPart = vehicle.transmission ? `, câmbio ${vehicle.transmission}` : '';
    const sheetPath = buildVehicleSheetPath(vehicle.id);
    const canonicalUrl = origin ? `${origin}${sheetPath}` : null;

    return {
      title: `${vehicleTitle} ${vehicle.year} à Venda | ${storeName}`,
      description: `${vehicleTitle} ${vehicle.year}${pricePart}${kmPart}${transPart}. Confira ficha completa, procedência, simulação de financiamento e avaliação de troca na ${storeName}${locationSuffix}.`,
      robots: 'index, follow',
      canonicalUrl,
      ogType: 'product',
      ogImage: isHttpImageUrl(vehicle.imageUrl) ? vehicle.imageUrl : defaultOgImage,
      siteName: storeName,
      jsonLd: [
        buildAutoDealerJsonLd(settings, origin),
        buildVehicleJsonLd(vehicle, settings, origin),
      ],
    };
  }

  if (viewMode === 'vehicle_detail') {
    return {
      title: `Ficha do Veículo | ${storeName}`,
      description: `Consulte a ficha técnica, preço, quilometragem e condições de financiamento ou troca na ${storeName}.`,
      robots: 'index, follow',
      canonicalUrl: null,
      ogType: 'website',
      ogImage: defaultOgImage,
      siteName: storeName,
      jsonLd: [buildAutoDealerJsonLd(settings, origin)],
    };
  }

  if (viewMode === 'chat') {
    return {
      title: `Atendimento Digital e Consultor IA | ${storeName}`,
      description: `Tire dúvidas sobre o estoque de seminovos, simule entrada de financiamento, envie seu usado para pré-avaliação na troca e consulte horários da ${storeName}${locationSuffix}.`,
      robots: 'index, follow',
      canonicalUrl: origin ? `${origin}/chat` : null,
      ogType: 'website',
      ogImage: defaultOgImage,
      siteName: storeName,
      jsonLd: [buildAutoDealerJsonLd(settings, origin)],
    };
  }

  if (viewMode === 'privacy') {
    return {
      title: `Política de Privacidade (LGPD) | ${storeName}`,
      description: `Saiba como a ${storeName} trata, protege e permite a exclusão de seus dados pessoais conforme a LGPD.`,
      robots: 'index, follow',
      canonicalUrl: origin ? `${origin}/privacidade` : null,
      ogType: 'website',
      ogImage: defaultOgImage,
      siteName: storeName,
      jsonLd: [buildAutoDealerJsonLd(settings, origin)],
    };
  }

  if (viewMode === 'home') {
    return {
      title: `${storeName} — Seminovos Selecionados, Financiamento e Troca`,
      description: `Conheça a ${storeName}${locationSuffix}: veículos seminovos selecionados com procedência, simulação de financiamento, avaliação de troca e atendimento digital direto.`,
      robots: 'index, follow',
      canonicalUrl: origin ? `${origin}/inicio` : null,
      ogType: 'website',
      ogImage: defaultOgImage,
      siteName: storeName,
      jsonLd: [
        buildAutoDealerJsonLd(settings, origin),
        ...(vehicles.length > 0 ? [buildInventoryItemListJsonLd(vehicles, origin)] : []),
      ],
    };
  }

  // Default: public catalog ('/')
  const availableCount = vehicles.filter(isVehicleAvailable).length;
  const countPrefix =
    availableCount > 0 ? `${availableCount} seminovos disponíveis` : 'Seminovos selecionados';
  return {
    title: `Estoque de Veículos Seminovos | ${storeName}`,
    description: `${countPrefix} na ${storeName}${locationSuffix}. Filtre por preço, câmbio e categoria, compare fichas completas, simule financiamento ou avalie seu usado na troca.`,
    robots: 'index, follow',
    canonicalUrl: origin ? `${origin}/` : null,
    ogType: 'website',
    ogImage: defaultOgImage,
    siteName: storeName,
    jsonLd: [
      buildAutoDealerJsonLd(settings, origin),
      ...(vehicles.length > 0 ? [buildInventoryItemListJsonLd(vehicles, origin)] : []),
    ],
  };
}

function upsertMetaTag(
  attr: 'name' | 'property',
  key: string,
  content: string | null
): void {
  if (typeof document === 'undefined') return;
  const selector = `meta[${attr}="${key}"]`;
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!content) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function upsertCanonicalLink(href: string | null): void {
  if (typeof document === 'undefined') return;
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!href) {
    if (link) link.remove();
    return;
  }
  if (!link) {
    link = document.createElement('link');
    link.setAttribute('rel', 'canonical');
    document.head.appendChild(link);
  }
  link.setAttribute('href', href);
}

function upsertJsonLdScript(nodes: Record<string, unknown>[]): void {
  if (typeof document === 'undefined') return;
  const scriptId = 'armazem-seo-jsonld';
  let script = document.getElementById(scriptId) as HTMLScriptElement | null;
  if (!nodes || nodes.length === 0) {
    if (script) script.remove();
    return;
  }
  if (!script) {
    script = document.createElement('script');
    script.id = scriptId;
    script.type = 'application/ld+json';
    document.head.appendChild(script);
  }
  const payload = nodes.length === 1 ? nodes[0] : { '@context': 'https://schema.org', '@graph': nodes };
  script.textContent = JSON.stringify(payload);
}

export function applyClientRouteSeo(payload: RouteSeoPayload): void {
  if (typeof document === 'undefined') return;
  document.title = payload.title;
  upsertMetaTag('name', 'description', payload.description);
  upsertMetaTag('name', 'robots', payload.robots);
  upsertCanonicalLink(payload.canonicalUrl);

  upsertMetaTag('property', 'og:site_name', payload.siteName);
  upsertMetaTag('property', 'og:title', payload.title);
  upsertMetaTag('property', 'og:description', payload.description);
  upsertMetaTag('property', 'og:type', payload.ogType);
  upsertMetaTag('property', 'og:url', payload.canonicalUrl);
  upsertMetaTag('property', 'og:image', payload.ogImage);

  upsertMetaTag('name', 'twitter:card', 'summary_large_image');
  upsertMetaTag('name', 'twitter:title', payload.title);
  upsertMetaTag('name', 'twitter:description', payload.description);
  upsertMetaTag('name', 'twitter:image', payload.ogImage);

  upsertJsonLdScript(payload.jsonLd);
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeJsonForScriptTag(json: string): string {
  return json.replace(/</g, '\\u003c').replace(/-->/g, '--\\u003e');
}

/**
 * Injects route-specific <title>, meta tags, robots, canonical, Open Graph,
 * Twitter Card, and Schema.org JSON-LD into HTML for SSR / search engines / AI agents (GEO).
 */
export function injectSeoIntoHtml(html: string, payload: RouteSeoPayload): string {
  const safeTitle = escapeHtmlAttr(payload.title);
  const safeDesc = escapeHtmlAttr(payload.description);
  const safeSite = escapeHtmlAttr(payload.siteName);
  const safeRobots = escapeHtmlAttr(payload.robots);
  const safeOgType = escapeHtmlAttr(payload.ogType);

  let out = html;
  out = out.replace(/<title>[\s\S]*?<\/title>/i, `<title>${safeTitle}</title>`);
  out = out.replace(
    /<meta\s+name="description"[^>]*>/i,
    `<meta name="description" content="${safeDesc}" />`
  );
  out = out.replace(
    /<meta\s+property="og:title"[^>]*>/i,
    `<meta property="og:title" content="${safeTitle}" />`
  );
  out = out.replace(
    /<meta\s+property="og:description"[^>]*>/i,
    `<meta property="og:description" content="${safeDesc}" />`
  );
  out = out.replace(
    /<meta\s+property="og:type"[^>]*>/i,
    `<meta property="og:type" content="${safeOgType}" />`
  );

  const extraHeadTags: string[] = [
    `<meta name="robots" content="${safeRobots}" />`,
    `<meta property="og:site_name" content="${safeSite}" />`,
    `<meta name="twitter:title" content="${safeTitle}" />`,
    `<meta name="twitter:description" content="${safeDesc}" />`,
  ];

  if (payload.canonicalUrl) {
    const safeCanonical = escapeHtmlAttr(payload.canonicalUrl);
    extraHeadTags.push(`<link rel="canonical" href="${safeCanonical}" />`);
    extraHeadTags.push(`<meta property="og:url" content="${safeCanonical}" />`);
  }
  if (payload.ogImage) {
    const safeImg = escapeHtmlAttr(payload.ogImage);
    extraHeadTags.push(`<meta property="og:image" content="${safeImg}" />`);
    extraHeadTags.push(`<meta name="twitter:image" content="${safeImg}" />`);
  }
  if (payload.jsonLd.length > 0) {
    const graphPayload =
      payload.jsonLd.length === 1
        ? payload.jsonLd[0]
        : { '@context': 'https://schema.org', '@graph': payload.jsonLd };
    extraHeadTags.push(
      `<script id="armazem-seo-jsonld" type="application/ld+json">${escapeJsonForScriptTag(
        JSON.stringify(graphPayload)
      )}</script>`
    );
  }

  return out.replace('</head>', `    ${extraHeadTags.join('\n    ')}\n  </head>`);
}
