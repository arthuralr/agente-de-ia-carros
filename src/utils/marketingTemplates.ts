import type {
  DealershipSettings,
  MarketingFormat,
  Vehicle,
  VehicleStatus,
} from '../types';
import { formatBRL, formatKm } from './formatters';
import {
  analyzeVehicleDataQuality,
  buildVehicleSheetPath,
  computeFipeMetrics,
  formatDealershipAddress,
  formatPhoneDisplay,
} from './vehicleDomain';

export interface MarketingDraftValidation {
  priceChanged: boolean;
  previousPrice: number;
  currentPrice: number;
  priceDelta: number;
  isUnavailable: boolean;
  currentStatus: VehicleStatus;
  canExportActiveOffer: boolean;
  warnings: string[];
}

export interface DeterministicMarketingOutput {
  format: MarketingFormat;
  title: string;
  headline: string;
  caption: string;
  classifiedText: string;
  publicSheetPath: string;
  publicSheetUrl: string;
  trackingSource: string;
  carouselSlides: Array<{
    slideNumber: number;
    heading: string;
    subheading: string;
    bullets: string[];
    photoUrl: string;
  }>;
  dataWarnings: string[];
}

export function buildTrackedVehicleSheetUrl(
  vehicleId: string,
  format: MarketingFormat,
  baseUrl?: string
): { path: string; fullUrl: string; trackingSource: string } {
  const trackingSource = `divulgacao_${format}`;
  const path = `${buildVehicleSheetPath(vehicleId)}?origem=${encodeURIComponent(trackingSource)}`;
  const cleanBase = (baseUrl || '').replace(/\/+$/, '');
  return {
    path,
    fullUrl: cleanBase ? `${cleanBase}${path}` : path,
    trackingSource,
  };
}

export function revalidateMarketingDraft(
  snapshotPrice: number,
  snapshotStatus: string,
  liveVehicle: Vehicle | null | undefined
): MarketingDraftValidation {
  if (!liveVehicle) {
    return {
      priceChanged: false,
      previousPrice: snapshotPrice,
      currentPrice: snapshotPrice,
      priceDelta: 0,
      isUnavailable: true,
      currentStatus: 'Vendido',
      canExportActiveOffer: false,
      warnings: ['Veículo não encontrado no estoque atual. Exportação bloqueada.'],
    };
  }

  const warnings: string[] = [];
  const priceChanged = Math.round(snapshotPrice) !== Math.round(liveVehicle.price);
  const priceDelta = liveVehicle.price - snapshotPrice;
  const isUnavailable = liveVehicle.status !== 'Disponível';

  if (priceChanged) {
    warnings.push(
      `Preço alterado no estoque: rascunho tinha ${formatBRL(snapshotPrice)} e o valor atual é ${formatBRL(liveVehicle.price)} (${priceDelta > 0 ? '+' : ''}${formatBRL(priceDelta)}). Revise antes de exportar.`
    );
  }
  if (isUnavailable) {
    warnings.push(
      `Veículo está marcado como "${liveVehicle.status}" no estoque. A exportação como oferta disponível foi bloqueada para evitar anúncio indevido.`
    );
  } else if (snapshotStatus && snapshotStatus !== liveVehicle.status) {
    warnings.push(`Status alterado de "${snapshotStatus}" para "${liveVehicle.status}".`);
  }

  return {
    priceChanged,
    previousPrice: snapshotPrice,
    currentPrice: liveVehicle.price,
    priceDelta,
    isUnavailable,
    currentStatus: liveVehicle.status,
    canExportActiveOffer: !isUnavailable,
    warnings,
  };
}

/**
 * 100% deterministic marketing kit builder — ZERO AI/LLM calls, ZERO tokens.
 * Uses only confirmed stock fields, verified FIPE references, and official Admin dealership settings.
 */
