import crypto from 'crypto';
import dns from 'dns/promises';
import net from 'net';
import { pool } from '../db/pool';
import { isSafeHttpUrl } from '../utils/vehicleDomain';
import type {
  ExternalInventorySourceSummary,
  ExternalInventorySourceType,
  ExternalSourceHealthStatus,
  Vehicle,
  VehicleStatus,
} from '../types';

const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
const MAX_EXTERNAL_BODY_BYTES = 3 * 1024 * 1024; // 3 MB hard limit
const MAX_REDIRECT_HOPS = 3;

export interface ExternalUrlValidationResult {
  ok: boolean;
  normalizedUrl?: string;
  error?: string;
}

export interface NormalizedExternalVehicleInput {
  externalId: string;
  brand: string;
  model: string;
  version: string;
  year: string;
  km: number;
  price: number;
  priceConfirmed: boolean;
  transmission: string;
  fuel: string;
  color: string;
  status: VehicleStatus;
  availabilityConfirmed: boolean;
  imageUrl: string;
  gallery: string[];
  officialUrl: string | null;
  optionals: string[];
  sourceUpdatedAt: string | null;
}

export interface ExternalParseResult {
  ok: boolean;
  status: ExternalSourceHealthStatus;
  vehicles: NormalizedExternalVehicleInput[];
  detail: string;
}

function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT)
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 192 && b === 0) return true; // 192.0.0.0/24, 192.0.2.0/24
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmark
  if (a >= 224) return true; // multicast & reserved
  return false;
}

export function isBlockedIpAddress(ip: string): boolean {
  const clean = ip.trim().toLowerCase().replace(/^\[|\]$/g, '');
  const version = net.isIP(clean);
  if (version === 4) {
    return isPrivateOrReservedIpv4(clean);
  }
  if (version === 6) {
    if (clean === '::1' || clean === '::') return true;
    // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 or ::ffff:169.254.169.254)
    if (clean.startsWith('::ffff:')) {
      const mapped = clean.slice('::ffff:'.length);
      if (net.isIP(mapped) === 4) {
        return isPrivateOrReservedIpv4(mapped);
      }
      return true;
    }
    // Unique local (fc00::/7 -> fc.. or fd..) and link-local (fe80::/10 -> fe8..feb) and multicast (ff..)
    if (/^(fc|fd|fe[89ab]|ff)/i.test(clean)) return true;
    return false;
  }
  return true;
}

export function isBlockedHostnameSyntax(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (!h) return true;
  if (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    h === 'metadata.google.internal' ||
    h === 'metadata'
  ) {
    return true;
  }
  if (net.isIP(h.replace(/^\[|\]$/g, '')) > 0) {
    return isBlockedIpAddress(h);
  }
  return false;
}

/**
 * Validates that an external dealership/feed URL uses http(s), contains no credentials,
 * does not target private/loopback/link-local/metadata networks, and resolves only to public IPs.
 */
export async function validateExternalUrl(
  rawUrl: string,
  options?: { skipDnsLookup?: boolean; allowLoopbackForTest?: boolean }
): Promise<ExternalUrlValidationResult> {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) {
    return { ok: false, error: 'Informe uma URL válida começando com https:// ou http://.' };
  }
  if (trimmed.length > 2048) {
    return { ok: false, error: 'A URL informada excede o limite máximo permitido.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'Formato de URL inválido. Use o endereço completo, como https://www.sualoja.com.br/estoque.' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'Apenas endereços http:// ou https:// são permitidos.' };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, error: 'Não inclua usuário ou senha diretamente na URL.' };
  }

  const host = parsed.hostname.toLowerCase();
  const isLoopbackAllowed = Boolean(options?.allowLoopbackForTest);

  if (!isLoopbackAllowed && isBlockedHostnameSyntax(host)) {
    return {
      ok: false,
      error: 'Endereços locais ou internos de rede não são permitidos por segurança.',
    };
  }

  if (!options?.skipDnsLookup && !isLoopbackAllowed && net.isIP(host.replace(/^\[|\]$/g, '')) === 0) {
    try {
      const addresses = await dns.lookup(host, { all: true, verbatim: true });
      if (!addresses || addresses.length === 0) {
        return { ok: false, error: 'Não foi possível resolver o domínio informado.' };
      }
      for (const addr of addresses) {
        if (isBlockedIpAddress(addr.address)) {
          return {
            ok: false,
            error: 'O domínio informado resolve para uma rede privada ou restrita e foi bloqueado.',
          };
        }
      }
    } catch {
      return { ok: false, error: 'Não foi possível localizar o endereço informado na internet.' };
    }
  }

  return { ok: true, normalizedUrl: parsed.toString() };
}

