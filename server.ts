import crypto from 'crypto';
import dotenv from 'dotenv';
import express, { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { pool, verifyDatabaseConnection } from './src/db/pool';
import {
  DbChatMessageRow,
  DbChatSessionRow,
  DbContractRow,
  DbLeadRow,
  DbVehicleRow,
  seedNeonDatabaseIfEmpty,
} from './src/db/repository';
import {
  buildClearSessionCookieHeader,
  buildSessionCookieHeader,
  DbAdminUserRow,
  ensureAdminUsersSchemaAndSeed,
  parseCookies,
  PublicAdminUser,
  SESSION_COOKIE_NAME,
  signPublicLeadChatToken,
  signSessionToken,
  verifyPassword,
  verifyPublicLeadChatToken,
  verifySessionToken,
} from './src/db/auth';

if (fs.existsSync('.env.local')) {
  dotenv.config({ path: '.env.local', override: true });
}
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1);
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '5mb' }));

interface GeneratePostBody {
  vehicle: {
    brand: string;
    model: string;
    version: string;
    year: string;
    km: number;
    price: number;
    color: string;
    transmission: string;
    fuel: string;
    optionals: string[];
  };
  platform: string;
  tone: string;
  differentials: string;
  dealershipName: string;
  whatsapp: string;
  city: string;
}

interface ChatReplyPayload {
  id?: string;
  sender?: 'ia' | 'cliente';
  preview?: string;
}

interface ChatAudioPayload {
  dataUrl: string;
  mimeType?: string;
  durationSec?: number;
}

interface ChatAttachmentPayload {
  dataUrl: string;
  name?: string;
  mimeType?: string;
}

interface ChatRequestBody {
  sessionId?: string;
  origem?: string;
  visitorName?: string;
  messages: { sender: 'ia' | 'cliente'; text: string }[];
  replyTo?: ChatReplyPayload | null;
  audio?: ChatAudioPayload | null;
  attachment?: ChatAttachmentPayload | null;
  vehicle?: {
    brand: string;
    model: string;
    version: string;
    year: string;
    km: number;
    price: number;
    fipePrice?: number;
    fipeCode?: string;
    color: string;
    transmission: string;
    fuel: string;
    status: string;
    optionals: string[];
  } | null;
  inventorySummary?: string;
  settings?: {
    tradeName: string;
    address: string;
    city: string;
    state: string;
    whatsapp: string;
    hoursWeekdays: string;
    hoursSaturday: string;
    aiAssistantName: string;
  };
}

interface ChatAuditMeta {
  replyToId?: string | null;
  replyToPreview?: string | null;
  replyToSender?: 'user' | 'assistant' | null;
  audioUrl?: string | null;
  transcription?: string | null;
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  attachmentMime?: string | null;
}

const MAX_INLINE_MEDIA_BYTES = 3_200_000;

function parseDataUrlMedia(
  dataUrl: unknown,
  fallbackMime?: string
): { mimeType: string; base64: string; cleanDataUrl: string; byteLength: number } | null {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    return null;
  }
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) return null;
  const header = dataUrl.slice(5, commaIdx);
  const base64 = dataUrl.slice(commaIdx + 1).replace(/\s+/g, '');
  if (!base64) return null;

  const rawMime = header.split(';')[0]?.trim().toLowerCase() || (fallbackMime || '').split(';')[0].trim().toLowerCase();
  if (!rawMime) return null;

  const byteLength = Math.floor((base64.length * 3) / 4);
  return {
    mimeType: rawMime,
    base64,
    cleanDataUrl: dataUrl,
    byteLength,
  };
}

function normalizeGeminiAudioMime(mime: string): string {
  const base = mime.split(';')[0].trim().toLowerCase();
  if (base === 'audio/x-m4a' || base === 'audio/m4a') return 'audio/mp4';
  if (base === 'audio/mp3') return 'audio/mpeg';
  return base;
}

function withPromiseTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function isAudioTranscriptionUnintelligible(raw: string | null): boolean {
  if (!raw) return true;
  const trimmed = raw.trim();
  if (!trimmed) return true;
  if (/\[?\s*audio[_\s-]?inaud[ií]vel\s*\]?/i.test(trimmed)) return true;

  // Strip common non-speech tags like [silêncio], (ruído), [música], [inaudível]
  const withoutTags = trimmed
    .replace(
      /[\[(]\s*(sil[eê]ncio|ru[ií]do|inaud[ií]vel|m[uú]sica|sem\s+[aá]udio|sem\s+fala|barulho|est[aá]tica|silence|noise|inaudible|unintelligible|music)[^\]\)]*[\])]/gi,
      ' '
    )
    .trim();

  const alnumOnly = withoutTags.replace(/[^a-zA-Z0-9À-ÿ]/g, '');
  return alnumOnly.length < 2;
}

function isNonFallbackGeminiError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err);
  return (
    raw.includes('API_KEY_INVALID') ||
    raw.includes('PERMISSION_DENIED') ||
    raw.includes('401') ||
    raw.includes('403')
  );
}

let transcribeModelUnavailableUntil = 0;

type OperationMode = 'full' | 'agent_only';

function sanitizeSessionId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().slice(0, 120);
  if (!trimmed) return null;
  return trimmed;
}

function sanitizeOrigin(raw: unknown): string {
  if (typeof raw !== 'string') return '/chat';
  const trimmed = raw.trim().slice(0, 60);
  return trimmed || '/chat';
}

async function recordChatAuditTurn(
  sessionId: string | null,
  origem: string,
  sender: 'user' | 'assistant',
  content: string,
  meta?: ChatAuditMeta
): Promise<void> {
  const safeContent = content.trim();
  const hasRichMedia = Boolean(meta?.audioUrl || meta?.attachmentUrl);
  if (!sessionId || (!safeContent && !hasRichMedia)) return;
  try {
    await pool.query(
      `INSERT INTO chat_sessions (session_id, origem, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT (session_id)
       DO UPDATE SET updated_at = NOW()`,
      [sessionId, origem]
    );
    await pool.query(
      `INSERT INTO chat_messages (
         session_id,
         sender,
         content,
         reply_to_id,
         reply_to_preview,
         reply_to_sender,
         audio_url,
         transcription,
         attachment_url,
         attachment_name,
         attachment_mime,
         created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
      [
        sessionId,
        sender,
        safeContent,
        meta?.replyToId ?? null,
        meta?.replyToPreview ?? null,
        meta?.replyToSender ?? null,
        meta?.audioUrl ?? null,
        meta?.transcription ?? null,
        meta?.attachmentUrl ?? null,
        meta?.attachmentName ?? null,
        meta?.attachmentMime ?? null,
      ]
    );
  } catch (err) {
    console.error('[Chat Audit Log Error]', err);
  }
}

async function attachLeadToChatSession(
  sessionId: string | null,
  leadName: string,
  leadPhone: string,
  origem: string
): Promise<void> {
  if (!sessionId) return;
  try {
    await pool.query(
      `INSERT INTO chat_sessions (session_id, lead_name, lead_phone, origem, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (session_id)
       DO UPDATE SET lead_name = EXCLUDED.lead_name,
                     lead_phone = EXCLUDED.lead_phone,
                     updated_at = NOW()`,
      [sessionId, leadName, leadPhone, origem]
    );
  } catch (err) {
    console.error('[Chat Audit Lead Attach Error]', err);
  }
}

const VISITOR_NAME_STOPWORDS = new Set([
  'oi', 'ola', 'olá', 'opa', 'eae', 'fala', 'salve', 'bom', 'boa', 'dia', 'tarde', 'noite',
  'tudo', 'bem', 'obrigado', 'obrigada', 'valeu', 'sim', 'nao', 'não', 'ok', 'blz', 'beleza',
  'certo', 'show', 'legal', 'perfeito', 'otimo', 'ótimo', 'quero', 'gostaria', 'preciso',
  'tenho', 'estou', 'queria', 'ver', 'saber', 'falar', 'ajuda', 'info', 'informacao',
  'informação', 'contato', 'whatsapp', 'zap', 'menu', 'voltar', 'teste', 'testando',
  'carro', 'carros', 'veiculo', 'veículo', 'veiculos', 'veículos', 'estoque', 'modelo',
  'modelos', 'oferta', 'ofertas', 'preco', 'preço', 'valor', 'valores', 'fipe', 'tabela',
  'troca', 'avaliar', 'avaliacao', 'avaliação', 'financiamento', 'financiar', 'parcela',
  'parcelas', 'simular', 'simulacao', 'simulação', 'visita', 'agendar', 'endereco',
  'endereço', 'horario', 'horário', 'garantia', 'laudo', 'cautelar', 'suv', 'suvs',
  'sedan', 'sedans', 'hatch', 'picape', 'automatico', 'automático', 'manual', 'flex',
  'diesel', 'hibrido', 'híbrido', 'eletrico', 'elétrico', 'zero', 'seminovo', 'seminovos',
  'usado', 'usados', 'comprar', 'vender', 'consignado', 'consorcio', 'consórcio',
  'bmw', 'audi', 'mercedes', 'porsche', 'volvo', 'toyota', 'honda', 'jeep', 'volkswagen',
  'vw', 'chevrolet', 'ford', 'fiat', 'hyundai', 'nissan', 'renault', 'peugeot', 'citroen',
  'mitsubishi', 'byd', 'gwm', 'corolla', 'civic', 'compass', 'renegade', 'nivus', 'tcross',
  'taos', 'tracker', 'onix', 'hb20', 'creta', 'kicks', 'hrv', 'hilux', 'sw4', 'ranger',
  'toro', 'fastback', 'pulse', 'polo', 'virtus', 'tiguan', 'dolphin', 'song',
  'eu', 'voce', 'você', 'ele', 'ela', 'nos', 'nós', 'meu', 'minha', 'seu', 'sua', 'esse',
  'essa', 'este', 'esta', 'aqui', 'ali', 'como', 'onde', 'quando', 'qual', 'quais',
  'quanto', 'quanta', 'para', 'com', 'sem', 'por', 'que', 'um', 'uma', 'uns', 'umas',
  'os', 'as', 'do', 'da', 'dos', 'das', 'no', 'na', 'de', 'em', 'ou', 'mas', 'porque',
  'pois', 'tambem', 'também', 'muito', 'mais', 'menos', 'melhor', 'novo', 'nova',
  'cliente', 'visitante', 'interessado', 'interessada', 'consultor', 'vendedor', 'loja',
]);

function normalizeCandidateVisitorName(rawCandidate: string): string | null {
  const cleaned = rawCandidate
    .replace(/[^A-Za-zÀ-ÿ'\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;

  const words = cleaned.split(' ').filter(Boolean);
  if (words.length === 0 || words.length > 2) return null;

  const validated: string[] = [];
  for (const w of words) {
    const lower = w.toLowerCase();
    if (lower.length < 2 || lower.length > 20) return null;
    if (VISITOR_NAME_STOPWORDS.has(lower)) return null;
    validated.push(lower.charAt(0).toUpperCase() + lower.slice(1));
  }

  return validated.length > 0 ? validated.join(' ') : null;
}

function extractVisitorNameFromMessage(
  rawText: string,
  isFirstUserTurn: boolean
): string | null {
  const text = (rawText || '').trim();
  if (!text || text.length > 260) return null;

  // 1. Padrões explícitos de apresentação (ex: "Me chamo Mariana", "Oi, sou o Pedro, quero simular")
  const explicitPatterns: RegExp[] = [
    /(?:^|[\s,!.;-])(?:me\s+chamo|meu\s+nome\s+(?:é|e)|pode\s+me\s+chamar\s+de|chamo-me)\s+([A-Za-zÀ-ÿ]{2,20}(?:\s+[A-Za-zÀ-ÿ]{2,20})?)(?=$|[\s,!.;?:-]|(?:\s+(?:e|quero|gostaria|preciso|tenho|estou|tô|to|vim|queria|tudo|bom|boa|sobre|qual|quais|quanto|vocês|voces|vcs|pode|por|para)\b))/i,
    /(?:^|[\s,!.;-])(?:eu\s+sou\s+(?:o|a)?|sou\s+(?:o|a)|aqui\s+(?:é|e)\s+(?:o|a))\s+([A-Za-zÀ-ÿ]{2,20}(?:\s+[A-Za-zÀ-ÿ]{2,20})?)(?=$|[\s,!.;?:-]|(?:\s+(?:e|quero|gostaria|preciso|tenho|estou|tô|to|vim|queria|tudo|bom|boa|sobre|qual|quais|quanto|vocês|voces|vcs|pode|por|para)\b))/i,
    /(?:^|[\s,!.;-])(?:prazer|fala|oi|olá|ola)[,!.\s]+(?:sou\s+(?:o|a)?\s*)?([A-Za-zÀ-ÿ]{2,20})(?=\s*[,!.](?:\s|$)|$)/i,
  ];

  for (const rx of explicitPatterns) {
    const match = text.match(rx);
    if (match?.[1]) {
      // Se o segundo termo capturado for verbo/conector (ex: "Pedro quero"), usa apenas o primeiro nome
      const parts = match[1].trim().split(/\s+/);
      const fullCandidate = normalizeCandidateVisitorName(match[1]);
      if (fullCandidate) return fullCandidate;
      if (parts.length === 2) {
        const firstOnly = normalizeCandidateVisitorName(parts[0]);
        if (firstOnly) return firstOnly;
      }
    }
  }

  // 2. Resposta direta apenas com o nome na primeira mensagem após a saudação ("Lucas", "Oi, Mariana")
  if (isFirstUserTurn && !text.includes('?') && !/\d/.test(text) && !text.includes('/')) {
    const strippedGreeting = text
      .replace(
        /^(?:(?:oi|olá|ola|opa|bom\s+dia|boa\s+tarde|boa\s+noite|tudo\s+bem|e\s+a[ií]|olá\s+tudo\s+bem|oi\s+tudo\s+bem)[\s,!.-]*)+/i,
        ''
      )
      .replace(/[.!]+$/, '')
      .trim();

    if (strippedGreeting.length >= 2 && strippedGreeting.length <= 36) {
      const bareCandidate = normalizeCandidateVisitorName(strippedGreeting);
      if (bareCandidate) return bareCandidate;
    }
  }

  return null;
}

async function updateChatSessionVisitorName(
  sessionId: string | null,
  visitorName: string,
  origem: string
): Promise<void> {
  if (!sessionId || !visitorName.trim()) return;
  try {
    await pool.query(
      `INSERT INTO chat_sessions (session_id, lead_name, origem, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (session_id)
       DO UPDATE SET lead_name = CASE
                       WHEN chat_sessions.lead_name IS NULL OR BTRIM(chat_sessions.lead_name) = ''
                         THEN EXCLUDED.lead_name
                       ELSE chat_sessions.lead_name
                     END,
                     updated_at = NOW()`,
      [sessionId, visitorName.trim().slice(0, 120), origem]
    );
  } catch (err) {
    console.error('[Chat Audit Visitor Name Error]', err);
  }
}

async function getPersistedOperationMode(): Promise<OperationMode> {
  const envDefault: OperationMode =
    process.env.OPERATION_MODE === 'agent_only' ? 'agent_only' : 'full';
  try {
    const res = await pool.query<{ value: string }>(
      "SELECT value FROM app_settings WHERE key = 'operation_mode' LIMIT 1"
    );
    const val = res.rows[0]?.value?.trim();
    if (val === 'agent_only' || val === 'full') {
      return val;
    }
    return envDefault;
  } catch {
    return envDefault;
  }
}

interface BrasilApiFipeRawItem {
  valor?: string;
  marca?: string;
  modelo?: string;
  anoModelo?: number;
  combustivel?: string;
  codigoFipe?: string;
  mesReferencia?: string;
  tipoVeiculo?: number;
  siglaCombustivel?: string;
  dataConsulta?: string;
}

interface FipePriceEntry {
  valor: string;
  valorNumerico: number;
  marca: string;
  modelo: string;
  anoModelo: number;
  combustivel: string;
  codigoFipe: string;
  mesReferencia: string;
  tipoVeiculo: number;
  siglaCombustivel: string;
  dataConsulta: string;
}

interface FipeLookupResult {
  codigoFipe: string;
  cached: boolean;
  items: FipePriceEntry[];
  recommended: FipePriceEntry;
}

class FipeServiceError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const FIPE_CACHE_TTL_MS = 30 * 60 * 1000;
const fipeLookupCache = new Map<
  string,
  { expiresAt: number; items: FipePriceEntry[] }
>();

function normalizeFipeCode(rawCode: string): string | null {
  const digits = rawCode.replace(/\D/g, '');
  if (digits.length !== 7) {
    return null;
  }
  return `${digits.slice(0, 6)}-${digits.slice(6)}`;
}

function parseFipeBrlValue(rawValor: string | undefined): number {
  if (!rawValor) return 0;
  const cleaned = rawValor
    .replace(/R\$/gi, '')
    .replace(/\s+/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

function selectRecommendedFipeItem(
  items: FipePriceEntry[],
  yearHint?: number
): FipePriceEntry {
  if (Number.isFinite(yearHint) && (yearHint as number) > 1900) {
    const exact = items.find((item) => item.anoModelo === yearHint);
    if (exact) return exact;

    const regularYears = items.filter(
      (item) => item.anoModelo >= 1950 && item.anoModelo < 30000
    );
    if (regularYears.length > 0) {
      return [...regularYears].sort(
        (a, b) =>
          Math.abs(a.anoModelo - (yearHint as number)) -
          Math.abs(b.anoModelo - (yearHint as number))
      )[0];
    }
  }

  return (
    items.find((item) => item.anoModelo >= 1950 && item.anoModelo < 30000) ||
    items[0]
  );
}

async function fetchBrasilApiFipe(
  rawCode: string,
  yearHint?: number
): Promise<FipeLookupResult> {
  const normalizedCode = normalizeFipeCode(rawCode);
  if (!normalizedCode) {
    throw new FipeServiceError(
      400,
      'Código FIPE inválido. Informe os 7 dígitos do código FIPE (ex: 001004-9 ou 009222-3).'
    );
  }

  const cachedEntry = fipeLookupCache.get(normalizedCode);
  if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
    return {
      codigoFipe: normalizedCode,
      cached: true,
      items: cachedEntry.items,
      recommended: selectRecommendedFipeItem(cachedEntry.items, yearHint),
    };
  }

  const endpoint = `https://brasilapi.com.br/api/fipe/preco/v1/${encodeURIComponent(
    normalizedCode
  )}`;

  let response: globalThis.Response;
  try {
    response = await fetch(endpoint, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'ArmazemDoCarro/1.0',
      },
      signal: AbortSignal.timeout(8000),
    });
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      (err.name === 'TimeoutError' || err.name === 'AbortError')
    ) {
      throw new FipeServiceError(
        504,
        'Tempo limite excedido ao consultar a Tabela FIPE (BrasilAPI). Tente novamente em instantes.'
      );
    }
    throw new FipeServiceError(
      502,
      'Não foi possível conectar ao serviço da BrasilAPI para consultar a Tabela FIPE.'
    );
  }

  if (response.status === 404) {
    throw new FipeServiceError(
      404,
      `Código FIPE ${normalizedCode} não encontrado na Tabela FIPE oficial.`
    );
  }

  if (response.status === 400) {
    throw new FipeServiceError(
      400,
      `Código FIPE ${normalizedCode} rejeitado pela BrasilAPI.`
    );
  }

  if (!response.ok) {
    const upstreamErr = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    const upstreamMsg = upstreamErr?.message?.trim();
    throw new FipeServiceError(
      response.status >= 500 ? 503 : 502,
      upstreamMsg
        ? `BrasilAPI (${normalizedCode}): ${upstreamMsg}`
        : `BrasilAPI retornou erro (${response.status}) ao consultar o código FIPE ${normalizedCode}.`
    );
  }

  const rawData = (await response.json().catch(() => null)) as
    | BrasilApiFipeRawItem[]
    | { message?: string }
    | null;

  if (!Array.isArray(rawData) || rawData.length === 0) {
    throw new FipeServiceError(
      404,
      `Nenhum valor encontrado na Tabela FIPE para o código ${normalizedCode}.`
    );
  }

  const items: FipePriceEntry[] = rawData
    .map((item) => ({
      valor: String(item.valor || 'R$ 0,00'),
      valorNumerico: parseFipeBrlValue(item.valor),
      marca: String(item.marca || ''),
      modelo: String(item.modelo || ''),
      anoModelo: Number(item.anoModelo) || 0,
      combustivel: String(item.combustivel || ''),
      codigoFipe: normalizeFipeCode(String(item.codigoFipe || normalizedCode)) || normalizedCode,
      mesReferencia: String(item.mesReferencia || '').trim(),
      tipoVeiculo: Number(item.tipoVeiculo) || 1,
      siglaCombustivel: String(item.siglaCombustivel || ''),
      dataConsulta: String(item.dataConsulta || ''),
    }))
    .sort((a, b) => b.anoModelo - a.anoModelo);

  fipeLookupCache.set(normalizedCode, {
    expiresAt: Date.now() + FIPE_CACHE_TTL_MS,
    items,
  });

  return {
    codigoFipe: normalizedCode,
    cached: false,
    items,
    recommended: selectRecommendedFipeItem(items, yearHint),
  };
}

function buildFipeComparisonSummary(
  sellingPrice: number,
  fipePrice?: number | null,
  fipeCode?: string | null
): string {
  const validFipe = Number(fipePrice);
  const codeTag = fipeCode ? ` (Cód. FIPE ${fipeCode})` : '';
  if (!Number.isFinite(validFipe) || validFipe <= 0) {
    return fipeCode ? `Cód. FIPE ${fipeCode} (sem valor salvo)` : '';
  }

  const formattedFipe = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(validFipe);

  if (!Number.isFinite(sellingPrice) || sellingPrice <= 0) {
    return `FIPE${codeTag}: ${formattedFipe}`;
  }

  const diff = validFipe - sellingPrice;
  const pct = (Math.abs(diff) / validFipe) * 100;
  const pctLabel = pct.toFixed(1).replace('.', ',');
  const diffFormatted = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(Math.abs(diff));

  if (diff > 0) {
    return `FIPE${codeTag}: ${formattedFipe} — ${pctLabel}% abaixo da FIPE (economia de ${diffFormatted})`;
  }
  if (diff < 0) {
    return `FIPE${codeTag}: ${formattedFipe} — ${pctLabel}% acima da FIPE (+${diffFormatted} por diferenciais/baixa km)`;
  }
  return `FIPE${codeTag}: ${formattedFipe} — exatamente no valor da Tabela FIPE`;
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'Chave GEMINI_API_KEY não configurada no ambiente. Configure-a em Settings > Secrets ou .env.local para utilizar a IA.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: 60000,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

interface GeminiUsageMetadataLike {
  promptTokenCount?: number | null;
  candidatesTokenCount?: number | null;
  totalTokenCount?: number | null;
}

type AiUsageFeature = 'chat_text' | 'chat_audio' | 'crm_summary' | 'social_post';

/**
 * Persiste silenciosamente o consumo de tokens reportado pelo Gemini em ai_usage_logs.
 * Executa em background com try/catch para nunca atrasar nem interromper a resposta ao usuário.
 */
function recordAiUsageLog(params: {
  sessionId?: string | null;
  feature: AiUsageFeature;
  model: string;
  usageMetadata?: GeminiUsageMetadataLike | null;
}): void {
  try {
    const meta = params.usageMetadata;
    if (!meta) return;

    const promptTokens = Math.max(0, Math.round(Number(meta.promptTokenCount) || 0));
    const completionTokens = Math.max(
      0,
      Math.round(Number(meta.candidatesTokenCount) || 0)
    );
    const totalTokens = Math.max(
      0,
      Math.round(Number(meta.totalTokenCount) || promptTokens + completionTokens)
    );

    if (promptTokens === 0 && completionTokens === 0 && totalTokens === 0) {
      return;
    }

    const safeSessionId = params.sessionId
      ? sanitizeSessionId(params.sessionId)
      : null;
    const safeModel = String(params.model || 'unknown').trim().slice(0, 128);

    void pool
      .query(
        `INSERT INTO ai_usage_logs (
           session_id,
           feature,
           model,
           prompt_tokens,
           completion_tokens,
           total_tokens,
           created_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          safeSessionId,
          params.feature,
          safeModel,
          promptTokens,
          completionTokens,
          totalTokens,
        ]
      )
      .catch((err) => {
        console.error('[AI Usage Audit Log Error]', err);
      });
  } catch (err) {
    console.error('[AI Usage Audit Log Sync Error]', err);
  }
}