export function buildDeterministicMarketingOutput(params: {
  vehicle: Vehicle;
  dealership: DealershipSettings;
  format: MarketingFormat;
  selectedPhotoUrl?: string | null;
  baseUrl?: string;
}): DeterministicMarketingOutput {
  const { vehicle, dealership, format, baseUrl } = params;
  const quality = analyzeVehicleDataQuality(vehicle);
  const fipe = computeFipeMetrics(vehicle);
  const address = formatDealershipAddress(dealership);
  const activeWhatsapp = formatPhoneDisplay(
    dealership.salesWhatsapp || dealership.whatsapp || dealership.phone
  );
  const linkInfo = buildTrackedVehicleSheetUrl(vehicle.id, format, baseUrl);
  const dataWarnings: string[] = [];

  const transmissionConfirmed = Boolean(
    quality.canonicalTransmission && !quality.hasTransmissionConflict
  );

  if (!transmissionConfirmed) {
    dataWarnings.push(
      quality.conflictDetail ||
        'Câmbio sem confirmação clara no cadastro — omitido na peça até revisão.'
    );
  }
  if (vehicle.fipePrice > 0 && !vehicle.fipeReferenceMonth) {
    dataWarnings.push(
      'FIPE sem mês de referência cadastrado — oferta abaixo da FIPE não será anunciada como confirmada.'
    );
  }
  if (vehicle.status !== 'Disponível') {
    dataWarnings.push(
      `Veículo com status "${vehicle.status}" — não publicar como oferta disponível.`
    );
  }

  const displayTitle = `${vehicle.brand} ${vehicle.model}`.trim();
  const fullName = vehicle.version &&
    !vehicle.model.toLowerCase().includes(vehicle.version.toLowerCase())
    ? `${displayTitle} ${vehicle.version}`
    : displayTitle;

  const confirmedSpecs: string[] = [
    `Ano ${vehicle.year}`,
    formatKm(vehicle.km),
    transmissionConfirmed ? quality.canonicalTransmission : null,
    vehicle.fuel || null,
    vehicle.color ? `Cor ${vehicle.color}` : null,
  ].filter(Boolean) as string[];

  const fipeLine =
    fipe.isConfirmedBelowFipeOffer && fipe.fipePrice && fipe.fipeReferenceMonth
      ? `Abaixo da FIPE (${fipe.fipeReferenceMonth}): ${formatBRL(fipe.fipePrice)} — economia de ${formatBRL(Math.abs(fipe.diffBrl || 0))} (${Math.abs(fipe.diffPct || 0).toFixed(1)}%).`
      : fipe.fipePrice && fipe.fipeReferenceMonth
        ? `Referência FIPE (${fipe.fipeReferenceMonth}): ${formatBRL(fipe.fipePrice)}.`
        : null;

  const headline = `${fullName} · ${vehicle.year} · ${formatBRL(vehicle.price)}`;

  // 1. Feed / Stories Caption
  const captionLines: string[] = [];
  if (format === 'stories') {
    captionLines.push(`${fullName} (${vehicle.year})`);
    captionLines.push(`${formatBRL(vehicle.price)} · ${confirmedSpecs.slice(1, 4).join(' · ')}`);
    if (fipeLine && fipe.isConfirmedBelowFipeOffer) captionLines.push(fipeLine);
    captionLines.push(`Veja fotos e ficha completa: ${linkInfo.fullUrl}`);
    if (activeWhatsapp) captionLines.push(`WhatsApp: ${activeWhatsapp}`);
  } else {
    captionLines.push(`${fullName} — ${vehicle.year}`);
    captionLines.push(`Valor: ${formatBRL(vehicle.price)}`);
    captionLines.push('');
    captionLines.push(`Destaques confirmados: ${confirmedSpecs.join(' · ')}.`);
    if (fipeLine) captionLines.push(fipeLine);
    if (vehicle.optionals.length > 0) {
      captionLines.push(`Equipamentos: ${vehicle.optionals.slice(0, 6).join(', ')}.`);
    }
    captionLines.push('');
    captionLines.push(`Ficha completa e simulação: ${linkInfo.fullUrl}`);
    if (activeWhatsapp) captionLines.push(`Atendimento oficial: ${activeWhatsapp}`);
    if (address) captionLines.push(`Endereço: ${address}`);
  }

  // 2. Classifieds Text (OLX / Webmotors / Mercado Livre / Facebook Marketplace)
  const classifiedLines: string[] = [
    `TÍTULO: ${fullName} ${vehicle.year} ${transmissionConfirmed ? quality.canonicalTransmission : ''} ${formatKm(vehicle.km)}`.replace(/\s+/g, ' ').trim(),
    '',
    `PREÇO: ${formatBRL(vehicle.price)}`,
    `STATUS: ${vehicle.status}`,
    '',
    'FICHA TÉCNICA:',
    `- Marca / Modelo: ${fullName}`,
    `- Ano/Modelo: ${vehicle.year}`,
    `- Quilometragem: ${formatKm(vehicle.km)}`,
    ...(transmissionConfirmed ? [`- Câmbio: ${quality.canonicalTransmission}`] : []),
    ...(vehicle.fuel ? [`- Combustível: ${vehicle.fuel}`] : []),
    ...(vehicle.color ? [`- Cor: ${vehicle.color}`] : []),
    ...(fipeLine ? [`- ${fipeLine}`] : []),
    '',
    ...(vehicle.optionals.length > 0
      ? ['EQUIPAMENTOS E OPCIONAIS:', ...vehicle.optionals.map((opt) => `- ${opt}`), '']
      : []),
    'ATENDIMENTO OFICIAL:',
    `- ${dealership.tradeName}`,
    ...(address ? [`- Endereço: ${address}`] : ['- Endereço: confirme com nosso consultor']),
    ...(activeWhatsapp ? [`- WhatsApp: ${activeWhatsapp}`] : []),
    `- Ficha completa online: ${linkInfo.fullUrl}`,
  ];

  // 3. Carousel Slides (reusing the same deterministic template fields)
  const photos = [
    params.selectedPhotoUrl || vehicle.imageUrl,
    ...(vehicle.gallery || []),
  ].filter(Boolean);
  const pickPhoto = (idx: number) => photos[idx % photos.length] || vehicle.imageUrl;

  const carouselSlides = [
    {
      slideNumber: 1,
      heading: fullName,
      subheading: `${vehicle.year} · ${formatBRL(vehicle.price)}`,
      bullets: [confirmedSpecs.slice(1, 4).join(' · '), dealership.tradeName],
      photoUrl: pickPhoto(0),
    },
    {
      slideNumber: 2,
      heading: 'Ficha Técnica Confirmada',
      subheading: formatBRL(vehicle.price),
      bullets: [
        ...confirmedSpecs,
        ...(fipeLine ? [fipeLine] : []),
      ],
      photoUrl: pickPhoto(1),
    },
    {
      slideNumber: 3,
      heading: 'Equipamentos & Procedência',
      subheading: 'Seminovo selecionado',
      bullets:
        vehicle.optionals.length > 0
          ? vehicle.optionals.slice(0, 6)
          : ['Veículo disponível para inspeção presencial', `Garantia legal de ${dealership.warrantyDays || 90} dias`],
      photoUrl: pickPhoto(2),
    },
    {
      slideNumber: 4,
      heading: 'Fale com a Equipe',
      subheading: dealership.tradeName,
      bullets: [
        ...(activeWhatsapp ? [`WhatsApp: ${activeWhatsapp}`] : ['Atendimento via chat oficial']),
        ...(address ? [address] : ['Confirme nosso endereço com o consultor']),
        `Ficha: ${linkInfo.path}`,
      ],
      photoUrl: pickPhoto(0),
    },
  ];

  return {
    format,
    title: fullName,
    headline,
    caption: captionLines.join('\n'),
    classifiedText: classifiedLines.join('\n'),
    publicSheetPath: linkInfo.path,
    publicSheetUrl: linkInfo.fullUrl,
    trackingSource: linkInfo.trackingSource,
    carouselSlides,
    dataWarnings,
  };
}