export async function safeFetchExternalResource(
  rawUrl: string,
  options?: {
    method?: 'GET' | 'HEAD';
    headers?: Record<string, string>;
    timeoutMs?: number;
    maxBytes?: number;
    allowLoopbackForTest?: boolean;
  }
): Promise<{
  ok: boolean;
  status: number;
  finalUrl: string;
  contentType: string;
  bodyText: string;
  error?: string;
}> {
  const method = options?.method || 'GET';
  const timeoutMs = options?.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const maxBytes = options?.maxBytes ?? MAX_EXTERNAL_BODY_BYTES;
  let currentUrl = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    const check = await validateExternalUrl(currentUrl, {
      allowLoopbackForTest: options?.allowLoopbackForTest,
    });
    if (!check.ok || !check.normalizedUrl) {
      return {
        ok: false,
        status: 0,
        finalUrl: currentUrl,
        contentType: '',
        bodyText: '',
        error: check.error || 'URL externa bloqueada na validação.',
      };
    }
    currentUrl = check.normalizedUrl;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(currentUrl, {
        method,
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'ArmazemDoCarro-CatalogSync/1.0 (+https://agente-de-ia-carros.vercel.app)',
          Accept: 'application/json, text/html, application/xhtml+xml;q=0.9, */*;q=0.5',
          ...(options?.headers || {}),
        },
      });
    } catch (err: unknown) {
      clearTimeout(timer);
      const isAbort = err instanceof Error && err.name === 'AbortError';
      return {
        ok: false,
        status: 0,
        finalUrl: currentUrl,
        contentType: '',
        bodyText: '',
        error: isAbort
          ? 'Tempo limite excedido ao consultar o site da revenda.'
          : 'Não foi possível conectar ao endereço externo no momento.',
      };
    }

    if (response.status >= 300 && response.status < 400) {
      clearTimeout(timer);
      const loc = response.headers.get('location');
      if (!loc) {
        return {
          ok: false,
          status: response.status,
          finalUrl: currentUrl,
          contentType: '',
          bodyText: '',
          error: 'O endereço retornou um redirecionamento sem destino.',
        };
      }
      if (hop === MAX_REDIRECT_HOPS) {
        return {
          ok: false,
          status: response.status,
          finalUrl: currentUrl,
          contentType: '',
          bodyText: '',
          error: 'Excesso de redirecionamentos ao acessar o endereço externo.',
        };
      }
      try {
        currentUrl = new URL(loc, currentUrl).toString();
      } catch {
        return {
          ok: false,
          status: response.status,
          finalUrl: currentUrl,
          contentType: '',
          bodyText: '',
          error: 'Destino de redirecionamento inválido.',
        };
      }
      continue;
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const contentLengthHeader = Number(response.headers.get('content-length') || '0');
    if (Number.isFinite(contentLengthHeader) && contentLengthHeader > maxBytes) {
      clearTimeout(timer);
      return {
        ok: false,
        status: response.status,
        finalUrl: currentUrl,
        contentType,
        bodyText: '',
        error: 'A resposta do site externo excedeu o limite máximo de 3 MB.',
      };
    }

    if (method === 'HEAD') {
      clearTimeout(timer);
      return {
        ok: response.ok,
        status: response.status,
        finalUrl: currentUrl,
        contentType,
        bodyText: '',
        error: response.ok ? undefined : `O site respondeu com status HTTP ${response.status}.`,
      };
    }

    try {
      const reader = response.body?.getReader();
      if (!reader) {
        const text = await response.text();
        clearTimeout(timer);
        if (Buffer.byteLength(text, 'utf8') > maxBytes) {
          return {
            ok: false,
            status: response.status,
            finalUrl: currentUrl,
            contentType,
            bodyText: '',
            error: 'O conteúdo retornado excedeu o limite máximo de 3 MB.',
          };
        }
        return {
          ok: response.ok,
          status: response.status,
          finalUrl: currentUrl,
          contentType,
          bodyText: text,
          error: response.ok ? undefined : `O site respondeu com status HTTP ${response.status}.`,
        };
      }

      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel().catch(() => undefined);
          clearTimeout(timer);
          return {
            ok: false,
            status: response.status,
            finalUrl: currentUrl,
            contentType,
            bodyText: '',
            error: 'O conteúdo retornado pelo site externo excedeu o limite máximo de 3 MB.',
          };
        }
        chunks.push(value);
      }
      clearTimeout(timer);
      const bodyText = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
      return {
        ok: response.ok,
        status: response.status,
        finalUrl: currentUrl,
        contentType,
        bodyText,
        error: response.ok ? undefined : `O site respondeu com status HTTP ${response.status}.`,
      };
    } catch {
      clearTimeout(timer);
      return {
        ok: false,
        status: response.status,
        finalUrl: currentUrl,
        contentType,
        bodyText: '',
        error: 'Falha ao ler os dados retornados pelo site externo.',
      };
    }
  }

  return {
    ok: false,
    status: 0,
    finalUrl: currentUrl,
    contentType: '',
    bodyText: '',
    error: 'Não foi possível concluir a consulta externa.',
  };
}

export function stripHtmlAndSanitize(raw: unknown, maxLen = 200): string {
  if (raw === null || raw === undefined) return '';
  return String(raw)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function sanitizeOptionalExternalUrl(raw: unknown, baseUrl?: string): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const resolved = baseUrl ? new URL(trimmed, baseUrl).toString() : trimmed;
    return isSafeHttpUrl(resolved) ? resolved.slice(0, 1000) : null;
  } catch {
    return null;
  }
}

function parseNumericFlexible(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : null;
  }
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim();
  if (!cleaned) return null;
  // Handle Brazilian formatting like "R$ 68.900,00" or "68900" or "54.200 km"
  const normalized = cleaned
    .replace(/r\$/gi, '')
    .replace(/km/gi, '')
    .replace(/\s+/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');
  const match = normalized.match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const val = Number(match[0]);
  return Number.isFinite(val) && val >= 0 ? Math.round(val) : null;
}

function normalizeExternalStatus(raw: unknown): {
  status: VehicleStatus;
  confirmed: boolean;
} {
  const s = stripHtmlAndSanitize(raw, 60).toLowerCase();
  if (!s) return { status: 'Disponível', confirmed: false };
  if (/(vendid|sold|outofstock|out_of_stock|indispon|inativo|removed)/i.test(s)) {
    return { status: 'Vendido', confirmed: true };
  }
  if (/(reserv|pending|hold)/i.test(s)) {
    return { status: 'Reservado', confirmed: true };
  }
  if (/(dispon|avail|instock|in_stock|ativo|active|publicado)/i.test(s)) {
    return { status: 'Disponível', confirmed: true };
  }
  return { status: 'Disponível', confirmed: false };
}

