import {
  ChatMessage,
  DealershipSettings,
  TradeInSessionState,
  Vehicle,
  VehicleCardData,
  VehicleComparisonData,
  VehicleFinancingSummary,
  VehicleSearchFilters,
} from '../types';

export type TransmissionQualityStatus =
  | 'confirmed_auto'
  | 'confirmed_manual'
  | 'conflict'
  | 'unconfirmed';

export interface VehicleDataQuality {
  transmissionStatus: TransmissionQualityStatus;
  canonicalTransmission: 'Automático' | 'Manual' | null;
  displayTransmission: string;
  hasTransmissionConflict: boolean;
  conflictDetail: string | null;
  hasMissingPhoto: boolean;
  hasBrandModelMismatch: boolean;
  hasOutlierPrice: boolean;
  reviewFlags: string[];
  needsReview: boolean;
}

export interface VehicleFipeMetrics {
  hasFipeValue: boolean;
  fipePrice: number | null;
  fipeCode: string | null;
  fipeReferenceMonth: string | null;
  hasReferenceMonth: boolean;
  diffBrl: number | null; // positive means cash price is BELOW FIPE
  diffPct: number | null; // positive means % BELOW FIPE
  isBelowFipe: boolean;
  isConfirmedBelowFipeOffer: boolean;
}

export interface NearMatchVehicle {
  vehicle: Vehicle;
  quality: VehicleDataQuality;
  reasons: string[];
  score: number;
}

export interface InventorySearchResult {
  appliedFilters: VehicleSearchFilters;
  exactMatches: Vehicle[];
  nearMatches: NearMatchVehicle[];
  excludedConflicts: Array<{ vehicle: Vehicle; detail: string }>;
  totalAvailable: number;
}

export interface VehicleReferenceResolution {
  status: 'resolved' | 'ambiguous' | 'none';
  vehicle?: Vehicle;
  candidates?: Vehicle[];
  reason?: string;
}

export interface TradeInExtractedInfo {
  model: string | null;
  year: string | null;
  engine: string | null;
  transmission: string | null;
  km: string | null;
  version: string | null;
  missingFields: string[];
  hasAnyDetail: boolean;
}

export type VisitIntentClassification = 'none' | 'inquiry_only' | 'request_visit';

const AUTO_TEXT_RE =
  /\b(aut\.?|autom[aá]tic[oa]|cvt|e-?cvt|dsg|pdk|tiptronic|steptronic|s-?tronic|powershift|dual[- ]?clutch|at\d?|autom\.)\b/i;
const MANUAL_TEXT_RE = /\b(mec\.?|manual|mec[aâ]nic[oa]|mt\d?)\b/i;