/**
 * Renders a crisp high-resolution PNG artwork in the browser via HTML5 Canvas (0 tokens).
 */
export async function renderMarketingArtworkDataUrl(params: {
  vehicle: Vehicle;
  dealership: DealershipSettings;
  format: 'feed' | 'stories' | 'carrossel';
  photoUrl: string;
  slideIndex?: number;
  customHeadline?: string;
}): Promise<string> {
  const { vehicle, dealership, format, photoUrl, slideIndex = 0, customHeadline } = params;
  const width = 1080;
  const height = format === 'stories' ? 1920 : 1350;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponível neste navegador.');

  // Background
  ctx.fillStyle = '#09090B';
  ctx.fillRect(0, 0, width, height);

  // Load real vehicle image safely (never crashes on CORS)
  const loadImage = (src: string): Promise<HTMLImageElement | null> =>
    new Promise((resolve) => {
      if (!src) return resolve(null);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });

  const img = await loadImage(photoUrl);
  const photoAreaHeight = format === 'stories' ? 1180 : 820;

  if (img && img.naturalWidth > 0) {
    // Cover-fit image
    const scale = Math.max(width / img.naturalWidth, photoAreaHeight / img.naturalHeight);
    const drawW = img.naturalWidth * scale;
    const drawH = img.naturalHeight * scale;
    const dx = (width - drawW) / 2;
    const dy = (photoAreaHeight - drawH) / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, photoAreaHeight);
    ctx.clip();
    ctx.drawImage(img, dx, dy, drawW, drawH);
    ctx.restore();
  } else {
    // Architectural fallback
    const grad = ctx.createLinearGradient(0, 0, width, photoAreaHeight);
    grad.addColorStop(0, '#18181B');
    grad.addColorStop(1, '#09090B');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, photoAreaHeight);
  }

  // Scrim over bottom of photo for crisp legibility
  const scrim = ctx.createLinearGradient(0, photoAreaHeight - 280, 0, photoAreaHeight + 20);
  scrim.addColorStop(0, 'rgba(9,9,11,0)');
  scrim.addColorStop(1, 'rgba(9,9,11,1)');
  ctx.fillStyle = scrim;
  ctx.fillRect(0, photoAreaHeight - 280, width, 300);

  // Top brand header strip
  ctx.fillStyle = 'rgba(9, 9, 11, 0.78)';
  ctx.fillRect(0, 0, width, 118);
  ctx.fillStyle = '#DC2626';
  ctx.fillRect(56, 36, 12, 46);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 38px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText(dealership.tradeName || 'Armazém do Carro', 86, 72);

  if (format === 'carrossel') {
    ctx.fillStyle = '#A1A1AA';
    ctx.font = '600 24px monospace';
    ctx.fillText(`0${slideIndex + 1} / 04`, width - 160, 70);
  }

  const quality = analyzeVehicleDataQuality(vehicle);
  const fipe = computeFipeMetrics(vehicle);
  const output = buildDeterministicMarketingOutput({
    vehicle,
    dealership,
    format,
    selectedPhotoUrl: photoUrl,
  });

  const padX = 56;
  let y = photoAreaHeight + 30;

  if (format === 'carrossel' && slideIndex > 0) {
    const slide = output.carouselSlides[slideIndex] || output.carouselSlides[0];
    ctx.fillStyle = '#EF4444';
    ctx.font = '700 26px system-ui, sans-serif';
    ctx.fillText(slide.subheading.toUpperCase(), padX, y);
    y += 58;

    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 54px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillText(slide.heading.slice(0, 32), padX, y);
    y += 66;

    ctx.fillStyle = '#E4E4E7';
    ctx.font = '500 30px system-ui, sans-serif';
    for (const b of slide.bullets.slice(0, 5)) {
      ctx.fillText(`•  ${b.slice(0, 52)}`, padX, y);
      y += 48;
    }
  } else {
    // Vehicle title
    const titleText = customHeadline || `${vehicle.brand} ${vehicle.model}`;
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 54px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillText(titleText.slice(0, 30), padX, y);
    y += 52;

    if (vehicle.version && !titleText.toLowerCase().includes(vehicle.version.toLowerCase())) {
      ctx.fillStyle = '#A1A1AA';
      ctx.font = '500 28px system-ui, sans-serif';
      ctx.fillText(vehicle.version.slice(0, 48), padX, y);
      y += 44;
    }

    // Price block
    y += 18;
    ctx.fillStyle = '#DC2626';
    ctx.fillRect(padX, y - 54, 420, 82);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 52px monospace';
    ctx.fillText(formatBRL(vehicle.price), padX + 24, y + 6);
    y += 68;

    // Confirmed specs line
    const canvasTransmissionConfirmed = Boolean(
      quality.canonicalTransmission && !quality.hasTransmissionConflict
    );
    const specs = [
      vehicle.year,
      formatKm(vehicle.km),
      canvasTransmissionConfirmed ? quality.canonicalTransmission : null,
      vehicle.fuel || null,
    ].filter(Boolean);
    ctx.fillStyle = '#E4E4E7';
    ctx.font = '600 28px system-ui, sans-serif';
    ctx.fillText(specs.join('  ·  '), padX, y);
    y += 48;

    // Verified FIPE only when complete
    if (fipe.isConfirmedBelowFipeOffer && fipe.fipePrice && fipe.fipeReferenceMonth) {
      ctx.fillStyle = '#34D399';
      ctx.font = '600 26px system-ui, sans-serif';
      ctx.fillText(
        `Abaixo da FIPE (${fipe.fipeReferenceMonth}): ${formatBRL(fipe.fipePrice)}`,
        padX,
        y
      );
      y += 46;
    }

    if (format === 'stories') {
      y += 30;
      ctx.fillStyle = '#18181B';
      ctx.fillRect(padX, y, width - padX * 2, 110);
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 2;
      ctx.strokeRect(padX, y, width - padX * 2, 110);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '600 30px system-ui, sans-serif';
      ctx.fillText('Acesse a ficha completa ou chame no WhatsApp', padX + 28, y + 66);
    }
  }

  // Bottom official dealership footer
  const address = formatDealershipAddress(dealership);
  const phone = formatPhoneDisplay(dealership.salesWhatsapp || dealership.whatsapp || dealership.phone);
  ctx.fillStyle = '#141418';
  ctx.fillRect(0, height - 110, width, 110);
  ctx.fillStyle = '#D4D4D8';
  ctx.font = '500 24px system-ui, sans-serif';
  const bottomLeft = address || 'Consulte nosso endereço com a equipe oficial';
  ctx.fillText(bottomLeft.slice(0, 58), padX, height - 46);
  if (phone) {
    ctx.fillStyle = '#34D399';
    ctx.font = '700 26px monospace';
    ctx.fillText(phone, width - 310, height - 46);
  }

  return canvas.toDataURL('image/png');
}