function normalizeVehicleObject(
  item: Record<string, unknown>,
  index: number,
  baseUrl?: string
): NormalizedExternalVehicleInput | null {
  const rawTitle = stripHtmlAndSanitize(
    item.title || item.name || item.titulo || item.nome || '',
    180
  );
  let brand = stripHtmlAndSanitize(
    typeof item.brand === 'object' && item.brand !== null
      ? (item.brand as Record<string, unknown>).name
      : item.brand || item.marca || item.make || '',
    100
  );
  let model = stripHtmlAndSanitize(
    item.model || item.modelo || '',
    160
  );
  const version = stripHtmlAndSanitize(
    item.version || item.versao || item.trim || item.vehicleConfiguration || '',
    180
  );

  if (!brand && !model && rawTitle) {
    const parts = rawTitle.split(/\s+/);
    brand = parts[0] || '';
    model = parts.slice(1).join(' ') || rawTitle;
  } else if (!model && rawTitle) {
    model = rawTitle;
  }

  if (!brand && !model) return null;

  const yearRaw =
    item.year ||
    item.ano ||
    item.anoModelo ||
    item.modelYear ||
    item.vehicleModelDate ||
    item.productionDate ||
    '';
  const year = stripHtmlAndSanitize(yearRaw, 24);

  const mileageObj =
    typeof item.mileageFromOdometer === 'object' && item.mileageFromOdometer !== null
      ? (item.mileageFromOdometer as Record<string, unknown>).value
      : item.mileageFromOdometer;
  const kmParsed = parseNumericFlexible(
    item.km ?? item.quilometragem ?? item.mileage ?? mileageObj
  );
  const km = kmParsed ?? 0;

  const offers =
    typeof item.offers === 'object' && item.offers !== null
      ? (Array.isArray(item.offers) ? item.offers[0] : item.offers) as Record<string, unknown>
      : null;

  const priceParsed = parseNumericFlexible(
    item.price ?? item.preco ?? item.valor ?? offers?.price
  );
  const priceConfirmed = priceParsed !== null && priceParsed > 0;
  const price = priceConfirmed ? priceParsed! : 0;

  const transmission = stripHtmlAndSanitize(
    item.transmission ||
      item.cambio ||
      item.vehicleTransmission ||
      item.gearbox ||
      '',
    80
  );
  const fuel = stripHtmlAndSanitize(
    item.fuel || item.combustivel || item.fuelType || '',
    60
  );
  const color = stripHtmlAndSanitize(item.color || item.cor || '', 60);

  const statusInfo = normalizeExternalStatus(
    item.status ?? item.disponibilidade ?? offers?.availability
  );

  const officialUrl = sanitizeOptionalExternalUrl(
    item.officialUrl ||
      item.official_url ||
      item.url ||
      item.link ||
      item.permalink ||
      offers?.url,
    baseUrl
  );

  const rawImage = Array.isArray(item.image)
    ? item.image[0]
    : typeof item.image === 'object' && item.image !== null
      ? (item.image as Record<string, unknown>).url
      : item.imageUrl || item.image_url || item.foto || item.photo || item.image || item.thumbnail;
  const imageUrl = sanitizeOptionalExternalUrl(rawImage, baseUrl) || '';

  const rawGallery = Array.isArray(item.gallery)
    ? item.gallery
    : Array.isArray(item.fotos)
      ? item.fotos
      : Array.isArray(item.images)
        ? item.images
        : Array.isArray(item.image)
          ? item.image
          : [];
  const gallery = rawGallery
    .map((entry) =>
      sanitizeOptionalExternalUrl(
        typeof entry === 'object' && entry !== null
          ? (entry as Record<string, unknown>).url
          : entry,
        baseUrl
      )
    )
    .filter((u): u is string => Boolean(u))
    .slice(0, 12);
  if (imageUrl && !gallery.includes(imageUrl)) {
    gallery.unshift(imageUrl);
  }

  const rawOptionals = Array.isArray(item.optionals)
    ? item.optionals
    : Array.isArray(item.opcionais)
      ? item.opcionais
      : Array.isArray(item.features)
        ? item.features
        : [];
  const optionals = rawOptionals
    .map((o) => stripHtmlAndSanitize(o, 80))
    .filter(Boolean)
    .slice(0, 20);

  const explicitId = stripHtmlAndSanitize(
    item.externalId || item.external_id || item.id || item.sku || item.codigo || item.vehicleIdentificationNumber || '',
    180
  );
  const fallbackKey = officialUrl
    ? crypto.createHash('sha1').update(officialUrl).digest('hex').slice(0, 24)
    : crypto
        .createHash('sha1')
        .update(`${brand}|${model}|${version}|${year}|${index}`)
        .digest('hex')
        .slice(0, 24);
  const externalId = explicitId || `ext-${fallbackKey}`;

  const rawUpdated = item.updatedAt || item.updated_at || item.sourceUpdatedAt || item.dateModified;
  let sourceUpdatedAt: string | null = null;
  if (typeof rawUpdated === 'string' && rawUpdated.trim()) {
    const parsedDate = new Date(rawUpdated);
    if (!Number.isNaN(parsedDate.getTime())) {
      sourceUpdatedAt = parsedDate.toISOString();
    }
  }

  return {
    externalId,
    brand: brand || 'Veículo',
    model: model || version || 'Seminovo',
    version,
    year,
    km,
    price,
    priceConfirmed,
    transmission,
    fuel,
    color,
    status: statusInfo.status,
    availabilityConfirmed: statusInfo.confirmed,
    imageUrl,
    gallery,
    officialUrl,
    optionals,
    sourceUpdatedAt,
  };
}

export function parseExternalJsonFeed(
  bodyText: string,
  baseUrl?: string
): ExternalParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return {
      ok: false,
      status: 'error',
      vehicles: [],
      detail: 'A URL configurada não retornou um JSON válido.',
    };
  }

  let rawList: unknown[] | null = null;
  if (Array.isArray(parsed)) {
    rawList = parsed;
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    const candidates = [
      obj.vehicles,
      obj.veiculos,
      obj.items,
      obj.estoque,
      obj.inventory,
      obj.listings,
      obj.data,
      obj.results,
    ];
    for (const c of candidates) {
      if (Array.isArray(c)) {
        rawList = c;
        break;
      }
    }
  }

  if (!rawList) {
    return {
      ok: false,
      status: 'error',
      vehicles: [],
      detail: 'O JSON retornado não contém uma lista de veículos reconhecível (ex.: array ou campo "vehicles"/"items").',
    };
  }

  const vehicles: NormalizedExternalVehicleInput[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < rawList.length; i++) {
    const entry = rawList[i];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const normalized = normalizeVehicleObject(entry as Record<string, unknown>, i, baseUrl);
    if (!normalized) continue;
    if (seen.has(normalized.externalId)) continue;
    seen.add(normalized.externalId);
    vehicles.push(normalized);
  }

  if (vehicles.length === 0) {
    return {
      ok: true,
      status: 'empty',
      vehicles: [],
      detail: 'Feed JSON válido, porém sem veículos anunciados no momento.',
    };
  }

  return {
    ok: true,
    status: 'ok',
    vehicles,
    detail: `${vehicles.length} veículo(s) lido(s) do feed oficial JSON.`,
  };
}

