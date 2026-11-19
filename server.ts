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

interface ChatRequestBody {
  sessionId?: string;
  origem?: string;
  messages: { sender: 'ia' | 'cliente'; text: string }[];
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
  content: string
): Promise<void> {
  if (!sessionId || !content.trim()) return;
  try {
    await pool.query(
      `INSERT INTO chat_sessions (session_id, origem, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT (session_id)
       DO UPDATE SET updated_at = NOW()`,
      [sessionId, origem]
    );
    await pool.query(
      `INSERT INTO chat_messages (session_id, sender, content, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [sessionId, sender, content.trim()]
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
         s.created_at,
         s.updated_at,
         COALESCE(m_agg.message_count, 0)::int AS message_count,
         m_last.content AS last_message,
         m_last.sender AS last_sender
       FROM chat_sessions s
       LEFT JOIN (
         SELECT session_id, COUNT(*)::int AS message_count
         FROM chat_messages
         GROUP BY session_id
       ) m_agg ON m_agg.session_id = s.session_id
       LEFT JOIN LATERAL (
         SELECT content, sender
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
        `SELECT id, session_id, sender, content, created_at
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
          createdAt: s.created_at,
          updatedAt: s.updated_at,
        },
        messages: msgRes.rows.map((m) => ({
          id: m.id,
          sessionId: m.session_id,
          sender: m.sender,
          content: m.content,
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

    const result = await pool.query<DbLeadRow>(
      `INSERT INTO leads (name, phone, vehicle_interest, stage, chat_history, lgpd_consent, lgpd_consent_at)
       VALUES ($1, $2, $3, 'Novo Lead', $4, true, NOW())
       RETURNING *`,
      [
        cleanName,
        cleanPhone,
        vehicle_interest ? String(vehicle_interest).trim() : 'Atendimento Geral',
        typeof chat_history === 'string'
          ? chat_history
          : JSON.stringify(chat_history || []),
      ]
    );

    const safeSessionId = sanitizeSessionId(session_id);
    if (safeSessionId) {
      await attachLeadToChatSession(
        safeSessionId,
        cleanName,
        cleanPhone,
        sanitizeOrigin(origem)
      );
    }

    const created = result.rows[0];
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
    const { name, phone, vehicle_interest, stage, chat_history } = req.body;

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
           chat_history = COALESCE($5, chat_history)
       WHERE id = $6
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
    const ai = getGeminiClient();
    const s = body.settings;
    const dealership = s?.tradeName || 'Armazém do Carro';
    const assistantName = s?.aiAssistantName || 'Consultor Virtual Armazém';

    // Consulta direta ao estoque real no Neon PostgreSQL para garantir dados 100% verídicos
    let dbInventoryText = '';
    try {
      const stockRes = await pool.query<DbVehicleRow>(
        `SELECT brand, model, version, year_fab, year_model, km, price, fipe_code, fipe_price, status, fuel, transmission, options
         FROM vehicles
         WHERE status IN ('Disponivel', 'Disponível', 'Reservado')
         ORDER BY created_at DESC, id DESC`
      );
      if (stockRes.rows.length > 0) {
        dbInventoryText = stockRes.rows
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
    } catch {
      dbInventoryText = '';
    }

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

    // Verifica se o cliente digitou explicitamente um código FIPE na última mensagem (ex: 001004-9)
    let clientFipeLookupContext = '';
    const lastUserMessage = [...body.messages]
      .reverse()
      .find((m) => m.sender === 'cliente')?.text;
    const fipeCodeMatch = lastUserMessage?.match(/\b\d{6}-?\d\b/);
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
      .map((m) => `${m.sender === 'cliente' ? 'Cliente' : assistantName}: ${m.text}`)
      .join('\n');

    const chatConfig = {
      thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
      maxOutputTokens: 500,
      systemInstruction: `Você é o Consultor Oficial da revenda "${dealership}" (${s?.address || 'Av. Ibirapuera, 2.840 — Moema'}, ${s?.city || 'São Paulo'}/${s?.state || 'SP'}).
Atendimento: Seg-Sex ${s?.hoursWeekdays || '09:00 às 19:00'} | Sáb ${s?.hoursSaturday || '09:00 às 16:00'} | WhatsApp: ${s?.whatsapp || '(11) 99482-1040'}.

1. FORMATAÇÃO VISUAL LIMPA, CURTA E ESTRUTURADA (OBRIGATÓRIO):
- É PROIBIDO enviar blocos longos ou densos de texto corrido.
- Seja objetivo e direto (idealmente entre 60 e 160 palavras por resposta).
- Separe seções com linha em branco e use parágrafos curtos (1 frase por parágrafo).
- Use listas em Markdown com \`- \` para apresentar ficha técnica, diferenciais, opcionais ou opções de estoque.
- Use negritos estratégicos (\`**texto**\`) para destacar nomes de modelos, anos, quilometragem, preços e economia frente à Tabela FIPE (ex: **BMW 320i M Sport (2023/2024)** por **R$ 314.900**).

2. PERSONALIDADE COMERCIAL CONSULTIVA, FIPE OFICIAL E VERACIDADE:
- Atue estritamente como o Consultor Oficial do ${dealership}, especialista em seminovos selecionados com procedência garantida, **laudo cautelar 100% aprovado** e **garantia legal de 90 dias (CDC)**.
- Utilize APENAS os dados reais do estoque e os valores oficiais da Tabela FIPE (BrasilAPI) fornecidos no contexto. NUNCA invente especificações, preços, valores FIPE, anos, versões, taxas exatas de financiamento ou veículos que não constam no contexto. Se uma informação não estiver listada, diga com clareza que confirmará presencialmente ou pelo WhatsApp.
- ARGUMENTAÇÃO COMERCIAL COM TABELA FIPE: Sempre que o contexto trouxer o valor oficial da **Tabela FIPE** (ou consulta ao vivo por código FIPE), use essa referência para valorizar o negócio de forma transparente — destacando o preço FIPE, o **percentual de desconto** e a **economia em reais** quando o veículo estiver abaixo da tabela, ou justificando o valor de mercado pela baixa quilometragem, laudo cautelar e pacote de opcionais.
- Quando pertinente, destaque que aceitamos veículo usado na troca (mediante avaliação presencial) e trabalhamos com financiamento bancário e carta de crédito contemplada.

3. CHAMADA PARA AÇÃO (CTA) ATIVA:
- Toda resposta sobre veículos ou estoque DEVE terminar com uma linha separada convidando o cliente a avançar na negociação (ex.: solicitar simulação de financiamento, informar apenas nome e WhatsApp no formulário de atendimento para receber o laudo cautelar completo, ou agendar visita/test-drive no showroom).

4. MINIMIZAÇÃO DE DADOS E PRIVACIDADE (LGPD):
- Solicite APENAS os dados estritamente necessários para o atendimento inicial: **Nome** e **WhatsApp**.
- É PROIBIDO solicitar CPF, RG, CNH, endereço residencial, comprovante de renda, dados bancários ou número de cartão pelo chat.
- Caso o cliente informe documentos pessoais ou dados sensíveis espontaneamente, NÃO repita esses dados e oriente que documentos cadastrais são tratados apenas presencialmente ou com o consultor autorizado no fechamento da negociação.`,
    };

    const contentsPrompt = `Dados reais do estoque no banco de dados:\n${vehicleContext}\n\nHistórico da conversa:\n${conversationTranscript}\n\nResponda à última mensagem do cliente de forma rápida, objetiva, em tópicos Markdown e com CTA ativo.`;

    const auditSessionId = sanitizeSessionId(body.sessionId);
    const auditOrigin = sanitizeOrigin(body.origem);
    if (auditSessionId && lastUserMessage) {
      await recordChatAuditTurn(auditSessionId, auditOrigin, 'user', lastUserMessage);
    }

    const wantsStream =
      (req.body as { stream?: boolean }).stream !== false &&
      (req.headers.accept?.includes('text/event-stream') ||
        (req.body as { stream?: boolean }).stream === true);

    if (!wantsStream) {
      const response = await callGeminiWithRetry(() =>
        ai.models.generateContent({
          model: 'gemini-3.1-flash-lite',
          contents: contentsPrompt,
          config: chatConfig,
        })
      );

      const reply = response.text?.trim();
      if (!reply) {
        res.status(502).json({ error: 'O assistente não retornou uma resposta válida.' });
        return;
      }

      if (auditSessionId) {
        await recordChatAuditTurn(auditSessionId, auditOrigin, 'assistant', reply);
      }

      res.json({ reply });
      return;
    }

    const stream = await callGeminiWithRetry(() =>
      ai.models.generateContentStream({
        model: 'gemini-3.1-flash-lite',
        contents: contentsPrompt,
        config: chatConfig,
      })
    );

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let clientClosed = false;
    res.on('close', () => {
      clientClosed = true;
    });

    let fullText = '';
    try {
      for await (const chunk of stream) {
        if (clientClosed) break;
        const delta = chunk.text;
        if (delta) {
          fullText += delta;
          res.write(`data: ${JSON.stringify({ type: 'chunk', text: delta })}\n\n`);
        }
      }

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