function isValidOwnerSecret(req: express.Request, configuredSecret: string): boolean {
  const headerKey =
    typeof req.headers['x-owner-secret'] === 'string'
      ? req.headers['x-owner-secret'].trim()
      : '';
  const authHeader =
    typeof req.headers.authorization === 'string'
      ? req.headers.authorization.trim()
      : '';
  const bearerKey = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : '';
  const queryKey =
    typeof req.query.key === 'string' ? req.query.key.trim() : '';

  const provided = headerKey || bearerKey || queryKey;
  if (!provided) return false;

  const providedBuf = Buffer.from(provided, 'utf8');
  const expectedBuf = Buffer.from(configuredSecret, 'utf8');
  if (providedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

async function callGeminiWithRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient =
        msg.includes('503') ||
        msg.includes('504') ||
        msg.includes('429') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('DEADLINE_EXCEEDED') ||
        msg.includes('high demand');
      if (!isTransient || attempt === maxRetries) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
    }
  }
  throw lastError;
}

function formatGeminiError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : 'Erro desconhecido ao consultar Gemini API.';
  if (raw.includes('503') || raw.includes('UNAVAILABLE')) {
    return {
      status: 503,
      message: 'O serviço de IA está com alta demanda temporária no momento. Tente novamente em alguns segundos.',
    };
  }
  if (raw.includes('504') || raw.includes('DEADLINE_EXCEEDED')) {
    return {
      status: 504,
      message: 'A requisição de IA excedeu o tempo limite. Tente novamente em instantes.',
    };
  }
  if (raw.includes('429') || raw.includes('RESOURCE_EXHAUSTED')) {
    return {
      status: 429,
      message: 'Limite temporário de requisições da API Gemini atingido. Aguarde alguns instantes.',
    };
  }
  if (raw.includes('403') || raw.includes('400') || raw.includes('API_KEY_INVALID')) {
    return {
      status: 400,
      message: 'Chave GEMINI_API_KEY inválida ou sem permissão. Verifique a configuração em .env.local ou Settings > Secrets.',
    };
  }
  return { status: 500, message: raw };
}

interface AuthenticatedRequest extends Request {
  adminUser?: PublicAdminUser;
}

async function resolveAuthenticatedAdmin(
  req: Request
): Promise<PublicAdminUser | null> {
  const cookies = parseCookies(req.headers.cookie);
  let token = cookies[SESSION_COOKIE_NAME] || '';

  if (!token) {
    const authHeader = req.headers.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    }
  }

  if (!token) return null;

  const payload = verifySessionToken(token);
  if (!payload) return null;

  const userRes = await pool.query<DbAdminUserRow>(
    `SELECT id, name, email, role, avatar_url, active
     FROM admin_users
     WHERE id = $1 AND active = true
     LIMIT 1`,
    [payload.sub]
  );

  const row = userRes.rows[0];
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    avatarUrl: row.avatar_url,
  };
}

async function requireAdminAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = await resolveAuthenticatedAdmin(req);
    if (!user) {
      res.status(401).json({
        error: 'Autenticação administrativa necessária. Faça login para continuar.',
      });
      return;
    }
    req.adminUser = user;
    next();
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Erro ao validar sessão administrativa.';
    res.status(500).json({ error: message });
  }
}

// ============================================================================
// Authentication Routes (HttpOnly JWT Cookie + Neon PostgreSQL)
// ============================================================================

app.post('/api/auth/login', async (req, res) => {
  try {
    const rawEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const rawPassword = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!rawEmail || !rawPassword) {
      res.status(400).json({ error: 'Informe o e-mail corporativo e a senha.' });
      return;
    }

    const userRes = await pool.query<DbAdminUserRow>(
      `SELECT id, name, email, password_hash, role, avatar_url, active
       FROM admin_users
       WHERE LOWER(email) = $1
       LIMIT 1`,
      [rawEmail]
    );

    const row = userRes.rows[0];
    if (!row || !row.active || !verifyPassword(rawPassword, row.password_hash)) {
      res.status(401).json({
        error: 'E-mail ou senha inválidos. Verifique suas credenciais e tente novamente.',
      });
      return;
    }

    await pool.query('UPDATE admin_users SET last_login_at = NOW() WHERE id = $1', [
      row.id,
    ]);

    const user: PublicAdminUser = {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      avatarUrl: row.avatar_url,
    };

    const token = signSessionToken(user);
    res.setHeader('Set-Cookie', buildSessionCookieHeader(req, token));
    res.json({ authenticated: true, user, token });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Erro ao autenticar no banco de dados.';
    res.status(500).json({ error: message });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', buildClearSessionCookieHeader(req));
  res.json({ loggedOut: true });
});

app.get('/api/auth/me', async (req, res) => {
  try {
    const user = await resolveAuthenticatedAdmin(req);
    if (!user) {
      res.status(401).json({ authenticated: false, error: 'Sessão não autenticada.' });
      return;
    }
    res.json({ authenticated: true, user });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Erro ao verificar sessão ativa.';
    res.status(500).json({ authenticated: false, error: message });
  }
});

// ============================================================================
// Neon PostgreSQL API Routes (Public Storefront vs Protected Admin)
// ============================================================================

app.get('/api/health/db', async (_req, res) => {
  try {
    const info = await verifyDatabaseConnection();
    res.json(info);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao conectar ao PostgreSQL.';
    res.status(500).json({ connected: false, error: message });
  }
});

app.get('/api/public/vehicles', async (_req, res) => {
  try {
    const result = await pool.query<DbVehicleRow>(
      "SELECT * FROM vehicles WHERE status = 'Disponivel' ORDER BY created_at DESC, id DESC"
    );
    res.json(result.rows);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Erro ao consultar estoque público.';
    res.status(500).json({ error: message });
  }
});

app.get('/api/public/config', async (_req, res) => {
  try {
    const operationMode = await getPersistedOperationMode();
    res.json({ operationMode });
  } catch {
    const fallback: OperationMode =
      process.env.OPERATION_MODE === 'agent_only' ? 'agent_only' : 'full';
    res.json({ operationMode: fallback });
  }
});

app.get('/api/public/chat-session/:sessionId', async (req, res) => {
  const cleanSessionId = sanitizeSessionId(req.params.sessionId);
  if (!cleanSessionId) {
    res.status(400).json({ error: 'Sessão inválida.' });
    return;
  }
  try {
    const result = await pool.query<{
      session_id: string;
      lead_name: string | null;
      lead_phone: string | null;
    }>(
      `SELECT session_id, lead_name, lead_phone
       FROM chat_sessions
       WHERE session_id = $1
       LIMIT 1`,
      [cleanSessionId]
    );
    const row = result.rows[0];
    res.json({
      found: Boolean(row),
      sessionId: cleanSessionId,
      leadName: row?.lead_name?.trim() || null,
      leadPhone: row?.lead_phone?.trim() || null,
    });
  } catch {
    res.json({
      found: false,
      sessionId: cleanSessionId,
      leadName: null,
      leadPhone: null,
    });
  }
});