function collectVehicleJsonLdNodes(node: unknown, out: Record<string, unknown>[]): void {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const child of node) collectVehicleJsonLdNodes(child, out);
    return;
  }
  if (typeof node !== 'object') return;
  const rec = node as Record<string, unknown>;
  const rawType = rec['@type'];
  const types = (Array.isArray(rawType) ? rawType : [rawType])
    .map((t) => String(t || '').toLowerCase());

  if (types.some((t) => ['vehicle', 'car', 'auto', 'motorizedbicycle', 'motorcycle'].includes(t))) {
    out.push(rec);
    return;
  }
  if (types.includes('product') && (rec.brand || rec.vehicleModelDate || rec.mileageFromOdometer || rec.offers)) {
    out.push(rec);
    return;
  }
  if (types.includes('itemlist') && Array.isArray(rec.itemListElement)) {
    for (const el of rec.itemListElement) {
      if (el && typeof el === 'object') {
        const elRec = el as Record<string, unknown>;
        collectVehicleJsonLdNodes(elRec.item || elRec, out);
      }
    }
    return;
  }
  if (Array.isArray(rec['@graph'])) {
    collectVehicleJsonLdNodes(rec['@graph'], out);
  }
}

export function parseStructuredSiteHtml(
  html: string,
  baseUrl?: string
): ExternalParseResult {
  const scriptRegex =
    /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const vehicleNodes: Record<string, unknown>[] = [];
  let match: RegExpExecArray | null;

  while ((match = scriptRegex.exec(html)) !== null) {
    const rawJson = (match[1] || '').trim();
    if (!rawJson) continue;
    try {
      const parsed = JSON.parse(rawJson);
      collectVehicleJsonLdNodes(parsed, vehicleNodes);
    } catch {
      // Skip malformed JSON-LD script blocks cleanly
    }
  }

  const vehicles: NormalizedExternalVehicleInput[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < vehicleNodes.length; i++) {
    const normalized = normalizeVehicleObject(vehicleNodes[i], i, baseUrl);
    if (!normalized) continue;
    if (seen.has(normalized.externalId)) continue;
    seen.add(normalized.externalId);
    vehicles.push(normalized);
  }

  if (vehicles.length === 0) {
    return {
      ok: false,
      status: 'connector_required',
      vehicles: [],
      detail:
        'Nenhum dado estruturado de veículos (JSON-LD) foi encontrado nesta página. Para leitura automática do estoque, informe a URL do feed JSON oficial ou solicite um conector dedicado para o site.',
    };
  }

  return {
    ok: true,
    status: 'ok',
    vehicles,
    detail: `${vehicles.length} veículo(s) identificado(s) via dados estruturados (JSON-LD).`,
  };
}

export function parseExternalInventoryPayload(
  sourceType: ExternalInventorySourceType,
  bodyText: string,
  contentType: string,
  baseUrl?: string
): ExternalParseResult {
  if (sourceType === 'site_connector') {
    return {
      ok: false,
      status: 'connector_required',
      vehicles: [],
      detail:
        'O modo conector dedicado aguarda integração específica com a plataforma do site da revenda. Caso o site possua feed JSON ou dados estruturados (JSON-LD), selecione uma dessas opções.',
    };
  }
  if (sourceType === 'json_feed' || contentType.includes('application/json')) {
    return parseExternalJsonFeed(bodyText, baseUrl);
  }
  return parseStructuredSiteHtml(bodyText, baseUrl);
}

export async function ensureExternalStorefrontSchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS external_inventory_sources (
        store_slug VARCHAR(120) PRIMARY KEY,
        source_type VARCHAR(40) NOT NULL DEFAULT 'json_feed',
        feed_url TEXT,
        auth_header_name VARCHAR(120),
        auth_header_value TEXT,
        sync_interval_minutes INTEGER NOT NULL DEFAULT 30,
        public_link_status VARCHAR(40) NOT NULL DEFAULT 'unverified',
        public_link_checked_at TIMESTAMPTZ,
        public_link_detail TEXT,
        connection_status VARCHAR(40) NOT NULL DEFAULT 'not_configured',
        last_sync_attempt_at TIMESTAMPTZ,
        last_sync_success_at TIMESTAMPTZ,
        last_sync_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS external_vehicles (
        id SERIAL PRIMARY KEY,
        store_slug VARCHAR(120) NOT NULL,
        external_id VARCHAR(255) NOT NULL,
        brand VARCHAR(120) NOT NULL DEFAULT '',
        model VARCHAR(180) NOT NULL DEFAULT '',
        version VARCHAR(200) NOT NULL DEFAULT '',
        year VARCHAR(30) NOT NULL DEFAULT '',
        km INTEGER NOT NULL DEFAULT 0,
        price NUMERIC(12, 2) NOT NULL DEFAULT 0,
        price_confirmed BOOLEAN NOT NULL DEFAULT true,
        transmission VARCHAR(80) NOT NULL DEFAULT '',
        fuel VARCHAR(80) NOT NULL DEFAULT '',
        color VARCHAR(80) NOT NULL DEFAULT '',
        status VARCHAR(40) NOT NULL DEFAULT 'Disponível',
        availability_confirmed BOOLEAN NOT NULL DEFAULT true,
        image_url TEXT NOT NULL DEFAULT '',
        gallery JSONB NOT NULL DEFAULT '[]'::jsonb,
        official_url TEXT,
        optionals JSONB NOT NULL DEFAULT '[]'::jsonb,
        raw_fingerprint VARCHAR(128),
        source_updated_at TIMESTAMPTZ,
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (store_slug, external_id)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_external_vehicles_store_status
        ON external_vehicles (store_slug, status)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_external_vehicles_store_url
        ON external_vehicles (store_slug, official_url)
    `);
  } finally {
    client.release();
  }
}

export async function getExternalSourceSummary(
  storeSlug: string
): Promise<ExternalInventorySourceSummary> {
  const slug = storeSlug.trim() || 'armazem-do-carro';
  const [srcRes, countRes] = await Promise.all([
    pool.query(
      `SELECT store_slug, source_type, feed_url, auth_header_name,
              (auth_header_value IS NOT NULL AND BTRIM(auth_header_value) <> '') AS has_auth_header,
              sync_interval_minutes, public_link_status, public_link_checked_at,
              public_link_detail, connection_status, last_sync_attempt_at,
              last_sync_success_at, last_sync_count, last_error
       FROM external_inventory_sources
       WHERE store_slug = $1
       LIMIT 1`,
      [slug]
    ),
    pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM external_vehicles
       WHERE store_slug = $1 AND status IN ('Disponível', 'Disponivel')`,
      [slug]
    ),
  ]);

  const row = srcRes.rows[0];
  const availableCount = countRes.rows[0]?.count ?? 0;

  if (!row) {
    return {
      storeSlug: slug,
      sourceType: 'json_feed',
      feedUrl: '',
      hasAuthHeader: false,
      authHeaderName: '',
      syncIntervalMinutes: 30,
      publicLinkStatus: 'unverified',
      publicLinkCheckedAt: null,
      publicLinkDetail: null,
      connectionStatus: 'not_configured',
      lastSyncAttemptAt: null,
      lastSyncSuccessAt: null,
      lastSyncCount: 0,
      availableCount,
      lastError: null,
    };
  }

  return {
    storeSlug: String(row.store_slug),
    sourceType: (['json_feed', 'structured_site', 'site_connector'].includes(row.source_type)
      ? row.source_type
      : 'json_feed') as ExternalInventorySourceType,
    feedUrl: row.feed_url ? String(row.feed_url) : '',
    hasAuthHeader: Boolean(row.has_auth_header),
    authHeaderName: row.auth_header_name ? String(row.auth_header_name) : '',
    syncIntervalMinutes: Number(row.sync_interval_minutes) || 30,
    publicLinkStatus: (['valid', 'invalid'].includes(row.public_link_status)
      ? row.public_link_status
      : 'unverified') as ExternalInventorySourceSummary['publicLinkStatus'],
    publicLinkCheckedAt: row.public_link_checked_at
      ? new Date(row.public_link_checked_at).toISOString()
      : null,
    publicLinkDetail: row.public_link_detail ? String(row.public_link_detail) : null,
    connectionStatus: (row.connection_status || 'not_configured') as ExternalSourceHealthStatus,
    lastSyncAttemptAt: row.last_sync_attempt_at
      ? new Date(row.last_sync_attempt_at).toISOString()
      : null,
    lastSyncSuccessAt: row.last_sync_success_at
      ? new Date(row.last_sync_success_at).toISOString()
      : null,
    lastSyncCount: Number(row.last_sync_count) || 0,
    availableCount,
    lastError: row.last_error ? String(row.last_error) : null,
  };
}

