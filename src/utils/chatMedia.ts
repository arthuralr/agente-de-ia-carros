import { ChatAttachment } from '../types';

export const MAX_IMAGE_DATA_URL_BYTES = 1_200_000; // ~1.2MB base64 after compression
export const MAX_PDF_RAW_BYTES = 2_400_000; // ~2.4MB raw (~3.2MB base64, safe under Vercel 4.5MB limit)
export const MAX_AUDIO_RAW_BYTES = 1_800_000; // ~1.8MB raw (~2.4MB base64)
export const MAX_AUDIO_DURATION_SEC = 90;

export const ALLOWED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export function formatDurationSeconds(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function formatBytesCompact(bytes?: number): string {
  if (!bytes || !Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

export function stripMarkdownForPreview(text: string, maxLen = 110): string {
  const clean = text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^[-*•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 1).trimEnd()}…`;
}

export function pickSupportedAudioMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4',
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return '';
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Falha ao converter arquivo para envio.'));
      }
    };
    reader.onerror = () =>
      reject(new Error('Não foi possível ler o arquivo selecionado.'));
    reader.readAsDataURL(blob);
  });
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new Error('Não foi possível decodificar a imagem selecionada.'));
    img.src = src;
  });
}

/**
 * Compresses JPG/PNG/WEBP images on canvas so smartphone photos stay compact
 * and always respect Vercel's 4.5MB serverless payload limit.
 */
export async function compressImageFile(file: File): Promise<ChatAttachment> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImageElement(objectUrl);
    const maxDimension = 1280;
    let width = img.naturalWidth || img.width;
    let height = img.naturalHeight || img.height;

    if (width > maxDimension || height > maxDimension) {
      const scale = maxDimension / Math.max(width, height);
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Navegador sem suporte a compressão de imagem.');
    }

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const outputMime =
      file.type === 'image/webp' ? 'image/webp' : 'image/jpeg';

    let quality = 0.8;
    let dataUrl = canvas.toDataURL(outputMime, quality);

    while (dataUrl.length > MAX_IMAGE_DATA_URL_BYTES && quality > 0.45) {
      quality -= 0.12;
      dataUrl = canvas.toDataURL('image/jpeg', quality);
    }

    if (dataUrl.length > MAX_IMAGE_DATA_URL_BYTES) {
      // Scale down further if still large
      const reducedCanvas = document.createElement('canvas');
      reducedCanvas.width = Math.max(1, Math.round(width * 0.65));
      reducedCanvas.height = Math.max(1, Math.round(height * 0.65));
      const rCtx = reducedCanvas.getContext('2d');
      if (rCtx) {
        rCtx.fillStyle = '#FFFFFF';
        rCtx.fillRect(0, 0, reducedCanvas.width, reducedCanvas.height);
        rCtx.drawImage(
          canvas,
          0,
          0,
          reducedCanvas.width,
          reducedCanvas.height
        );
        dataUrl = reducedCanvas.toDataURL('image/jpeg', 0.72);
      }
    }

    const approxBytes = Math.round((dataUrl.length * 3) / 4);
    const finalMime = dataUrl.startsWith('data:image/webp')
      ? 'image/webp'
      : 'image/jpeg';

    return {
      url: dataUrl,
      name: file.name || 'foto-veiculo.jpg',
      mimeType: finalMime,
      sizeBytes: approxBytes,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function prepareChatAttachment(file: File): Promise<ChatAttachment> {
  const mime = (file.type || '').toLowerCase();
  const lowerName = (file.name || '').toLowerCase();

  if (
    ALLOWED_IMAGE_MIMES.has(mime) ||
    /\.(jpe?g|png|webp)$/i.test(lowerName)
  ) {
    return compressImageFile(file);
  }

  if (mime === 'application/pdf' || lowerName.endsWith('.pdf')) {
    if (file.size > MAX_PDF_RAW_BYTES) {
      throw new Error(
        'O PDF excede o limite de 2,4 MB para envio rápido. Comprima o arquivo ou envie uma foto das páginas principais.'
      );
    }
    const dataUrl = await blobToDataUrl(file);
    return {
      url: dataUrl,
      name: file.name || 'documento.pdf',
      mimeType: 'application/pdf',
      sizeBytes: file.size,
    };
  }

  throw new Error(
    'Formato não suportado. Envie imagens (JPG, PNG, WEBP) ou documentos em PDF.'
  );
}