app.post('/api/public/chat-session/identify', async (req, res) => {
  try {
    const cleanSessionId = sanitizeSessionId(req.body?.sessionId);
    const rawName =
      typeof req.body?.leadName === 'string'
        ? req.body.leadName.replace(/\s+/g, ' ').trim()
        : '';
    const rawPhone =
      typeof req.body?.leadPhone === 'string'
        ? req.body.leadPhone.trim().slice(0, 40)
        : '';
    const cleanOrigin = sanitizeOrigin(req.body?.origem);

    if (!cleanSessionId) {
      res.status(400).json({ error: 'Sessão inválida.' });
      return;
    }
    if (rawName.length < 2) {
      res.status(400).json({ error: 'Informe seu nome para iniciar o atendimento.' });
      return;
    }

    const safeName = rawName.slice(0, 120);
    const phoneDigits = rawPhone.replace(/\D/g, '');
    const safePhone = phoneDigits.length >= 8 ? rawPhone : null;

    const result = await pool.query<{
      session_id: string;
      lead_name: string | null;
      lead_phone: string | null;
    }>(
      `INSERT INTO chat_sessions (session_id, lead_name, lead_phone, origem, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (session_id)
       DO UPDATE SET lead_name = EXCLUDED.lead_name,
                     lead_phone = COALESCE(NULLIF(BTRIM(EXCLUDED.lead_phone), ''), chat_sessions.lead_phone),
                     updated_at = NOW()
       RETURNING session_id, lead_name, lead_phone`,
      [cleanSessionId, safeName, safePhone, cleanOrigin]
    );

    const row = result.rows[0];
    res.json({
      sessionId: row?.session_id ?? cleanSessionId,
      leadName: row?.lead_name ?? safeName,
      leadPhone: row?.lead_phone ?? safePhone,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : 'Erro ao salvar identificação do visitante.';
    res.status(500).json({ error: message });
  }
});

app.get('/api/public/chat-session/:sessionId/updates', async (req, res) => {
  const cleanSessionId = sanitizeSessionId(req.params.sessionId);
  if (!cleanSessionId) {
    res.status(400).json({ error: 'Sessão inválida.' });
    return;
  }

  const afterMessageId = Math.max(0, Number(req.query.afterMessageId) || 0);
  const afterBroadcastId = Math.max(
    0,
    Number(req.query.afterBroadcastId) || 0
  );

  try {
    const [msgRes, broadcastRes] = await Promise.all([
      pool.query<DbChatMessageRow>(
        `SELECT id, session_id, sender, content, sender_label, is_human_consultant, created_at
         FROM chat_messages
         WHERE session_id = $1
           AND is_human_consultant = true
           AND id > $2
         ORDER BY id ASC
         LIMIT 20`,
        [cleanSessionId, afterMessageId]
      ),
      pool.query<{
        id: number;
        title: string | null;
        message: string;
        created_by: string | null;
        created_at: Date;
      }>(
        `SELECT id, title, message, created_by, created_at
         FROM chat_broadcasts
         WHERE id > $1
           AND created_at >= NOW() - INTERVAL '24 hours'
         ORDER BY id ASC
         LIMIT 5`,
        [afterBroadcastId]
      ),
    ]);

    res.json({
      consultantMessages: msgRes.rows.map((m) => ({
        id: m.id,
        content: m.content,
        senderLabel: m.sender_label || 'Consultor da Loja',
        isHumanConsultant: true,
        createdAt: m.created_at,
      })),
      broadcasts: broadcastRes.rows.map((b) => ({
        id: b.id,
        title: b.title,
        message: b.message,
        createdBy: b.created_by || 'Equipe Armazém do Carro',
        createdAt: b.created_at,
      })),
    });
  } catch {
    res.json({
      consultantMessages: [],
      broadcasts: [],
    });
  }
});

app.patch('/api/admin/settings/operation-mode', requireAdminAuth, async (req, res) => {
  try {
    const requested =
      typeof req.body?.operationMode === 'string'
        ? req.body.operationMode.trim()
        : '';
    if (requested !== 'full' && requested !== 'agent_only') {
      res.status(400).json({
        error: "Modo de operação inválido. Utilize 'full' ou 'agent_only'.",
      });
      return;
    }

    await pool.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('operation_mode', $1, NOW())
       ON CONFLICT (key)
       DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [requested]
    );

    res.json({ operationMode: requested });
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : 'Erro ao salvar modo de operação no banco.';
    res.status(500).json({ error: message });
  }
});

app.get('/api/admin/chat-sessions', requireAdminAuth, async (_req, res) => {
  try {
    const result = await pool.query<DbChatSessionRow>(
      `SELECT
         s.id,
         s.session_id,
         s.lead_name,
          s.lead_phone,
          s.origem,
          s.tag,
          s.ai_summary,
          s.ai_summary_updated_at,
          s.created_at,
          s.updated_at,
          COALESCE(m_agg.message_count, 0)::int AS message_count,
          CASE
            WHEN m_last.audio_url IS NOT NULL THEN
              COALESCE(NULLIF(TRIM(m_last.transcription), ''), NULLIF(TRIM(m_last.content), ''), '[Mensagem de áudio]')
            WHEN m_last.attachment_url IS NOT NULL THEN
              COALESCE(NULLIF(TRIM(m_last.content), ''), CONCAT('[Anexo: ', COALESCE(m_last.attachment_name, 'arquivo'), ']'))
            ELSE m_last.content
          END AS last_message,
          m_last.sender AS last_sender
        FROM chat_sessions s
        LEFT JOIN (
          SELECT session_id, COUNT(*)::int AS message_count
          FROM chat_messages
          GROUP BY session_id
        ) m_agg ON m_agg.session_id = s.session_id
        LEFT JOIN LATERAL (
          SELECT content, sender, audio_url, transcription, attachment_url, attachment_name
          FROM chat_messages
          WHERE session_id = s.session_id
          ORDER BY id DESC
          LIMIT 1
        ) m_last ON true
        ORDER BY s.updated_at DESC, s.id DESC
        LIMIT 200`
    );

    res.json(
      result.rows.map((row) => ({
        id: row.id,
        sessionId: row.session_id,
        leadName: row.lead_name,
        leadPhone: row.lead_phone,
        origem: row.origem,
        tag: row.tag ?? null,
        aiSummary: row.ai_summary ?? null,
        aiSummaryUpdatedAt: row.ai_summary_updated_at ?? null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        messageCount: Number(row.message_count) || 0,
        lastMessage: row.last_message ?? null,
        lastSender: row.last_sender ?? null,
      }))
    );
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : 'Erro ao listar histórico de conversas da IA.';
    res.status(500).json({ error: message });
  }
});

app.get(
  '/api/admin/chat-sessions/:sessionId/messages',
  requireAdminAuth,
  async (req, res) => {
    const sessionId = sanitizeSessionId(req.params.sessionId);
    if (!sessionId) {
      res.status(400).json({ error: 'Identificador de sessão inválido.' });
      return;
    }

    try {
      const sessionRes = await pool.query<DbChatSessionRow>(
        'SELECT * FROM chat_sessions WHERE session_id = $1 LIMIT 1',
        [sessionId]
      );

      if (sessionRes.rowCount === 0) {
        res.status(404).json({ error: 'Sessão de conversa não encontrada.' });
        return;
      }

      const msgRes = await pool.query<DbChatMessageRow>(
        `SELECT
           id,
           session_id,
           sender,
           content,
           reply_to_id,
           reply_to_preview,
           reply_to_sender,
           audio_url,
           transcription,
           attachment_url,
           attachment_name,
           attachment_mime,
           sender_label,
           is_human_consultant,
           created_at
         FROM chat_messages
         WHERE session_id = $1
         ORDER BY id ASC`,
        [sessionId]
      );

      const s = sessionRes.rows[0];
      res.json({
        session: {
          id: s.id,
          sessionId: s.session_id,
          leadName: s.lead_name,
          leadPhone: s.lead_phone,
          origem: s.origem,
          tag: s.tag ?? null,
          aiSummary: s.ai_summary ?? null,
          aiSummaryUpdatedAt: s.ai_summary_updated_at ?? null,
          createdAt: s.created_at,
          updatedAt: s.updated_at,
        },
        messages: msgRes.rows.map((m) => ({
          id: m.id,
          sessionId: m.session_id,
          sender: m.sender,
          content: m.content,
          replyToId: m.reply_to_id ?? null,
          replyToPreview: m.reply_to_preview ?? null,
          replyToSender: m.reply_to_sender ?? null,
          audioUrl: m.audio_url ?? null,
          transcription: m.transcription ?? null,
          attachmentUrl: m.attachment_url ?? null,
          attachmentName: m.attachment_name ?? null,
          attachmentMime: m.attachment_mime ?? null,
          attachmentDownloadUrl: m.attachment_url
            ? `/api/admin/chat-messages/${m.id}/attachment`
            : null,
          senderLabel: m.sender_label ?? null,
          isHumanConsultant: Boolean(m.is_human_consultant),
          createdAt: m.created_at,
        })),
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'Erro ao carregar mensagens da sessão.';
      res.status(500).json({ error: message });
    }
  }
);

app.post(
  '/api/admin/chat-sessions/:sessionId/consultant-message',
  requireAdminAuth,
  async (req: AuthenticatedRequest, res) => {
    const sessionId = sanitizeSessionId(req.params.sessionId);
    if (!sessionId) {
      res.status(400).json({ error: 'Identificador de sessão inválido.' });
      return;
    }

    const rawText =
      typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!rawText) {
      res.status(400).json({ error: 'Digite uma mensagem para enviar ao visitante.' });
      return;
    }

    const safeMessage = rawText.slice(0, 2000);
    const customLabel =
      typeof req.body?.senderLabel === 'string' && req.body.senderLabel.trim()
        ? req.body.senderLabel.trim().slice(0, 80)
        : req.adminUser?.name
          ? `Consultor ${req.adminUser.name.split(' ')[0]}`
          : 'Consultor da Loja';

    try {
      const sessionRes = await pool.query<{ session_id: string }>(
        'SELECT session_id FROM chat_sessions WHERE session_id = $1 LIMIT 1',
        [sessionId]
      );
      if (sessionRes.rowCount === 0) {
        res.status(404).json({ error: 'Sessão de conversa não encontrada.' });
        return;
      }

      const insertRes = await pool.query<DbChatMessageRow>(
        `INSERT INTO chat_messages (
           session_id,
           sender,
           content,
           sender_label,
           is_human_consultant
         )
         VALUES ($1, 'assistant', $2, $3, true)
         RETURNING id, session_id, sender, content, sender_label, is_human_consultant, created_at`,
        [sessionId, safeMessage, customLabel]
      );

      await pool.query(
        'UPDATE chat_sessions SET updated_at = NOW() WHERE session_id = $1',
        [sessionId]
      );

      const m = insertRes.rows[0];
      res.status(201).json({
        id: m.id,
        sessionId: m.session_id,
        sender: m.sender,
        content: m.content,
        senderLabel: m.sender_label ?? customLabel,
        isHumanConsultant: true,
        createdAt: m.created_at,
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'Erro ao enviar mensagem do consultor.';
      res.status(500).json({ error: message });
    }
  }
);

app.get('/api/admin/notifications', requireAdminAuth, async (_req, res) => {
  try {
    const [chatMsgsRes, leadsRes] = await Promise.all([
      pool.query<{
        id: number;
        session_id: string;
        content: string;
        transcription: string | null;
        attachment_name: string | null;
        created_at: Date;
        lead_name: string | null;
        lead_phone: string | null;
        origem: string;
      }>(
        `SELECT
           m.id,
           m.session_id,
           m.content,
           m.transcription,
           m.attachment_name,
           m.created_at,
           s.lead_name,
           s.lead_phone,
           s.origem
         FROM chat_messages m
         JOIN chat_sessions s ON s.session_id = m.session_id
         WHERE m.sender = 'user'
         ORDER BY m.id DESC
         LIMIT 20`
      ),
      pool.query<{
        id: number;
        name: string;
        phone: string;
        vehicle_interest: string | null;
        chat_session_id: string | null;
        created_at: Date;
      }>(
        `SELECT id, name, phone, vehicle_interest, chat_session_id, created_at
         FROM leads
         ORDER BY id DESC
         LIMIT 12`
      ),
    ]);

    const items = [
      ...chatMsgsRes.rows.map((row) => {
        const preview =
          row.transcription?.trim() ||
          row.content?.trim() ||
          (row.attachment_name ? `Anexo: ${row.attachment_name}` : 'Nova mensagem');
        return {
          id: `msg-${row.id}`,
          type: 'chat_message' as const,
          title: row.lead_name?.trim()
            ? `Nova mensagem de ${row.lead_name.trim()}`
            : `Nova mensagem (${row.origem})`,
          preview: preview.replace(/\s+/g, ' ').slice(0, 120),
          sessionId: row.session_id,
          leadId: null,
          leadPhone: row.lead_phone,
          origem: row.origem,
          createdAt: row.created_at.toISOString(),
        };
      }),
      ...leadsRes.rows.map((lead) => ({
        id: `lead-${lead.id}`,
        type: 'new_lead' as const,
        title: `Novo lead: ${lead.name}`,
        preview: (lead.vehicle_interest || lead.phone || 'Novo contato no CRM').slice(
          0,
          120
        ),
        sessionId: lead.chat_session_id,
        leadId: String(lead.id),
        leadPhone: lead.phone,
        origem: 'CRM',
        createdAt: lead.created_at.toISOString(),
      })),
    ]
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
      .slice(0, 25);

    res.json({
      serverTime: new Date().toISOString(),
      items,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : 'Erro ao carregar notificações administrativas.';
    res.status(500).json({ error: message });
  }
});

app.get('/api/admin/chat-broadcasts', requireAdminAuth, async (_req, res) => {
  try {
    const result = await pool.query<{
      id: number;
      title: string | null;
      message: string;
      created_by: string | null;
      created_at: Date;
    }>(
      `SELECT id, title, message, created_by, created_at
       FROM chat_broadcasts
       ORDER BY id DESC
       LIMIT 15`
    );
    res.json(
      result.rows.map((b) => ({
        id: b.id,
        title: b.title,
        message: b.message,
        createdBy: b.created_by,
        createdAt: b.created_at,
      }))
    );
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Erro ao listar avisos enviados.';
    res.status(500).json({ error: message });
  }
});

app.post('/api/admin/chat-broadcasts', requireAdminAuth, async (req: AuthenticatedRequest, res) => {
  const rawMessage =
    typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  const rawTitle =
    typeof req.body?.title === 'string' ? req.body.title.trim() : '';

  if (!rawMessage) {
    res.status(400).json({ error: 'Escreva o texto do aviso/campanha antes de enviar.' });
    return;
  }

  const safeMessage = rawMessage.slice(0, 1200);
  const safeTitle = rawTitle ? rawTitle.slice(0, 120) : 'Aviso da Loja';
  const createdBy = req.adminUser?.name || 'Equipe Comercial';

  try {
    const result = await pool.query<{
      id: number;
      title: string | null;
      message: string;
      created_by: string | null;
      created_at: Date;
    }>(
      `INSERT INTO chat_broadcasts (title, message, created_by)
       VALUES ($1, $2, $3)
       RETURNING id, title, message, created_by, created_at`,
      [safeTitle, safeMessage, createdBy]
    );
    const b = result.rows[0];
    res.status(201).json({
      id: b.id,
      title: b.title,
      message: b.message,
      createdBy: b.created_by,
      createdAt: b.created_at,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Erro ao publicar aviso no /chat.';
    res.status(500).json({ error: message });
  }
});

const ALLOWED_CHAT_SESSION_TAGS: Record<string, string> = {
  'Lead Quente': '🔥 Lead Quente',
  Financiamento: '💰 Financiamento',
  Troca: '🔄 Troca',
  'Agendar Visita': '📅 Agendar Visita',
  'Frio / Dúvida': '❄️ Frio / Dúvida',
};

app.patch(
  '/api/admin/chat-sessions/:sessionId/tag',
  requireAdminAuth,
  async (req, res) => {
    const sessionId = sanitizeSessionId(req.params.sessionId);
    if (!sessionId) {
      res.status(400).json({ error: 'Identificador de sessão inválido.' });
      return;
    }

    const rawTag =
      typeof req.body?.tag === 'string' ? req.body.tag.trim() : '';
    const nextTag = rawTag.length > 0 ? rawTag : null;

    if (nextTag && !ALLOWED_CHAT_SESSION_TAGS[nextTag]) {
      res.status(400).json({
        error: 'Etiqueta de classificação inválida.',
      });
      return;
    }

    try {
      const sessionRes = await pool.query<DbChatSessionRow>(
        `UPDATE chat_sessions
         SET tag = $1, updated_at = NOW()
         WHERE session_id = $2
         RETURNING *`,
        [nextTag, sessionId]
      );

      if (sessionRes.rowCount === 0) {
        res.status(404).json({ error: 'Sessão de conversa não encontrada.' });
        return;
      }

      const session = sessionRes.rows[0];

      if (!nextTag) {
        res.json({
          sessionId: session.session_id,
          tag: null,
          crmAction: 'none',
          lead: null,
        });
        return;
      }

      const tagLabel = ALLOWED_CHAT_SESSION_TAGS[nextTag];

      // Carrega histórico recente da sessão para compor resumo e transcript do CRM
      const msgRes = await pool.query<{
        id: number;
        sender: 'user' | 'assistant';
        content: string;
        transcription: string | null;
        attachment_name: string | null;
        created_at: Date;
      }>(
        `SELECT id, sender, content, transcription, attachment_name, created_at
         FROM chat_messages
         WHERE session_id = $1
         ORDER BY id ASC
         LIMIT 60`,
        [sessionId]
      );

      const lightweightChatHistory = msgRes.rows.map((m) => {
        const text =
          m.content?.trim() ||
          (m.transcription?.trim()
            ? `[Áudio] ${m.transcription.trim()}`
            : m.attachment_name
              ? `[Anexo: ${m.attachment_name}]`
              : '');
        const timestamp = m.created_at
          ? new Date(m.created_at).toLocaleTimeString('pt-BR', {
              hour: '2-digit',
              minute: '2-digit',
            })
          : 'Hoje';
        return {
          id: `audit-${m.id}`,
          sender: m.sender === 'user' ? 'cliente' : 'ia',
          text,
          timestamp,
        };
      });

      const lastUserMsg = [...msgRes.rows]
        .reverse()
        .find((m) => m.sender === 'user');
      const lastAnyMsg = msgRes.rows[msgRes.rows.length - 1];
      const rawSnippet =
        lastUserMsg?.transcription?.trim() ||
        lastUserMsg?.content?.trim() ||
        (lastUserMsg?.attachment_name
          ? `Anexo enviado: ${lastUserMsg.attachment_name}`
          : '') ||
        lastAnyMsg?.content?.trim() ||
        '';
      const cleanSnippet = rawSnippet.replace(/\s+/g, ' ').trim().slice(0, 180);

      const leadName =
        session.lead_name?.trim() || `Visitante #${session.id}`;
      const leadPhone = session.lead_phone?.trim() || '';
      const normalizedPhoneDigits = leadPhone.replace(/\D/g, '');
      const autoSummary = `[${tagLabel}] Origem: Chat IA (${session.origem})${
        cleanSnippet ? `\nÚltima interação: "${cleanSnippet}"` : ''
      }`;
      const defaultInterest = `${tagLabel} · Chat IA (${session.origem})`;

      // Busca lead existente por chat_session_id ou telefone normalizado para evitar duplicidade
      let existingLead: DbLeadRow | null = null;
      const bySessionRes = await pool.query<DbLeadRow>(
        'SELECT * FROM leads WHERE chat_session_id = $1 ORDER BY id DESC LIMIT 1',
        [sessionId]
      );
      if (bySessionRes.rows[0]) {
        existingLead = bySessionRes.rows[0];
      } else if (normalizedPhoneDigits.length >= 8) {
        const byPhoneRes = await pool.query<DbLeadRow>(
          `SELECT *
           FROM leads
           WHERE REGEXP_REPLACE(COALESCE(phone, ''), '\\D', '', 'g') = $1
           ORDER BY id DESC
           LIMIT 1`,
          [normalizedPhoneDigits]
        );
        if (byPhoneRes.rows[0]) {
          existingLead = byPhoneRes.rows[0];
        }
      }

      if (existingLead) {
        const shouldUpgradeName =
          Boolean(session.lead_name?.trim()) &&
          /^Visitante/i.test(existingLead.name || '');
        const resolvedName = shouldUpgradeName
          ? session.lead_name!.trim()
          : existingLead.name;
        const resolvedPhone = existingLead.phone?.trim()
          ? existingLead.phone
          : leadPhone;

        const existingInterest = (existingLead.vehicle_interest || '').trim();
        const isGenericInterest =
          !existingInterest ||
          /^(Atendimento|Consultoria|🔥|💰|🔄|📅|❄️)/i.test(existingInterest);
        const resolvedInterest = isGenericInterest
          ? defaultInterest
          : existingInterest;

        // Preserva anotações manuais anteriores do vendedor e atualiza o cabeçalho automático
        const prevNotes = (existingLead.notes || '').trim();
        const cleanedManualNotes = prevNotes
          .replace(/^\[[^\]]+\]\s*Origem:[^\n]*(?:\nÚltima interação:[^\n]*)?\n*/m, '')
          .trim();
        const mergedNotes = cleanedManualNotes
          ? `${autoSummary}\n\n${cleanedManualNotes}`
          : autoSummary;

        const updatedRes = await pool.query<DbLeadRow>(
          `UPDATE leads
           SET name = $1,
               phone = $2,
               vehicle_interest = $3,
               tag = $4,
               chat_session_id = COALESCE(chat_session_id, $5),
               notes = $6,
               chat_history = CASE
                 WHEN $7::text <> '[]' THEN $7
                 ELSE chat_history
               END
           WHERE id = $8
           RETURNING *`,
          [
            resolvedName,
            resolvedPhone,
            resolvedInterest,
            nextTag,
            sessionId,
            mergedNotes,
            JSON.stringify(lightweightChatHistory),
            existingLead.id,
          ]
        );

        res.json({
          sessionId: session.session_id,
          tag: nextTag,
          crmAction: 'updated',
          lead: updatedRes.rows[0],
        });
        return;
      }

      const insertedRes = await pool.query<DbLeadRow>(
        `INSERT INTO leads (
           name,
           phone,
           vehicle_interest,
           stage,
           chat_history,
           lgpd_consent,
           lgpd_consent_at,
           chat_session_id,
           tag,
           notes
         )
         VALUES ($1, $2, $3, 'Novo Lead', $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          leadName,
          leadPhone,
          defaultInterest,
          JSON.stringify(lightweightChatHistory),
          Boolean(leadPhone),
          leadPhone ? new Date() : null,
          sessionId,
          nextTag,
          autoSummary,
        ]
      );

      res.json({
        sessionId: session.session_id,
        tag: nextTag,
        crmAction: 'created',
        lead: insertedRes.rows[0],
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'Erro ao salvar etiqueta e sincronizar com o CRM.';
      res.status(500).json({ error: message });
    }
  }
);

app.post(
  '/api/admin/chat-sessions/:sessionId/summary',
  requireAdminAuth,
  async (req, res) => {
    const sessionId = sanitizeSessionId(req.params.sessionId);
    if (!sessionId) {
      res.status(400).json({ error: 'Identificador de sessão inválido.' });
      return;
    }

    try {
      const sessionRes = await pool.query<DbChatSessionRow>(
        'SELECT * FROM chat_sessions WHERE session_id = $1 LIMIT 1',
        [sessionId]
      );
      if (sessionRes.rowCount === 0) {
        res.status(404).json({ error: 'Sessão de conversa não encontrada.' });
        return;
      }
      const session = sessionRes.rows[0];

      const msgRes = await pool.query<{
        id: number;
        sender: 'user' | 'assistant';
        content: string;
        transcription: string | null;
        attachment_name: string | null;
        created_at: Date;
      }>(
        `SELECT id, sender, content, transcription, attachment_name, created_at
         FROM chat_messages
         WHERE session_id = $1
         ORDER BY id ASC
         LIMIT 80`,
        [sessionId]
      );

      if (msgRes.rows.length === 0) {
        res.status(400).json({
          error:
            'Esta sessão ainda não possui mensagens suficientes para gerar um resumo comercial.',
        });
        return;
      }

      // Monta transcrição estritamente textual (incluindo transcrições de áudio) sem enviar binários
      const transcriptLines: string[] = [];
      for (const m of msgRes.rows) {
        const speaker = m.sender === 'user' ? 'Cliente' : 'Consultor IA';
        const parts: string[] = [];
        if (m.transcription?.trim()) {
          parts.push(`[Áudio transcrito]: ${m.transcription.trim()}`);
        }
        if (m.content?.trim()) {
          parts.push(m.content.trim());
        }
        if (m.attachment_name?.trim()) {
          parts.push(`[Anexo enviado: ${m.attachment_name.trim()}]`);
        }
        const lineText = parts.join(' ').replace(/\s+/g, ' ').trim();
        if (lineText) {
          transcriptLines.push(`${speaker}: ${lineText.slice(0, 900)}`);
        }
      }

      if (transcriptLines.length === 0) {
        res.status(400).json({
          error: 'Não há conteúdo textual nesta conversa para resumir.',
        });
        return;
      }

      const ai = getGeminiClient();
      const summaryPrompt = `Gere um resumo comercial objetivo e escaneável em Português do Brasil para o vendedor de concessionária de seminovos (CRM), baseado exclusivamente no histórico abaixo.

Dados da sessão:
- Nome do visitante: ${session.lead_name?.trim() || 'Não informado'}
- Telefone/WhatsApp: ${session.lead_phone?.trim() || 'Não informado'}
- Origem: ${session.origem}
- Etiqueta atual: ${session.tag || 'Sem etiqueta'}

Histórico da conversa:
${transcriptLines.join('\n').slice(0, 12000)}

Regras obrigatórias de formato:
- Responda APENAS com 4 tópicos curtos em bullet points (use "-" no início de cada linha), sem título introdutório e sem inventar dados que não estejam na conversa:
- **Veículo / Interesse:** <modelo, versão ou categoria mencionada; se não informado, diga "Não especificado">
- **Orçamento / Pagamento:** <faixa de valor, entrada, à vista, financiamento ou consórcio; se não mencionado, diga "Não informado">
- **Veículo na Troca:** <modelo, ano, km ou condição citada; se não mencionado, diga "Não mencionado">
- **Temperatura & Próximo Passo:** <Quente / Morno / Frio + ação prática e objetiva para o vendedor>`;

      const summaryModelCandidates = [
        'gemini-3.1-flash-lite',
        'gemini-2.5-flash',
        'gemini-4-hydrogen',
      ] as const;

      let summaryText = '';
      let lastGeminiErr: unknown = null;

      for (const modelName of summaryModelCandidates) {
        try {
          const response = await callGeminiWithRetry(
            () =>
              ai.models.generateContent({
                model: modelName,
                contents: summaryPrompt,
                config: {
                  systemInstruction:
                    'Você é um gerente comercial automotivo sênior. Produz resumos ultraconcisos em tópicos para CRM de vendas de seminovos em pt-BR, sem alucinar fatos.',
                  temperature: 0.2,
                  maxOutputTokens: 480,
                },
              }),
            1
          );
          const candidate = response.text?.trim() || '';
          recordAiUsageLog({
            sessionId,
            feature: 'crm_summary',
            model: modelName,
            usageMetadata: response.usageMetadata,
          });
          if (candidate) {
            summaryText = candidate;
            break;
          }
        } catch (err: unknown) {
          lastGeminiErr = err;
        }
      }

      if (!summaryText) {
        const errDetail =
          lastGeminiErr instanceof Error
            ? lastGeminiErr.message
            : 'Serviço de IA indisponível no momento.';
        throw new Error(`Não foi possível gerar o resumo com a IA: ${errDetail}`);
      }

      const updatedSessionRes = await pool.query<DbChatSessionRow>(
        `UPDATE chat_sessions
         SET ai_summary = $1,
             ai_summary_updated_at = NOW(),
             updated_at = NOW()
         WHERE session_id = $2
         RETURNING *`,
        [summaryText, sessionId]
      );
      const updatedSession = updatedSessionRes.rows[0];

      const lightweightChatHistory = msgRes.rows.map((m) => {
        const text =
          m.content?.trim() ||
          (m.transcription?.trim()
            ? `[Áudio] ${m.transcription.trim()}`
            : m.attachment_name
              ? `[Anexo: ${m.attachment_name}]`
              : '');
        const timestamp = m.created_at
          ? new Date(m.created_at).toLocaleTimeString('pt-BR', {
              hour: '2-digit',
              minute: '2-digit',
            })
          : 'Hoje';
        return {
          id: `audit-${m.id}`,
          sender: m.sender === 'user' ? 'cliente' : 'ia',
          text,
          timestamp,
        };
      });

      const formattedDate = new Date().toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
      const summaryBlock = `--- Resumo Comercial IA (${formattedDate}) ---\n${summaryText}\n--- Fim Resumo IA ---`;

      const leadName =
        session.lead_name?.trim() || `Visitante #${session.id}`;
      const leadPhone = session.lead_phone?.trim() || '';
      const normalizedPhoneDigits = leadPhone.replace(/\D/g, '');

      // Busca lead existente no CRM por chat_session_id ou telefone normalizado
      let existingLead: DbLeadRow | null = null;
      const bySessionRes = await pool.query<DbLeadRow>(
        'SELECT * FROM leads WHERE chat_session_id = $1 ORDER BY id DESC LIMIT 1',
        [sessionId]
      );
      if (bySessionRes.rows[0]) {
        existingLead = bySessionRes.rows[0];
      } else if (normalizedPhoneDigits.length >= 8) {
        const byPhoneRes = await pool.query<DbLeadRow>(
          `SELECT *
           FROM leads
           WHERE REGEXP_REPLACE(COALESCE(phone, ''), '\\D', '', 'g') = $1
           ORDER BY id DESC
           LIMIT 1`,
          [normalizedPhoneDigits]
        );
        if (byPhoneRes.rows[0]) {
          existingLead = byPhoneRes.rows[0];
        }
      }

      if (existingLead) {
        const prevNotes = (existingLead.notes || '').trim();
        const withoutOldSummary = prevNotes
          .replace(
            /\n*--- Resumo Comercial IA \([^)]*\) ---[\s\S]*?--- Fim Resumo IA ---\n*/g,
            '\n\n'
          )
          .trim();
        const mergedNotes = withoutOldSummary
          ? `${withoutOldSummary}\n\n${summaryBlock}`
          : summaryBlock;

        const shouldUpgradeName =
          Boolean(session.lead_name?.trim()) &&
          /^Visitante/i.test(existingLead.name || '');
        const resolvedName = shouldUpgradeName
          ? session.lead_name!.trim()
          : existingLead.name;
        const resolvedPhone = existingLead.phone?.trim()
          ? existingLead.phone
          : leadPhone;

        const updatedLeadRes = await pool.query<DbLeadRow>(
          `UPDATE leads
           SET name = $1,
               phone = $2,
               chat_session_id = COALESCE(chat_session_id, $3),
               tag = COALESCE(tag, $4),
               notes = $5,
               chat_history = CASE
                 WHEN $6::text <> '[]' THEN $6
                 ELSE chat_history
               END
           WHERE id = $7
           RETURNING *`,
          [
            resolvedName,
            resolvedPhone,
            sessionId,
            session.tag ?? null,
            mergedNotes,
            JSON.stringify(lightweightChatHistory),
            existingLead.id,
          ]
        );

        res.json({
          sessionId: updatedSession.session_id,
          aiSummary: updatedSession.ai_summary,
          aiSummaryUpdatedAt: updatedSession.ai_summary_updated_at,
          crmAction: 'updated',
          lead: updatedLeadRes.rows[0],
        });
        return;
      }

      // Extrai interesse resumido da primeira linha do resumo se útil, senão usa padrão limpo
      const interestLineMatch = summaryText.match(
        /Ve[íi]culo\s*\/\s*Interesse:\*?\*?\s*([^\n]+)/i
      );
      const extractedInterest = interestLineMatch?.[1]
        ?.replace(/\*\*/g, '')
        .trim();
      const validExtractedInterest =
        extractedInterest &&
        !/^n[ãa]o\s+(especificado|informado|mencionado)/i.test(
          extractedInterest
        )
          ? extractedInterest.slice(0, 90)
          : null;

      const tagPrefix =
        session.tag && ALLOWED_CHAT_SESSION_TAGS[session.tag]
          ? `${ALLOWED_CHAT_SESSION_TAGS[session.tag]} · `
          : '';
      const resolvedInterest =
        validExtractedInterest || `${tagPrefix}Resumo IA · Chat (${session.origem})`;

      const insertedLeadRes = await pool.query<DbLeadRow>(
        `INSERT INTO leads (
           name,
           phone,
           vehicle_interest,
           stage,
           chat_history,
           lgpd_consent,
           lgpd_consent_at,
           chat_session_id,
           tag,
           notes
         )
         VALUES ($1, $2, $3, 'Novo Lead', $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          leadName,
          leadPhone,
          resolvedInterest,
          JSON.stringify(lightweightChatHistory),
          Boolean(leadPhone),
          leadPhone ? new Date() : null,
          sessionId,
          session.tag ?? null,
          summaryBlock,
        ]
      );

      res.json({
        sessionId: updatedSession.session_id,
        aiSummary: updatedSession.ai_summary,
        aiSummaryUpdatedAt: updatedSession.ai_summary_updated_at,
        crmAction: 'created',
        lead: insertedLeadRes.rows[0],
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'Erro ao gerar resumo comercial para o CRM.';
      res.status(500).json({ error: message });
    }
  }
);

app.get(
  '/api/admin/chat-messages/:messageId/attachment',
  requireAdminAuth,
  async (req, res) => {
    const messageId = Number(req.params.messageId);
    if (!Number.isInteger(messageId) || messageId <= 0) {
      res.status(400).json({ error: 'ID de mensagem inválido.' });
      return;
    }

    try {
      const msgRes = await pool.query<{
        attachment_url: string | null;
        attachment_name: string | null;
        attachment_mime: string | null;
      }>(
        `SELECT attachment_url, attachment_name, attachment_mime
         FROM chat_messages
         WHERE id = $1
         LIMIT 1`,
        [messageId]
      );

      const row = msgRes.rows[0];
      if (!row || !row.attachment_url) {
        res.status(404).json({ error: 'Anexo não encontrado para esta mensagem.' });
        return;
      }

      const rawName = (row.attachment_name || 'anexo').replace(/["\r\n\\]/g, '_');
      const wantsDownload = req.query.download === '1' || req.query.download === 'true';

      if (row.attachment_url.startsWith('data:')) {
        const parsed = parseDataUrlMedia(
          row.attachment_url,
          row.attachment_mime || undefined
        );
        if (!parsed) {
          res.status(422).json({ error: 'Conteúdo do anexo inválido ou corrompido.' });
          return;
        }
        const buffer = Buffer.from(parsed.base64, 'base64');
        const mimeType = row.attachment_mime || parsed.mimeType || 'application/octet-stream';
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Length', String(buffer.length));
        res.setHeader(
          'Content-Disposition',
          `${wantsDownload ? 'attachment' : 'inline'}; filename="${rawName}"`
        );
        res.setHeader('Cache-Control', 'private, max-age=300');
        res.send(buffer);
        return;
      }

      res.redirect(row.attachment_url);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Erro ao carregar anexo da mensagem.';
      res.status(500).json({ error: message });
    }
  }
);

app.post('/api/public/leads', async (req, res) => {
  try {
    const {
      name,
      phone,
      vehicle_interest,
      chat_history,
      lgpd_consent,
      session_id,
      origem,
    } = req.body;
    const cleanName = typeof name === 'string' ? name.trim() : '';
    const cleanPhone = typeof phone === 'string' ? phone.trim() : '';

    if (!cleanName || !cleanPhone) {
      res.status(400).json({ error: 'Nome e telefone/WhatsApp são obrigatórios.' });
      return;
    }

    if (lgpd_consent !== true) {
      res.status(400).json({
        error:
          'Consentimento ativo (LGPD) é obrigatório para registrar seus dados e iniciar o atendimento comercial.',
      });
      return;
    }

    const safeSessionId = sanitizeSessionId(session_id);
    const serializedChatHistory =
      typeof chat_history === 'string'
        ? chat_history
        : JSON.stringify(chat_history || []);
    const resolvedVehicleInterest = vehicle_interest
      ? String(vehicle_interest).trim()
      : 'Atendimento Geral';

    let created: DbLeadRow;
    const existingBySession = safeSessionId
      ? await pool.query<DbLeadRow>(
          'SELECT * FROM leads WHERE chat_session_id = $1 ORDER BY id DESC LIMIT 1',
          [safeSessionId]
        )
      : null;

    if (existingBySession?.rows[0]) {
      const updated = await pool.query<DbLeadRow>(
        `UPDATE leads
         SET name = $1,
             phone = $2,
             vehicle_interest = CASE
               WHEN vehicle_interest IS NULL OR BTRIM(vehicle_interest) = '' OR vehicle_interest LIKE '%Chat IA%'
                 THEN $3
               ELSE vehicle_interest
             END,
             chat_history = $4,
             lgpd_consent = true,
             lgpd_consent_at = COALESCE(lgpd_consent_at, NOW())
         WHERE id = $5
         RETURNING *`,
        [
          cleanName,
          cleanPhone,
          resolvedVehicleInterest,
          serializedChatHistory,
          existingBySession.rows[0].id,
        ]
      );
      created = updated.rows[0];
    } else {
      const result = await pool.query<DbLeadRow>(
        `INSERT INTO leads (name, phone, vehicle_interest, stage, chat_history, lgpd_consent, lgpd_consent_at, chat_session_id)
         VALUES ($1, $2, $3, 'Novo Lead', $4, true, NOW(), $5)
         RETURNING *`,
        [
          cleanName,
          cleanPhone,
          resolvedVehicleInterest,
          serializedChatHistory,
          safeSessionId,
        ]
      );
      created = result.rows[0];
    }

    if (safeSessionId) {
      await attachLeadToChatSession(
        safeSessionId,
        cleanName,
        cleanPhone,
        sanitizeOrigin(origem)
      );
    }

    const chatToken = signPublicLeadChatToken(created.id);
    res.status(201).json({ ...created, chatToken });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao registrar interesse.';
    res.status(500).json({ error: message });
  }
});

app.patch('/api/public/leads/:id/chat', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'ID de atendimento inválido.' });
    return;
  }

  const chatToken =
    typeof req.body?.chatToken === 'string' ? req.body.chatToken.trim() : '';
  if (!verifyPublicLeadChatToken(id, chatToken)) {
    res.status(401).json({ error: 'Token de atendimento inválido.' });
    return;
  }

  try {
    const rawHistory = req.body?.chat_history;
    const serialized =
      typeof rawHistory === 'string'
        ? rawHistory
        : JSON.stringify(rawHistory || []);

    const result = await pool.query<DbLeadRow>(
      'UPDATE leads SET chat_history = $1 WHERE id = $2 RETURNING id, chat_history',
      [serialized, id]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Atendimento não encontrado.' });
      return;
    }

    res.json({ updated: true, id });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Erro ao sincronizar histórico do chat.';
    res.status(500).json({ error: message });
  }
});

// ============================================================================
// Tabela FIPE (BrasilAPI) Consultation Routes
// ============================================================================

async function handleFipeLookupRequest(
  rawCode: string,
  rawYear: unknown,
  res: Response
): Promise<void> {
  if (!rawCode || !rawCode.trim()) {
    res.status(400).json({
      error: 'Informe o código FIPE para consulta (ex: 001004-9).',
    });
    return;
  }

  const parsedYear =
    typeof rawYear === 'string' && rawYear.trim() !== ''
      ? Number(rawYear.trim())
      : undefined;

  try {
    const result = await fetchBrasilApiFipe(rawCode, parsedYear);
    res.json(result);
  } catch (err: unknown) {
    if (err instanceof FipeServiceError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    const message =
      err instanceof Error ? err.message : 'Erro interno ao consultar Tabela FIPE.';
    res.status(500).json({ error: message });
  }
}

app.get('/api/fipe/consultar', async (req, res) => {
  const rawCode =
    typeof req.query.codigo === 'string'
      ? req.query.codigo
      : typeof req.query.codigoFipe === 'string'
        ? req.query.codigoFipe
        : '';
  await handleFipeLookupRequest(rawCode, req.query.ano, res);
});

app.get('/api/fipe/:codigoFipe', async (req, res) => {
  await handleFipeLookupRequest(req.params.codigoFipe || '', req.query.ano, res);
});

app.get('/api/vehicles', requireAdminAuth, async (req, res) => {
  try {
    const statusFilter =
      typeof req.query.status === 'string' ? req.query.status.trim() : '';
    if (statusFilter) {
      const result = await pool.query<DbVehicleRow>(
        'SELECT * FROM vehicles WHERE status = $1 ORDER BY created_at DESC, id DESC',
        [statusFilter]
      );
      res.json(result.rows);
      return;
    }

    const result = await pool.query<DbVehicleRow>(
      'SELECT * FROM vehicles ORDER BY created_at DESC, id DESC'
    );
    res.json(result.rows);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao listar veículos.';
    res.status(500).json({ error: message });
  }
});

app.post('/api/vehicles', requireAdminAuth, async (req, res) => {
  try {
    const {
      brand,
      model,
      version,
      year_fab,
      year_model,
      km,
      price,
      fipe_code,
      fipe_price,
      status,
      fuel,
      transmission,
      image_url,
      options,
    } = req.body;

    if (!brand || !String(brand).trim() || !model || !String(model).trim()) {
      res.status(400).json({ error: 'Marca e modelo são obrigatórios.' });
      return;
    }

    const parsedYearFab = Number(year_fab);
    const parsedYearModel = Number(year_model);
    const parsedKm = Number(km);
    const parsedPrice = Number(price);
    const parsedFipePrice = Number(fipe_price);
    const normalizedFipeCode =
      typeof fipe_code === 'string' && fipe_code.trim()
        ? normalizeFipeCode(fipe_code) || fipe_code.trim()
        : null;

    if (!Number.isFinite(parsedYearFab) || !Number.isFinite(parsedYearModel)) {
      res.status(400).json({ error: 'Ano de fabricação e ano do modelo inválidos.' });
      return;
    }

    const vehicleStatus =
      typeof status === 'string' &&
      status.trim() !== '' &&
      status.trim() !== 'Disponível'
        ? status.trim()
        : 'Disponivel';

    const result = await pool.query<DbVehicleRow>(
      `INSERT INTO vehicles (brand, model, version, year_fab, year_model, km, price, fipe_code, fipe_price, status, fuel, transmission, image_url, options)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [
        String(brand).trim(),
        String(model).trim(),
        version ? String(version).trim() : '',
        parsedYearFab,
        parsedYearModel,
        Number.isFinite(parsedKm) ? parsedKm : 0,
        Number.isFinite(parsedPrice) ? parsedPrice : 0,
        normalizedFipeCode,
        Number.isFinite(parsedFipePrice) && parsedFipePrice > 0
          ? parsedFipePrice
          : null,
        vehicleStatus,
        fuel ? String(fuel).trim() : 'Flex',
        transmission ? String(transmission).trim() : 'Automático',
        image_url ? String(image_url).trim() : '',
        Array.isArray(options) ? options.map(String) : [],
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao cadastrar veículo no banco.';
    res.status(500).json({ error: message });
  }
});

app.patch('/api/vehicles/:id', requireAdminAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'ID de veículo inválido.' });
    return;
  }

  try {
    const {
      brand,
      model,
      version,
      year_fab,
      year_model,
      km,
      price,
      fipe_code,
      fipe_price,
      status,
      fuel,
      transmission,
      image_url,
      options,
    } = req.body;

    const normalizedStatus =
      typeof status === 'string' && status.trim() === 'Disponível'
        ? 'Disponivel'
        : status;

    const cleanFipeCode =
      fipe_code === undefined
        ? undefined
        : typeof fipe_code === 'string' && fipe_code.trim()
          ? normalizeFipeCode(fipe_code) || fipe_code.trim()
          : null;

    const cleanFipePrice =
      fipe_price === undefined
        ? undefined
        : Number.isFinite(Number(fipe_price)) && Number(fipe_price) > 0
          ? Number(fipe_price)
          : null;

    const result = await pool.query<DbVehicleRow>(
      `UPDATE vehicles
       SET brand = COALESCE($1, brand),
           model = COALESCE($2, model),
           version = COALESCE($3, version),
           year_fab = COALESCE($4, year_fab),
           year_model = COALESCE($5, year_model),
           km = COALESCE($6, km),
           price = COALESCE($7, price),
           fipe_code = CASE WHEN $8::boolean THEN $9 ELSE fipe_code END,
           fipe_price = CASE WHEN $10::boolean THEN $11 ELSE fipe_price END,
           status = COALESCE($12, status),
           fuel = COALESCE($13, fuel),
           transmission = COALESCE($14, transmission),
           image_url = COALESCE($15, image_url),
           options = COALESCE($16, options)
       WHERE id = $17
       RETURNING *`,
      [
        brand,
        model,
        version,
        year_fab !== undefined ? Number(year_fab) : null,
        year_model !== undefined ? Number(year_model) : null,
        km !== undefined ? Number(km) : null,
        price !== undefined ? Number(price) : null,
        fipe_code !== undefined,
        cleanFipeCode ?? null,
        fipe_price !== undefined,
        cleanFipePrice ?? null,
        normalizedStatus,
        fuel,
        transmission,
        image_url,
        Array.isArray(options) ? options : null,
        id,
      ]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Veículo não encontrado.' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao atualizar veículo.';
    res.status(500).json({ error: message });
  }
});

app.delete('/api/vehicles/:id', requireAdminAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'ID de veículo inválido.' });
    return;
  }

  try {
    await pool.query('UPDATE contracts SET vehicle_id = NULL WHERE vehicle_id = $1', [id]);
    const result = await pool.query('DELETE FROM vehicles WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Veículo não encontrado.' });
      return;
    }
    res.json({ deleted: true, id });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao remover veículo.';
    res.status(500).json({ error: message });
  }
});