export async function saveExternalSourceConfig(
  storeSlug: string,
  input: {
    sourceType?: ExternalInventorySourceType;
    feedUrl?: string;
    authHeaderName?: string;
    authHeaderValue?: string;
    clearAuthHeader?: boolean;
    syncIntervalMinutes?: number;
  },
  options?: { allowLoopbackForTest?: boolean }
): Promise<{ ok: boolean; error?: string; summary?: ExternalInventorySourceSummary }> {
  const slug = storeSlug.trim() || 'armazem-do-carro';
  const sourceType: ExternalInventorySourceType =
    input.sourceType === 'structured_site' || input.sourceType === 'site_connector'
      ? input.sourceType
      : 'json_feed';

  const feedUrlRaw = typeof input.feedUrl === 'string' ? input.feedUrl.trim() : '';
  let normalizedFeedUrl: string | null = null;
  if (feedUrlRaw) {
    const check = await validateExternalUrl(feedUrlRaw, {
      allowLoopbackForTest: options?.allowLoopbackForTest,
    });
    if (!check.ok || !check.normalizedUrl) {
      return { ok: false, error: check.error || 'URL da fonte de dados inválida.' };
    }
    normalizedFeedUrl = check.normalizedUrl;
  }

  const interval = Number(input.syncIntervalMinutes);
  const safeInterval =
    Number.isFinite(interval) && interval >= 5 && interval <= 1440
      ? Math.round(interval)
      : 30;

  const cleanHeaderName =
    typeof input.authHeaderName === 'string'
      ? input.authHeaderName.replace(/[^a-zA-Z0-9\-_]/g, '').slice(0, 100)
      : '';
  const hasNewHeaderVal =
    typeof input.authHeaderValue === 'string' && input.authHeaderValue.trim().length > 0;

  const existingRes = await pool.query<{
    auth_header_name: string | null;
    auth_header_value: string | null;
  }>(
    'SELECT auth_header_name, auth_header_value FROM external_inventory_sources WHERE store_slug = $1 LIMIT 1',
    [slug]
  );
  const existing = existingRes.rows[0];

  const finalHeaderName = input.clearAuthHeader
    ? null
    : cleanHeaderName || existing?.auth_header_name || null;
  const finalHeaderValue = input.clearAuthHeader
    ? null
    : hasNewHeaderVal
      ? input.authHeaderValue!.trim().slice(0, 600)
      : existing?.auth_header_value || null;

  const nextConnStatus: ExternalSourceHealthStatus = !normalizedFeedUrl
    ? 'not_configured'
    : sourceType === 'site_connector'
      ? 'connector_required'
      : 'unverified' as ExternalSourceHealthStatus;

  await pool.query(
    `INSERT INTO external_inventory_sources (
       store_slug, source_type, feed_url, auth_header_name, auth_header_value,
       sync_interval_minutes, connection_status, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (store_slug)
     DO UPDATE SET
       source_type = EXCLUDED.source_type,
       feed_url = EXCLUDED.feed_url,
       auth_header_name = EXCLUDED.auth_header_name,
       auth_header_value = EXCLUDED.auth_header_value,
       sync_interval_minutes = EXCLUDED.sync_interval_minutes,
       connection_status = CASE
         WHEN EXCLUDED.feed_url IS NULL THEN 'not_configured'
         WHEN EXCLUDED.source_type = 'site_connector' THEN 'connector_required'
         ELSE external_inventory_sources.connection_status
       END,
       updated_at = NOW()`,
    [
      slug,
      sourceType,
      normalizedFeedUrl,
      finalHeaderName,
      finalHeaderValue,
      safeInterval,
      nextConnStatus === ('unverified' as ExternalSourceHealthStatus)
        ? 'not_configured'
        : nextConnStatus,
    ]
  );

  const summary = await getExternalSourceSummary(slug);
  return { ok: true, summary };
}