export function normalizeTextForMatch(input: string | null | undefined): string {
  return (input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function isVehicleAvailable(vehicle: Pick<Vehicle, 'status'>): boolean {
  const norm = normalizeTextForMatch(vehicle.status);
  return norm === 'disponivel' || norm === 'available';
}

export function formatBrlCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

export function formatKmBr(km: number): string {
  return `${Math.round(km).toLocaleString('pt-BR')} km`;
}

const KNOWN_AUTOMAKERS = new Set([
  'chevrolet',
  'volkswagen',
  'vw',
  'peugeot',
  'renault',
  'honda',
  'hyundai',
  'fiat',
  'ford',
  'toyota',
  'nissan',
  'jeep',
  'citroen',
  'mitsubishi',
  'bmw',
  'mercedes',
  'audi',
  'kia',
  'chery',
  'byd',
  'gwm',
  'suzuki',
  'subaru',
  'volvo',
  'mini',
  'dodge',
  'ram',
]);

const GENERIC_VEHICLE_STOPWORDS = new Set([
  'hatch',
  'sedan',
  'flex',
  'aut',
  'mec',
  'manual',
  'automatico',
  'automatica',
  'mecanico',
  'mecanica',
  '8v',
  '12v',
  '16v',
  '24v',
  '2p',
  '4p',
  '5p',
  'grand',
  'tour',
  'edition',
  'black',
  'white',
  'silver',
  'plus',
  'pro',
  'max',
  'pack',
  'top',
  'de',
  'do',
  'da',
  'dos',
  'das',
  'com',
  'sem',
  'para',
  'por',
  'em',
  'no',
  'na',
  'turbo',
  'aspirado',
  'gasolina',
  'etanol',
  'diesel',
  'hibrido',
  'eletrico',
  'carro',
  'veiculo',
]);

export function extractVehicleMatchTokens(
  vehicle: Pick<Vehicle, 'brand' | 'model' | 'version'>
): { brandTokens: string[]; modelTokens: string[] } {
  const combined = `${vehicle.brand || ''} ${vehicle.model || ''}`;
  const rawTokens = normalizeTextForMatch(combined)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

  const brandTokens: string[] = [];
  const modelTokens: string[] = [];

  for (const tok of rawTokens) {
    if (GENERIC_VEHICLE_STOPWORDS.has(tok)) continue;
    if (/^(199\d|20[0-2]\d)$/.test(tok)) continue;
    if (/^\d{2,3}cv$/.test(tok)) continue;
    if (/^\d{1,2}$/.test(tok)) continue; // skip '1', '0', '6', '16', '8' from '1.0', '1.6'
    if (tok.length < 3 && !['vw', 'ka', 'up'].includes(tok)) continue;

    if (KNOWN_AUTOMAKERS.has(tok)) {
      if (!brandTokens.includes(tok)) brandTokens.push(tok);
    } else {
      if (!modelTokens.includes(tok)) modelTokens.push(tok);
    }
  }

  return { brandTokens, modelTokens };
}

export function getVehicleDisplayTitle(vehicle: Pick<Vehicle, 'brand' | 'model' | 'version'>): string {
  const brand = (vehicle.brand || '').trim();
  const model = (vehicle.model || '').trim();
  const normBrand = normalizeTextForMatch(brand);
  const normModel = normalizeTextForMatch(model);

  const cleanLeadingSeparator = (raw: string): string =>
    raw.replace(/^[\s\-–—:|/]+/, '').replace(/\s{2,}/g, ' ').trim();

  let combined = '';
  if (normBrand && normModel.startsWith(normBrand)) {
    combined = model;
  } else {
    // Avoid stuttering like "Volkswagen Gol Gol - 1.0..." or "Renault Mégane Megane Grand Tour..."
    const brandWords = brand.split(/\s+/).filter(Boolean);
    const modelWords = model.split(/\s+/).filter(Boolean);
    if (brandWords.length > 0 && modelWords.length > 0) {
      const lastBrandWord = normalizeTextForMatch(brandWords[brandWords.length - 1]);
      const firstModelWord = normalizeTextForMatch(modelWords[0]);
      if (lastBrandWord && lastBrandWord === firstModelWord) {
        const rest = cleanLeadingSeparator(modelWords.slice(1).join(' '));
        combined = rest ? `${brand} ${rest}` : brand;
      } else {
        combined = `${brand} ${cleanLeadingSeparator(model)}`.trim();
      }
    } else {
      combined = `${brand} ${model}`.trim();
    }
  }

  // Collapse adjacent duplicate words (accent/case-insensitive), keeping first spelling
  const tokens = combined.split(/\s+/).filter(Boolean);
  const deduped: string[] = [];
  for (const tok of tokens) {
    const prev = deduped[deduped.length - 1];
    const normTok = normalizeTextForMatch(tok);
    const normPrev = prev ? normalizeTextForMatch(prev) : '';
    if (normTok && normPrev && normTok === normPrev) {
      continue;
    }
    deduped.push(tok);
  }

  return deduped.join(' ').replace(/\s+[-–—]\s+[-–—]\s+/g, ' - ').trim();
}

export function extractModelYear(yearStr: string | null | undefined): number | null {
  if (!yearStr) return null;
  const parts = String(yearStr)
    .split('/')
    .map((p) => parseInt(p.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= 1980 && n <= 2035);
  if (parts.length === 0) return null;
  return parts[parts.length - 1];
}

/**
 * Inspects a vehicle record for transmission conflicts, missing data, or brand/model anomalies.
 * NEVER mutates or auto-corrects the vehicle record — marks conflicting fields as unconfirmed.
 */
export function analyzeVehicleDataQuality(vehicle: Vehicle): VehicleDataQuality {
  const fieldRaw = (vehicle.transmission || '').trim();
  const textCorpus = `${vehicle.model || ''} ${vehicle.version || ''}`.trim();

  const fieldSaysAuto = AUTO_TEXT_RE.test(fieldRaw);
  const fieldSaysManual = MANUAL_TEXT_RE.test(fieldRaw);
  const textSaysAuto = AUTO_TEXT_RE.test(textCorpus);
  const textSaysManual = MANUAL_TEXT_RE.test(textCorpus);

  let transmissionStatus: TransmissionQualityStatus = 'unconfirmed';
  let canonicalTransmission: 'Automático' | 'Manual' | null = null;
  let hasTransmissionConflict = false;
  let conflictDetail: string | null = null;

  if (!fieldRaw) {
    transmissionStatus = 'unconfirmed';
    conflictDetail = 'Câmbio não informado no cadastro';
  } else if (fieldSaysAuto && fieldSaysManual) {
    transmissionStatus = 'conflict';
    hasTransmissionConflict = true;
    conflictDetail = `Campo de câmbio ambíguo ("${fieldRaw}")`;
  } else if (fieldSaysManual && textSaysAuto && !textSaysManual) {
    transmissionStatus = 'conflict';
    hasTransmissionConflict = true;
    conflictDetail = `Versão indica automático ("${textCorpus.match(AUTO_TEXT_RE)?.[0] || 'Aut.'}"), mas o campo câmbio está como "${fieldRaw}"`;
  } else if (fieldSaysAuto && textSaysManual && !textSaysAuto) {
    transmissionStatus = 'conflict';
    hasTransmissionConflict = true;
    conflictDetail = `Versão indica manual ("${textCorpus.match(MANUAL_TEXT_RE)?.[0] || 'Mec.'}"), mas o campo câmbio está como "${fieldRaw}"`;
  } else if (fieldSaysAuto) {
    transmissionStatus = 'confirmed_auto';
    canonicalTransmission = 'Automático';
  } else if (fieldSaysManual) {
    transmissionStatus = 'confirmed_manual';
    canonicalTransmission = 'Manual';
  } else {
    transmissionStatus = 'unconfirmed';
    conflictDetail = `Câmbio "${fieldRaw}" não classificado`;
  }

  const hasMissingPhoto = !(vehicle.imageUrl || '').trim();

  // Detect obvious cross-brand duplication (e.g. brand "Honda" with model "Hyundai Veloster")
  const knownBrands = [
    'hyundai',
    'honda',
    'chevrolet',
    'volkswagen',
    'renault',
    'peugeot',
    'fiat',
    'ford',
    'toyota',
    'jeep',
    'nissan',
    'bmw',
    'mercedes',
    'audi',
    'porsche',
    'kia',
    'mitsubishi',
    'citroen',
  ];
  const normBrand = normalizeTextForMatch(vehicle.brand);
  const normModelVersion = normalizeTextForMatch(`${vehicle.model} ${vehicle.version}`);
  const conflictingOtherBrand = knownBrands.find(
    (b) => b !== normBrand && new RegExp(`\\b${b}\\b`, 'i').test(normModelVersion)
  );
  const hasBrandModelMismatch = Boolean(conflictingOtherBrand);

  // Flag suspiciously high outlier price on older high-km mainstream models (soft review indicator only)
  const modelYear = extractModelYear(vehicle.year);
  const isMainstreamBrand = [
    'renault',
    'fiat',
    'chevrolet',
    'volkswagen',
    'peugeot',
    'ford',
    'hyundai',
    'citroen',
  ].includes(normBrand);
  const hasOutlierPrice = Boolean(
    isMainstreamBrand && modelYear && modelYear <= 2018 && vehicle.km > 120000 && vehicle.price >= 200000
  );

  const reviewFlags: string[] = [];
  if (hasTransmissionConflict && conflictDetail) {
    reviewFlags.push(`Câmbio divergente: ${conflictDetail}`);
  } else if (transmissionStatus === 'unconfirmed') {
    reviewFlags.push('Câmbio não confirmado no cadastro');
  }
  if (hasBrandModelMismatch && conflictingOtherBrand) {
    reviewFlags.push(
      `Marca/modelo divergentes: marca "${vehicle.brand}" com menção a "${conflictingOtherBrand}"`
    );
  }
  if (hasOutlierPrice) {
    reviewFlags.push(
      `Preço atípico para conferência (${formatBrlCurrency(vehicle.price)} em ano ${vehicle.year})`
    );
  }
  if (hasMissingPhoto) {
    reviewFlags.push('Sem foto principal cadastrada');
  }

  const displayTransmission = hasTransmissionConflict
    ? 'Câmbio em conferência'
    : canonicalTransmission || (fieldRaw ? fieldRaw : 'A confirmar');

  return {
    transmissionStatus,
    canonicalTransmission,
    displayTransmission,
    hasTransmissionConflict,
    conflictDetail,
    hasMissingPhoto,
    hasBrandModelMismatch,
    hasOutlierPrice,
    reviewFlags,
    needsReview: reviewFlags.length > 0,
  };
}

/**
 * Truthful FIPE calculation from real persisted data ONLY (never fabricates price * 1.04).
 */
export function computeFipeMetrics(vehicle: Vehicle): VehicleFipeMetrics {
  const fipeVal = Number(vehicle.fipePrice);
  const hasFipeValue = Number.isFinite(fipeVal) && fipeVal > 0;
  const fipeCode = (vehicle.fipeCode || '').trim() || null;
  const fipeReferenceMonth = (vehicle.fipeReferenceMonth || '').trim() || null;
  const hasReferenceMonth = Boolean(fipeReferenceMonth);

  if (!hasFipeValue) {
    return {
      hasFipeValue: false,
      fipePrice: null,
      fipeCode,
      fipeReferenceMonth,
      hasReferenceMonth,
      diffBrl: null,
      diffPct: null,
      isBelowFipe: false,
      isConfirmedBelowFipeOffer: false,
    };
  }

  const diffBrl = Math.round(fipeVal - vehicle.price);
  const diffPct = Number(((diffBrl / fipeVal) * 100).toFixed(1));
  const isBelowFipe = diffBrl > 0;
  // Rule: Without reference month, do NOT advertise as a confirmed below-FIPE offer
  const isConfirmedBelowFipeOffer = isBelowFipe && hasReferenceMonth;

  return {
    hasFipeValue: true,
    fipePrice: fipeVal,
    fipeCode,
    fipeReferenceMonth,
    hasReferenceMonth,
    diffBrl,
    diffPct,
    isBelowFipe,
    isConfirmedBelowFipeOffer,
  };
}

/**
 * Validates that a URL uses strictly http: or https: and has no embedded credentials.
 */
export function isSafeHttpUrl(raw?: string | null): boolean {
  const clean = (raw || '').trim();
  if (!clean) return false;
  try {
    const parsed = new URL(clean);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;
    return Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

export interface PublicStorefrontLinks {
  isExternal: boolean;
  catalogUrl: string;
  homeUrl: string;
  catalogLabel: string;
  catalogCtaLabel: string;
  backToCatalogLabel: string;
}

/**
 * Resolves public storefront navigation URLs and labels from DealershipSettings.
 * Defaults safely to internal storefront unless external mode is active with a valid http(s) catalog URL.
 */
export function resolvePublicStorefrontLinks(
  settings?: Partial<DealershipSettings> | null
): PublicStorefrontLinks {
  const externalCatalog = (settings?.externalCatalogUrl || '').trim();
  const externalHome = (settings?.externalHomeUrl || '').trim();
  const isExternal =
    settings?.storefrontMode === 'external' && isSafeHttpUrl(externalCatalog);

  if (isExternal) {
    return {
      isExternal: true,
      catalogUrl: externalCatalog,
      homeUrl: isSafeHttpUrl(externalHome) ? externalHome : externalCatalog,
      catalogLabel: 'Ver carros no site da revenda',
      catalogCtaLabel: 'Ver vitrine da revenda',
      backToCatalogLabel: 'Ver vitrine da revenda',
    };
  }

  return {
    isExternal: false,
    catalogUrl: '/',
    homeUrl: '/inicio',
    catalogLabel: 'Estoque de Veículos',
    catalogCtaLabel: 'Explorar Estoque',
    backToCatalogLabel: 'Voltar à vitrine',
  };
}

export interface ResolvedVehicleSheetLink {
  href: string;
  fullUrl: string;
  isExternal: boolean;
  hasOfficialVehicleUrl: boolean;
  label: string;
}

export function resolveVehicleSheetLink(
  vehicle: Pick<Vehicle, 'id' | 'officialUrl' | 'dataSource'>,
  origin?: string | null,
  dealership?: Partial<DealershipSettings> | null
): ResolvedVehicleSheetLink {
  const storefront = resolvePublicStorefrontLinks(dealership);
  const official = (vehicle.officialUrl || '').trim();
  const hasOfficial = isSafeHttpUrl(official);

  if (storefront.isExternal || vehicle.dataSource === 'external') {
    if (hasOfficial) {
      return {
        href: official,
        fullUrl: official,
        isExternal: true,
        hasOfficialVehicleUrl: true,
        label: 'Ver ficha oficial',
      };
    }
    if (storefront.isExternal) {
      return {
        href: storefront.catalogUrl,
        fullUrl: storefront.catalogUrl,
        isExternal: true,
        hasOfficialVehicleUrl: false,
        label: 'Ver vitrine da revenda',
      };
    }
  }

  const path = buildVehicleSheetPath(vehicle.id);
  const full = buildVehicleSheetUrl(vehicle.id, origin);
  return {
    href: path,
    fullUrl: full,
    isExternal: false,
    hasOfficialVehicleUrl: false,
    label: 'Ver ficha',
  };
}

/**
 * Builds canonical shareable vehicle sheet path and full URL.
 */
export function buildVehicleSheetPath(vehicleId: string | number): string {
  const cleanId = encodeURIComponent(String(vehicleId).trim());
  return `/veiculo/${cleanId}`;
}

export function buildVehicleSheetUrl(
  vehicleId: string | number,
  origin?: string | null
): string {
  const path = buildVehicleSheetPath(vehicleId);
  const cleanOrigin = (origin || '').trim().replace(/\/+$/, '');
  if (!cleanOrigin) return path;
  return `${cleanOrigin}${path}`;
}

export function toVehicleCardData(
  vehicle: Vehicle,
  origin?: string | null,
  alternativeNote?: string | null,
  dealership?: Partial<DealershipSettings> | null
): VehicleCardData {
  const quality = analyzeVehicleDataQuality(vehicle);
  const fipe = computeFipeMetrics(vehicle);
  const link = resolveVehicleSheetLink(vehicle, origin, dealership);
  return {
    id: vehicle.id,
    brand: vehicle.brand,
    model: vehicle.model,
    version: vehicle.version,
    year: vehicle.year,
    price: vehicle.price,
    km: vehicle.km,
    status: vehicle.status,
    fuel: vehicle.fuel,
    transmission: quality.displayTransmission,
    transmissionConfirmed: !quality.hasTransmissionConflict && quality.transmissionStatus !== 'unconfirmed',
    transmissionConflictNote: quality.hasTransmissionConflict ? quality.conflictDetail : null,
    imageUrl: vehicle.imageUrl || '',
    fipePrice: fipe.fipePrice,
    fipeReferenceMonth: fipe.fipeReferenceMonth,
    fipeDiffBrl: fipe.diffBrl,
    fipeDiffPct: fipe.diffPct,
    isConfirmedBelowFipeOffer: fipe.isConfirmedBelowFipeOffer,
    sheetPath: link.href,
    sheetUrl: link.fullUrl,
    officialUrl: link.hasOfficialVehicleUrl ? link.fullUrl : null,
    isExternalUrl: link.isExternal,
    dataSource: vehicle.dataSource || 'internal',
    priceConfirmed: vehicle.priceConfirmed !== false && vehicle.price > 0,
    availabilityConfirmed: vehicle.availabilityConfirmed !== false,
    alternativeNote: alternativeNote || null,
  };
}

/**
 * Parses Brazilian number expressions like "60 mil", "60k", "60.000", "55,9 mil", "90000".
 */
export function parsePtBrNumericAmount(raw: string): number | null {
  const cleaned = raw
    .toLowerCase()
    .replace(/r\$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const milMatch = cleaned.match(/^(\d+(?:[.,]\d+)?)\s*(?:mil|k)\b/);
  if (milMatch) {
    const num = parseFloat(milMatch[1].replace(',', '.'));
    return Number.isFinite(num) ? Math.round(num * 1000) : null;
  }

  // Handle "60.000" or "60.000,00" or "60000"
  const plainMatch = cleaned.match(/^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/);
  if (plainMatch) {
    const intPart = plainMatch[1].replace(/\./g, '');
    const decPart = plainMatch[2] ? `.${plainMatch[2]}` : '';
    const num = parseFloat(`${intPart}${decPart}`);
    return Number.isFinite(num) ? Math.round(num) : null;
  }

  return null;
}

function hasFilterResetPhrase(normMsg: string): boolean {
  return /\b(limpar filtros?|remover filtros?|todos os carros|ver todo o estoque|ver estoque completo|mostrar tudo|recome[çc]ar busca|qualquer carro)\b/i.test(
    normMsg
  );
}

/**
 * Deterministically extracts structured search filters from a user message in PT-BR,
 * preserving active filters from previous turns when the user modifies only one criterion.
 */
export function parseFiltersDeterministically(
  message: string,
  previousFilters?: VehicleSearchFilters | null,
  knownVehicles: Vehicle[] = []
): {
  filters: VehicleSearchFilters;
  hasNewConstraints: boolean;
  wasReset: boolean;
} {
  const norm = normalizeTextForMatch(message);
  const wasReset = hasFilterResetPhrase(norm);
  const base: VehicleSearchFilters = wasReset
    ? {}
    : { ...(previousFilters || {}) };

  let hasNewConstraints = wasReset;

  // Guard: don't misinterpret down payment ("entrada de 20 mil") or trade-in ("tenho um Sandero 2019 com 75 mil km") as stock search filters
  const isTradeInDescription =
    /\b(tenho um|meu carro|dar na troca|na troca|avaliar meu|para troca)\b/i.test(norm);
  const isFinancingDownPayment =
    /\b(entrada|parcela|parcelas|financiar|financiamento|meses|vezes|\d+x)\b/i.test(norm);

  // 1. Transmission filter
  if (
    /\b(qualquer cambio|tanto faz o cambio|sem preferencia de cambio|manual ou automatico|automatico ou manual)\b/i.test(
      norm
    ) ||
    (!isTradeInDescription &&
      previousFilters?.transmission === 'automatico' &&
      /\b(agora\s+)?(?:pode\s+ser|aceito|tambem\s+pode\s+ser|tanto\s+faz)\s+manual\b/i.test(
        norm
      )) ||
    (!isTradeInDescription &&
      previousFilters?.transmission === 'manual' &&
      /\b(agora\s+)?(?:pode\s+ser|aceito|tambem\s+pode\s+ser|tanto\s+faz)\s+automatico\b/i.test(
        norm
      ))
  ) {
    base.transmission = null;
    hasNewConstraints = true;
  } else if (
    !isTradeInDescription &&
    /\b(automatico|automatica|aut\.|cvt|dsg|sem embreagem)\b/i.test(norm)
  ) {
    base.transmission = 'automatico';
    hasNewConstraints = true;
  } else if (
    !isTradeInDescription &&
    /\b(manual|mecanico|mecanica|mec\.)\b/i.test(norm)
  ) {
    base.transmission = 'manual';
    hasNewConstraints = true;
  }

  // 2. Max KM filter (must check before maxPrice so "90 mil km" isn't parsed as price)
  if (/\b(sem limite de km|qualquer km|qualquer quilometragem)\b/i.test(norm)) {
    base.maxKm = null;
    hasNewConstraints = true;
  } else if (!isTradeInDescription) {
    const kmMatch =
      norm.match(
        /(?:ate|no maximo|maximo de|menos de|abaixo de|com ate|com no maximo|(?:aument[ae]r?|subir|sobe|mud[ae]r?|alter[ae]r?|passar|ir)\s+(?:o\s+limite\s+)?(?:para|pra)|<=?)\s*(\d+(?:[.,]\d+)?\s*(?:mil|k)|\d{1,3}(?:\.\d{3})+|\d{4,6})\s*(?:km|quilometros?)\b/i
      ) ||
      norm.match(
        /\b(\d+(?:[.,]\d+)?\s*(?:mil|k)|\d{1,3}(?:\.\d{3})+|\d{4,6})\s*(?:km|quilometros?)\s*(?:no maximo|ou menos|para baixo)\b/i
      );
    if (kmMatch?.[1]) {
      const parsedKm = parsePtBrNumericAmount(kmMatch[1]);
      if (parsedKm && parsedKm >= 1000 && parsedKm <= 500000) {
        base.maxKm = parsedKm;
        hasNewConstraints = true;
      }
    }
  }

  // 3. Max Price filter
  if (/\b(sem limite de preco|qualquer preco|qualquer valor)\b/i.test(norm)) {
    base.maxPrice = null;
    hasNewConstraints = true;
  } else if (!isTradeInDescription) {
    // Strip km phrases and down-payment phrases before scanning for budget
    const withoutKmAndDownPayment = norm
      .replace(
        /(?:ate|no maximo|maximo de|menos de|abaixo de|com ate|(?:aument[ae]r?|subir|sobe|mud[ae]r?|alter[ae]r?|passar)\s+(?:para|pra)|<=?)?\s*\d+(?:[.,]\d+)?\s*(?:mil|k)?\s*(?:km|quilometros?)\b/gi,
        ' '
      )
      .replace(
        /(?:entrada\s*(?:de)?|com)\s*(?:r\$\s*)?\d+(?:[.,]\d+)?\s*(?:mil|k|\.\d{3})*\s*(?:de entrada)?/gi,
        ' '
      );

    const priceMatch =
      withoutKmAndDownPayment.match(
        /(?:ate|no maximo|maximo de|abaixo de|menos de|orcamento de|valor de|limite de|por ate|(?:aument[ae]r?|subir|sobe|mud[ae]r?|alter[ae]r?|passar)\s+(?:o\s+orcamento\s+|o\s+valor\s+|o\s+limite\s+)?(?:para|pra)|<=?)\s*(?:r\$\s*)?(\d+(?:[.,]\d+)?\s*(?:mil|k)|\d{1,3}(?:\.\d{3})+|\d{5,7})(?!\s*(?:km|meses|x\b|vezes|parcelas))/i
      ) ||
      (!isFinancingDownPayment
        ? withoutKmAndDownPayment.match(
            /r\$\s*(\d+(?:[.,]\d+)?\s*(?:mil|k)|\d{1,3}(?:\.\d{3})+|\d{5,7})\b/i
          )
        : null);

    if (priceMatch?.[1]) {
      const parsedPrice = parsePtBrNumericAmount(priceMatch[1]);
      if (parsedPrice && parsedPrice >= 10000 && parsedPrice <= 5000000) {
        base.maxPrice = parsedPrice;
        hasNewConstraints = true;
      }
    }
  }

  // 4. Min Year filter
  if (!isTradeInDescription) {
    const yearMatch = norm.match(
      /(?:a partir de|ano|acima de|de)\s*(20[0-2]\d)\s*(?:em diante|pra cima|para cima|\+)?\b/i
    );
    if (yearMatch?.[1] && !/\b(sandero|meu|tenho)\b/i.test(norm)) {
      const yr = parseInt(yearMatch[1], 10);
      if (yr >= 2000 && yr <= 2030) {
        base.minYear = yr;
        hasNewConstraints = true;
      }
    }
  }

  // 5. Below FIPE filter
  if (/\b(abaixo da fipe|menor que a fipe|desconto na fipe|oportunidade fipe)\b/i.test(norm)) {
    base.belowFipeOnly = true;
    hasNewConstraints = true;
  }

  // 6. Brand / Model filter (supports dealership rows where model sits inside brand, e.g. "Chevrolet Onix")
  if (!isTradeInDescription && knownVehicles.length > 0) {
    const allBrandTokens = new Set<string>();
    const allModelTokens = new Set<string>();
    for (const v of knownVehicles) {
      const { brandTokens, modelTokens } = extractVehicleMatchTokens(v);
      brandTokens.forEach((t) => allBrandTokens.add(t));
      modelTokens.forEach((t) => allModelTokens.add(t));
    }

    for (const bTok of allBrandTokens) {
      if (new RegExp(`\\b${bTok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(norm)) {
        base.brand = bTok;
        hasNewConstraints = true;
        break;
      }
    }

    for (const mTok of allModelTokens) {
      if (new RegExp(`\\b${mTok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(norm)) {
        base.model = mTok;
        hasNewConstraints = true;
        break;
      }
    }
  }

  return {
    filters: base,
    hasNewConstraints,
    wasReset,
  };
}

export function hasAnyActiveFilter(filters?: VehicleSearchFilters | null): boolean {
  if (!filters) return false;
  return Boolean(
    filters.transmission ||
      (filters.maxPrice && filters.maxPrice > 0) ||
      (filters.minPrice && filters.minPrice > 0) ||
      (filters.maxKm && filters.maxKm > 0) ||
      (filters.minYear && filters.minYear > 0) ||
      filters.brand ||
      filters.model ||
      filters.belowFipeOnly
  );
}

export function describeActiveFilters(filters?: VehicleSearchFilters | null): string[] {
  if (!filters) return [];
  const parts: string[] = [];
  if (filters.transmission === 'automatico') parts.push('Câmbio automático');
  if (filters.transmission === 'manual') parts.push('Câmbio manual');
  if (filters.maxPrice) parts.push(`Até ${formatBrlCurrency(filters.maxPrice)}`);
  if (filters.maxKm) parts.push(`Até ${formatKmBr(filters.maxKm)}`);
  if (filters.minYear) parts.push(`Ano a partir de ${filters.minYear}`);
  if (filters.brand) parts.push(`Marca ${filters.brand}`);
  if (filters.model) parts.push(`Modelo ${filters.model}`);
  if (filters.belowFipeOnly) parts.push('Confirmado abaixo da FIPE');
  return parts;
}

export interface VehicleFilterMatchCheck {
  matches: boolean;
  mismatches: string[];
  shortReason: string | null;
}

/**
 * Checks whether a specifically focused vehicle satisfies the previously active search filters.
 * Used to clearly explain when a directly requested vehicle (e.g. Onix Manual) sits outside
 * the customer's earlier search (e.g. Automáticos até R$ 60 mil).
 */
export function checkVehicleAgainstFilters(
  vehicle: Vehicle,
  filters?: VehicleSearchFilters | null
): VehicleFilterMatchCheck {
  if (!filters || !hasAnyActiveFilter(filters)) {
    return { matches: true, mismatches: [], shortReason: null };
  }

  const quality = analyzeVehicleDataQuality(vehicle);
  const fipe = computeFipeMetrics(vehicle);
  const mismatches: string[] = [];

  if (filters.transmission === 'automatico') {
    if (quality.hasTransmissionConflict || quality.transmissionStatus === 'unconfirmed') {
      mismatches.push('câmbio em conferência cadastral (sua busca anterior era por automáticos)');
    } else if (quality.transmissionStatus !== 'confirmed_auto') {
      mismatches.push('câmbio manual (fora da sua busca por automáticos)');
    }
  } else if (filters.transmission === 'manual') {
    if (quality.hasTransmissionConflict || quality.transmissionStatus === 'unconfirmed') {
      mismatches.push('câmbio em conferência cadastral (sua busca anterior era por manuais)');
    } else if (quality.transmissionStatus !== 'confirmed_manual') {
      mismatches.push('câmbio automático (fora da sua busca por manuais)');
    }
  }

  if (filters.maxPrice && vehicle.price > filters.maxPrice) {
    mismatches.push(
      `preço ${formatBrlCurrency(vehicle.price)} acima do limite de ${formatBrlCurrency(filters.maxPrice)}`
    );
  }
  if (filters.maxKm && vehicle.km > filters.maxKm) {
    mismatches.push(
      `km ${formatKmBr(vehicle.km)} acima do limite de ${formatKmBr(filters.maxKm)}`
    );
  }
  if (filters.minYear) {
    const modelYr = extractModelYear(vehicle.year);
    if (modelYr && modelYr < filters.minYear) {
      mismatches.push(`ano ${vehicle.year} abaixo de ${filters.minYear}`);
    }
  }
  if (filters.belowFipeOnly && !fipe.isConfirmedBelowFipeOffer) {
    mismatches.push('sem oferta confirmada abaixo da FIPE');
  }

  return {
    matches: mismatches.length === 0,
    mismatches,
    shortReason: mismatches.length > 0 ? mismatches.join(' · ') : null,
  };
}

/**
 * Deterministic inventory search & ranking engine.
 * Enforces ALL filters conjunctively with inclusive limits, never uses conflicting
 * transmissions to satisfy mandatory transmission filters, and computes concrete
 * deltas for close alternatives when exact matches are empty.
 */
export function searchAndRankInventory(
  vehicles: Vehicle[],
  filters: VehicleSearchFilters = {}
): InventorySearchResult {
  const available = vehicles.filter((v) => isVehicleAvailable(v));
  const exactMatches: Vehicle[] = [];
  const nearMatches: NearMatchVehicle[] = [];
  const excludedConflicts: Array<{ vehicle: Vehicle; detail: string }> = [];

  for (const v of available) {
    const quality = analyzeVehicleDataQuality(v);
    const fipe = computeFipeMetrics(v);
    const missReasons: string[] = [];
    let penaltyScore = 0;

    // 1. Transmission check (STRICT: conflict/unconfirmed NEVER satisfies mandatory filter)
    if (filters.transmission) {
      const wantAuto = filters.transmission === 'automatico';
      if (quality.hasTransmissionConflict || quality.transmissionStatus === 'unconfirmed') {
        const detail =
          quality.conflictDetail || 'Câmbio não confirmado no cadastro (em revisão)';
        excludedConflicts.push({ vehicle: v, detail });
        missReasons.push(
          `câmbio em conferência cadastral (${detail}) — não confirmado como ${wantAuto ? 'automático' : 'manual'}`
        );
        penaltyScore += 60;
      } else if (wantAuto && quality.transmissionStatus !== 'confirmed_auto') {
        missReasons.push(`câmbio manual (você pediu automático)`);
        penaltyScore += 100;
      } else if (!wantAuto && quality.transmissionStatus !== 'confirmed_manual') {
        missReasons.push(`câmbio automático (você pediu manual)`);
        penaltyScore += 100;
      }
    }

    // 2. Price check (inclusive <=)
    if (filters.maxPrice && filters.maxPrice > 0) {
      if (v.price > filters.maxPrice) {
        const over = Math.round(v.price - filters.maxPrice);
        const overPct = over / filters.maxPrice;
        missReasons.push(
          `${formatBrlCurrency(over)} acima do limite de ${formatBrlCurrency(filters.maxPrice)}`
        );
        penaltyScore +=
          overPct <= 0.35 ? 25 + overPct * 120 : overPct <= 0.75 ? 80 + overPct * 80 : 260;
      }
    }

    if (filters.minPrice && filters.minPrice > 0 && v.price < filters.minPrice) {
      const under = Math.round(filters.minPrice - v.price);
      missReasons.push(
        `${formatBrlCurrency(under)} abaixo do valor mínimo de ${formatBrlCurrency(filters.minPrice)}`
      );
      penaltyScore += 40;
    }

    // 3. KM check (inclusive <=)
    if (filters.maxKm && filters.maxKm > 0) {
      if (v.km > filters.maxKm) {
        const overKm = Math.round(v.km - filters.maxKm);
        const overRatio = overKm / filters.maxKm;
        missReasons.push(
          `${formatKmBr(overKm)} acima do limite de ${formatKmBr(filters.maxKm)}`
        );
        penaltyScore +=
          overRatio <= 0.6 ? 20 + overRatio * 65 : overRatio <= 1.2 ? 75 + overRatio * 40 : 160;
      }
    }

    // 4. Min Year check (inclusive >=)
    if (filters.minYear && filters.minYear > 0) {
      const modelYr = extractModelYear(v.year);
      if (modelYr && modelYr < filters.minYear) {
        missReasons.push(`ano ${v.year} abaixo do mínimo ${filters.minYear}`);
        penaltyScore += 50;
      }
    }

    // 5. Brand check
    if (filters.brand) {
      const normWanted = normalizeTextForMatch(filters.brand);
      const normActual = normalizeTextForMatch(`${v.brand} ${v.model}`);
      if (!normActual.includes(normWanted)) {
        missReasons.push(`marca ${v.brand} (você filtrou por ${filters.brand})`);
        penaltyScore += 150;
      }
    }

    // 6. Model check
    if (filters.model) {
      const normWanted = normalizeTextForMatch(filters.model);
      const normActual = normalizeTextForMatch(`${v.brand} ${v.model} ${v.version}`);
      if (!normActual.includes(normWanted)) {
        missReasons.push(`modelo ${v.model} (você filtrou por ${filters.model})`);
        penaltyScore += 150;
      }
    }

    // 7. Below FIPE check (only confirmed below FIPE with real price AND reference month)
    if (filters.belowFipeOnly && !fipe.isConfirmedBelowFipeOffer) {
      missReasons.push(
        fipe.hasFipeValue
          ? fipe.hasReferenceMonth
            ? 'preço não está abaixo da tabela FIPE'
            : 'FIPE cadastrada sem mês de referência confirmado'
          : 'valor FIPE não cadastrado neste veículo'
      );
      penaltyScore += 120;
    }

    if (missReasons.length === 0) {
      exactMatches.push(v);
    } else if (penaltyScore < 210) {
      // Only suggest genuinely close alternatives (avoid suggesting R$ 299.900 for a R$ 60.000 search)
      nearMatches.push({
        vehicle: v,
        quality,
        reasons: missReasons,
        score: penaltyScore,
      });
    }
  }

  // Deterministic ranking: lower km / cleaner data / closer to budget first
  exactMatches.sort((a, b) => {
    const qa = analyzeVehicleDataQuality(a).needsReview ? 1 : 0;
    const qb = analyzeVehicleDataQuality(b).needsReview ? 1 : 0;
    if (qa !== qb) return qa - qb;
    if (a.price !== b.price) return a.price - b.price;
    return a.km - b.km;
  });

  nearMatches.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return a.vehicle.km - b.vehicle.km;
  });

  return {
    appliedFilters: filters,
    exactMatches,
    nearMatches: nearMatches.slice(0, 3),
    excludedConflicts,
    totalAvailable: available.length,
  };
}

/**
 * Resolves a customer reference like "o Onix que você indicou", "esse Gol", "a ficha do 13"
 * using actual vehicle IDs and recent conversation context, flagging ambiguity cleanly.
 */
export function resolveVehicleReference(
  message: string,
  allVehicles: Vehicle[],
  contextVehicleIds: string[] = [],
  focusedVehicleId?: string | null
): VehicleReferenceResolution {
  const norm = normalizeTextForMatch(message);

  // 1. Direct ID mention ("veiculo 13", "#13", "/veiculo/13")
  const idMatch = norm.match(/(?:veiculo\/?|#)\s*(\d+)\b/);
  if (idMatch?.[1]) {
    const found = allVehicles.find((v) => String(v.id) === idMatch[1]);
    if (found) return { status: 'resolved', vehicle: found, reason: 'id_match' };
  }

  const contextVehicles = contextVehicleIds
    .map((id) => allVehicles.find((v) => String(v.id) === String(id)))
    .filter((v): v is Vehicle => Boolean(v));

  // 2. Ordinal references ("o primeiro", "o segundo", "o terceiro")
  if (contextVehicles.length > 0) {
    if (/\b(primeiro|1o|1º|opcao 1)\b/i.test(norm) && contextVehicles[0]) {
      return { status: 'resolved', vehicle: contextVehicles[0], reason: 'ordinal_1' };
    }
    if (/\b(segundo|2o|2º|opcao 2)\b/i.test(norm) && contextVehicles[1]) {
      return { status: 'resolved', vehicle: contextVehicles[1], reason: 'ordinal_2' };
    }
    if (/\b(terceiro|3o|3º|opcao 3)\b/i.test(norm) && contextVehicles[2]) {
      return { status: 'resolved', vehicle: contextVehicles[2], reason: 'ordinal_3' };
    }
  }

  // 3. Match model tokens first (more specific), then fallback to brand tokens
  const matchesToken = (tok: string) =>
    new RegExp(`\\b${tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(norm);

  const byModelMention = allVehicles.filter((v) => {
    const modelNorm = normalizeTextForMatch(v.model);
    if (modelNorm.length >= 4 && norm.includes(modelNorm)) return true;
    const { modelTokens } = extractVehicleMatchTokens(v);
    return modelTokens.some(matchesToken);
  });

  const byBrandMention =
    byModelMention.length > 0
      ? []
      : allVehicles.filter((v) => {
          const { brandTokens } = extractVehicleMatchTokens(v);
          return brandTokens.some(matchesToken);
        });

  const mentioned = byModelMention.length > 0 ? byModelMention : byBrandMention;

  if (mentioned.length === 1) {
    return { status: 'resolved', vehicle: mentioned[0], reason: 'unique_mention' };
  }

  if (mentioned.length > 1) {
    // Disambiguate by year or price or version keyword mentioned in message
    const yearInMsg = norm.match(/\b(20[0-2]\d)\b/)?.[1];
    if (yearInMsg) {
      const byYear = mentioned.filter((v) => v.year.includes(yearInMsg));
      if (byYear.length === 1) {
        return { status: 'resolved', vehicle: byYear[0], reason: 'year_disambiguated' };
      }
    }

    if (/\b(black edition|joy|griffe|dynamique|veloster|touring|sport)\b/i.test(norm)) {
      const kw = norm.match(/\b(black edition|joy|griffe|dynamique|veloster|touring|sport)\b/i)![1];
      const byKw = mentioned.filter((v) =>
        normalizeTextForMatch(`${v.model} ${v.version}`).includes(kw)
      );
      if (byKw.length === 1) {
        return { status: 'resolved', vehicle: byKw[0], reason: 'version_disambiguated' };
      }
    }

    // Disambiguate by explicitly mentioned transmission (e.g. "Onix manual" vs Onix automático/conflito)
    if (/\b(manual|mecanico|mecanica)\b/i.test(norm) && !/\bautomatico\b/i.test(norm)) {
      const byManual = mentioned.filter(
        (v) => analyzeVehicleDataQuality(v).transmissionStatus === 'confirmed_manual'
      );
      if (byManual.length === 1) {
        return { status: 'resolved', vehicle: byManual[0], reason: 'transmission_disambiguated' };
      }
    } else if (/\b(automatico|automatica)\b/i.test(norm) && !/\bmanual\b/i.test(norm)) {
      const byAuto = mentioned.filter(
        (v) => analyzeVehicleDataQuality(v).transmissionStatus === 'confirmed_auto'
      );
      if (byAuto.length === 1) {
        return { status: 'resolved', vehicle: byAuto[0], reason: 'transmission_disambiguated' };
      }
    }

    // Disambiguate using context vehicles shown previously ("o Onix que você indicou")
    if (contextVehicles.length > 0) {
      const inContext = mentioned.filter((m) =>
        contextVehicles.some((cv) => cv.id === m.id)
      );
      if (inContext.length === 1) {
        return { status: 'resolved', vehicle: inContext[0], reason: 'context_disambiguated' };
      }
      if (inContext.length > 1) {
        // Check focused vehicle if user says "esse Onix" / "dele"
        if (
          focusedVehicleId &&
          /\b(esse|este|desse|deste|dele|indicou|falou|citou)\b/i.test(norm)
        ) {
          const focused = inContext.find((v) => v.id === focusedVehicleId);
          if (focused) {
            return { status: 'resolved', vehicle: focused, reason: 'focused_disambiguated' };
          }
        }
        return {
          status: 'ambiguous',
          candidates: inContext,
          reason: 'multiple_in_context',
        };
      }
    }

    return {
      status: 'ambiguous',
      candidates: mentioned,
      reason: 'multiple_in_inventory',
    };
  }

  // 4. Anaphoric reference ("ficha dele", "desse carro", "esse veículo", "simular ele")
  if (
    /\b(dele|dela|desse|deste|esse carro|este carro|esse veiculo|este veiculo|ficha completa|manda a ficha|link da ficha|ver a ficha|valor da entrada|financiar)\b/i.test(
      norm
    )
  ) {
    if (focusedVehicleId) {
      const focused = allVehicles.find((v) => v.id === focusedVehicleId);
      if (focused) return { status: 'resolved', vehicle: focused, reason: 'focused_anaphora' };
    }
    if (contextVehicles.length === 1) {
      return { status: 'resolved', vehicle: contextVehicles[0], reason: 'single_context' };
    }
    if (contextVehicles.length > 1) {
      return {
        status: 'ambiguous',
        candidates: contextVehicles.slice(0, 3),
        reason: 'multiple_context_anaphora',
      };
    }
  }

  return { status: 'none' };
}

/**
 * Extracts financing parameters (down payment & term in months) from a user message.
 */
export function parseFinancingParams(message: string): {
  downPayment: number | null;
  months: number | null;
  isFinancingRequest: boolean;
} {
  const norm = normalizeTextForMatch(message);
  const isFinancingRequest =
    /\b(financ|entrada|parcela|parcelas|simular|simulacao|meses|\d+\s*x\b|saldo a financiar)\b/i.test(
      norm
    );

  let downPayment: number | null = null;
  const dpMatch =
    norm.match(
      /(?:entrada\s*(?:de)?|dando|dar)\s*(?:r\$\s*)?(\d+(?:[.,]\d+)?\s*(?:mil|k)|\d{1,3}(?:\.\d{3})+|\d{4,7})/i
    ) ||
    norm.match(
      /(?:r\$\s*)?(\d+(?:[.,]\d+)?\s*(?:mil|k)|\d{1,3}(?:\.\d{3})+|\d{4,7})\s*(?:de entrada|entrada)\b/i
    );
  if (dpMatch?.[1]) {
    downPayment = parsePtBrNumericAmount(dpMatch[1]);
  }

  let months: number | null = null;
  const termMatch = norm.match(/\b(12|18|24|36|48|60|72)\s*(?:x|vezes|meses|parcelas)\b/i);
  if (termMatch?.[1]) {
    months = parseInt(termMatch[1], 10);
  }

  return { downPayment, months, isFinancingRequest };
}

/**
 * Deterministic financing calculation.
 * Calculates exact principal balance (price - downPayment).
 * NEVER quotes a monthly installment unless a valid monthlyRatePct (> 0) is provided.
 */
export function computeFinancingSummary(params: {
  vehicle: Vehicle;
  downPayment: number;
  months?: number | null;
  monthlyRatePct?: number | null;
}): VehicleFinancingSummary {
  const vehiclePrice = Math.max(0, Math.round(params.vehicle.price));
  const safeDown = Math.max(0, Math.min(vehiclePrice, Math.round(params.downPayment)));
  const principalBalance = Math.max(0, vehiclePrice - safeDown);
  const months = params.months && params.months > 0 ? Math.round(params.months) : null;
  const rate =
    params.monthlyRatePct && Number.isFinite(params.monthlyRatePct) && params.monthlyRatePct > 0
      ? Number(params.monthlyRatePct)
      : null;

  let estimatedInstallment: number | null = null;
  if (rate && months && principalBalance > 0) {
    const i = rate / 100;
    const pmt = (principalBalance * (i * Math.pow(1 + i, months))) / (Math.pow(1 + i, months) - 1);
    estimatedInstallment = Number.isFinite(pmt) ? Math.round(pmt) : null;
  }

  return {
    vehicleId: params.vehicle.id,
    vehicleTitle: `${getVehicleDisplayTitle(params.vehicle)} ${params.vehicle.year}`,
    vehiclePrice,
    downPayment: safeDown,
    principalBalance,
    months,
    monthlyRatePct: rate,
    estimatedInstallment,
    isIllustrativeOnly: Boolean(estimatedInstallment),
    note: estimatedInstallment
      ? `Estimativa ilustrativa com taxa de ${rate?.toFixed(2).replace('.', ',')}% a.m. em ${months}x, sujeita à análise de crédito, IOF e tarifas bancárias.`
      : 'Saldo base a financiar antes de juros, IOF e tarifas. Sem taxa definida, a parcela depende da análise de crédito.',
  };
}

/**
 * Extracts and merges trade-in vehicle details across recent user turns
 * so the assistant reuses everything already informed and asks only for missing items.
 */
export function extractTradeInInfo(userMessages: string[]): TradeInExtractedInfo {
  const combined = userMessages.join(' | ');
  const norm = normalizeTextForMatch(combined);

  // Known popular models (broad list for trade-ins outside current stock)
  const modelMatch = combined.match(
    /\b(Sandero|Onix|Gol|HB20|Polo|Virtus|Argo|Cronos|Mobi|Kwid|Creta|T-?Cross|Tracker|Compass|Renegade|Kicks|Corolla|Civic|HR-?V|Fit|City|Ka|Fiesta|Focus|EcoSport|208|2008|C3|Duster|Logan|Captur|Prisma|Cruze|Cobalt|Spin|Fox|Up|Voyage|Saveiro|Strada|Toro|Hilux|S10|Ranger|Sentra|Versa|March|Etios|Yaris|Nivus|Taos|Pulse|Fastback|Tiggo|Celta|Corsa|Palio|Uno|Siena|Punto|Veloster|Megane)\b/i
  );

  const yearMatch = norm.match(/\b(199\d|20[0-2]\d)(?:\s*\/\s*(199\d|20[0-2]\d))?\b/);
  const engineMatch = combined.match(/\b([1-4]\.[0-9](?:\s*(?:16V|8V|12V|Turbo|TSI|Flex))?)\b/i);
  const transMatch = norm.match(/\b(manual|mecanico|automatico|automatica|cvt|dsg)\b/i);
  const kmMatch = norm.match(
    /\b(\d+(?:[.,]\d+)?\s*(?:mil|k)|\d{1,3}(?:\.\d{3})+|\d{4,6})\s*(?:km|quilometros?)\b/i
  );
  const versionMatch = combined.match(
    /\b(Expression|Authentique|Stepway|Zen|Intense|Life|Dynamique|Privil[eé]ge|GT Line|LTZ|LT|Premier|RS|Joy|Comfort|Comfortline|Highline|Trendline|MSI|TSI|GLi|XEi|Altis|EXL|EX|LX|Touring|Drive|Trekking|Like|Active|Allure|Griffe|Limited|Longitude|Sport|Sense|Advance|Exclusive|S|SE|SEL|Titanium|Freestyle)\b/i
  );

  const model = modelMatch?.[1] || null;
  const year = yearMatch ? (yearMatch[2] ? `${yearMatch[1]}/${yearMatch[2]}` : yearMatch[1]) : null;
  const engine = engineMatch?.[1] || null;
  const transmission = transMatch?.[1]
    ? /manual|mecanico/i.test(transMatch[1])
      ? 'Manual'
      : 'Automático'
    : null;
  const kmNum = kmMatch?.[1] ? parsePtBrNumericAmount(kmMatch[1]) : null;
  const km = kmNum ? formatKmBr(kmNum) : null;
  const version = versionMatch?.[1] || null;

  const missingFields: string[] = [];
  if (!model) missingFields.push('modelo');
  if (!version) missingFields.push('versão exata');
  if (!year) missingFields.push('ano/modelo');
  if (!km) missingFields.push('quilometragem');
  if (!transmission) missingFields.push('câmbio');

  const hasAnyDetail = Boolean(model || year || engine || transmission || km || version);

  return {
    model,
    year,
    engine,
    transmission,
    km,
    version,
    missingFields,
    hasAnyDetail,
  };
}

export interface TradeInMergeConflict {
  field: 'modelo' | 'ano/modelo' | 'câmbio' | 'quilometragem';
  existingValue: string;
  newValue: string;
}

export interface TradeInMergeResult {
  state: TradeInSessionState;
  conflicts: TradeInMergeConflict[];
  wasExplicitCorrection: boolean;
  missingFields: string[];
}

const EXPLICIT_CORRECTION_RE =
  /\b(na verdade|corrigindo|desculpa|errei|digitei errado|outro carro|outro veiculo|troquei de ideia|nao e|nao eh|era um|mudei para|atualiza|atualizar para)\b/i;

/**
 * Protects confirmed trade-in session data from silent overwrite.
 * - Merges new non-conflicting fields into the existing confirmed trade-in state.
 * - If a new message brings a conflicting model/year/transmission/km without explicit correction intent,
 *   keeps the confirmed values intact and returns `conflicts` so the assistant asks for explicit confirmation.
 */
export function mergeTradeInSessionState(
  existing: TradeInSessionState | null | undefined,
  extracted: TradeInExtractedInfo,
  latestMessage: string
): TradeInMergeResult {
  const normLatest = normalizeTextForMatch(latestMessage);
  const wasExplicitCorrection = EXPLICIT_CORRECTION_RE.test(normLatest);
  const conflicts: TradeInMergeConflict[] = [];

  const prev: TradeInSessionState = existing ? { ...existing } : {};
  const next: TradeInSessionState = {
    brandModel: prev.brandModel ?? null,
    version: prev.version ?? null,
    yearText: prev.yearText ?? null,
    engine: prev.engine ?? null,
    transmission: prev.transmission ?? null,
    km: prev.km ?? null,
    kmText: prev.kmText ?? (prev.km ? formatKmBr(prev.km) : null),
    photosCount: typeof prev.photosCount === 'number' ? prev.photosCount : 0,
    pendingItems: Array.isArray(prev.pendingItems) ? [...prev.pendingItems] : [],
    confirmedAt: prev.confirmedAt ?? null,
    pendingConflict: null,
  };

  const applyField = (
    field: TradeInMergeConflict['field'],
    existingVal: string | null | undefined,
    incomingVal: string | null | undefined,
    assign: (val: string) => void
  ) => {
    const cleanIncoming = (incomingVal || '').trim();
    if (!cleanIncoming) return;
    const cleanExisting = (existingVal || '').trim();
    if (!cleanExisting) {
      assign(cleanIncoming);
      return;
    }
    if (normalizeTextForMatch(cleanExisting) === normalizeTextForMatch(cleanIncoming)) {
      return;
    }
    if (wasExplicitCorrection) {
      assign(cleanIncoming);
    } else {
      conflicts.push({
        field,
        existingValue: cleanExisting,
        newValue: cleanIncoming,
      });
    }
  };

  applyField('modelo', next.brandModel, extracted.model, (v) => {
    next.brandModel = v;
  });
  applyField('ano/modelo', next.yearText, extracted.year, (v) => {
    next.yearText = v;
  });
  applyField('câmbio', next.transmission, extracted.transmission, (v) => {
    next.transmission = v;
  });

  if (extracted.km) {
    const parsedKmNum = parsePtBrNumericAmount(extracted.km.replace(/[^\d.,]/g, ''));
    applyField('quilometragem', next.kmText, extracted.km, (v) => {
      next.kmText = v;
      if (parsedKmNum) next.km = parsedKmNum;
    });
  }

  // Non-destructive enrichment for version & engine (only overwrite on explicit correction)
  if (extracted.version && (!next.version || wasExplicitCorrection)) {
    next.version = extracted.version;
  }
  if (extracted.engine && (!next.engine || wasExplicitCorrection)) {
    next.engine = extracted.engine;
  }

  const missingFields: string[] = [];
  if (!next.brandModel) missingFields.push('modelo');
  if (!next.version) missingFields.push('versão exata');
  if (!next.yearText) missingFields.push('ano/modelo');
  if (!next.kmText) missingFields.push('quilometragem');
  if (!next.transmission) missingFields.push('câmbio');

  next.pendingItems = missingFields;
  if (conflicts.length > 0) {
    next.pendingConflict = conflicts[0];
  }
  if (
    !next.confirmedAt &&
    (next.brandModel || next.yearText || next.kmText || next.transmission || next.version || next.engine)
  ) {
    next.confirmedAt = new Date().toISOString();
  }

  return {
    state: next,
    conflicts,
    wasExplicitCorrection,
    missingFields,
  };
}

export function formatTradeInSummaryLine(
  tradeIn: TradeInSessionState | null | undefined
): string | null {
  if (!tradeIn) return null;
  const parts: string[] = [];
  if (tradeIn.brandModel) parts.push(tradeIn.brandModel);
  if (tradeIn.version) parts.push(tradeIn.version);
  if (tradeIn.yearText) parts.push(tradeIn.yearText);
  if (tradeIn.engine) parts.push(tradeIn.engine);
  if (tradeIn.transmission) parts.push(tradeIn.transmission);
  if (tradeIn.kmText) parts.push(tradeIn.kmText);
  else if (tradeIn.km && tradeIn.km > 0) parts.push(formatKmBr(tradeIn.km));

  if (parts.length === 0 && !tradeIn.photosCount) return null;
  const base = parts.length > 0 ? parts.join(' · ') : 'Veículo na troca em coleta';
  const photoSuffix =
    tradeIn.photosCount && tradeIn.photosCount > 0
      ? ` (${tradeIn.photosCount} ${tradeIn.photosCount === 1 ? 'foto anexada' : 'fotos anexadas'})`
      : '';
  return `${base}${photoSuffix}`;
}

/**
 * Builds an objective consolidated commercial handoff summary for both
 * WhatsApp handoff and Central da Revenda ("Aguardando retorno" queue).
 * Strictly separates interest vehicle, financing simulation, and trade-in vehicle.
 */
export function buildConsolidatedHandoffSummary(params: {
  focusedVehicle?: Pick<Vehicle, 'id' | 'brand' | 'model' | 'version' | 'year' | 'price' | 'priceConfirmed'> | null;
  financingSummary?: VehicleFinancingSummary | null;
  tradeInSummary?: TradeInSessionState | null;
}): string | null {
  const segments: string[] = [];

  if (params.focusedVehicle) {
    const v = params.focusedVehicle;
    const pricePart =
      v.priceConfirmed === false || v.price <= 0
        ? 'preço a confirmar'
        : formatBrlCurrency(v.price);
    segments.push(`Interesse: ${getVehicleDisplayTitle(v)} ${v.year} (${pricePart})`);
  } else if (params.financingSummary?.vehicleTitle) {
    segments.push(`Interesse: ${params.financingSummary.vehicleTitle}`);
  }

  if (params.financingSummary) {
    const fin = params.financingSummary;
    const termPart = fin.months ? ` · ${fin.months}x` : '';
    const instPart = fin.estimatedInstallment
      ? ` (~${formatBrlCurrency(fin.estimatedInstallment)}/mês ilustrativo)`
      : '';
    segments.push(
      `Financiamento: entrada ${formatBrlCurrency(fin.downPayment)} · saldo ${formatBrlCurrency(fin.principalBalance)}${termPart}${instPart}`
    );
  }

  const tradeInLine = formatTradeInSummaryLine(params.tradeInSummary);
  if (tradeInLine) {
    segments.push(`Troca: ${tradeInLine}`);
  }

  return segments.length > 0 ? segments.join(' | ') : null;
}

/**
 * Single source of truth for dealership visit, test-drive, trade-in, financing, and warranty rules.
 */
export function buildDealershipPoliciesSummary(
  settings?: Partial<DealershipSettings> | null
): {
  warrantyLine: string;
  visitPolicyLine: string;
  tradeInPolicyLine: string;
  financingPolicyLine: string;
} {
  const warrantyDays = settings?.warrantyDays && settings.warrantyDays > 0 ? settings.warrantyDays : 90;
  const warrantyKm = settings?.warrantyKm && settings.warrantyKm > 0 ? settings.warrantyKm : 5000;
  return {
    warrantyLine: `Garantia legal de ${warrantyDays} dias ou ${formatKmBr(warrantyKm)} (CDC) e procedência conferida.`,
    visitPolicyLine:
      'Visitas e test-drive mediante solicitação e confirmação de horário com um consultor da loja.',
    tradeInPolicyLine:
      'Aceitamos veículo usado na troca com pré-avaliação mediante envio de dados (modelo, versão, ano, km, câmbio) e fotos, sujeita a vistoria presencial.',
    financingPolicyLine:
      'Financiamento bancário sujeito à análise de crédito, entrada e condições da instituição financeira.',
  };
}

/**
 * Classifies visit-related messages cleanly into:
 * - 'inquiry_only': exploratory questions about address/hours/policies or explicit "não agende"
 * - 'request_visit': user explicitly asks to schedule/request a visit
 * - 'none': unrelated
 */
export function analyzeVisitIntent(message: string): VisitIntentClassification {
  const norm = normalizeTextForMatch(message);
  if (!norm) return 'none';

  // Explicit opt-out of scheduling ALWAYS forces inquiry_only
  if (
    /\b(nao agende|sem agendar|nao quero agendar|nao precisa agendar|so quero saber|apenas saber|so consultar|por enquanto nao|ainda nao quero agendar)\b/i.test(
      norm
    )
  ) {
    return 'inquiry_only';
  }

  const asksInfo =
    /\b(horario|horarios|funciona|funcionamento|abre|aberto|fecha|sabado|domingo|segunda|endereco|onde fica|onde voces ficam|localizacao|como chegar|como funciona visita|test[\s-]?drive|regras de visita|garantia|procedencia)\b/i.test(
      norm
    );
  const requestsSchedule =
    /\b(quero agendar|agendar visita|marcar visita|agendar test|marcar test|quero visitar|posso ir hoje|posso passar amanha|reservar horario|solicitar visita)\b/i.test(
      norm
    );

  if (requestsSchedule && !asksInfo) return 'request_visit';
  if (requestsSchedule && asksInfo) return 'request_visit';
  if (asksInfo) return 'inquiry_only';
  return 'none';
}

/**
 * Builds objective side-by-side comparison strictly for the given vehicles (2 to 3).
 */
export function buildVehicleComparison(
  vehicles: Vehicle[],
  origin?: string | null,
  dealership?: Partial<DealershipSettings> | null
): VehicleComparisonData | null {
  const unique: Vehicle[] = [];
  for (const v of vehicles) {
    if (!unique.some((u) => u.id === v.id)) unique.push(v);
  }
  if (unique.length < 2) return null;

  const selected = unique.slice(0, 3);
  const cards = selected.map((v) => toVehicleCardData(v, origin, null, dealership));

  const rows: VehicleComparisonData['rows'] = [
    {
      label: 'Preço à vista',
      values: selected.map((v) =>
        v.priceConfirmed === false || v.price <= 0
          ? 'A confirmar'
          : formatBrlCurrency(v.price)
      ),
    },
    {
      label: 'Ano',
      values: selected.map((v) => v.year),
    },
    {
      label: 'Quilometragem',
      values: selected.map((v) => formatKmBr(v.km)),
    },
    {
      label: 'Câmbio',
      values: selected.map((v) => analyzeVehicleDataQuality(v).displayTransmission),
    },
    {
      label: 'Combustível',
      values: selected.map((v) => v.fuel || 'Não informado'),
    },
    {
      label: 'Tabela FIPE',
      values: selected.map((v) => {
        const f = computeFipeMetrics(v);
        if (!f.hasFipeValue || !f.fipePrice) return 'Não informada';
        return f.hasReferenceMonth
          ? `${formatBrlCurrency(f.fipePrice)} (${f.fipeReferenceMonth})`
          : `${formatBrlCurrency(f.fipePrice)} (mês não informado)`;
      }),
    },
    {
      label: 'Status',
      values: selected.map((v) => v.status),
    },
  ];

  // Objective highlights (strictly from registered numbers)
  const highlights: string[] = [];
  const cheapest = [...selected].sort((a, b) => a.price - b.price);
  if (cheapest[0].price < cheapest[cheapest.length - 1].price) {
    const diff = cheapest[cheapest.length - 1].price - cheapest[0].price;
    highlights.push(
      `${getVehicleDisplayTitle(cheapest[0])} ${cheapest[0].year} está ${formatBrlCurrency(diff)} mais barato.`
    );
  }
  const lowestKm = [...selected].sort((a, b) => a.km - b.km);
  if (lowestKm[0].km < lowestKm[lowestKm.length - 1].km) {
    const kmDiff = lowestKm[lowestKm.length - 1].km - lowestKm[0].km;
    highlights.push(
      `${getVehicleDisplayTitle(lowestKm[0])} ${lowestKm[0].year} tem ${formatKmBr(kmDiff)} a menos.`
    );
  }
  const conflictVehicles = selected.filter(
    (v) => analyzeVehicleDataQuality(v).hasTransmissionConflict
  );
  for (const cv of conflictVehicles) {
    highlights.push(
      `${getVehicleDisplayTitle(cv)} ${cv.year} possui divergência cadastral de câmbio e precisa de confirmação com a loja.`
    );
  }

  return {
    vehicles: cards,
    rows,
    highlights,
  };
}

/**
 * Default centralized dealership configuration used as baseline when DB settings are empty.
 * IMPORTANT: Never hardcode any demo city/street address (e.g. São Paulo/Moema or Gravataí)
 * as a fallback, and never silently overwrite an active store_whatsapp_number from Neon.
 */
export const DEFAULT_DEALERSHIP_CONFIG: DealershipSettings = {
  tradeName: 'Armazém do Carro',
  legalName: 'Armazém do Carro',
  cnpj: '',
  stateRegistration: '',
  phone: '',
  whatsapp: '',
  salesWhatsapp: '',
  salesWhatsappLabel: 'Consultor de Vendas',
  financingWhatsapp: '',
  financingWhatsappLabel: 'Financeiro / Simulação',
  email: '',
  address: '',
  city: '',
  state: '',
  hoursWeekdays: '',
  hoursSaturday: '',
  hoursSunday: '',
  minResaleMarginPct: 12,
  defaultSocialCta: 'Fale com nossa equipe para conferir a ficha completa e disponibilidade.',
  aiAssistantName: 'Consultor Digital Armazém do Carro',
  warrantyDays: 90,
  warrantyKm: 5000,
  financingMonthlyRatePct: null,
  logoUrl: '',
  publicStoreSlug: 'armazem-do-carro',
  storefrontMode: 'internal',
  externalCatalogUrl: '',
  externalHomeUrl: '',
  widgetEnabled: true,
  widgetPosition: 'bottom-right',
  widgetLabel: 'Fale com o agente',
  widgetAllowedOrigins: [],
};

/**
 * Formats the dealership address cleanly from the persisted admin fields.
 * Preserves the admin's exact text, omits empty optional components, and avoids
 * duplicating city/state if the admin already included them in the main address field.
 * Returns null if no address component is configured (never returns a demo fallback).
 */
export function formatDealershipAddress(
  settings?: Partial<DealershipSettings> | null
): string | null {
  if (!settings) return null;
  const street = (settings.address || '').trim();
  const city = (settings.city || '').trim();
  const state = (settings.state || '').trim().toUpperCase();

  const cityState =
    city && state ? `${city}/${state}` : city || state || '';

  if (!street && !cityState) return null;
  if (street && !cityState) return street;
  if (!street && cityState) return cityState;

  const normStreet = normalizeTextForMatch(street);
  const normCity = normalizeTextForMatch(city);
  const hasCityAlready = Boolean(normCity && normStreet.includes(normCity));
  if (hasCityAlready) {
    if (state && !new RegExp(`\\b${state.toLowerCase()}\\b`).test(normStreet)) {
      return `${street}/${state}`;
    }
    return street;
  }

  return `${street} — ${cityState}`;
}

/**
 * Builds a Google Maps query URL strictly from the admin-saved address.
 * Returns null if no address is configured.
 */
export function buildDealershipMapsUrl(
  settings?: Partial<DealershipSettings> | null
): string | null {
  const formatted = formatDealershipAddress(settings);
  if (!formatted) return null;
  return `https://maps.google.com/?q=${encodeURIComponent(formatted)}`;
}

/**
 * Strips duplicated leading day prefixes (e.g., "Sábado, das 09h às 16h" -> "das 09h às 16h")
 * so UI/chat never prints "Sábado: Sábado, das 09h às 16h" or "Domingo: Domingo: fechado".
 */
export function formatScheduleValue(
  dayKind: 'weekdays' | 'saturday' | 'sunday',
  rawValue?: string | null
): string | null {
  const clean = (rawValue || '').trim();
  if (!clean) return null;

  const patterns: Record<'weekdays' | 'saturday' | 'sunday', RegExp> = {
    weekdays:
      /^(?:de\s+)?(?:segunda(?:\s*-?\s*feira)?\s*(?:a|à|ate|até|-|–)\s*sexta(?:\s*-?\s*feira)?|seg\.?\s*(?:a|-|–)\s*sex\.?)\s*[:,;\-–]?\s*/i,
    saturday: /^(?:aos\s+)?s[aá]b(?:ados?|ado|\.)?\s*[:,;\-–]?\s*/i,
    sunday:
      /^(?:aos\s+)?dom(?:ingos?|ingo|\.)?(?:\s*e\s*feriados?)?\s*[:,;\-–]?\s*/i,
  };

  const stripped = clean.replace(patterns[dayKind], '').trim();
  return stripped || clean;
}

export interface FormattedDealershipHours {
  weekdays: string | null;
  saturday: string | null;
  sunday: string | null;
  hasAny: boolean;
  inlineSummary: string | null;
  summaryLine: string | null;
}

export function formatDealershipHours(
  settings?: Partial<DealershipSettings> | null
): FormattedDealershipHours {
  const weekdays = formatScheduleValue('weekdays', settings?.hoursWeekdays);
  const saturday = formatScheduleValue('saturday', settings?.hoursSaturday);
  const sunday = formatScheduleValue('sunday', settings?.hoursSunday);
  const hasAny = Boolean(weekdays || saturday || sunday);

  const parts: string[] = [];
  if (weekdays) parts.push(`Seg–Sex: ${weekdays}`);
  if (saturday) parts.push(`Sábado: ${saturday}`);
  if (sunday) parts.push(`Domingo: ${sunday}`);
  const summary = parts.length > 0 ? parts.join(' · ') : null;

  return {
    weekdays,
    saturday,
    sunday,
    hasAny,
    inlineSummary: summary,
    summaryLine: summary,
  };
}

export function mergeDealershipConfig(
  dbConfig?: Partial<DealershipSettings> | null,
  legacyStoreWhatsapp?: string | null
): DealershipSettings {
  const merged: DealershipSettings = {
    ...DEFAULT_DEALERSHIP_CONFIG,
    ...(dbConfig || {}),
  };

  // Single source of truth for primary sales WhatsApp:
  // prefer explicit salesWhatsapp -> dbConfig.whatsapp -> legacyStoreWhatsapp
  const resolvedSalesWa =
    (dbConfig?.salesWhatsapp || '').trim() ||
    (dbConfig?.whatsapp || '').trim() ||
    (legacyStoreWhatsapp || '').trim() ||
    '';

  merged.salesWhatsapp = resolvedSalesWa;
  merged.whatsapp = resolvedSalesWa;

  if (!merged.salesWhatsappLabel?.trim()) {
    merged.salesWhatsappLabel = 'Consultor de Vendas';
  }
  if (!merged.financingWhatsappLabel?.trim()) {
    merged.financingWhatsappLabel = 'Financeiro / Simulação';
  }
  if (!merged.publicStoreSlug?.trim()) {
    merged.publicStoreSlug = 'armazem-do-carro';
  }
  merged.storefrontMode =
    merged.storefrontMode === 'external' ? 'external' : 'internal';
  merged.externalCatalogUrl = (merged.externalCatalogUrl || '').trim();
  merged.externalHomeUrl = (merged.externalHomeUrl || '').trim();
  merged.widgetEnabled = merged.widgetEnabled !== false;
  merged.widgetPosition =
    merged.widgetPosition === 'bottom-left' ? 'bottom-left' : 'bottom-right';
  merged.widgetLabel = (merged.widgetLabel || '').trim() || 'Fale com o agente';
  merged.widgetAllowedOrigins = Array.isArray(merged.widgetAllowedOrigins)
    ? merged.widgetAllowedOrigins
        .map((o) => String(o || '').trim().replace(/\/+$/, ''))
        .filter(Boolean)
    : [];
  return merged;
}

export function formatPhoneDisplay(raw: string | null | undefined): string {
  const digits = (raw || '').replace(/\D/g, '');
  if (!digits) return 'Não configurado';
  const local = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
  if (local.length === 11) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  }
  if (local.length === 10) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  }
  return raw || '';
}

export function isHistoryCompatibleMessage(msg: unknown): msg is ChatMessage {
  if (!msg || typeof msg !== 'object') return false;
  const candidate = msg as Partial<ChatMessage>;
  return (
    typeof candidate.id === 'string' &&
    (candidate.sender === 'ia' || candidate.sender === 'cliente') &&
    typeof candidate.text === 'string'
  );
}