app.get('/api/leads', requireAdminAuth, async (_req, res) => {
  try {
    const result = await pool.query<DbLeadRow>(
      'SELECT * FROM leads ORDER BY id DESC'
    );
    res.json(result.rows);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao listar leads.';
    res.status(500).json({ error: message });
  }
});

const ALLOWED_LEAD_STAGES = [
  'Novo Lead',
  'Em Atendimento',
  'Proposta',
  'Fechado',
] as const;

app.post('/api/leads', requireAdminAuth, async (req, res) => {
  try {
    const { name, phone, vehicle_interest, stage, chat_history } = req.body;
    const cleanName = typeof name === 'string' ? name.trim() : '';
    const cleanPhone = typeof phone === 'string' ? phone.trim() : '';

    if (!cleanName || !cleanPhone) {
      res.status(400).json({ error: 'Nome e telefone/WhatsApp são obrigatórios.' });
      return;
    }

    const requestedStage = typeof stage === 'string' ? stage.trim() : '';
    const validStage = ALLOWED_LEAD_STAGES.includes(
      requestedStage as (typeof ALLOWED_LEAD_STAGES)[number]
    )
      ? requestedStage
      : 'Novo Lead';

    const result = await pool.query<DbLeadRow>(
      `INSERT INTO leads (name, phone, vehicle_interest, stage, chat_history)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        cleanName,
        cleanPhone,
        vehicle_interest ? String(vehicle_interest).trim() : 'Atendimento Geral',
        validStage,
        typeof chat_history === 'string'
          ? chat_history
          : JSON.stringify(chat_history || []),
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao salvar lead.';
    res.status(500).json({ error: message });
  }
});

app.patch('/api/leads/:id', requireAdminAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'ID de lead inválido.' });
    return;
  }

  try {
    const { name, phone, vehicle_interest, stage, chat_history, notes, tag } =
      req.body;

    if (
      stage !== undefined &&
      stage !== null &&
      !ALLOWED_LEAD_STAGES.includes(stage as (typeof ALLOWED_LEAD_STAGES)[number])
    ) {
      res.status(400).json({ error: 'Estágio de funil inválido.' });
      return;
    }

    const result = await pool.query<DbLeadRow>(
      `UPDATE leads
       SET name = COALESCE($1, name),
           phone = COALESCE($2, phone),
           vehicle_interest = COALESCE($3, vehicle_interest),
           stage = COALESCE($4, stage),
           chat_history = COALESCE($5, chat_history),
           notes = COALESCE($6, notes),
           tag = CASE WHEN $7::boolean THEN $8 ELSE tag END
       WHERE id = $9
       RETURNING *`,
      [
        name !== undefined ? String(name).trim() : null,
        phone !== undefined ? String(phone).trim() : null,
        vehicle_interest !== undefined ? String(vehicle_interest).trim() : null,
        stage ?? null,
        chat_history !== undefined
          ? typeof chat_history === 'string'
            ? chat_history
            : JSON.stringify(chat_history)
          : null,
        notes !== undefined ? String(notes) : null,
        tag !== undefined,
        tag !== undefined && tag !== null && String(tag).trim()
          ? String(tag).trim()
          : null,
        id,
      ]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Lead não encontrado.' });
      return;
    }
    res.json(result.rows[0]);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao atualizar lead.';
    res.status(500).json({ error: message });
  }
});

app.delete('/api/leads/:id', requireAdminAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'ID de lead inválido.' });
    return;
  }

  try {
    const result = await pool.query<{ id: number; name: string }>(
      'DELETE FROM leads WHERE id = $1 RETURNING id, name',
      [id]
    );
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Lead não encontrado.' });
      return;
    }
    res.json({ deleted: true, id: result.rows[0].id, name: result.rows[0].name });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao excluir dados do lead.';
    res.status(500).json({ error: message });
  }
});

app.get('/api/contracts', requireAdminAuth, async (_req, res) => {
  try {
    const result = await pool.query<
      DbContractRow & {
        vehicle_brand?: string | null;
        vehicle_model?: string | null;
        vehicle_year_fab?: number | null;
        vehicle_year_model?: number | null;
      }
    >(
      `SELECT c.*,
              v.brand AS vehicle_brand,
              v.model AS vehicle_model,
              v.year_fab AS vehicle_year_fab,
              v.year_model AS vehicle_year_model
       FROM contracts c
       LEFT JOIN vehicles v ON v.id = c.vehicle_id
       ORDER BY c.id DESC`
    );
    res.json(result.rows);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao listar contratos.';
    res.status(500).json({ error: message });
  }
});

app.post('/api/contracts', requireAdminAuth, async (req, res) => {
  try {
    const { client_name, client_cpf, vehicle_id, final_price, payment_method } =
      req.body;

    const cleanName = typeof client_name === 'string' ? client_name.trim() : '';
    const cleanCpf = typeof client_cpf === 'string' ? client_cpf.trim() : '';
    const parsedPrice = Number(final_price);

    if (!cleanName || !cleanCpf) {
      res.status(400).json({ error: 'Nome e CPF do comprador são obrigatórios.' });
      return;
    }

    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      res.status(400).json({ error: 'Preço final negociado inválido.' });
      return;
    }

    const parsedVehicleId =
      vehicle_id && Number.isInteger(Number(vehicle_id))
        ? Number(vehicle_id)
        : null;

    const insertRes = await pool.query<{ id: number }>(
      `INSERT INTO contracts (client_name, client_cpf, vehicle_id, final_price, payment_method)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        cleanName,
        cleanCpf,
        parsedVehicleId,
        parsedPrice,
        payment_method ? String(payment_method).trim() : 'À vista',
      ]
    );

    const createdId = insertRes.rows[0].id;
    const joined = await pool.query<
      DbContractRow & {
        vehicle_brand?: string | null;
        vehicle_model?: string | null;
        vehicle_year_fab?: number | null;
        vehicle_year_model?: number | null;
      }
    >(
      `SELECT c.*,
              v.brand AS vehicle_brand,
              v.model AS vehicle_model,
              v.year_fab AS vehicle_year_fab,
              v.year_model AS vehicle_year_model
       FROM contracts c
       LEFT JOIN vehicles v ON v.id = c.vehicle_id
       WHERE c.id = $1`,
      [createdId]
    );

    res.status(201).json(joined.rows[0]);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao registrar contrato.';
    res.status(500).json({ error: message });
  }
});