export async function validatePublicStorefrontLink(
  storeSlug: string,
  rawUrl: string,
  options?: { allowLoopbackForTest?: boolean }
): Promise<{
  ok: boolean;
  normalizedUrl?: string;
  httpStatus?: number;
  detail: string;
  summary: ExternalInventorySourceSummary;
}> {
  const slug = storeSlug.trim() || 'armazem-do-carro';
  const syntaxCheck = await validateExternalUrl(rawUrl, {
    allowLoopbackForTest: options?.allowLoopbackForTest,
  });

  if (!syntaxCheck.ok || !syntaxCheck.normalizedUrl) {
    const detail = syntaxCheck.error || 'Link da vitrine oficial inválido.';
    await pool.query(
      `INSERT INTO external_inventory_sources (
         store_slug, public_link_status, public_link_checked_at, public_link_detail, updated_at
       )
       VALUES ($1, 'invalid', NOW(), $2, NOW())
       ON CONFLICT (store_slug)
       DO UPDATE SET
         public_link_status = 'invalid',
         public_link_checked_at = NOW(),
         public_link_detail = EXCLUDED.public_link_detail,
         updated_at = NOW()`,
      [slug, detail]
    );
    return {
      ok: false,
      detail,
      summary: await getExternalSourceSummary(slug),
    };
  }

  let probe = await safeFetchExternalResource(syntaxCheck.normalizedUrl, {
    method: 'HEAD',
    timeoutMs: 8_000,
    allowLoopbackForTest: options?.allowLoopbackForTest,
  });
  // Some storefronts reject HEAD with 405/403 — retry with lightweight GET
  if (!probe.ok && (probe.status === 405 || probe.status === 403 || probe.status === 501)) {
    probe = await safeFetchExternalResource(syntaxCheck.normalizedUrl, {
      method: 'GET',
      timeoutMs: 8_000,
      maxBytes: 256 * 1024,
      allowLoopbackForTest: options?.allowLoopbackForTest,
    });
  }

  const isValid = probe.ok && probe.status >= 200 && probe.status < 400;
  const detail = isValid
    ? `Link público acessível (HTTP ${probe.status}).`
    : probe.error || `Não foi possível acessar o link público (HTTP ${probe.status || 'erro'}).`;

  await pool.query(
    `INSERT INTO external_inventory_sources (
       store_slug, public_link_status, public_link_checked_at, public_link_detail, updated_at
     )
     VALUES ($1, $2, NOW(), $3, NOW())
     ON CONFLICT (store_slug)
     DO UPDATE SET
       public_link_status = EXCLUDED.public_link_status,
       public_link_checked_at = NOW(),
       public_link_detail = EXCLUDED.public_link_detail,
       updated_at = NOW()`,
    [slug, isValid ? 'valid' : 'invalid', detail]
  );

  return {
    ok: isValid,
    normalizedUrl: probe.finalUrl || syntaxCheck.normalizedUrl,
    httpStatus: probe.status,
    detail,
    summary: await getExternalSourceSummary(slug),
  };
}

async function getRawSourceCredentials(storeSlug: string): Promise<{
  sourceType: ExternalInventorySourceType;
  feedUrl: string | null;
  headers: Record<string, string>;
} | null> {
  const res = await pool.query<{
    source_type: string;
    feed_url: string | null;
    auth_header_name: string | null;
    auth_header_value: string | null;
  }>(
    `SELECT source_type, feed_url, auth_header_name, auth_header_value
     FROM external_inventory_sources
     WHERE store_slug = $1
     LIMIT 1`,
    [storeSlug]
  );
  const row = res.rows[0];
  if (!row) return null;
  const headers: Record<string, string> = {};
  if (row.auth_header_name && row.auth_header_value) {
    headers[row.auth_header_name] = row.auth_header_value;
  }
  return {
    sourceType: (['json_feed', 'structured_site', 'site_connector'].includes(row.source_type)
      ? row.source_type
      : 'json_feed') as ExternalInventorySourceType,
    feedUrl: row.feed_url,
    headers,
  };
}

export async function testExternalSourceConnection(
  storeSlug: string,
  override?: {
    sourceType?: ExternalInventorySourceType;
    feedUrl?: string;
    authHeaderName?: string;
    authHeaderValue?: string;
  },
  options?: { allowLoopbackForTest?: boolean }
): Promise<{
  ok: boolean;
  status: ExternalSourceHealthStatus;
  sampleCount: number;
  sampleVehicles: Array<{ title: string; year: string; price: number; officialUrl: string | null }>;
  detail: string;
}> {
  const slug = storeSlug.trim() || 'armazem-do-carro';
  const stored = await getRawSourceCredentials(slug);
  const sourceType = override?.sourceType || stored?.sourceType || 'json_feed';
  const feedUrl = (override?.feedUrl ?? stored?.feedUrl ?? '').trim();

  if (sourceType === 'site_connector') {
    return {
      ok: false,
      status: 'connector_required',
      sampleCount: 0,
      sampleVehicles: [],
      detail:
        'Esta revenda está marcada para conector dedicado. Para teste imediato, informe um feed JSON oficial ou uma página com dados estruturados (JSON-LD).',
    };
  }

  if (!feedUrl) {
    return {
      ok: false,
      status: 'not_configured',
      sampleCount: 0,
      sampleVehicles: [],
      detail: 'Informe a URL do feed JSON ou da página estruturada antes de testar a conexão.',
    };
  }

  const headers: Record<string, string> = { ...(stored?.headers || {}) };
  if (override?.authHeaderName && override?.authHeaderValue) {
    headers[override.authHeaderName.replace(/[^a-zA-Z0-9\-_]/g, '')] =
      override.authHeaderValue.trim();
  }

  const fetched = await safeFetchExternalResource(feedUrl, {
    method: 'GET',
    headers,
    allowLoopbackForTest: options?.allowLoopbackForTest,
  });

  if (!fetched.ok) {
    return {
      ok: false,
      status: 'unavailable',
      sampleCount: 0,
      sampleVehicles: [],
      detail: fetched.error || 'Falha ao conectar à fonte de estoque configurada.',
    };
  }

  const parsed = parseExternalInventoryPayload(
    sourceType,
    fetched.bodyText,
    fetched.contentType,
    fetched.finalUrl
  );

  return {
    ok: parsed.ok,
    status: parsed.status,
    sampleCount: parsed.vehicles.length,
    sampleVehicles: parsed.vehicles.slice(0, 5).map((v) => ({
      title: `${v.brand} ${v.model}`.trim(),
      year: v.year,
      price: v.price,
      officialUrl: v.officialUrl,
    })),
    detail: parsed.detail,
  };
}

/**
 * Synchronizes external dealership vehicles into `external_vehicles`.
 * - Upserts by (store_slug, external_id) so repeated syncs update the same record.
 * - Marks listings absent from a COMPLETE successful sync as 'Indisponível'.
 * - On ANY fetch/parse error, preserves the existing synced catalog intact and marks health 'stale'/'unavailable'.
 */