// ============================================================================
// Gemini AI Routes
// ============================================================================

app.post('/api/ai/generate-post', requireAdminAuth, async (req, res) => {
  const body = req.body as GeneratePostBody;
  if (!body || !body.vehicle) {
    res.status(400).json({ error: 'Dados do veículo são obrigatórios.' });
    return;
  }

  try {
    const ai = getGeminiClient();

    const formattedPrice = new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      maximumFractionDigits: 0,
    }).format(body.vehicle.price);

    const formattedKm = new Intl.NumberFormat('pt-BR').format(body.vehicle.km);

    const prompt = `Você é o estrategista sênior de social media automotiva da revenda "${body.dealershipName || 'Armazém do Carro'}" localizada em ${body.city || 'São Paulo - SP'}.

Crie uma copy de alta conversão em Português do Brasil para a plataforma "${body.platform}" com tom "${body.tone}".

Dados do veículo em estoque:
- Veículo: ${body.vehicle.brand} ${body.vehicle.model} ${body.vehicle.version}
- Ano: ${body.vehicle.year}
- Quilometragem: ${formattedKm} km
- Preço: ${formattedPrice}
- Cor: ${body.vehicle.color}
- Câmbio / Combustível: ${body.vehicle.transmission} / ${body.vehicle.fuel}
- Opcionais principais: ${Array.isArray(body.vehicle.optionals) && body.vehicle.optionals.length > 0 ? body.vehicle.optionals.join(', ') : 'Padrão de série'}
- Diferenciais informados pelo vendedor: ${body.differentials || 'Laudo cautelar 100% aprovado, procedência garantida, aceitamos usado na troca e financiamento facilitado.'}
- WhatsApp comercial: ${body.whatsapp || '(11) 99482-1040'}

Instruções:
1. A legenda deve ter gancho forte na primeira linha, leitura escaneável (bullet points limpos), prova de valor/diferenciais, gatilho de urgência real (sem exageros bregas) e CTA direto para o WhatsApp e catálogo.
2. Adapte o ritmo para ${body.platform} (especialmente para Instagram e TikTok Shop, incluindo roteiro dinâmico de cenas curtas 0-15s com gancho de retenção).
3. Gere de 6 a 10 hashtags automotivas otimizadas para alcance regional e vendas no Instagram e TikTok Shop.`;

    const response = await callGeminiWithRetry(() =>
      ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction:
            'Você escreve copys automotivas elegantes, persuasivas e profissionais em pt-BR para revendas premium de seminovos. Retorne estritamente JSON válido conforme o schema.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              headline: {
                type: Type.STRING,
                description: 'Gancho inicial curto e impactante (máx 90 caracteres).',
              },
              legenda: {
                type: Type.STRING,
                description: 'Texto completo da legenda formatado com quebras de linha para a rede social.',
              },
              gatilhos: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Lista com 3 gatilhos mentais aplicados na copy.',
              },
              ctaWhatsapp: {
                type: Type.STRING,
                description: 'Chamada para ação final direcionando para o WhatsApp da loja.',
              },
              hashtags: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Hashtags sem espaços, começando com #.',
              },
              roteiroReels: {
                type: Type.STRING,
                description: 'Sugestão rápida de 3 tomadas de vídeo (0-15s) para acompanhar o post.',
              },
            },
            required: ['headline', 'legenda', 'gatilhos', 'ctaWhatsapp', 'hashtags', 'roteiroReels'],
          },
        },
      })
    );

    recordAiUsageLog({
      sessionId: null,
      feature: 'social_post',
      model: 'gemini-4-hydrogen',
      usageMetadata: response.usageMetadata,
    });

    const rawText = response.text?.trim();
    if (!rawText) {
      res.status(502).json({ error: 'A IA não retornou conteúdo textual válido.' });
      return;
    }

    const parsed = JSON.parse(rawText);
    res.json(parsed);
  } catch (err: unknown) {
    const formatted = formatGeminiError(err);
    console.error('[AI Generate Post Error]', err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

app.post('/api/ai/chat', async (req, res) => {
  const body = req.body as ChatRequestBody;
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
    res.status(400).json({ error: 'Histórico de mensagens é obrigatório.' });
    return;
  }

  try {
    const s = body.settings;
    const dealership = s?.tradeName || 'Armazém do Carro';
    const assistantName = s?.aiAssistantName || 'Consultor Virtual Armazém';

    // Validação opcional de mídia (áudio ou anexo imagem/PDF) respeitando limite serverless da Vercel
    const parsedAudio = body.audio?.dataUrl
      ? parseDataUrlMedia(body.audio.dataUrl, body.audio.mimeType)
      : null;
    if (body.audio?.dataUrl && !parsedAudio) {
      res.status(400).json({ error: 'Formato de áudio inválido.' });
      return;
    }
    if (parsedAudio) {
      const allowedAudio = [
        'audio/webm',
        'audio/ogg',
        'audio/mp4',
        'audio/mpeg',
        'audio/wav',
        'audio/mp3',
        'audio/aac',
        'audio/m4a',
        'audio/x-m4a',
      ];
      if (!allowedAudio.includes(parsedAudio.mimeType)) {
        res.status(400).json({
          error: `Formato de áudio (${parsedAudio.mimeType}) não suportado. Grave novamente pelo navegador.`,
        });
        return;
      }
      if (parsedAudio.byteLength > MAX_INLINE_MEDIA_BYTES) {
        res.status(413).json({
          error: 'O áudio excedeu o limite permitido para envio. Envie um áudio mais curto.',
        });
        return;
      }
    }

    const parsedAttachment = body.attachment?.dataUrl
      ? parseDataUrlMedia(body.attachment.dataUrl, body.attachment.mimeType)
      : null;
    if (body.attachment?.dataUrl && !parsedAttachment) {
      res.status(400).json({ error: 'Formato de anexo inválido.' });
      return;
    }
    if (parsedAttachment) {
      const allowedAttachments = [
        'image/jpeg',
        'image/png',
        'image/webp',
        'application/pdf',
      ];
      if (!allowedAttachments.includes(parsedAttachment.mimeType)) {
        res.status(400).json({
          error: 'Envie apenas fotos (JPG, PNG, WEBP) ou documentos em PDF.',
        });
        return;
      }
      if (parsedAttachment.byteLength > MAX_INLINE_MEDIA_BYTES) {
        res.status(413).json({
          error: 'O arquivo anexado excede o tamanho máximo suportado (3 MB). Comprima e tente novamente.',
        });
        return;
      }
    }

    // Economia de tokens: quando o visitante envia anexo (foto/PDF), salva no Neon para o Admin
    // e responde diretamente perguntando do que se trata, SEM enviar o arquivo para análise da IA.
    if (parsedAttachment && !parsedAudio) {
      const auditSessionId = sanitizeSessionId(body.sessionId);
      const auditOrigin = sanitizeOrigin(body.origem);
      const lastUserMessageRaw =
        [...body.messages].reverse().find((m) => m.sender === 'cliente')?.text ||
        '';
      const safeAttachmentName =
        typeof body.attachment?.name === 'string' && body.attachment.name.trim()
          ? body.attachment.name.trim().slice(0, 250)
          : parsedAttachment.mimeType === 'application/pdf'
            ? 'documento.pdf'
            : 'imagem.jpg';

      const safeReplyToId =
        typeof body.replyTo?.id === 'string'
          ? body.replyTo.id.trim().slice(0, 120)
          : null;
      const safeReplyToPreview =
        typeof body.replyTo?.preview === 'string'
          ? body.replyTo.preview.trim().slice(0, 400)
          : null;
      const safeReplyToSender: 'user' | 'assistant' | null =
        body.replyTo?.sender === 'ia'
          ? 'assistant'
          : body.replyTo?.sender === 'cliente'
            ? 'user'
            : null;

      const isPdf = parsedAttachment.mimeType === 'application/pdf';
      const attachmentAckReply = isPdf
        ? `Recebi o seu anexo PDF (**${safeAttachmentName}**) e ele já foi registrado no seu atendimento!

Sobre o que ele se trata?
- É uma **proposta, simulação ou carta de crédito**?
- É o **documento de um veículo** para avaliação na troca?
- Ou alguma outra informação para a nossa equipe?

Pode me explicar aqui por texto (ou áudio) que eu já continuo o seu atendimento!`
        : `Recebi a sua foto (**${safeAttachmentName}**) e ela já foi registrada no seu atendimento!

Sobre o que ela se trata?
- É foto do seu **carro usado para avaliação na troca**? (Se sim, me informe **modelo, ano, versão e km**)
- É referência de algum **veículo que você procura**?
- Ou alguma outra dúvida sobre nosso estoque?

Pode me explicar aqui por texto (ou áudio) que eu já dou sequência para você!`;

      if (auditSessionId) {
        const storedUserContent =
          lastUserMessageRaw.trim() || `Anexo enviado: ${safeAttachmentName}`;
        await recordChatAuditTurn(
          auditSessionId,
          auditOrigin,
          'user',
          storedUserContent,
          {
            replyToId: safeReplyToId,
            replyToPreview: safeReplyToPreview,
            replyToSender: safeReplyToSender,
            attachmentUrl: parsedAttachment.cleanDataUrl,
            attachmentName: safeAttachmentName,
            attachmentMime: parsedAttachment.mimeType,
          }
        );
        await recordChatAuditTurn(
          auditSessionId,
          auditOrigin,
          'assistant',
          attachmentAckReply
        );
      }

      const wantsStreamForAttachment =
        (req.body as { stream?: boolean }).stream !== false &&
        (req.headers.accept?.includes('text/event-stream') ||
          (req.body as { stream?: boolean }).stream === true);

      if (!wantsStreamForAttachment) {
        res.json({ reply: attachmentAckReply });
        return;
      }

      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();
      res.write(
        `data: ${JSON.stringify({ type: 'chunk', text: attachmentAckReply })}\n\n`
      );
      res.write(
        `data: ${JSON.stringify({ type: 'done', reply: attachmentAckReply })}\n\n`
      );
      res.end();
      return;
    }

    const ai = getGeminiClient();

    // Inicia consulta ao estoque real no Neon em paralelo com a transcrição de áudio para máxima agilidade
    const dbInventoryPromise: Promise<string> = (async () => {
      try {
        const stockRes = await pool.query<DbVehicleRow>(
          `SELECT brand, model, version, year_fab, year_model, km, price, fipe_code, fipe_price, status, fuel, transmission, options
           FROM vehicles
           WHERE status IN ('Disponivel', 'Disponível', 'Reservado')
           ORDER BY created_at DESC, id DESC`
        );
        if (stockRes.rows.length > 0) {
          return stockRes.rows
            .map((v) => {
              const sellingPrice = Number(v.price);
              const formattedPrice = new Intl.NumberFormat('pt-BR', {
                style: 'currency',
                currency: 'BRL',
                maximumFractionDigits: 0,
              }).format(sellingPrice);
              const formattedKm = new Intl.NumberFormat('pt-BR').format(Number(v.km));
              const opts =
                Array.isArray(v.options) && v.options.length > 0
                  ? v.options.join(', ')
                  : 'Pacote de série';
              const fipeNote = buildFipeComparisonSummary(
                sellingPrice,
                v.fipe_price ? Number(v.fipe_price) : null,
                v.fipe_code
              );
              return `- ${v.brand} ${v.model} ${v.version || ''} | Ano: ${v.year_fab}/${v.year_model} | Km: ${formattedKm} km | Preço: ${formattedPrice}${fipeNote ? ` | ${fipeNote}` : ''} | Status: ${v.status} | Câmbio: ${v.transmission || 'N/I'} | Combustível: ${v.fuel || 'N/I'} | Opcionais: ${opts}`.trim();
            })
            .join('\n');
        }
        return '';
      } catch {
        return '';
      }
    })();

    // Se o cliente enviou áudio, realiza transcrição calibrada via Gemini com detecção de áudio inaudível
    let audioTranscription: string | null = null;
    if (parsedAudio) {
      const audioInlinePart = {
        inlineData: {
          mimeType: normalizeGeminiAudioMime(parsedAudio.mimeType),
          data: parsedAudio.base64,
        },
      };
      const transcribePrompt = {
        text: 'Transcreva fielmente em Português do Brasil o que o cliente falou neste áudio de atendimento em revenda de veículos. REGRAS ESTRITAS: Retorne APENAS o texto falado limpo, sem prefixos ou explicações. Se o áudio estiver mudo, apenas silêncio, inaudível, com ruído excessivo, cortado ou incompreensível a ponto de não ser possível entender com segurança o que foi falado, NÃO chute nem invente palavras ou letras isoladas — responda EXATAMENTE com: [AUDIO_INAUDIVEL]',
      };

      const transcribeCandidates: Array<{
        model: string;
        timeoutMs: number;
        config?: Record<string, unknown>;
      }> = [];

      if (Date.now() >= transcribeModelUnavailableUntil) {
        transcribeCandidates.push({
          model: 'gemini-3.5-transcribe',
          timeoutMs: 10_000,
        });
      }
      transcribeCandidates.push(
        {
          model: 'gemini-3.1-flash-lite',
          timeoutMs: 10_000,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
          },
        },
        {
          model: 'gemini-2.5-flash',
          timeoutMs: 12_000,
        }
      );

      let lastTranscribeErr: unknown = null;
      let transcribedSuccessfully = false;
      for (const candidate of transcribeCandidates) {
        try {
          const resTranscribe = await withPromiseTimeout(
            ai.models.generateContent({
              model: candidate.model,
              contents: { parts: [audioInlinePart, transcribePrompt] },
              ...(candidate.config ? { config: candidate.config } : {}),
            }),
            candidate.timeoutMs,
            `DEADLINE_EXCEEDED: Tempo limite na transcrição de áudio (${candidate.model}).`
          );
          audioTranscription = resTranscribe.text?.trim() || null;
          transcribedSuccessfully = true;
          recordAiUsageLog({
            sessionId: sanitizeSessionId(body.sessionId),
            feature: 'chat_audio',
            model: candidate.model,
            usageMetadata: resTranscribe.usageMetadata,
          });
          break;
        } catch (transcribeErr) {
          lastTranscribeErr = transcribeErr;
          if (isNonFallbackGeminiError(transcribeErr)) {
            throw transcribeErr;
          }
          const errMsg =
            transcribeErr instanceof Error
              ? transcribeErr.message
              : String(transcribeErr);
          if (
            candidate.model === 'gemini-3.5-transcribe' &&
            (errMsg.includes('404') || errMsg.includes('not found'))
          ) {
            transcribeModelUnavailableUntil = Date.now() + 10 * 60 * 1000;
          }
          console.warn(
            `[Audio Transcribe Fallback] ${candidate.model} failed:`,
            errMsg.slice(0, 140)
          );
        }
      }

      if (!transcribedSuccessfully && lastTranscribeErr) {
        throw lastTranscribeErr;
      }

      // Fallback seguro: áudio inaudível, mudo, cortado ou com ruído excessivo — pede reenvio sem inventar resposta
      if (isAudioTranscriptionUnintelligible(audioTranscription)) {
        const auditSessionId = sanitizeSessionId(body.sessionId);
        const auditOrigin = sanitizeOrigin(body.origem);
        const safeReplyToId =
          typeof body.replyTo?.id === 'string'
            ? body.replyTo.id.trim().slice(0, 120)
            : null;
        const safeReplyToPreview =
          typeof body.replyTo?.preview === 'string'
            ? body.replyTo.preview.trim().slice(0, 400)
            : null;
        const safeReplyToSender: 'user' | 'assistant' | null =
          body.replyTo?.sender === 'ia'
            ? 'assistant'
            : body.replyTo?.sender === 'cliente'
              ? 'user'
              : null;

        const unclearAudioReply =
          'Não consegui entender o seu áudio com clareza (ele pode ter ficado baixo, cortado ou com ruído de fundo).\n\nPode **enviar o áudio novamente** falando um pouco mais perto do microfone ou, se preferir, **escrever sua dúvida por texto**? Assim consigo te responder com precisão!';

        if (auditSessionId) {
          await recordChatAuditTurn(
            auditSessionId,
            auditOrigin,
            'user',
            'Mensagem de áudio (não compreendida)',
            {
              replyToId: safeReplyToId,
              replyToPreview: safeReplyToPreview,
              replyToSender: safeReplyToSender,
              audioUrl: parsedAudio.cleanDataUrl,
              transcription: null,
            }
          );
          await recordChatAuditTurn(
            auditSessionId,
            auditOrigin,
            'assistant',
            unclearAudioReply
          );
        }

        const wantsStreamForUnclear =
          (req.body as { stream?: boolean }).stream !== false &&
          (req.headers.accept?.includes('text/event-stream') ||
            (req.body as { stream?: boolean }).stream === true);

        if (!wantsStreamForUnclear) {
          res.json({ reply: unclearAudioReply });
          return;
        }

        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();
        res.write(
          `data: ${JSON.stringify({ type: 'chunk', text: unclearAudioReply })}\n\n`
        );
        res.write(
          `data: ${JSON.stringify({ type: 'done', reply: unclearAudioReply })}\n\n`
        );
        res.end();
        return;
      }
    }

    const dbInventoryText = await dbInventoryPromise;

    // Se o cliente ou veículo selecionado informar código FIPE, consulta BrasilAPI ao vivo quando necessário
    let resolvedSelectedFipePrice = body.vehicle?.fipePrice;
    let resolvedSelectedFipeRef = '';
    if (
      body.vehicle?.fipeCode &&
      (!resolvedSelectedFipePrice || resolvedSelectedFipePrice <= 0)
    ) {
      try {
        const yearDigits = body.vehicle.year.split('/').pop();
        const yearNum = yearDigits ? Number(yearDigits) : undefined;
        const liveFipe = await fetchBrasilApiFipe(body.vehicle.fipeCode, yearNum);
        resolvedSelectedFipePrice = liveFipe.recommended.valorNumerico;
        resolvedSelectedFipeRef = ` (Referência BrasilAPI: ${liveFipe.recommended.mesReferencia})`;
      } catch {
        // Ignora falha silenciosamente para não interromper o atendimento
      }
    }

    // Verifica se o cliente digitou (ou falou no áudio) um código FIPE (ex: 001004-9)
    let clientFipeLookupContext = '';
    const lastUserMessageRaw =
      [...body.messages].reverse().find((m) => m.sender === 'cliente')?.text ||
      '';
    const fipeSearchText = audioTranscription
      ? `${lastUserMessageRaw} ${audioTranscription}`
      : lastUserMessageRaw;
    const fipeCodeMatch = fipeSearchText.match(/\b\d{6}-?\d\b/);
    if (fipeCodeMatch) {
      try {
        const liveFipe = await fetchBrasilApiFipe(fipeCodeMatch[0]);
        const summaryLines = liveFipe.items
          .slice(0, 6)
          .map(
            (item) =>
              `  * ${item.marca} ${item.modelo} (${item.anoModelo === 32000 ? 'Zero KM' : item.anoModelo}, ${item.combustivel}): ${item.valor} — Ref.: ${item.mesReferencia}`
          )
          .join('\n');
        clientFipeLookupContext = `\nConsulta oficial Tabela FIPE (BrasilAPI) realizada em tempo real para o código **${liveFipe.codigoFipe}**:\n${summaryLines}`;
      } catch {
        // Se código digitado não existir na FIPE, segue atendimento normal sem travar
      }
    }

    const realStockContext =
      dbInventoryText ||
      body.inventorySummary ||
      'Nenhum veículo listado no momento.';

    const selectedVehicleFipeLine = body.vehicle
      ? buildFipeComparisonSummary(
          body.vehicle.price,
          resolvedSelectedFipePrice,
          body.vehicle.fipeCode
        )
      : '';

    const vehicleContext = body.vehicle
      ? `Veículo selecionado pelo cliente:
- Modelo: ${body.vehicle.brand} ${body.vehicle.model} ${body.vehicle.version}
- Ano: ${body.vehicle.year} | Km: ${new Intl.NumberFormat('pt-BR').format(body.vehicle.km)} km
- Preço à vista: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(body.vehicle.price)}${
          selectedVehicleFipeLine
            ? `\n- Referência Oficial FIPE: ${selectedVehicleFipeLine}${resolvedSelectedFipeRef}`
            : ''
        }
- Cor: ${body.vehicle.color} | Câmbio: ${body.vehicle.transmission} | Combustível: ${body.vehicle.fuel}
- Status atual: ${body.vehicle.status}
- Opcionais: ${Array.isArray(body.vehicle.optionals) && body.vehicle.optionals.length > 0 ? body.vehicle.optionals.join(', ') : 'Padrão de série'}${clientFipeLookupContext}

Estoque completo disponível no banco de dados (caso o cliente pergunte sobre outros veículos):
${realStockContext}`
      : `Estoque real disponível no banco de dados (${dealership}):
${realStockContext}${clientFipeLookupContext}`;

    const conversationTranscript = body.messages
      .map((m, idx) => {
        const isLastClient =
          idx === body.messages.length - 1 && m.sender === 'cliente';
        let messageText = m.text;
        if (isLastClient && audioTranscription) {
          messageText = `[Áudio enviado pelo cliente — Transcrição]: "${audioTranscription}"${
            m.text && m.text !== 'Mensagem de áudio' ? ` (${m.text})` : ''
          }`;
        }
        return `${m.sender === 'cliente' ? 'Cliente' : assistantName}: ${messageText}`;
      })
      .join('\n');

    const safeReplyToId =
      typeof body.replyTo?.id === 'string'
        ? body.replyTo.id.trim().slice(0, 120)
        : null;
    const safeReplyToPreview =
      typeof body.replyTo?.preview === 'string'
        ? body.replyTo.preview.trim().slice(0, 400)
        : null;
    const safeReplyToSender: 'user' | 'assistant' | null =
      body.replyTo?.sender === 'ia'
        ? 'assistant'
        : body.replyTo?.sender === 'cliente'
          ? 'user'
          : null;

    const replyContextPrompt = safeReplyToPreview
      ? `\n\n[MENSAGEM CITADA PELO CLIENTE (REPLY)]\nO cliente respondeu especificamente a esta mensagem anterior (${
          safeReplyToSender === 'assistant'
            ? `enviada por ${assistantName}`
            : 'enviada pelo próprio Cliente'
        }):\n"${safeReplyToPreview}"\nResponda levando exatamente essa mensagem citada como referência principal.`
      : '';

    const auditSessionId = sanitizeSessionId(body.sessionId);
    const auditOrigin = sanitizeOrigin(body.origem);

    const clientMessagesOnly = body.messages.filter((m) => m.sender === 'cliente');
    const isFirstClientTurn = clientMessagesOnly.length <= 1;
    const latestClientUtterance = audioTranscription
      ? `${lastUserMessageRaw} ${audioTranscription}`.trim()
      : lastUserMessageRaw;

    const sanitizedBodyVisitorName =
      typeof body.visitorName === 'string' && body.visitorName.trim().length >= 2
        ? body.visitorName.trim().slice(0, 80)
        : null;

    let detectedVisitorName = extractVisitorNameFromMessage(
      latestClientUtterance,
      isFirstClientTurn
    );
    if (!detectedVisitorName && !sanitizedBodyVisitorName) {
      for (let i = 0; i < clientMessagesOnly.length; i++) {
        const found = extractVisitorNameFromMessage(
          clientMessagesOnly[i].text,
          i === 0
        );
        if (found) {
          detectedVisitorName = found;
          break;
        }
      }
    }

    let dbSessionVisitorName: string | null = null;
    if (!detectedVisitorName && !sanitizedBodyVisitorName && auditSessionId) {
      try {
        const sessionLookup = await pool.query<{ lead_name: string | null }>(
          'SELECT lead_name FROM chat_sessions WHERE session_id = $1 LIMIT 1',
          [auditSessionId]
        );
        const existingName = sessionLookup.rows[0]?.lead_name?.trim();
        if (existingName && existingName.length >= 2) {
          dbSessionVisitorName = existingName.slice(0, 80);
        }
      } catch {
        // Ignore lookup errors so chat never blocks
      }
    }

    const resolvedVisitorName =
      detectedVisitorName || sanitizedBodyVisitorName || dbSessionVisitorName;
    const visitorNameForClientMeta = detectedVisitorName || dbSessionVisitorName;

    const visitorContextLine = resolvedVisitorName
      ? `\nNome já cadastrado do cliente nesta conversa: **${resolvedVisitorName}** (trate-o de forma cordial pelo primeiro nome e NÃO pergunte novamente como ele se chama).`
      : '';

    const systemInstruction = `Você é o Consultor Oficial da revenda "${dealership}" (${s?.address || 'Av. Ibirapuera, 2.840 — Moema'}, ${s?.city || 'São Paulo'}/${s?.state || 'SP'}).
Atendimento: Seg-Sex ${s?.hoursWeekdays || '09:00 às 19:00'} | Sáb ${s?.hoursSaturday || '09:00 às 16:00'} | WhatsApp: ${s?.whatsapp || '(11) 99482-1040'}.

1. CONCISÃO RIGOROSA ESTILO WHATSAPP (OBRIGATÓRIO):
- Responda de forma **curta, direta e escaneável** — como um vendedor ágil no WhatsApp.
- Limite-se a **2 a 4 linhas curtas** OU no máximo **3 bullet points curtos** com \`- \`.
- É PROIBIDO enviar introduções longas, repetições, despedidas extensas ou paredões de texto.
- Vá direto ao ponto: destaque em negrito (\`**texto**\`) apenas o essencial (modelo, ano, preço, economia frente à FIPE ou condição principal).
- Encerre sempre com **apenas 1 pergunta curta e objetiva** conduzindo ao próximo passo (ex.: visita, simulação de financiamento ou avaliação de troca).

2. PERSONALIDADE COMERCIAL CONSULTIVA, FIPE OFICIAL E VERACIDADE:
- Seminovos com **laudo cautelar 100% aprovado** e **garantia de 90 dias (CDC)**.
- Utilize APENAS os dados reais do estoque e os valores oficiais da Tabela FIPE (BrasilAPI) fornecidos no contexto. NUNCA invente preços, valores FIPE, taxas exatas ou veículos fora do estoque. Se algo não constar, diga brevemente que confirmará com a equipe.
- Quando houver valor FIPE no contexto, cite de forma sucinta o preço e a economia frente à tabela. Aceitamos usado na troca e financiamento bancário/carta contemplada.

3. IDENTIFICAÇÃO E CONTINUIDADE (SEM REPETIÇÃO):
- Se o nome do cliente estiver no contexto, chame-o naturalmente pelo primeiro nome e NUNCA peça o nome novamente.
- Não peça novamente dados que o cliente já informou.

4. MINIMIZAÇÃO DE DADOS E PRIVACIDADE (LGPD):
- Solicite apenas **Nome** e **WhatsApp** quando necessário. É PROIBIDO pedir CPF, RG, CNH, endereço, renda ou dados bancários no chat.

5. COMPREENSÃO DE ÁUDIO E FALLBACK HONESTO:
- Se a transcrição do áudio estiver incompleta, cortada ou inaudível, não chute: peça em 1 frase curta para reenviar o áudio ou escrever por texto.`;

    const contentsPrompt = `Dados reais do estoque no banco de dados:\n${vehicleContext}${visitorContextLine}\n\nHistórico da conversa:\n${conversationTranscript}${replyContextPrompt}\n\nResponda à última mensagem do cliente em no máximo 2 a 4 linhas curtas (ou até 3 tópicos breves), direto ao ponto e finalizando com 1 única pergunta curta.`;

    const chatConfig = {
      thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
      maxOutputTokens: 360,
      systemInstruction,
    };

    if (auditSessionId) {
      const storedUserContent =
        lastUserMessageRaw.trim() ||
        (parsedAudio
          ? audioTranscription || 'Mensagem de áudio'
          : '');
      await recordChatAuditTurn(
        auditSessionId,
        auditOrigin,
        'user',
        storedUserContent,
        {
          replyToId: safeReplyToId,
          replyToPreview: safeReplyToPreview,
          replyToSender: safeReplyToSender,
          audioUrl: parsedAudio?.cleanDataUrl ?? null,
          transcription: audioTranscription,
        }
      );
      if (resolvedVisitorName) {
        await updateChatSessionVisitorName(
          auditSessionId,
          resolvedVisitorName,
          auditOrigin
        );
      }
    }

    const wantsStream =
      (req.body as { stream?: boolean }).stream !== false &&
      (req.headers.accept?.includes('text/event-stream') ||
        (req.body as { stream?: boolean }).stream === true);

    if (!wantsStream) {
      let response;
      let replyModelUsed = 'gemini-3.1-flash-lite';
      try {
        response = await callGeminiWithRetry(
          () =>
            ai.models.generateContent({
              model: 'gemini-3.1-flash-lite',
              contents: contentsPrompt,
              config: chatConfig,
            }),
          parsedAudio ? 1 : 2
        );
      } catch (chatErr) {
        if (!parsedAudio || isNonFallbackGeminiError(chatErr)) {
          throw chatErr;
        }
        replyModelUsed = 'gemini-2.5-flash';
        response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: contentsPrompt,
          config: {
            maxOutputTokens: 500,
            systemInstruction,
          },
        });
      }

      recordAiUsageLog({
        sessionId: auditSessionId,
        feature: 'chat_text',
        model: replyModelUsed,
        usageMetadata: response.usageMetadata,
      });

      const reply = response.text?.trim();
      if (!reply) {
        res.status(502).json({ error: 'O assistente não retornou uma resposta válida.' });
        return;
      }

      if (auditSessionId) {
        await recordChatAuditTurn(auditSessionId, auditOrigin, 'assistant', reply);
      }

      res.json({
        reply,
        ...(audioTranscription ? { transcription: audioTranscription } : {}),
        ...(visitorNameForClientMeta ? { visitorName: visitorNameForClientMeta } : {}),
      });
      return;
    }

    let stream;
    let streamModelUsed = 'gemini-3.1-flash-lite';
    try {
      stream = await callGeminiWithRetry(
        () =>
          ai.models.generateContentStream({
            model: 'gemini-3.1-flash-lite',
            contents: contentsPrompt,
            config: chatConfig,
          }),
        parsedAudio ? 1 : 2
      );
    } catch (streamErr) {
      if (!parsedAudio || isNonFallbackGeminiError(streamErr)) {
        throw streamErr;
      }
      streamModelUsed = 'gemini-2.5-flash';
      stream = await ai.models.generateContentStream({
        model: 'gemini-2.5-flash',
        contents: contentsPrompt,
        config: {
          maxOutputTokens: 500,
          systemInstruction,
        },
      });
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    if (audioTranscription || visitorNameForClientMeta) {
      res.write(
        `data: ${JSON.stringify({
          type: 'meta',
          ...(audioTranscription ? { transcription: audioTranscription } : {}),
          ...(visitorNameForClientMeta ? { visitorName: visitorNameForClientMeta } : {}),
        })}\n\n`
      );
    }

    let clientClosed = false;
    res.on('close', () => {
      clientClosed = true;
    });

    let fullText = '';
    let lastStreamUsage: GeminiUsageMetadataLike | null = null;
    try {
      for await (const chunk of stream) {
        if (chunk.usageMetadata) {
          lastStreamUsage = chunk.usageMetadata;
        }
        if (clientClosed) break;
        const delta = chunk.text;
        if (delta) {
          fullText += delta;
          res.write(`data: ${JSON.stringify({ type: 'chunk', text: delta })}\n\n`);
        }
      }

      recordAiUsageLog({
        sessionId: auditSessionId,
        feature: 'chat_text',
        model: streamModelUsed,
        usageMetadata: lastStreamUsage,
      });

      if (!clientClosed) {
        const trimmed = fullText.trim();
        if (!trimmed) {
          res.write(
            `data: ${JSON.stringify({
              type: 'error',
              error: 'O assistente não retornou uma resposta válida.',
            })}\n\n`
          );
        } else {
          if (auditSessionId) {
            void recordChatAuditTurn(auditSessionId, auditOrigin, 'assistant', trimmed);
          }
          res.write(`data: ${JSON.stringify({ type: 'done', reply: trimmed })}\n\n`);
        }
        res.end();
      } else if (auditSessionId && fullText.trim()) {
        void recordChatAuditTurn(auditSessionId, auditOrigin, 'assistant', fullText.trim());
      }
    } catch (streamErr: unknown) {
      const formatted = formatGeminiError(streamErr);
      console.error('[AI Chat Stream Error]', streamErr);
      if (!clientClosed) {
        res.write(
          `data: ${JSON.stringify({ type: 'error', error: formatted.message })}\n\n`
        );
        res.end();
      }
    }
  } catch (err: unknown) {
    const formatted = formatGeminiError(err);
    console.error('[AI Chat Error]', err);
    if (!res.headersSent) {
      res.status(formatted.status).json({ error: formatted.message });
    } else {
      res.write(
        `data: ${JSON.stringify({ type: 'error', error: formatted.message })}\n\n`
      );
      res.end();
    }
  }
});

// ============================================================================
// Private Owner-Only AI Token Usage Monitoring (100% Invisible to UI/Users)
// ============================================================================

app.get('/api/internal/ai-usage', async (req, res) => {
  const configuredSecret = process.env.OWNER_SECRET_KEY?.trim();
  if (!configuredSecret || configuredSecret === 'MY_OWNER_SECRET_KEY') {
    res.status(503).json({
      error:
        'Endpoint privado indisponível: configure a variável de ambiente OWNER_SECRET_KEY.',
    });
    return;
  }

  if (!isValidOwnerSecret(req, configuredSecret)) {
    res.status(401).json({ error: 'Não autorizado.' });
    return;
  }

  try {
    const [totalsRes, byFeatureRes, byModelRes] = await Promise.all([
      pool.query<{
        today_requests: string;
        today_prompt_tokens: string;
        today_completion_tokens: string;
        today_total_tokens: string;
        month_requests: string;
        month_prompt_tokens: string;
        month_completion_tokens: string;
        month_total_tokens: string;
        all_requests: string;
        all_prompt_tokens: string;
        all_completion_tokens: string;
        all_total_tokens: string;
      }>(
        `SELECT
           COUNT(*) FILTER (
             WHERE (created_at AT TIME ZONE 'America/Sao_Paulo')::date =
                   (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
           ) AS today_requests,
           COALESCE(SUM(prompt_tokens) FILTER (
             WHERE (created_at AT TIME ZONE 'America/Sao_Paulo')::date =
                   (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
           ), 0) AS today_prompt_tokens,
           COALESCE(SUM(completion_tokens) FILTER (
             WHERE (created_at AT TIME ZONE 'America/Sao_Paulo')::date =
                   (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
           ), 0) AS today_completion_tokens,
           COALESCE(SUM(total_tokens) FILTER (
             WHERE (created_at AT TIME ZONE 'America/Sao_Paulo')::date =
                   (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
           ), 0) AS today_total_tokens,

           COUNT(*) FILTER (
             WHERE DATE_TRUNC('month', created_at AT TIME ZONE 'America/Sao_Paulo') =
                   DATE_TRUNC('month', NOW() AT TIME ZONE 'America/Sao_Paulo')
           ) AS month_requests,
           COALESCE(SUM(prompt_tokens) FILTER (
             WHERE DATE_TRUNC('month', created_at AT TIME ZONE 'America/Sao_Paulo') =
                   DATE_TRUNC('month', NOW() AT TIME ZONE 'America/Sao_Paulo')
           ), 0) AS month_prompt_tokens,
           COALESCE(SUM(completion_tokens) FILTER (
             WHERE DATE_TRUNC('month', created_at AT TIME ZONE 'America/Sao_Paulo') =
                   DATE_TRUNC('month', NOW() AT TIME ZONE 'America/Sao_Paulo')
           ), 0) AS month_completion_tokens,
           COALESCE(SUM(total_tokens) FILTER (
             WHERE DATE_TRUNC('month', created_at AT TIME ZONE 'America/Sao_Paulo') =
                   DATE_TRUNC('month', NOW() AT TIME ZONE 'America/Sao_Paulo')
           ), 0) AS month_total_tokens,

           COUNT(*) AS all_requests,
           COALESCE(SUM(prompt_tokens), 0) AS all_prompt_tokens,
           COALESCE(SUM(completion_tokens), 0) AS all_completion_tokens,
           COALESCE(SUM(total_tokens), 0) AS all_total_tokens
         FROM ai_usage_logs`
      ),
      pool.query<{
        feature: string;
        requests: string;
        prompt_tokens: string;
        completion_tokens: string;
        total_tokens: string;
        today_total_tokens: string;
        month_total_tokens: string;
      }>(
        `SELECT
           feature,
           COUNT(*) AS requests,
           COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
           COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
           COALESCE(SUM(total_tokens), 0) AS total_tokens,
           COALESCE(SUM(total_tokens) FILTER (
             WHERE (created_at AT TIME ZONE 'America/Sao_Paulo')::date =
                   (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
           ), 0) AS today_total_tokens,
           COALESCE(SUM(total_tokens) FILTER (
             WHERE DATE_TRUNC('month', created_at AT TIME ZONE 'America/Sao_Paulo') =
                   DATE_TRUNC('month', NOW() AT TIME ZONE 'America/Sao_Paulo')
           ), 0) AS month_total_tokens
         FROM ai_usage_logs
         GROUP BY feature
         ORDER BY SUM(total_tokens) DESC`
      ),
      pool.query<{
        model: string;
        requests: string;
        prompt_tokens: string;
        completion_tokens: string;
        total_tokens: string;
      }>(
        `SELECT
           model,
           COUNT(*) AS requests,
           COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
           COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
           COALESCE(SUM(total_tokens), 0) AS total_tokens
         FROM ai_usage_logs
         GROUP BY model
         ORDER BY SUM(total_tokens) DESC`
      ),
    ]);

    const t = totalsRes.rows[0];
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      generatedAt: new Date().toISOString(),
      timezone: 'America/Sao_Paulo',
      today: {
        requests: Number(t?.today_requests) || 0,
        promptTokens: Number(t?.today_prompt_tokens) || 0,
        completionTokens: Number(t?.today_completion_tokens) || 0,
        totalTokens: Number(t?.today_total_tokens) || 0,
      },
      thisMonth: {
        requests: Number(t?.month_requests) || 0,
        promptTokens: Number(t?.month_prompt_tokens) || 0,
        completionTokens: Number(t?.month_completion_tokens) || 0,
        totalTokens: Number(t?.month_total_tokens) || 0,
      },
      allTime: {
        requests: Number(t?.all_requests) || 0,
        promptTokens: Number(t?.all_prompt_tokens) || 0,
        completionTokens: Number(t?.all_completion_tokens) || 0,
        totalTokens: Number(t?.all_total_tokens) || 0,
      },
      byFeature: byFeatureRes.rows.map((r) => ({
        feature: r.feature,
        requests: Number(r.requests) || 0,
        promptTokens: Number(r.prompt_tokens) || 0,
        completionTokens: Number(r.completion_tokens) || 0,
        totalTokens: Number(r.total_tokens) || 0,
        todayTokens: Number(r.today_total_tokens) || 0,
        monthTokens: Number(r.month_total_tokens) || 0,
      })),
      byModel: byModelRes.rows.map((r) => ({
        model: r.model,
        requests: Number(r.requests) || 0,
        promptTokens: Number(r.prompt_tokens) || 0,
        completionTokens: Number(r.completion_tokens) || 0,
        totalTokens: Number(r.total_tokens) || 0,
      })),
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : 'Erro ao consultar consumo interno de tokens da IA.';
    res.status(500).json({ error: message });
  }
});

let dbInitPromise: Promise<void> | null = null;

export function ensureDatabaseInitialized(): Promise<void> {
  if (!dbInitPromise) {
    dbInitPromise = (async () => {
      try {
        await seedNeonDatabaseIfEmpty();
        await ensureAdminUsersSchemaAndSeed();
        console.log('[DB] Neon PostgreSQL conectado e tabelas verificadas.');
      } catch (err) {
        console.error('[DB] Falha ao inicializar/semear Neon PostgreSQL:', err);
        dbInitPromise = null;
      }
    })();
  }
  return dbInitPromise;
}

async function startServer() {
  await ensureDatabaseInitialized();

  const isProd =
    process.env.NODE_ENV === 'production' &&
    fs.existsSync(path.join(__dirname, 'dist'));

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Armazém do Carro server listening on http://0.0.0.0:${PORT}`);
  });
}

if (!process.env.VERCEL) {
  void startServer();
}

export default app;