export async function syncExternalInventory(
  storeSlug: string,
  options?: { allowLoopbackForTest?: boolean }
): Promise<{
  ok: boolean;
  status: ExternalSourceHealthStatus;
  syncedCount: number;
  removedCount: number;
  detail: string;
  summary: ExternalInventorySourceSummary;
}> {
  const slug = storeSlug.trim() || 'armazem-do-carro';
  const creds = await getRawSourceCredentials(slug);

  const countExistingRes = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
     FROM external_vehicles
     WHERE store_slug = $1 AND status IN ('Disponível', 'Disponivel')`,
    [slug]
  );
  const existingAvailable = countExistingRes.rows[0]?.count ?? 0;

  const recordFailure = async (status: ExternalSourceHealthStatus, detail: string) => {
    const effectiveStatus: ExternalSourceHealthStatus =
      status === 'connector_required'
        ? 'connector_required'
        : existingAvailable > 0
          ? 'stale'
          : status;
    await pool.query(
      `INSERT INTO external_inventory_sources (
         store_slug, connection_status, last_sync_attempt_at, last_error, updated_at
       )
       VALUES ($1, $2, NOW(), $3, NOW())
       ON CONFLICT (store_slug)
       DO UPDATE SET
         connection_status = EXCLUDED.connection_status,
         last_sync_attempt_at = NOW(),
         last_error = EXCLUDED.last_error,
         updated_at = NOW()`,
      [slug, effectiveStatus, detail.slice(0, 600)]
    );
    return {
      ok: false,
      status: effectiveStatus,
      syncedCount: 0,
      removedCount: 0,
      detail,
      summary: await getExternalSourceSummary(slug),
    };
  };

  if (!creds || !creds.feedUrl) {
    return recordFailure(
      'not_configured',
      'Nenhuma URL de fonte de estoque foi configurada para esta revenda.'
    );
  }

  if (creds.sourceType === 'site_connector') {
    return recordFailure(
      'connector_required',
      'Conector dedicado ainda não configurado para o site desta revenda.'
    );
  }

  const fetched = await safeFetchExternalResource(creds.feedUrl, {
    method: 'GET',
    headers: creds.headers,
    allowLoopbackForTest: options?.allowLoopbackForTest,
  });

  if (!fetched.ok) {
    return recordFailure(
      'unavailable',
      fetched.error || 'Falha ao consultar a fonte externa de estoque.'
    );
  }

  const parsed = parseExternalInventoryPayload(
    creds.sourceType,
    fetched.bodyText,
    fetched.contentType,
    fetched.finalUrl
  );

  if (!parsed.ok) {
    return recordFailure(parsed.status, parsed.detail);
  }

  const client = await pool.connect();
  let removedCount = 0;
  try {
    await client.query('BEGIN');

    const activeExternalIds: string[] = [];
    for (const v of parsed.vehicles) {
      activeExternalIds.push(v.externalId);
      const fingerprint = crypto
        .createHash('sha1')
        .update(
          JSON.stringify([
            v.brand,
            v.model,
            v.version,
            v.year,
            v.km,
            v.price,
            v.transmission,
            v.status,
            v.officialUrl,
          ])
        )
        .digest('hex');

      await client.query(
        `INSERT INTO external_vehicles (
           store_slug, external_id, brand, model, version, year, km,
           price, price_confirmed, transmission, fuel, color, status,
           availability_confirmed, image_url, gallery, official_url, optionals,
           raw_fingerprint, source_updated_at, last_seen_at, updated_at
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, $7,
           $8, $9, $10, $11, $12, $13,
           $14, $15, $16::jsonb, $17, $18::jsonb,
           $19, $20, NOW(), NOW()
         )
         ON CONFLICT (store_slug, external_id)
         DO UPDATE SET
           brand = EXCLUDED.brand,
           model = EXCLUDED.model,
           version = EXCLUDED.version,
           year = EXCLUDED.year,
           km = EXCLUDED.km,
           price = EXCLUDED.price,
           price_confirmed = EXCLUDED.price_confirmed,
           transmission = EXCLUDED.transmission,
           fuel = EXCLUDED.fuel,
           color = EXCLUDED.color,
           status = EXCLUDED.status,
           availability_confirmed = EXCLUDED.availability_confirmed,
           image_url = EXCLUDED.image_url,
           gallery = EXCLUDED.gallery,
           official_url = EXCLUDED.official_url,
           optionals = EXCLUDED.optionals,
           raw_fingerprint = EXCLUDED.raw_fingerprint,
           source_updated_at = COALESCE(EXCLUDED.source_updated_at, external_vehicles.source_updated_at),
           last_seen_at = NOW(),
           updated_at = NOW()`,
        [
          slug,
          v.externalId,
          v.brand,
          v.model,
          v.version,
          v.year,
          v.km,
          v.price,
          v.priceConfirmed,
          v.transmission,
          v.fuel,
          v.color,
          v.status,
          v.availabilityConfirmed,
          v.imageUrl,
          JSON.stringify(v.gallery),
          v.officialUrl,
          JSON.stringify(v.optionals),
          fingerprint,
          v.sourceUpdatedAt,
        ]
      );
    }

    // Remove listings no longer present in this complete successful sync from available search
    if (activeExternalIds.length > 0) {
      const removedRes = await client.query(
        `UPDATE external_vehicles
         SET status = 'Vendido', availability_confirmed = true, updated_at = NOW()
         WHERE store_slug = $1
           AND status IN ('Disponível', 'Disponivel', 'Reservado')
           AND NOT (external_id = ANY($2::text[]))`,
        [slug, activeExternalIds]
      );
      removedCount = removedRes.rowCount ?? 0;
    } else {
      const removedRes = await client.query(
        `UPDATE external_vehicles
         SET status = 'Vendido', availability_confirmed = true, updated_at = NOW()
         WHERE store_slug = $1
           AND status IN ('Disponível', 'Disponivel', 'Reservado')`,
        [slug]
      );
      removedCount = removedRes.rowCount ?? 0;
    }

    const finalStatus: ExternalSourceHealthStatus =
      parsed.vehicles.length > 0 ? 'ok' : 'empty';

    await client.query(
      `UPDATE external_inventory_sources
       SET connection_status = $2,
           last_sync_attempt_at = NOW(),
           last_sync_success_at = NOW(),
           last_sync_count = $3,
           last_error = NULL,
           updated_at = NOW()
       WHERE store_slug = $1`,
      [slug, finalStatus, parsed.vehicles.length]
    );

    await client.query('COMMIT');
    const summary = await getExternalSourceSummary(slug);
    return {
      ok: true,
      status: finalStatus,
      syncedCount: parsed.vehicles.length,
      removedCount,
      detail:
        parsed.vehicles.length > 0
          ? `Sincronização concluída: ${parsed.vehicles.length} anúncio(s) atualizado(s)${removedCount > 0 ? ` e ${removedCount} removido(s) de disponíveis` : ''}.`
          : 'Sincronização concluída com estoque externo vazio.',
      summary,
    };
  } catch (err: unknown) {
    await client.query('ROLLBACK').catch(() => undefined);
    const msg =
      err instanceof Error ? err.message : 'Erro ao persistir estoque externo sincronizado.';
    return recordFailure('error', msg);
  } finally {
    client.release();
  }
}

function mapExternalRowToVehicle(row: Record<string, unknown>): Vehicle {
  const rawGallery = Array.isArray(row.gallery)
    ? row.gallery.map(String).filter(Boolean)
    : [];
  const rawOptionals = Array.isArray(row.optionals)
    ? row.optionals.map(String).filter(Boolean)
    : [];

  const rawStatus = String(row.status || 'Disponível');
  const status: VehicleStatus =
    rawStatus === 'Reservado'
      ? 'Reservado'
      : rawStatus === 'Vendido' || rawStatus === 'Indisponível'
        ? 'Vendido'
        : 'Disponível';

  return {
    id: `ext-${row.id}`,
    externalId: String(row.external_id || ''),
    brand: String(row.brand || ''),
    model: String(row.model || ''),
    version: String(row.version || ''),
    year: String(row.year || ''),
    km: Number(row.km) || 0,
    price: Number(row.price) || 0,
    fipePrice: 0,
    fipeCode: '',
    fipeReferenceMonth: null,
    color: String(row.color || ''),
    transmission: String(row.transmission || ''),
    fuel: String(row.fuel || ''),
    plate: '',
    renavam: '',
    chassis: '',
    status,
    imageUrl: String(row.image_url || ''),
    gallery: rawGallery,
    optionals: rawOptionals,
    createdAt: row.created_at ? new Date(String(row.created_at)).toISOString() : new Date().toISOString(),
    officialUrl: row.official_url ? String(row.official_url) : null,
    dataSource: 'external',
    sourceUpdatedAt: row.source_updated_at
      ? new Date(String(row.source_updated_at)).toISOString()
      : row.updated_at
        ? new Date(String(row.updated_at)).toISOString()
        : null,
    priceConfirmed: row.price_confirmed !== false && Number(row.price) > 0,
    availabilityConfirmed: row.availability_confirmed !== false,
  };
}

export async function loadExternalVehiclesForChat(storeSlug: string): Promise<{
  vehicles: Vehicle[];
  health: ExternalSourceHealthStatus;
  lastSuccessAt: string | null;
  errorDetail: string | null;
}> {
  const slug = storeSlug.trim() || 'armazem-do-carro';
  const [summary, rowsRes] = await Promise.all([
    getExternalSourceSummary(slug),
    pool.query(
      `SELECT *
       FROM external_vehicles
       WHERE store_slug = $1
       ORDER BY updated_at DESC, id DESC`,
      [slug]
    ),
  ]);

  const vehicles = rowsRes.rows.map((r) => mapExternalRowToVehicle(r as Record<string, unknown>));
  const available = vehicles.filter((v) => v.status === 'Disponível');

  let health: ExternalSourceHealthStatus = summary.connectionStatus;
  if (!summary.feedUrl && available.length === 0) {
    health = summary.sourceType === 'site_connector' ? 'connector_required' : 'not_configured';
  } else if (available.length > 0) {
    const staleByStatus =
      summary.connectionStatus === 'stale' ||
      summary.connectionStatus === 'error' ||
      summary.connectionStatus === 'unavailable';
    const staleByAge = Boolean(
      summary.lastSyncSuccessAt &&
        Date.now() - new Date(summary.lastSyncSuccessAt).getTime() >
          Math.max(summary.syncIntervalMinutes * 4, 180) * 60_000
    );
    health = staleByStatus || staleByAge ? 'stale' : 'ok';
  } else if (summary.connectionStatus === 'empty') {
    health = 'empty';
  } else if (summary.connectionStatus === 'connector_required') {
    health = 'connector_required';
  } else {
    health = 'unavailable';
  }

  return {
    vehicles,
    health,
    lastSuccessAt: summary.lastSyncSuccessAt,
    errorDetail: summary.lastError,
  };
}

function normalizeUrlForExactMatch(raw: string): string | null {
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    parsed.hash = '';
    for (const key of [...parsed.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('utm_') || key.toLowerCase() === 'fbclid' || key.toLowerCase() === 'gclid') {
        parsed.searchParams.delete(key);
      }
    }
    const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${parsed.origin.toLowerCase()}${pathname}${parsed.search}`.toLowerCase();
  } catch {
    return null;
  }
}

export async function findExternalVehicleForContext(
  storeSlug: string,
  params: { vehicleRef?: string | null; pageUrl?: string | null }
): Promise<Vehicle | null> {
  const slug = storeSlug.trim() || 'armazem-do-carro';
  const ref = (params.vehicleRef || '').trim();
  const pageUrl = (params.pageUrl || '').trim();

  if (ref) {
    const numericId = ref.startsWith('ext-') ? Number(ref.slice(4)) : Number(ref);
    const byRef = await pool.query(
      `SELECT *
       FROM external_vehicles
       WHERE store_slug = $1
         AND (external_id = $2 OR ($3::int IS NOT NULL AND id = $3::int))
       LIMIT 2`,
      [slug, ref, Number.isInteger(numericId) && numericId > 0 ? numericId : null]
    );
    if (byRef.rows.length === 1) {
      return mapExternalRowToVehicle(byRef.rows[0] as Record<string, unknown>);
    }
  }

  if (pageUrl) {
    const normalizedPage = normalizeUrlForExactMatch(pageUrl);
    if (!normalizedPage) return null;
    const candidatesRes = await pool.query(
      `SELECT *
       FROM external_vehicles
       WHERE store_slug = $1 AND official_url IS NOT NULL AND BTRIM(official_url) <> ''`,
      [slug]
    );
    const matches = candidatesRes.rows.filter((row) => {
      const normOfficial = normalizeUrlForExactMatch(String(row.official_url || ''));
      return normOfficial !== null && normOfficial === normalizedPage;
    });
    if (matches.length === 1) {
      return mapExternalRowToVehicle(matches[0] as Record<string, unknown>);
    }
  }

  return null;
}
