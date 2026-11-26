import crypto from 'crypto';
import type { Express, NextFunction, Request, Response } from 'express';
import { pool } from '../db/pool';
import {
  buildSessionCookieHeader,
  hashPassword,
  PublicAdminUser,
  signSessionToken,
} from '../db/auth';
import { recordStaffAudit } from '../db/centralSchema';
import { mapDbVehicleToFrontend, ApiVehicleRow } from '../db/mappers';
import {
  canEmitTemplateForRole,
  hasPermission,
  normalizeStaffRole,
  STAFF_ROLE_META,
  StaffPermission,
} from '../utils/rbac';
import {
  analyzeVehicleDataQuality,
  computeFipeMetrics,
  formatDealershipAddress,
} from '../utils/vehicleDomain';
import {
  buildPdfBytesFromIssuedDocument,
  computeDocumentFinancials,
  getMissingRequiredFields,
  renderDocumentPreviewText,
} from '../utils/documentEngine';
import { formatBRL, formatKm } from '../utils/formatters';
import {
  getExternalSourceSummary,
  saveExternalSourceConfig,
  syncExternalInventory,
  testExternalSourceConnection,
  validatePublicStorefrontLink,
} from './externalInventoryService';
import type {
  CopilotQueryResult,
  DealershipSettings,
  DocumentFieldSchema,
  DocumentTemplateRecord,
  DocumentTypeSlug,
  IssuedDocumentRecord,
  ManagementMetrics,
  MarketingDraftRecord,
  MarketingFormat,
  SessionAutomationMode,
  SessionCommercialStage,
  SessionNegotiationContext,
  StaffRole,
  StaffTaskRecord,
  TodayActionSummary,
  TradeInRecord,
  TradeInStatus,
  Vehicle,
  VisitRecord,
  VisitStatus,
} from '../types';

export interface StaffAuthenticatedRequest extends Request {
  adminUser?: PublicAdminUser;
}

export interface RegisterCentralRoutesDeps {
  requireAdminAuth: (
    req: StaffAuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => Promise<void> | void;
  getPersistedDealershipConfig: () => Promise<{
    config: DealershipSettings;
    configUnavailable: boolean;
    hasPersistedConfig: boolean;
  }>;
  polishMarketingCaptionWithAi?: (params: {
    vehicle: Vehicle;
    baseCaption: string;
    tone: string;
    format: MarketingFormat;
  }) => Promise<string | null>;
}

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function createPermissionMiddleware(
  requireAdminAuth: RegisterCentralRoutesDeps['requireAdminAuth'],
  permission: StaffPermission
) {
  return async (
    req: StaffAuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    await new Promise<void>((resolve) => {
      void requireAdminAuth(req, res, () => {
        resolve();
      });
    });
    if (res.headersSent || !req.adminUser) return;
    if (!hasPermission(req.adminUser.roleCode, permission)) {
      res.status(403).json({
        error: 'Permissão insuficiente para esta operação na Central da Revenda.',
        requiredPermission: permission,
        roleCode: req.adminUser.roleCode,
      });
      return;
    }
    next();
  };
}

function mapTemplateRow(row: Record<string, unknown>): DocumentTemplateRecord {
  return {
    id: Number(row.id),
    slug: String(row.slug),
    name: String(row.name),
    docType: String(row.doc_type) as DocumentTypeSlug,
    version: Number(row.version) || 1,
    status: String(row.status) as DocumentTemplateRecord['status'],
    isExampleTemplate: Boolean(row.is_example_template),
    allowedRoles: safeJsonParse<StaffRole[]>(
      typeof row.allowed_roles_json === 'string' ? row.allowed_roles_json : null,
      ['administrador']
    ),
    fieldsSchema: safeJsonParse<DocumentFieldSchema[]>(
      typeof row.fields_schema_json === 'string' ? row.fields_schema_json : null,
      []
    ),
    bodyTemplate: String(row.body_template || ''),
    createdByName: row.created_by_name ? String(row.created_by_name) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapIssuedDocRow(row: Record<string, unknown>): IssuedDocumentRecord {
  return {
    id: Number(row.id),
    idempotencyKey: row.idempotency_key ? String(row.idempotency_key) : null,
    templateId: row.template_id ? Number(row.template_id) : null,
    templateSlug: String(row.template_slug),
    templateName: String(row.template_name),
    templateVersion: Number(row.template_version) || 1,
    docType: String(row.doc_type) as DocumentTypeSlug,
    sessionId: row.session_id ? String(row.session_id) : null,
    leadId: row.lead_id ? Number(row.lead_id) : null,
    vehicleId: row.vehicle_id ? Number(row.vehicle_id) : null,
    supersedesDocumentId: row.supersedes_document_id
      ? Number(row.supersedes_document_id)
      : null,
    issuedById: row.issued_by_id ? Number(row.issued_by_id) : null,
    issuedByName: String(row.issued_by_name || 'Equipe'),
    dealershipSnapshot: safeJsonParse<DealershipSettings>(
      typeof row.dealership_snapshot_json === 'string'
        ? row.dealership_snapshot_json
        : null,
      {} as DealershipSettings
    ),
    vehicleSnapshot: safeJsonParse<Partial<Vehicle> | null>(
      typeof row.vehicle_snapshot_json === 'string'
        ? row.vehicle_snapshot_json
        : null,
      null
    ),
    values: safeJsonParse<Record<string, string | number | boolean | null>>(
      typeof row.values_json === 'string' ? row.values_json : null,
      {}
    ),
    calculatedTotals: safeJsonParse<IssuedDocumentRecord['calculatedTotals']>(
      typeof row.calculated_totals_json === 'string'
        ? row.calculated_totals_json
        : null,
      null
    ),
    renderedText: String(row.rendered_text || ''),
    createdAt: String(row.created_at),
  };
}

function mapVisitRow(row: Record<string, unknown>): VisitRecord {
  return {
    id: Number(row.id),
    sessionId: row.session_id ? String(row.session_id) : null,
    leadId: row.lead_id ? Number(row.lead_id) : null,
    vehicleId: row.vehicle_id ? Number(row.vehicle_id) : null,
    vehicleLabel: row.vehicle_label ? String(row.vehicle_label) : null,
    customerName: row.customer_name ? String(row.customer_name) : null,
    customerPhone: row.customer_phone ? String(row.customer_phone) : null,
    status: String(row.status || 'solicitada') as VisitStatus,
    scheduledDate: row.scheduled_date ? String(row.scheduled_date) : null,
    scheduledTime: row.scheduled_time ? String(row.scheduled_time) : null,
    assignedUserId: row.assigned_user_id ? Number(row.assigned_user_id) : null,
    assignedUserName: row.assigned_user_name ? String(row.assigned_user_name) : null,
    notes: row.notes ? String(row.notes) : null,
    createdByName: row.created_by_name ? String(row.created_by_name) : null,
    updatedByName: row.updated_by_name ? String(row.updated_by_name) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapTradeInRow(row: Record<string, unknown>): TradeInRecord {
  return {
    id: Number(row.id),
    sessionId: row.session_id ? String(row.session_id) : null,
    leadId: row.lead_id ? Number(row.lead_id) : null,
    targetVehicleId: row.target_vehicle_id ? Number(row.target_vehicle_id) : null,
    customerName: row.customer_name ? String(row.customer_name) : null,
    customerPhone: row.customer_phone ? String(row.customer_phone) : null,
    brandModel: String(row.brand_model || 'Veículo na troca'),
    yearText: row.year_text ? String(row.year_text) : null,
    versionText: row.version_text ? String(row.version_text) : null,
    transmission: row.transmission ? String(row.transmission) : null,
    km: row.km !== null && row.km !== undefined ? Number(row.km) : null,
    color: row.color ? String(row.color) : null,
    plate: row.plate ? String(row.plate) : null,
    conditionNotes: row.condition_notes ? String(row.condition_notes) : null,
    photos: safeJsonParse<Array<{ url: string; name: string }>>(
      typeof row.photos_json === 'string' ? row.photos_json : null,
      []
    ),
    pendingItems: safeJsonParse<string[]>(
      typeof row.pending_items_json === 'string' ? row.pending_items_json : null,
      []
    ),
    status: String(row.status || 'aguardando_fotos') as TradeInStatus,
    approvedValue:
      row.approved_value !== null && row.approved_value !== undefined
        ? Number(row.approved_value)
        : null,
    evaluatedByName: row.evaluated_by_name ? String(row.evaluated_by_name) : null,
    evaluatedAt: row.evaluated_at ? String(row.evaluated_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapTaskRow(row: Record<string, unknown>): StaffTaskRecord {
  return {
    id: Number(row.id),
    sessionId: row.session_id ? String(row.session_id) : null,
    leadId: row.lead_id ? Number(row.lead_id) : null,
    vehicleId: row.vehicle_id ? Number(row.vehicle_id) : null,
    assignedUserId: row.assigned_user_id ? Number(row.assigned_user_id) : null,
    assignedUserName: row.assigned_user_name ? String(row.assigned_user_name) : null,
    title: String(row.title),
    notes: row.notes ? String(row.notes) : null,
    dueAt: row.due_at ? String(row.due_at) : null,
    status: String(row.status || 'pendente') as StaffTaskRecord['status'],
    createdByName: row.created_by_name ? String(row.created_by_name) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    createdAt: String(row.created_at),
  };
}

function mapMarketingDraftRow(row: Record<string, unknown>): MarketingDraftRecord {
  return {
    id: Number(row.id),
    vehicleId: Number(row.vehicle_id),
    format: String(row.format) as MarketingFormat,
    title: String(row.title),
    caption: String(row.caption || ''),
    selectedPhotoUrl: row.selected_photo_url ? String(row.selected_photo_url) : null,
    selectedPhotos: safeJsonParse<string[]>(
      typeof row.selected_photos_json === 'string' ? row.selected_photos_json : null,
      []
    ),
    templateConfig: safeJsonParse<Record<string, unknown>>(
      typeof row.template_config_json === 'string' ? row.template_config_json : null,
      {}
    ),
    snapshotPrice: Number(row.snapshot_price) || 0,
    snapshotStatus: String(row.snapshot_status || 'Disponível'),
    publicSheetUrl: row.public_sheet_url ? String(row.public_sheet_url) : null,
    trackingSource: row.tracking_source ? String(row.tracking_source) : null,
    createdByName: row.created_by_name ? String(row.created_by_name) : null,
    updatedByName: row.updated_by_name ? String(row.updated_by_name) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function registerCentralRevendaRoutes(
  app: Express,
  deps: RegisterCentralRoutesDeps
): void {
  const { requireAdminAuth, getPersistedDealershipConfig } = deps;
  const requirePerm = (perm: StaffPermission) =>
    createPermissionMiddleware(requireAdminAuth, perm);

  // ==========================================================================
  // 1. TEAM MANAGEMENT & INVITES (Administrador only, except public accept-invite)
  // ==========================================================================

  app.get(
    '/api/admin/team',
    requirePerm('team:manage'),
    async (_req: StaffAuthenticatedRequest, res) => {
      try {
        const [usersRes, invitesRes] = await Promise.all([
          pool.query(
            `SELECT id, name, email, role, role_code, avatar_url, active, last_login_at, created_at
             FROM admin_users
             ORDER BY id ASC`
          ),
          pool.query(
            `SELECT id, name, email, role_code, invited_by_name, expires_at, accepted_at, created_at
             FROM staff_invites
             ORDER BY created_at DESC
             LIMIT 50`
          ),
        ]);

        res.setHeader('Cache-Control', 'no-store');
        res.json({
          users: usersRes.rows.map((u) => {
            const roleCode = normalizeStaffRole(u.role_code, u.role);
            return {
              id: Number(u.id),
              name: String(u.name),
              email: String(u.email),
              role: String(u.role || STAFF_ROLE_META[roleCode].label),
              roleCode,
              avatarUrl: u.avatar_url ? String(u.avatar_url) : null,
              active: Boolean(u.active),
              lastLoginAt: u.last_login_at ? String(u.last_login_at) : null,
            };
          }),
          invites: invitesRes.rows.map((inv) => ({
            id: Number(inv.id),
            name: String(inv.name),
            email: String(inv.email),
            roleCode: normalizeStaffRole(inv.role_code),
            invitedByName: inv.invited_by_name ? String(inv.invited_by_name) : null,
            expiresAt: String(inv.expires_at),
            acceptedAt: inv.accepted_at ? String(inv.accepted_at) : null,
            createdAt: String(inv.created_at),
          })),
        });
      } catch (err: unknown) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Erro ao listar equipe.',
        });
      }
    }
  );

  // Lightweight staff directory for managers/sellers assigning sessions or visits
  app.get(
    '/api/admin/team/directory',
    requirePerm('today:view'),
    async (_req: StaffAuthenticatedRequest, res) => {
      try {
        const usersRes = await pool.query(
          `SELECT id, name, role, role_code
           FROM admin_users
           WHERE active = true
           ORDER BY name ASC`
        );
        res.json(
          usersRes.rows.map((u) => {
            const roleCode = normalizeStaffRole(u.role_code, u.role);
            return {
              id: Number(u.id),
              name: String(u.name),
              roleCode,
              roleLabel: STAFF_ROLE_META[roleCode].label,
            };
          })
        );
      } catch (err: unknown) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Erro ao carregar diretório da equipe.',
        });
      }
    }
  );

  app.post(
    '/api/admin/team/users',
    requirePerm('team:manage'),
    async (req: StaffAuthenticatedRequest, res) => {
      try {
        const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 150) : '';
        const email =
          typeof req.body?.email === 'string'
            ? req.body.email.trim().toLowerCase().slice(0, 200)
            : '';
        const password = typeof req.body?.password === 'string' ? req.body.password : '';
        const roleCode = normalizeStaffRole(
          typeof req.body?.roleCode === 'string' ? req.body.roleCode : 'vendedor'
        );

        if (!name || !email || !email.includes('@')) {
          res.status(400).json({ error: 'Informe nome e e-mail corporativo válido.' });
          return;
        }
        if (password.length < 8) {
          res.status(400).json({ error: 'A senha inicial deve ter pelo menos 8 caracteres.' });
          return;
        }

        const roleLabel = STAFF_ROLE_META[roleCode].label;
        const passwordHash = hashPassword(password);
        const inserted = await pool.query(
          `INSERT INTO admin_users (name, email, password_hash, role, role_code, active)
           VALUES ($1, $2, $3, $4, $5, true)
           RETURNING id, name, email, role, role_code, avatar_url, active`,
          [name, email, passwordHash, roleLabel, roleCode]
        );

        const row = inserted.rows[0];
        await recordStaffAudit({
          user: req.adminUser,
          action: 'team_user_created',
          entityType: 'admin_user',
          entityId: row.id,
          details: { email, roleCode },
        });

        res.status(201).json({
          id: Number(row.id),
          name: String(row.name),
          email: String(row.email),
          role: String(row.role),
          roleCode,
          avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
          active: Boolean(row.active),
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Erro ao criar conta da equipe.';
        if (msg.toLowerCase().includes('unique')) {
          res.status(409).json({ error: 'Já existe um usuário cadastrado com este e-mail.' });
          return;
        }
        res.status(500).json({ error: msg });
      }
    }
  );

  app.patch(
    '/api/admin/team/users/:id',
    requirePerm('team:manage'),
    async (req: StaffAuthenticatedRequest, res) => {
      try {
        const userId = Number(req.params.id);
        if (!Number.isInteger(userId) || userId <= 0) {
          res.status(400).json({ error: 'ID de usuário inválido.' });
          return;
        }
        const existing = await pool.query(
          'SELECT id, name, email, role, role_code, active FROM admin_users WHERE id = $1 LIMIT 1',
          [userId]
        );
        if (existing.rowCount === 0) {
          res.status(404).json({ error: 'Usuário não encontrado.' });
          return;
        }
        const cur = existing.rows[0];
        const nextRoleCode = req.body?.roleCode
          ? normalizeStaffRole(String(req.body.roleCode))
          : normalizeStaffRole(cur.role_code, cur.role);
        const nextRoleLabel = STAFF_ROLE_META[nextRoleCode].label;
        const nextActive =
          typeof req.body?.active === 'boolean' ? req.body.active : Boolean(cur.active);
        const nextName =
          typeof req.body?.name === 'string' && req.body.name.trim()
            ? req.body.name.trim().slice(0, 150)
            : String(cur.name);

        if (req.adminUser && req.adminUser.id === userId && !nextActive) {
          res.status(400).json({ error: 'Você não pode desativar sua própria conta ativa.' });
          return;
        }

        // Prevent removing or disabling the last active administrator
        const wasActiveAdmin =
          Boolean(cur.active) && normalizeStaffRole(cur.role_code, cur.role) === 'administrador';
        const willBeActiveAdmin = nextActive && nextRoleCode === 'administrador';
        if (wasActiveAdmin && !willBeActiveAdmin) {
          const otherAdmins = await pool.query<{ count: number }>(
            `SELECT COUNT(*)::int AS count
             FROM admin_users
             WHERE id <> $1 AND active = true AND (role_code = 'administrador' OR LOWER(role) LIKE '%admin%')`,
            [userId]
          );
          if ((otherAdmins.rows[0]?.count ?? 0) === 0) {
            res.status(400).json({
              error: 'É necessário manter pelo menos um administrador ativo antes de alterar ou desativar esta conta.',
            });
            return;
          }
        }

        const shouldBumpTokenVersion =
          !nextActive || nextRoleCode !== normalizeStaffRole(cur.role_code, cur.role);

        const updated = await pool.query(
          `UPDATE admin_users
           SET name = $1,
               role = $2,
               role_code = $3,
               active = $4,
               token_version = CASE WHEN $6::boolean THEN COALESCE(token_version, 1) + 1 ELSE COALESCE(token_version, 1) END
           WHERE id = $5
           RETURNING id, name, email, role, role_code, avatar_url, active`,
          [nextName, nextRoleLabel, nextRoleCode, nextActive, userId, shouldBumpTokenVersion]
        );

        await recordStaffAudit({
          user: req.adminUser,
          action: 'team_user_updated',
          entityType: 'admin_user',
          entityId: userId,
          details: { roleCode: nextRoleCode, active: nextActive, sessionsRevoked: shouldBumpTokenVersion },
        });

        const row = updated.rows[0];
        res.json({
          id: Number(row.id),
          name: String(row.name),
          email: String(row.email),
          role: String(row.role),
          roleCode: normalizeStaffRole(row.role_code, row.role),
          avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
          active: Boolean(row.active),
        });
      } catch (err: unknown) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Erro ao atualizar usuário.',
        });
      }
    }
  );

  app.post(
    '/api/admin/team/users/:id/rotate-password',
    requirePerm('team:manage'),
    async (req: StaffAuthenticatedRequest, res) => {
      try {
        const userId = Number(req.params.id);
        if (!Number.isInteger(userId) || userId <= 0) {
          res.status(400).json({ error: 'ID de usuário inválido.' });
          return;
        }
        const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
        if (newPassword.length < 10) {
          res.status(400).json({
            error: 'A nova senha deve ter pelo menos 10 caracteres.',
          });
          return;
        }
        const existing = await pool.query(
          'SELECT id, name, email, role, role_code, avatar_url, active FROM admin_users WHERE id = $1 LIMIT 1',
          [userId]
        );
        if (existing.rowCount === 0) {
          res.status(404).json({ error: 'Usuário não encontrado.' });
          return;
        }

        const passwordHash = hashPassword(newPassword);
        const updated = await pool.query(
          `UPDATE admin_users
           SET password_hash = $1,
               token_version = COALESCE(token_version, 1) + 1
           WHERE id = $2
           RETURNING id, name, email, role, role_code, avatar_url, active, token_version`,
          [passwordHash, userId]
        );
        const row = updated.rows[0];

        await recordStaffAudit({
          user: req.adminUser,
          action: 'team_user_password_rotated',
          entityType: 'admin_user',
          entityId: userId,
          details: { sessionsRevoked: true },
        });

        // If the admin rotated their own password, issue a fresh session token so they stay logged in
        if (req.adminUser && req.adminUser.id === userId) {
          const freshUser: PublicAdminUser = {
            id: Number(row.id),
            name: String(row.name),
            email: String(row.email),
            role: String(row.role),
            roleCode: normalizeStaffRole(row.role_code, row.role),
            avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
            active: Boolean(row.active),
            tokenVersion: Number(row.token_version) || 1,
          };
          const freshToken = signSessionToken(freshUser);
          res.setHeader('Set-Cookie', buildSessionCookieHeader(req, freshToken));
        }

        res.json({
          rotated: true,
          sessionsRevoked: true,
          message: 'Senha redefinida e sessões anteriores revogadas com sucesso.',
        });
      } catch (err: unknown) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Erro ao redefinir senha da conta.',
        });
      }
    }
  );

  app.post(
    '/api/admin/team/users/:id/revoke-sessions',
    requirePerm('team:manage'),
    async (req: StaffAuthenticatedRequest, res) => {
      try {
        const userId = Number(req.params.id);
        if (!Number.isInteger(userId) || userId <= 0) {
          res.status(400).json({ error: 'ID de usuário inválido.' });
          return;
        }
        const updated = await pool.query(
          `UPDATE admin_users
           SET token_version = COALESCE(token_version, 1) + 1
           WHERE id = $1
           RETURNING id`,
          [userId]
        );
        if (updated.rowCount === 0) {
          res.status(404).json({ error: 'Usuário não encontrado.' });
          return;
        }

        await recordStaffAudit({
          user: req.adminUser,
          action: 'team_user_sessions_revoked',
          entityType: 'admin_user',
          entityId: userId,
        });

        res.json({
          revoked: true,
          message: 'Todas as sessões ativas desta conta foram encerradas.',
        });
      } catch (err: unknown) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Erro ao revogar sessões.',
        });
      }
    }
  );

  app.post(
    '/api/admin/team/invites',
    requirePerm('team:manage'),
    async (req: StaffAuthenticatedRequest, res) => {
      try {
        const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 150) : '';
        const email =
          typeof req.body?.email === 'string'
            ? req.body.email.trim().toLowerCase().slice(0, 200)
            : '';
        const roleCode = normalizeStaffRole(
          typeof req.body?.roleCode === 'string' ? req.body.roleCode : 'vendedor'
        );

        if (!name || !email || !email.includes('@')) {
          res.status(400).json({ error: 'Informe nome e e-mail corporativo para gerar o convite.' });
          return;
        }

        const rawToken = crypto.randomBytes(24).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

        const inserted = await pool.query(
          `INSERT INTO staff_invites (name, email, role_code, token_hash, invited_by_id, invited_by_name, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, name, email, role_code, invited_by_name, expires_at, accepted_at, created_at`,
          [
            name,
            email,
            roleCode,
            tokenHash,
            req.adminUser?.id ?? null,
            req.adminUser?.name ?? null,
            expiresAt,
          ]
        );

        await recordStaffAudit({
          user: req.adminUser,
          action: 'team_invite_created',
          entityType: 'staff_invite',
          entityId: inserted.rows[0].id,
          details: { email, roleCode },
        });

        res.status(201).json({
          invite: {
            id: Number(inserted.rows[0].id),
            name: String(inserted.rows[0].name),
            email: String(inserted.rows[0].email),
            roleCode,
            invitedByName: inserted.rows[0].invited_by_name,
            expiresAt: String(inserted.rows[0].expires_at),
            acceptedAt: null,
            createdAt: String(inserted.rows[0].created_at),
          },
          inviteToken: rawToken,
          invitePath: `/login?convite=${rawToken}`,
        });
      } catch (err: unknown) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Erro ao gerar convite de equipe.',
        });
      }
    }
  );

  app.post('/api/auth/accept-invite', async (req, res) => {
    try {
      const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      if (!token || password.length < 8) {
        res.status(400).json({
          error: 'Informe um convite válido e uma senha com pelo menos 8 caracteres.',
        });
        return;
      }

      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const invRes = await pool.query(
        `SELECT id, name, email, role_code, expires_at, accepted_at
         FROM staff_invites
         WHERE token_hash = $1
         LIMIT 1`,
        [tokenHash]
      );
      const inv = invRes.rows[0];
      if (!inv || inv.accepted_at || new Date(inv.expires_at).getTime() < Date.now()) {
        res.status(400).json({ error: 'Convite inválido, já utilizado ou expirado.' });
        return;
      }

      const roleCode = normalizeStaffRole(inv.role_code);
      const roleLabel = STAFF_ROLE_META[roleCode].label;
      const passwordHash = hashPassword(password);

      const userRes = await pool.query(
        `INSERT INTO admin_users (name, email, password_hash, role, role_code, active, last_login_at)
         VALUES ($1, $2, $3, $4, $5, true, NOW())
         ON CONFLICT (email) DO UPDATE
           SET password_hash = EXCLUDED.password_hash,
               role = EXCLUDED.role,
               role_code = EXCLUDED.role_code,
               active = true,
               last_login_at = NOW()
         RETURNING id, name, email, role, role_code, avatar_url, active`,
        [inv.name, inv.email, passwordHash, roleLabel, roleCode]
      );

      await pool.query('UPDATE staff_invites SET accepted_at = NOW() WHERE id = $1', [inv.id]);

      const u = userRes.rows[0];
      const publicUser: PublicAdminUser = {
        id: Number(u.id),
        name: String(u.name),
        email: String(u.email),
        role: String(u.role),
        roleCode: normalizeStaffRole(u.role_code, u.role),
        avatarUrl: u.avatar_url ? String(u.avatar_url) : null,
        active: true,
      };

      const jwtToken = signSessionToken(publicUser);
      res.setHeader('Set-Cookie', buildSessionCookieHeader(req, jwtToken));
      res.json({ authenticated: true, user: publicUser, token: jwtToken });
    } catch (err: unknown) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Erro ao aceitar convite.',
      });
    }
  });

  // ==========================================================================
  // 2. HOJE — ACTIONABLE DAILY DESK
  // ==========================================================================

  app.get(
    '/api/admin/today',
    requirePerm('today:view'),
    async (req: StaffAuthenticatedRequest, res) => {
      try {
        const user = req.adminUser!;
        const canSeeAllSessions = hasPermission(user.roleCode, 'sessions:view_all');
        const canSeeSessions = hasPermission(user.roleCode, 'sessions:view_own');
        const todayIso = new Date().toISOString().slice(0, 10);

        const [sessionsRes, proposalsRes, visitsRes, tradeInsRes, tasksRes, vehiclesRes] =
          await Promise.all([
            canSeeSessions
              ? pool.query(
                  `SELECT
                     s.id, s.session_id, s.lead_name, s.lead_phone, s.origem, s.tag,
                     s.assigned_user_id, s.assigned_user_name, s.automation_mode, s.stage,
                     s.focused_vehicle_id, s.context_json, s.version, s.created_at, s.updated_at,
                     COALESCE(m_agg.message_count, 0)::int AS message_count,
                     m_last.content AS last_message,
                     m_last.sender AS last_sender
                   FROM chat_sessions s
                   LEFT JOIN (
                     SELECT session_id, COUNT(*)::int AS message_count FROM chat_messages GROUP BY session_id
                   ) m_agg ON m_agg.session_id = s.session_id
                   LEFT JOIN LATERAL (
                     SELECT content, sender FROM chat_messages WHERE session_id = s.session_id ORDER BY id DESC LIMIT 1
                   ) m_last ON true
                   WHERE ($1::boolean = true OR s.assigned_user_id IS NULL OR s.assigned_user_id = $2)
                     AND COALESCE(s.stage, 'Novo Lead') NOT IN ('Fechado', 'Perdido')
                     AND (m_last.sender = 'user' OR s.first_human_reply_at IS NULL)
                   ORDER BY s.updated_at DESC
                   LIMIT 20`,
                  [canSeeAllSessions, user.id]
                )
              : Promise.resolve({ rows: [] }),
            pool.query(
              `SELECT id, session_id, vehicle_id, values_json, calculated_totals_json, created_at
               FROM issued_documents
               WHERE doc_type = 'proposta_comercial'
               ORDER BY created_at DESC
               LIMIT 15`
            ),
            pool.query(
              `SELECT * FROM visits
               WHERE status IN ('solicitada', 'confirmada', 'consultada')
                 AND (scheduled_date IS NULL OR scheduled_date >= $1)
               ORDER BY COALESCE(scheduled_date, '9999-12-31') ASC, id DESC
               LIMIT 20`,
              [todayIso]
            ),
            pool.query(
              `SELECT * FROM trade_ins
               WHERE status IN ('aguardando_dados', 'aguardando_fotos', 'em_avaliacao')
               ORDER BY updated_at DESC
               LIMIT 20`
            ),
            pool.query(
              `SELECT * FROM staff_tasks
               WHERE status = 'pendente'
                 AND ($1::boolean = true OR assigned_user_id IS NULL OR assigned_user_id = $2)
               ORDER BY COALESCE(due_at, created_at) ASC
               LIMIT 25`,
              [canSeeAllSessions, user.id]
            ),
            pool.query<ApiVehicleRow>('SELECT * FROM vehicles ORDER BY id DESC'),
          ]);

        const vehicles = vehiclesRes.rows.map(mapDbVehicleToFrontend);
        const incompleteVehicles = vehicles
          .map((v) => {
            const q = analyzeVehicleDataQuality(v);
            const fipe = computeFipeMetrics(v);
            const issues: string[] = [];
            if ((!q.canonicalTransmission || q.hasTransmissionConflict) && q.conflictDetail) {
              issues.push(q.conflictDetail);
            }
            if (q.hasBrandModelMismatch) {
              issues.push('Divergência entre marca e modelo no cadastro');
            }
            if (v.fipePrice > 0 && !fipe.fipeReferenceMonth) {
              issues.push('FIPE sem mês de referência');
            } else if (!v.fipePrice || v.fipePrice <= 0) {
              issues.push('Sem valor FIPE cadastrado');
            }
            if (!v.imageUrl || v.imageUrl.trim() === '') {
              issues.push('Sem foto principal');
            }
            return {
              id: v.id,
              title: `${v.brand} ${v.model} (${v.year})`.trim(),
              status: v.status,
              issues,
            };
          })
          .filter((item) => item.issues.length > 0);

        const summary: TodayActionSummary = {
          awaitingReply: sessionsRes.rows.map((r) => ({
            id: Number(r.id),
            sessionId: String(r.session_id),
            leadName: r.lead_name ? String(r.lead_name) : null,
            leadPhone: r.lead_phone ? String(r.lead_phone) : null,
            origem: String(r.origem || '/chat'),
            tag: r.tag ? String(r.tag) : null,
            assignedUserId: r.assigned_user_id ? Number(r.assigned_user_id) : null,
            assignedUserName: r.assigned_user_name ? String(r.assigned_user_name) : null,
            automationMode: (r.automation_mode || 'ai_active') as SessionAutomationMode,
            stage: (r.stage || 'Novo Lead') as SessionCommercialStage,
            focusedVehicleId: r.focused_vehicle_id ? Number(r.focused_vehicle_id) : null,
            context: safeJsonParse<SessionNegotiationContext | null>(
              typeof r.context_json === 'string' ? r.context_json : null,
              null
            ),
            version: Number(r.version) || 1,
            createdAt: String(r.created_at),
            updatedAt: String(r.updated_at),
            messageCount: Number(r.message_count) || 0,
            lastMessage: r.last_message ? String(r.last_message) : null,
            lastSender: (r.last_sender || null) as 'user' | 'assistant' | null,
          })),
          proposalsToFollowUp: proposalsRes.rows.map((p) => {
            const vals = safeJsonParse<Record<string, unknown>>(p.values_json, {});
            const totals = safeJsonParse<{ principalBalance?: number }>(
              p.calculated_totals_json,
              {}
            );
            return {
              documentId: Number(p.id),
              sessionId: p.session_id ? String(p.session_id) : null,
              vehicleId: p.vehicle_id ? Number(p.vehicle_id) : null,
              customerName: String(vals.customer_name || 'Cliente'),
              vehicleTitle: String(vals.vehicle_title || 'Veículo'),
              principalBalance: Number(totals.principalBalance) || 0,
              createdAt: String(p.created_at),
            };
          }),
          visitsToday: visitsRes.rows.map(mapVisitRow),
          pendingTradeIns: tradeInsRes.rows.map(mapTradeInRow),
          pendingTasks: tasksRes.rows.map(mapTaskRow),
          incompleteVehicles,
        };

        res.setHeader('Cache-Control', 'no-store');
        res.json(summary);
      } catch (err: unknown) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Erro ao carregar resumo de Hoje.',
        });
      }
    }
  );

  // ==========================================================================
  // 3. ATENDIMENTOS — CLAIM WITH OPTIMISTIC LOCK, WORKFLOW, AUTOMATION, TASKS
  // ==========================================================================

  app.post(
    '/api/admin/chat-sessions/:sessionId/claim',
    requirePerm('sessions:claim'),
    async (req: StaffAuthenticatedRequest, res) => {
      try {
        const sessionId = String(req.params.sessionId || '').trim();
        const user = req.adminUser!;
        const expectedVersion =
          typeof req.body?.expectedVersion === 'number'
            ? req.body.expectedVersion
            : null;
        const forceReassign =
          req.body?.force === true &&
          hasPermission(user.roleCode, 'sessions:assign_others');

        const curRes = await pool.query(
          `SELECT id, session_id, assigned_user_id, assigned_user_name, automation_mode, stage, version
           FROM chat_sessions
           WHERE session_id = $1
           LIMIT 1`,
          [sessionId]
        );
        if (curRes.rowCount === 0) {
          res.status(404).json({ error: 'Atendimento não encontrado.' });
          return;
        }
        const cur = curRes.rows[0];
        const curVersion = Number(cur.version) || 1;

        if (
          !forceReassign &&
          cur.assigned_user_id &&
          Number(cur.assigned_user_id) !== user.id
        ) {
          res.status(409).json({
            error: `Este atendimento já foi assumido por ${cur.assigned_user_name || 'outro consultor'}.`,
            assignedUserId: Number(cur.assigned_user_id),
            assignedUserName: cur.assigned_user_name,
            version: curVersion,
          });
          return;
        }

        if (!forceReassign && expectedVersion !== null && expectedVersion !== curVersion) {
          res.status(409).json({
            error: 'O atendimento foi atualizado por outro usuário. Recarregue antes de assumir.',
            assignedUserId: cur.assigned_user_id ? Number(cur.assigned_user_id) : null,
            assignedUserName: cur.assigned_user_name || null,
            version: curVersion,
          });
          return;
        }

        const updateRes = await pool.query(
          `UPDATE chat_sessions
           SET assigned_user_id = $1,
               assigned_user_name = $2,
               assigned_at = NOW(),
               automation_mode = 'human_active',
               stage = CASE WHEN COALESCE(stage, 'Novo Lead') = 'Novo Lead' THEN 'Em Atendimento' ELSE stage END,
               version = COALESCE(version, 1) + 1,
               updated_at = NOW()
           WHERE session_id = $3
             AND ($4::boolean = true OR COALESCE(version, 1) = $5)
           RETURNING id, session_id, assigned_user_id, assigned_user_name, assigned_at, automation_mode, stage, version`,
          [user.id, user.name, sessionId, forceReassign, curVersion]
        );

        if (updateRes.rowCount === 0) {
          res.status(409).json({
            error: 'Outro membro da equipe assumiu este atendimento simultaneamente.',
          });
          return;
        }

        const updated = updateRes.rows[0];
        await recordStaffAudit({
          user,
          action: 'session_claimed',
          entityType: 'chat_session',
          entityId: sessionId,
          details: { automationMode: 'human_active', version: updated.version },
        });

        res.json({
          sessionId: String(updated.session_id),
          assignedUserId: Number(updated.assigned_user_id),
          assignedUserName: String(updated.assigned_user_name),
          assignedAt: String(updated.assigned_at),
          automationMode: String(updated.automation_mode),
          stage: String(updated.stage),
          version: Number(updated.version),
        });
      } catch (err: unknown) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Erro ao assumir atendimento.',
        });
      }
    }
  );

  app.patch(
    '/api/admin/chat-sessions/:sessionId/workflow',
    requirePerm('sessions:claim'),
    async (req: StaffAuthenticatedRequest, res) => {
      try {
        const sessionId = String(req.params.sessionId || '').trim();
        const user = req.adminUser!;
        const curRes = await pool.query(
          `SELECT id, assigned_user_id, assigned_user_name, automation_mode, stage, loss_reason, context_json, version
           FROM chat_sessions WHERE session_id = $1 LIMIT 1`,
          [sessionId]
        );
        if (curRes.rowCount === 0) {
          res.status(404).json({ error: 'Atendimento não encontrado.' });
          return;
        }
        const cur = curRes.rows[0];
        const canReassignOthers = hasPermission(user.roleCode, 'sessions:assign_others');

        let nextAssignedId: number | null = cur.assigned_user_id ? Number(cur.assigned_user_id) : null;
        let nextAssignedName: string | null = cur.assigned_user_name ? String(cur.assigned_user_name) : null;

        if (req.body?.assignedUserId !== undefined) {
          const requestedId =
            req.body.assignedUserId === null ? null : Number(req.body.assignedUserId);
          if (requestedId !== nextAssignedId) {
            if (!canReassignOthers && requestedId !== user.id) {
              res.status(403).json({
                error: 'Apenas gestores e administradores podem redistribuir atendimentos para outro vendedor.',
              });
              return;
            }
            if (requestedId === null) {
              nextAssignedId = null;
              nextAssignedName = null;
            } else {
              const targetRes = await pool.query(
                'SELECT id, name FROM admin_users WHERE id = $1 AND active = true LIMIT 1',
                [requestedId]
              );
              if (targetRes.rowCount === 0) {
                res.status(404).json({ error: 'Responsável informado não encontrado.' });
                return;
              }
              nextAssignedId = Number(targetRes.rows[0].id);
              nextAssignedName = String(targetRes.rows[0].name);
            }
          }
        }

        const validModes: SessionAutomationMode[] = ['ai_active', 'human_active', 'paused'];
        const nextAutomation: SessionAutomationMode = validModes.includes(req.body?.automationMode)
          ? req.body.automationMode
          : ((cur.automation_mode || 'ai_active') as SessionAutomationMode);

        const validStages: SessionCommercialStage[] = [
          'Novo Lead',
          'Em Atendimento',
          'Proposta',
          'Visita',
          'Fechado',
          'Perdido',
        ];
        const nextStage: SessionCommercialStage = validStages.includes(req.body?.stage)
          ? req.body.stage
          : ((cur.stage || 'Novo Lead') as SessionCommercialStage);

        const nextLossReason =
          nextStage === 'Perdido'
            ? typeof req.body?.lossReason === 'string'
              ? req.body.lossReason.trim().slice(0, 160) || null
              : cur.loss_reason
            : null;

        const curCtx = safeJsonParse<SessionNegotiationContext>(cur.context_json, {});
        const nextCtx: SessionNegotiationContext = {
          ...curCtx,
          ...(typeof req.body?.nextAction === 'string'
            ? { nextAction: req.body.nextAction.trim().slice(0, 200) || null }
            : {}),
        };

        const updatedRes = await pool.query(
          `UPDATE chat_sessions
           SET assigned_user_id = $1,
               assigned_user_name = $2,
               automation_mode = $3,
               stage = $4,
               loss_reason = $5,
               context_json = $6,
               version = COALESCE(version, 1) + 1,
               updated_at = NOW()
           WHERE session_id = $7
           RETURNING session_id, assigned_user_id, assigned_user_name, automation_mode, stage, loss_reason, context_json, version`,
          [
            nextAssignedId,
            nextAssignedName,
            nextAutomation,
            nextStage,
            nextLossReason,
            JSON.stringify(nextCtx),
            sessionId,
          ]
        );

        await recordStaffAudit({
          user,
          action: 'session_workflow_updated',
          entityType: 'chat_session',
          entityId: sessionId,
          details: {
            assignedUserId: nextAssignedId,
            automationMode: nextAutomation,
            stage: nextStage,
            lossReason: nextLossReason,
          },
        });

        const row = updatedRes.rows[0];
        res.json({
          sessionId: String(row.session_id),
          assignedUserId: row.assigned_user_id ? Number(row.assigned_user_id) : null,
          assignedUserName: row.assigned_user_name ? String(row.assigned_user_name) : null,
          automationMode: String(row.automation_mode),
          stage: String(row.stage),
          lossReason: row.loss_reason ? String(row.loss_reason) : null,
          context: safeJsonParse<SessionNegotiationContext>(row.context_json, {}),
          version: Number(row.version),
        });
      } catch (err: unknown) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Erro ao atualizar fluxo do atendimento.',
        });
      }
    }
  );

  // ==========================================================================
  // 4. TASKS / REMINDERS
  // ==========================================================================

  app.get(
    '/api/admin/tasks',
    requirePerm('today:view'),
    async (req: StaffAuthenticatedRequest, res) => {
      try {
        const user = req.adminUser!;
        const sessionId =
          typeof req.query?.sessionId === 'string' ? req.query.sessionId.trim() : null;
        const canSeeAll = hasPermission(user.roleCode, 'sessions:view_all');

        const result = await pool.query(
          `SELECT * FROM staff_tasks
           WHERE ($1::text IS NULL OR session_id = $1)
             AND ($2::boolean = true OR assigned_user_id IS NULL OR assigned_user_id = $3)
           ORDER BY
             CASE WHEN status = 'pendente' THEN 0 ELSE 1 END,
             COALESCE(due_at, created_at) ASC
           LIMIT 100`,
          [sessionId, canSeeAll, user.id]
        );
        res.json(result.rows.map(mapTaskRow));
      } catch (err: unknown) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Erro ao listar tarefas.',
        });
      }
    }
  );

  app.post(
    '/api/admin/tasks',
    requirePerm('today:view'),
    async (req: StaffAuthenticatedRequest, res) => {
      try {
        const user = req.adminUser!;
        const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 200) : '';
        if (!title) {
          res.status(400).json({ error: 'Informe o título do lembrete ou tarefa.' });
          return;
        }
        const sessionId =
          typeof req.body?.sessionId === 'string' && req.body.sessionId.trim()
            ? req.body.sessionId.trim().slice(0, 120)
            : null;
        const vehicleId =
          req.body?.vehicleId && Number.isFinite(Number(req.body.vehicleId))
            ? Number(req.body.vehicleId)
            : null;
        const dueAt =
          typeof req.body?.dueAt === 'string' && req.body.dueAt.trim()
            ? req.body.dueAt.trim()
            : null;
        const notes =
          typeof req.body?.notes === 'string' ? req.body.notes.trim().slice(0, 1000) : null;

        const inserted = await pool.query(
          `INSERT INTO staff_tasks (
             session_id, vehicle_id, assigned_user_id, assigned_user_name,
             title, notes, due_at, status, created_by_id, created_by_name
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'pendente', $3, $4)
           RETURNING *`,
          [sessionId, vehicleId, user.id, user.name, title, notes, dueAt]
        );

        await recordStaffAudit({
          user,
          action: 'task_created',
          entityType: 'staff_task',
          entityId: inserted.rows[0].id,
          details: { title, sessionId },
        });

        res.status(201).json(mapTaskRow(inserted.rows[0]));
      } catch (err: unknown) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Erro ao criar tarefa.',
        });
      }
    }
  );

  app.patch(
    '/api/admin/tasks/:id',
    requirePerm('today:view'),
    async (req: StaffAuthenticatedRequest, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
          res.status(400).json({ error: 'ID de tarefa inválido.' });
          return;
        }
        const status = req.body?.status;
        if (!['pendente', 'concluida', 'cancelada'].includes(status)) {
          res.status(400).json({ error: 'Status de tarefa inválido.' });
          return;
        }
        const updated = await pool.query(
          `UPDATE staff_tasks
           SET status = $1,
               completed_at = CASE WHEN $1 = 'concluida' THEN NOW() ELSE NULL END
           WHERE id = $2
           RETURNING *`,
          [status, id]
        );
        if (updated.rowCount === 0) {
          res.status(404).json({ error: 'Tarefa não encontrada.' });
          return;
        }
        res.json(mapTaskRow(updated.rows[0]));
      } catch (err: unknown) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Erro ao atualizar tarefa.',
        });
      }
    }
  );

  // ==========================================================================
  // 5. VISITS & TRADE-INS (AGENDA E TROCAS)
  // ==========================================================================

  app.get(
    '/api/admin/visits',
    requirePerm('visits:view'),
    async (_req: StaffAuthenticatedRequest, res) => {
      try {
        const result = await pool.query(
          `SELECT * FROM visits
           ORDER BY COALESCE(scheduled_date, '9999-12-31') ASC, updated_at DESC
           LIMIT 150`
        );
        res.json(result.rows.map(mapVisitRow));
      } catch (err: unknown) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Erro ao listar agenda de visitas.',
        });
      }
    }
  );

  app.post(
    '/api/admin/visits',
    requirePerm('visits:manage'),
    async (req: StaffAuthenticatedRequest, res) => {
      try {
        const user = req.adminUser!;
        const validStatuses: VisitStatus[] = [
          'consultada',
          'solicitada',
          'confirmada',
          'realizada',
          'cancelada',
        ];
        const status: VisitStatus = validStatuses.includes(req.body?.status)
          ? req.body.status
          : 'solicitada';
        const customerName =
          typeof req.body?.customerName === 'string'
            ? req.body.customerName.trim().slice(0, 150)
            : null;
        const customerPhone =
          typeof req.body?.customerPhone === 'string'
            ? req.body.customerPhone.trim().slice(0, 60)
            : null;
        const vehicleId =
          req.body?.vehicleId && Number.isFinite(Number(req.body.vehicleId))
            ? Number(req.body.vehicleId)
            : null;
        const vehicleLabel =
          typeof req.body?.vehicleLabel === 'string'
            ? req.body.vehicleLabel.trim().slice(0, 200)
            : null;
        const scheduledDate =
          typeof req.body?.scheduledDate === 'string'
            ? req.body.scheduledDate.trim().slice(0, 20)
            : null;
        const scheduledTime =
          typeof req.body?.scheduledTime === 'string'
            ? req.body.scheduledTime.trim().slice(0, 20)
            : null;
        const sessionId =
          typeof req.body?.sessionId === 'string' && req.body.sessionId.trim()
            ? req.body.sessionId.trim().slice(0, 120)
            : null;
        const notes =
          typeof req.body?.notes === 'string' ? req.body.notes.trim().slice(0, 1000) : null;

        const inserted = await pool.query(
          `INSERT INTO visits (
             session_id, vehicle_id, vehicle_label, customer_name, customer_phone,
             status, scheduled_date, scheduled_time, assigned_user_id, assigned_user_name,
             notes, created_by_name, updated_by_name
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $10, $10)
           RETURNING *`,
          [
            sessionId,
            vehicleId,
            vehicleLabel,
            customerName,
            customerPhone,
            status,
            scheduledDate,
            scheduledTime,
            user.id,
            user.name,
            notes,
          ]
        );

        await recordStaffAudit({
          user,
          action: 'visit_created',
          entityType: 'visit',
          entityId: inserted.rows[0].id,
          details: { status, scheduledDate, scheduledTime, vehicleLabel },
        });

        res.status(201).json(mapVisitRow(inserted.rows[0]));
      } catch (err: unknown) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Erro ao registrar visita.',
        });
      }
    }
  );

  app.patch(
    '/api/admin/visits/:id',
    requirePerm('visits:manage'),
    async (req: StaffAuthenticatedRequest, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
          res.status(400).json({ error: 'ID de visita inválido.' });
          return;
        }
        const curRes = await pool.query('SELECT * FROM visits WHERE id = $1 LIMIT 1', [id]);
        if (curRes.rowCount === 0) {
          res.status(404).json({ error: 'Visita não encontrada.' });
          return;
        }
        const cur = curRes.rows[0];
        const validStatuses: VisitStatus[] = [
          'consultada',
          'solicitada',
          'confirmada',
          'realizada',
          'cancelada',
        ];
        const nextStatus: VisitStatus = validStatuses.includes(req.body?.status)
          ? req.body.status
          : cur.status;
        const nextDate =
          typeof req.body?.scheduledDate === 'string'
            ? req.body.scheduledDate.trim().slice(0, 20) || null
            : cur.scheduled_date;
        const nextTime =
          typeof req.body?.scheduledTime === 'string'
            ? req.body.scheduledTime.trim().slice(0, 20) || null
            : cur.scheduled_time;
        const nextNotes =
          typeof req.body?.notes === 'string'
            ? req.body.notes.trim().slice(0, 1000)
            : cur.notes;

        const updated = await pool.query(
          `UPDATE visits
           SET status = $1,
               scheduled_date = $2,
               scheduled_time = $3,
               notes = $4,
               updated_by_name = $5,
               updated_at = NOW()
           WHERE id = $6
           RETURNING *`,
          [nextStatus, nextDate, nextTime, nextNotes, req.adminUser?.name ?? null, id]
        );

        await recordStaffAudit({
          user: req.adminUser,
          action: 'visit_updated',
          entityType: 'visit',
          entityId: id,
          details: { status: nextStatus, scheduledDate: nextDate, scheduledTime: nextTime },
        });

        res.json(mapVisitRow(updated.rows[0]));
      } catch (err: unknown) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Erro ao atualizar visita.',
        });
      }
    }
  );

  app.get(
    '/api/admin/trade-ins',
    requirePerm('trade_ins:view'),
    async (_req: StaffAuthenticatedRequest, res) => {
      try {
        const result = await pool.query(
          'SELECT * FROM trade_ins ORDER BY updated_at DESC LIMIT 150'
        );
        res.json(result.rows.map(mapTradeInRow));
      } catch (err: unknown) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Erro ao listar trocas.',
        });
      }
    }
  );

  app.post(
    '/api/admin/trade-ins',
    requirePerm('trade_ins:manage'),
    async (req: StaffAuthenticatedRequest, res) => {
      try {
        const brandModel =
          typeof req.body?.brandModel === 'string'
            ? req.body.brandModel.trim().slice(0, 160)
            : '';
        if (!brandModel) {
          res.status(400).json({ error: 'Informe a marca e modelo do veículo na troca.' });
          return;
        }

        const inserted = await pool.query(
          `INSERT INTO trade_ins (
             session_id, target_vehicle_id, customer_name, customer_phone,
             brand_model, year_text, version_text, transmission, km, color, plate,
             condition_notes, photos_json, pending_items_json, status
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           RETURNING *`,
          [
            typeof req.body?.sessionId === 'string' ? req.body.sessionId.trim() || null : null,
            req.body?.targetVehicleId ? Number(req.body.targetVehicleId) : null,
            typeof req.body?.customerName === 'string' ? req.body.customerName.trim().slice(0, 150) : null,
            typeof req.body?.customerPhone === 'string' ? req.body.customerPhone.trim().slice(0, 60) : null,
            brandModel,
            typeof req.body?.yearText === 'string' ? req.body.yearText.trim().slice(0, 20) : null,
            typeof req.body?.versionText === 'string' ? req.body.versionText.trim().slice(0, 120) : null,
            typeof req.body?.transmission === 'string' ? req.body.transmission.trim().slice(0, 40) : null,
            req.body?.km !== undefined && req.body.km !== '' ? Number(req.body.km) : null,
            typeof req.body?.color === 'string' ? req.body.color.trim().slice(0, 40) : null,
            typeof req.body?.plate === 'string' ? req.body.plate.trim().slice(0, 20) : null,
            typeof req.body?.conditionNotes === 'string' ? req.body.conditionNotes.trim().slice(0, 1000) : null,
            JSON.stringify(Array.isArray(req.body?.photos) ? req.body.photos : []),
            JSON.stringify(
              Array.isArray(req.body?.pendingItems)
                ? req.body.pendingItems
                : ['Fotos externas e internas', 'Estado de pneus e pintura', 'Pendências documentais']
            ),
            typeof req.body?.status === 'string' ? req.body.status : 'aguardando_fotos',
          ]
        );

        await recordStaffAudit({
          user: req.adminUser,
          action: 'trade_in_created',
          entityType: 'trade_in',
          entityId: inserted.rows[0].id,
          details: { brandModel },
        });

        res.status(201).json(mapTradeInRow(inserted.rows[0]));
      } catch (err: unknown) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Erro ao registrar troca.',
        });
      }
    }
  );

  app.patch(
    '/api/admin/trade-ins/:id',
    requirePerm('trade_ins:manage'),
    async (req: StaffAuthenticatedRequest, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
          res.status(400).json({ error: 'ID de troca inválido.' });
          return;
        }
        const curRes = await pool.query('SELECT * FROM trade_ins WHERE id = $1 LIMIT 1', [id]);
        if (curRes.rowCount === 0) {
          res.status(404).json({ error: 'Registro de troca não encontrado.' });
          return;
        }
        const cur = curRes.rows[0];
        const user = req.adminUser!;

        const approvedValueProvided =
          req.body?.approvedValue !== undefined && req.body.approvedValue !== null && req.body.approvedValue !== '';
        if (
          approvedValueProvided &&
          !hasPermission(user.roleCode, 'trade_ins:approve_value')
        ) {
          res.status(403).json({
            error: 'Apenas gestores e administradores podem aprovar o valor final da troca.',
          });
          return;
        }

        const nextStatus =
          typeof req.body?.status === 'string' ? req.body.status : cur.status;
        const nextApprovedValue = approvedValueProvided
          ? Number(req.body.approvedValue)
          : cur.approved_value;
        const nextCondition =
          typeof req.body?.conditionNotes === 'string'
            ? req.body.conditionNotes.trim().slice(0, 1000)
            : cur.condition_notes;
        const nextPending = Array.isArray(req.body?.pendingItems)
          ? JSON.stringify(req.body.pendingItems)
          : cur.pending_items_json;

        const updated = await pool.query(
          `UPDATE trade_ins
           SET status = $1,
               approved_value = $2,
               condition_notes = $3,
               pending_items_json = $4,
               evaluated_by_name = CASE WHEN $5::boolean THEN $6 ELSE evaluated_by_name END,
               evaluated_at = CASE WHEN $5::boolean THEN NOW() ELSE evaluated_at END,
               updated_at = NOW()
           WHERE id = $7
           RETURNING *`,
          [
            nextStatus,
            nextApprovedValue,
            nextCondition,
            nextPending,
            approvedValueProvided,
            user.name,
            id,
          ]
        );

        await recordStaffAudit({
          user,
          action: 'trade_in_updated',
          entityType: 'trade_in',
          entityId: id,
          details: { status: nextStatus, approvedValue: nextApprovedValue },
        });

        res.json(mapTradeInRow(updated.rows[0]));
      } catch (err: unknown) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Erro ao atualizar troca.',
        });
      }
    }
  );

  // ==========================================================================
  // 6. DIVULGAÇÃO — ZERO-TOKEN DRAFTS + OPTIONAL AI POLISH
  // ==========================================================================

  app.get(
    '/api/admin/marketing/drafts',
    requirePerm('marketing:view'),
    async (_req: StaffAuthenticatedRequest, res) => {
      try {
        const result = await pool.query(
          'SELECT * FROM marketing_drafts ORDER BY updated_at DESC LIMIT 100'
        );
        res.json(result.rows.map(mapMarketingDraftRow));
      } catch (err: unknown) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Erro ao listar rascunhos de divulgação.',
        });
      }
    }
  );

  app.post(
    '/api/admin/marketing/drafts',
    requirePerm('marketing:create'),
    async (req: StaffAuthenticatedRequest, res) => {
      try {
        const vehicleId = Number(req.body?.vehicleId);
        const format = String(req.body?.format || 'feed') as MarketingFormat;
        if (!Number.isInteger(vehicleId) || vehicleId <= 0) {
          res.status(400).json({ error: 'Selecione um veículo válido do estoque.' });
          return;
        }
        if (!['feed', 'stories', 'classificado', 'carrossel'].includes(format)) {
          res.status(400).json({ error: 'Formato de divulgação inválido.' });
          return;
        }

        const vehRes = await pool.query<ApiVehicleRow>(
          'SELECT * FROM vehicles WHERE id = $1 LIMIT 1',
          [vehicleId]
        );
        if (vehRes.rowCount === 0) {
          res.status(404).json({ error: 'Veículo não encontrado no estoque.' });
          return;
        }
        const liveVehicle = mapDbVehicleToFrontend(vehRes.rows[0]);

        const title =
          typeof req.body?.title === 'string' && req.body.title.trim()
            ? req.body.title.trim().slice(0, 200)
            : `${liveVehicle.brand} ${liveVehicle.model}`;
        const caption =
          typeof req.body?.caption === 'string' ? req.body.caption.slice(0, 8000) : '';
        const selectedPhotoUrl =
          typeof req.body?.selectedPhotoUrl === 'string'
            ? req.body.selectedPhotoUrl.trim()
            : liveVehicle.imageUrl;
        const selectedPhotos = Array.isArray(req.body?.selectedPhotos)
          ? req.body.selectedPhotos
          : [selectedPhotoUrl].filter(Boolean);
        const templateConfig =
          req.body?.templateConfig && typeof req.body.templateConfig === 'object'
            ? req.body.templateConfig
            : {};
        const publicSheetUrl =
          typeof req.body?.publicSheetUrl === 'string'
            ? req.body.publicSheetUrl.trim().slice(0, 400)
            : `/veiculo/${vehicleId}?origem=divulgacao_${format}`;
        const trackingSource =
          typeof req.body?.trackingSource === 'string'
            ? req.body.trackingSource.trim().slice(0, 80)
            : `divulgacao_${format}`;

        const inserted = await pool.query(
          `INSERT INTO marketing_drafts (
             vehicle_id, format, title, caption, selected_photo_url, selected_photos_json,
             template_config_json, snapshot_price, snapshot_status, public_sheet_url, tracking_source,
             created_by_id, created_by_name, updated_by_name
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
           RETURNING *`,
          [
            vehicleId,
            format,
            title,
            caption,
            selectedPhotoUrl,
            JSON.stringify(selectedPhotos),
            JSON.stringify(templateConfig),
            liveVehicle.price,
            liveVehicle.status,
            publicSheetUrl,
            trackingSource,
            req.adminUser?.id ?? null,
            req.adminUser?.name ?? null,
          ]
        );

        await recordStaffAudit({
          user: req.adminUser,
          action: 'marketing_draft_saved',
          entityType: 'marketing_draft',
          entityId: inserted.rows[0].id,
          details: { vehicleId, format, snapshotPrice: liveVehicle.price },
        });

        res.status(201).json(mapMarketingDraftRow(inserted.rows[0]));
      } catch (err: unknown) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Erro ao salvar rascunho de divulgação.',
        });
      }
    }
  );

  app.patch(
    '/api/admin/marketing/drafts/:id',
    requirePerm('marketing:create'),
    async (req: StaffAuthenticatedRequest, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
          res.status(400).json({ error: 'ID de rascunho inválido.' });
          return;
        }
        const curRes = await pool.query(
          'SELECT * FROM marketing_drafts WHERE id = $1 LIMIT 1',
          [id]
        );
        if (curRes.rowCount === 0) {
          res.status(404).json({ error: 'Rascunho não encontrado.' });
          return;
        }
        const cur = curRes.rows[0];
        let nextPrice = Number(cur.snapshot_price);
        let nextStatus = String(cur.snapshot_status);

        if (req.body?.syncLiveSnapshot === true) {
          const vRes = await pool.query<ApiVehicleRow>(
            'SELECT * FROM vehicles WHERE id = $1 LIMIT 1',
            [cur.vehicle_id]
          );
          if (vRes.rowCount && vRes.rows[0]) {
            const liveV = mapDbVehicleToFrontend(vRes.rows[0]);
            nextPrice = liveV.price;
            nextStatus = liveV.status;
          }
        }

        const updated = await pool.query(
          `UPDATE marketing_drafts
           SET title = $1,
               caption = $2,
               selected_photo_url = $3,
               snapshot_price = $4,
               snapshot_status = $5,
               updated_by_name = $6,
               updated_at = NOW()
           WHERE id = $7
           RETURNING *`,
          [
            typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 200) : cur.title,
            typeof req.body?.caption === 'string' ? req.body.caption.slice(0, 8000) : cur.caption,
            typeof req.body?.selectedPhotoUrl === 'string'
              ? req.body.selectedPhotoUrl.trim()
              : cur.selected_photo_url,
            nextPrice,
            nextStatus,
            req.adminUser?.name ?? null,
            id,
          ]
        );

        res.json(mapMarketingDraftRow(updated.rows[0]));
      } catch (err: unknown) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Erro ao atualizar rascunho.',
        });
      }
    }
  );

  app.delete(
    '/api/admin/marketing/drafts/:id',
    requirePerm('marketing:create'),
    async (req: StaffAuthenticatedRequest, res) => {
      try {
        const id = Number(req.params.id);
        await pool.query('DELETE FROM marketing_drafts WHERE id = $1', [id]);
        res.json({ deleted: true });
      } catch (err: unknown) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Erro ao excluir rascunho.',
        });
      }
    }
  );

  app.post(
    '/api/admin/marketing/polish-caption',
    requirePerm('marketing:create'),
    async (req: StaffAuthenticatedRequest, res) => {
      try {
        const vehicleId = Number(req.body?.vehicleId);
        const baseCaption = typeof req.body?.baseCaption === 'string' ? req.body.baseCaption : '';
        const tone = typeof req.body?.tone === 'string' ? req.body.tone : 'direto e consultivo';
        const format = (req.body?.format || 'feed') as MarketingFormat;

        if (!deps.polishMarketingCaptionWithAi) {
          res.status(503).json({
            error: 'Refino opcional com IA indisponível no momento. Use a legenda gerada pelo modelo.',
          });
          return;
        }
        const vRes = await pool.query<ApiVehicleRow>(
          'SELECT * FROM vehicles WHERE id = $1 LIMIT 1',
          [vehicleId]
        );
        if (vRes.rowCount === 0) {
          res.status(404).json({ error: 'Veículo não encontrado.' });
          return;
        }
        const vehicle = mapDbVehicleToFrontend(vRes.rows[0]);
        const polished = await deps.polishMarketingCaptionWithAi({
          vehicle,
          baseCaption,
          tone,
          format,
        });
        if (!polished) {
          res.status(503).json({
            error: 'Provedor de IA indisponível. A legenda determinística permanece pronta para uso.',
          });
          return;
        }
        res.json({ caption: polished });
      } catch (err: unknown) {
        res.status(503).json({
          error:
            err instanceof Error
              ? err.message
              : 'IA temporariamente indisponível. Continue com a legenda do template.',
        });
      }
    }
  );

  // ==========================================================================
  // 7. DOCUMENTOS — TEMPLATES LIBRARY, ZERO-TOKEN EMISSION & REAL PDF DOWNLOAD
  // ==========================================================================

  app.get(
    '/api/admin/document-templates',
    requirePerm('documents:view'),
    async (req: StaffAuthenticatedRequest, res) => {
      try {
        const user = req.adminUser!;
        const includeAll =
          req.query?.includeAll === 'true' &&
          hasPermission(user.roleCode, 'documents:manage_templates');

        const result = await pool.query(
          `SELECT * FROM document_templates
           ${includeAll ? '' : "WHERE status = 'ativo'"}
           ORDER BY slug ASC, version DESC`
        );

        const templates = result.rows
          .map(mapTemplateRow)
          .filter((tpl) => includeAll || canEmitTemplateForRole(user.roleCode, tpl.allowedRoles));

        res.setHeader('Cache-Control', 'no-store');
        res.json(templates);
      } catch (err: unknown) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Erro ao listar modelos de documentos.',
        });
      }
    }
  );

  app.post(
    '/api/admin/document-templates',
    requirePerm('documents:manage_templates'),
    async (req: StaffAuthenticatedRequest, res) => {
      try {
        const slug = String(req.body?.slug || '')
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9-_]/g, '-')
          .slice(0, 80);
        const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 180) : '';
        const docType = String(req.body?.docType || 'proposta_comercial') as DocumentTypeSlug;
        const status = ['ativo', 'rascunho', 'arquivado'].includes(req.body?.status)
          ? req.body.status
          : 'rascunho';
        const isExampleTemplate = Boolean(req.body?.isExampleTemplate);
        const allowedRoles: StaffRole[] = Array.isArray(req.body?.allowedRoles)
          ? req.body.allowedRoles
          : ['administrador'];
        const fieldsSchema: DocumentFieldSchema[] = Array.isArray(req.body?.fieldsSchema)
          ? req.body.fieldsSchema
          : [];
        const bodyTemplate =
          typeof req.body?.bodyTemplate === 'string' ? req.body.bodyTemplate.trim() : '';

        if (!slug || !name || !bodyTemplate) {
          res.status(400).json({ error: 'Informe identificador, nome e texto-base do modelo.' });
          return;
        }

        // Preserve previous versions: automatically increment version number for same slug
        const maxVerRes = await pool.query<{ max_ver: number }>(
          'SELECT COALESCE(MAX(version), 0)::int AS max_ver FROM document_templates WHERE slug = $1',
          [slug]
        );
        const nextVersion = (Number(maxVerRes.rows[0]?.max_ver) || 0) + 1;

        if (status === 'ativo') {
          await pool.query(
            `UPDATE document_templates SET status = 'arquivado', updated_at = NOW()
             WHERE slug = $1 AND status = 'ativo'`,
            [slug]
          );
        }

        const inserted = await pool.query(
          `INSERT INTO document_templates (
             slug, name, doc_type, version, status, is_example_template,
             allowed_roles_json, fields_schema_json, conditional_rules_json, body_template, created_by_name
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '[]', $9, $10)
           RETURNING *`,
          [
            slug,
            name,
            docType,
            nextVersion,
            status,
            isExampleTemplate,
            JSON.stringify(allowedRoles),
            JSON.stringify(fieldsSchema),
            bodyTemplate,
            req.adminUser?.name ?? null,
          ]
        );

        await recordStaffAudit({
          user: req.adminUser,
          action: 'document_template_version_created',
          entityType: 'document_template',
          entityId: inserted.rows[0].id,
          details: { slug, version: nextVersion, status },
        });

        res.status(201).json(mapTemplateRow(inserted.rows[0]));
      } catch (err: unknown) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Erro ao criar versão do modelo.',
        });
      }
    }
  );

  app.patch(
    '/api/admin/document-templates/:id/status',
    requirePerm('documents:manage_templates'),
    async (req: StaffAuthenticatedRequest, res) => {
      try {
        const id = Number(req.params.id);
        const status = req.body?.status;
        if (!['ativo', 'rascunho', 'arquivado'].includes(status)) {
          res.status(400).json({ error: 'Status de modelo inválido.' });
          return;
        }
        const curRes = await pool.query(
          'SELECT * FROM document_templates WHERE id = $1 LIMIT 1',
          [id]
        );
        if (curRes.rowCount === 0) {
          res.status(404).json({ error: 'Modelo não encontrado.' });
          return;
        }
        const slug = String(curRes.rows[0].slug);
        if (status === 'ativo') {
          await pool.query(
            `UPDATE document_templates SET status = 'arquivado', updated_at = NOW()
             WHERE slug = $1 AND id <> $2 AND status = 'ativo'`,
            [slug, id]
          );
        }
        const updated = await pool.query(
          `UPDATE document_templates
           SET status = $1,
               is_example_template = CASE WHEN $2::boolean IS NOT NULL THEN $2 ELSE is_example_template END,
               updated_at = NOW()
           WHERE id = $3
           RETURNING *`,
          [
            status,
            typeof req.body?.isExampleTemplate === 'boolean'
              ? req.body.isExampleTemplate
              : null,
            id,
          ]
        );

        await recordStaffAudit({
          user: req.adminUser,
          action: 'document_template_status_changed',
          entityType: 'document_template',
          entityId: id,
          details: { slug, status },
        });

        res.json(mapTemplateRow(updated.rows[0]));
      } catch (err: unknown) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Erro ao atualizar status do modelo.',
        });
      }
    }
  );

  app.get(
    '/api/admin/documents',
    requirePerm('documents:view'),
    async (req: StaffAuthenticatedRequest, res) => {
      try {
        const sessionId =
          typeof req.query?.sessionId === 'string' ? req.query.sessionId.trim() : null;
        const vehicleId =
          req.query?.vehicleId && Number.isFinite(Number(req.query.vehicleId))
            ? Number(req.query.vehicleId)
            : null;

        const result = await pool.query(
          `SELECT * FROM issued_documents
           WHERE ($1::text IS NULL OR session_id = $1)
             AND ($2::int IS NULL OR vehicle_id = $2)
           ORDER BY created_at DESC
           LIMIT 120`,
          [sessionId, vehicleId]
        );
        res.setHeader('Cache-Control', 'no-store');
        res.json(result.rows.map(mapIssuedDocRow));
      } catch (err: unknown) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Erro ao listar documentos emitidos.',
        });
      }
    }
  );

  app.post(
    '/api/admin/documents',
    requirePerm('documents:emit_commercial'),
    async (req: StaffAuthenticatedRequest, res) => {
      try {
        const user = req.adminUser!;
        const idempotencyKey =
          typeof req.body?.idempotencyKey === 'string' && req.body.idempotencyKey.trim()
            ? req.body.idempotencyKey.trim().slice(0, 120)
            : null;

        // Idempotency protection: prevent duplicate emissions on double-click / network retry
        if (idempotencyKey) {
          const existing = await pool.query(
            'SELECT * FROM issued_documents WHERE idempotency_key = $1 LIMIT 1',
            [idempotencyKey]
          );
          if (existing.rowCount && existing.rows[0]) {
            res.status(200).json({
              document: mapIssuedDocRow(existing.rows[0]),
              deduplicated: true,
            });
            return;
          }
        }

        const templateId = Number(req.body?.templateId);
        if (!Number.isInteger(templateId) || templateId <= 0) {
          res.status(400).json({ error: 'Selecione um modelo ativo para emissão.' });
          return;
        }

        const tplRes = await pool.query(
          'SELECT * FROM document_templates WHERE id = $1 LIMIT 1',
          [templateId]
        );
        if (tplRes.rowCount === 0) {
          res.status(404).json({ error: 'Modelo de documento não encontrado.' });
          return;
        }
        const template = mapTemplateRow(tplRes.rows[0]);
        if (template.status !== 'ativo') {
          res.status(400).json({
            error: 'Apenas modelos ativos podem ser emitidos. Ative a versão no Admin.',
          });
          return;
        }
        if (!canEmitTemplateForRole(user.roleCode, template.allowedRoles)) {
          res.status(403).json({
            error: 'Seu perfil não possui permissão para emitir este tipo de documento.',
          });
          return;
        }

        const values =
          req.body?.values && typeof req.body.values === 'object'
            ? (req.body.values as Record<string, string | number | boolean | null>)
            : {};

        const missing = getMissingRequiredFields(template.fieldsSchema, values);
        if (missing.length > 0) {
          res.status(400).json({
            error: `Preencha os campos obrigatórios: ${missing.map((f) => f.label).join(', ')}.`,
            missingFields: missing.map((f) => f.key),
          });
          return;
        }

        // Snapshot official persisted dealership config at emission time (immutable!)
        const { config: dealership } = await getPersistedDealershipConfig();

        const vehicleId =
          req.body?.vehicleId && Number.isFinite(Number(req.body.vehicleId))
            ? Number(req.body.vehicleId)
            : null;
        let vehicleSnapshot: Partial<Vehicle> | null = null;
        if (vehicleId) {
          const vRes = await pool.query<ApiVehicleRow>(
            'SELECT * FROM vehicles WHERE id = $1 LIMIT 1',
            [vehicleId]
          );
          if (vRes.rowCount && vRes.rows[0]) {
            const v = mapDbVehicleToFrontend(vRes.rows[0]);
            vehicleSnapshot = {
              id: v.id,
              brand: v.brand,
              model: v.model,
              version: v.version,
              year: v.year,
              km: v.km,
              price: v.price,
              plate: v.plate,
              transmission: v.transmission,
              status: v.status,
            };
          }
        }

        const totals = computeDocumentFinancials(values, dealership);
        const renderedText = renderDocumentPreviewText({
          template,
          dealership,
          values,
          totals,
          issuedByName: user.name,
        });

        const sessionId =
          typeof req.body?.sessionId === 'string' && req.body.sessionId.trim()
            ? req.body.sessionId.trim().slice(0, 120)
            : null;
        const leadId =
          req.body?.leadId && Number.isFinite(Number(req.body.leadId))
            ? Number(req.body.leadId)
            : null;
        const supersedesDocumentId =
          req.body?.supersedesDocumentId && Number.isFinite(Number(req.body.supersedesDocumentId))
            ? Number(req.body.supersedesDocumentId)
            : null;

        const inserted = await pool.query(
          `INSERT INTO issued_documents (
             idempotency_key, template_id, template_slug, template_name, template_version, doc_type,
             session_id, lead_id, vehicle_id, supersedes_document_id,
             issued_by_id, issued_by_name, dealership_snapshot_json, vehicle_snapshot_json,
             values_json, calculated_totals_json, rendered_text
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
           RETURNING *`,
          [
            idempotencyKey,
            template.id,
            template.slug,
            template.name,
            template.version,
            template.docType,
            sessionId,
            leadId,
            vehicleId,
            supersedesDocumentId,
            user.id,
            user.name,
            JSON.stringify(dealership),
            vehicleSnapshot ? JSON.stringify(vehicleSnapshot) : null,
            JSON.stringify(values),
            JSON.stringify(totals),
            renderedText,
          ]
        );

        // If proposal emitted for a session, advance session stage to 'Proposta' when appropriate
        if (sessionId && template.docType === 'proposta_comercial') {
          await pool.query(
            `UPDATE chat_sessions
             SET stage = CASE WHEN COALESCE(stage, 'Novo Lead') IN ('Novo Lead', 'Em Atendimento') THEN 'Proposta' ELSE stage END,
                 updated_at = NOW()
             WHERE session_id = $1`,
            [sessionId]
          );
        }

        const doc = mapIssuedDocRow(inserted.rows[0]);
        await recordStaffAudit({
          user,
          action: 'document_issued',
          entityType: 'issued_document',
          entityId: doc.id,
          details: {
            templateSlug: template.slug,
            templateVersion: template.version,
            sessionId,
            vehicleId,
            principalBalance: totals.principalBalance,
          },
        });

        res.status(201).json({ document: doc, deduplicated: false });
      } catch (err: unknown) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Erro ao emitir documento.',
        });
      }
    }
  );

  // RBAC-protected PDF binary stream built strictly from the immutable issued_documents snapshot
  app.get(
    '/api/admin/documents/:id/pdf',
    requirePerm('documents:view'),
    async (req: StaffAuthenticatedRequest, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
          res.status(400).json({ error: 'ID de documento inválido.' });
          return;
        }
        const docRes = await pool.query(
          'SELECT * FROM issued_documents WHERE id = $1 LIMIT 1',
          [id]
        );
        if (docRes.rowCount === 0) {
          res.status(404).json({ error: 'Documento emitido não encontrado.' });
          return;
        }
        const doc = mapIssuedDocRow(docRes.rows[0]);
        const pdfBytes = buildPdfBytesFromIssuedDocument(doc);
        const safeFilename = `${doc.templateSlug}-${String(doc.id).padStart(5, '0')}.pdf`;

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);
        res.setHeader('Cache-Control', 'no-store');
        res.send(Buffer.from(pdfBytes));
      } catch (err: unknown) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Erro ao gerar PDF do documento.',
        });
      }
    }
  );

  // ==========================================================================
  // 8. GESTÃO — REAL DB METRICS & REACTIVATION REVIEW QUEUE
  // ==========================================================================

  app.get(
    '/api/admin/management/metrics',
    requirePerm('management:view'),
    async (_req: StaffAuthenticatedRequest, res) => {
      try {
        const [sessionsRes, docsRes, visitsRes, vehiclesRes] = await Promise.all([
          pool.query(
            `SELECT
               s.session_id, s.lead_name, s.lead_phone, s.assigned_user_id, s.assigned_user_name,
               s.stage, s.loss_reason, s.focused_vehicle_id, s.created_at, s.updated_at,
               s.first_human_reply_at,
               (SELECT sender FROM chat_messages WHERE session_id = s.session_id ORDER BY id DESC LIMIT 1) AS last_sender
             FROM chat_sessions s
             ORDER BY s.updated_at DESC
             LIMIT 300`
          ),
          pool.query(
            `SELECT id, doc_type, session_id, vehicle_id, values_json, created_at
             FROM issued_documents
             ORDER BY created_at DESC
             LIMIT 300`
          ),
          pool.query('SELECT id, session_id, vehicle_id, status FROM visits LIMIT 300'),
          pool.query<ApiVehicleRow>('SELECT * FROM vehicles ORDER BY id DESC'),
        ]);

        const sessions = sessionsRes.rows;
        const vehicles = vehiclesRes.rows.map(mapDbVehicleToFrontend);
        const vehicleById = new Map(vehicles.map((v) => [Number(v.id), v]));

        // 1. Avg time to first human reply (strictly from real timestamps)
        const replyDeltasMin: number[] = [];
        for (const s of sessions) {
          if (s.first_human_reply_at && s.created_at) {
            const diffMs =
              new Date(s.first_human_reply_at).getTime() - new Date(s.created_at).getTime();
            if (Number.isFinite(diffMs) && diffMs >= 0) {
              replyDeltasMin.push(diffMs / 60000);
            }
          }
        }
        const avgFirstHumanReplyMinutes =
          replyDeltasMin.length > 0
            ? Math.round(
                (replyDeltasMin.reduce((acc, v) => acc + v, 0) / replyDeltasMin.length) * 10
              ) / 10
            : null;

        // 2. Queue by assignee
        const assigneeMap = new Map<
          string,
          {
            assigneeName: string;
            assigneeId: number | null;
            total: number;
            awaitingReply: number;
            sessions: Array<{ sessionId: string; leadName: string | null; stage: string }>;
          }
        >();
        for (const s of sessions) {
          const key = s.assigned_user_id ? String(s.assigned_user_id) : 'unassigned';
          const entry = assigneeMap.get(key) || {
            assigneeName: s.assigned_user_name ? String(s.assigned_user_name) : 'Sem responsável',
            assigneeId: s.assigned_user_id ? Number(s.assigned_user_id) : null,
            total: 0,
            awaitingReply: 0,
            sessions: [],
          };
          entry.total += 1;
          if (s.last_sender === 'user') entry.awaitingReply += 1;
          entry.sessions.push({
            sessionId: String(s.session_id),
            leadName: s.lead_name ? String(s.lead_name) : null,
            stage: String(s.stage || 'Novo Lead'),
          });
          assigneeMap.set(key, entry);
        }

        // 3. Funnel (Interesse -> Proposta -> Visita -> Venda)
        const proposalSessions = new Set(
          docsRes.rows
            .filter((d) => d.doc_type === 'proposta_comercial' && d.session_id)
            .map((d) => String(d.session_id))
        );
        const visitSessions = new Set(
          visitsRes.rows.filter((v) => v.session_id).map((v) => String(v.session_id))
        );
        const funnel = {
          interesse: sessions.length,
          proposta: sessions.filter(
            (s) => s.stage === 'Proposta' || s.stage === 'Fechado' || proposalSessions.has(String(s.session_id))
          ).length,
          visita: sessions.filter(
            (s) => s.stage === 'Visita' || s.stage === 'Fechado' || visitSessions.has(String(s.session_id))
          ).length,
          venda: sessions.filter((s) => s.stage === 'Fechado').length,
        };

        // 4. Loss reasons
        const lossMap = new Map<string, { reason: string; count: number; sessionIds: string[] }>();
        for (const s of sessions) {
          if (s.stage === 'Perdido' && s.loss_reason) {
            const r = String(s.loss_reason);
            const entry = lossMap.get(r) || { reason: r, count: 0, sessionIds: [] };
            entry.count += 1;
            entry.sessionIds.push(String(s.session_id));
            lossMap.set(r, entry);
          }
        }

        // 5. Demand without progress per vehicle
        const vehicleStats = new Map<
          number,
          { inquiries: number; proposals: number; visits: number }
        >();
        for (const s of sessions) {
          if (s.focused_vehicle_id) {
            const vid = Number(s.focused_vehicle_id);
            const cur = vehicleStats.get(vid) || { inquiries: 0, proposals: 0, visits: 0 };
            cur.inquiries += 1;
            vehicleStats.set(vid, cur);
          }
        }
        for (const d of docsRes.rows) {
          if (d.vehicle_id && d.doc_type === 'proposta_comercial') {
            const vid = Number(d.vehicle_id);
            const cur = vehicleStats.get(vid) || { inquiries: 0, proposals: 0, visits: 0 };
            cur.proposals += 1;
            vehicleStats.set(vid, cur);
          }
        }
        for (const v of visitsRes.rows) {
          if (v.vehicle_id) {
            const vid = Number(v.vehicle_id);
            const cur = vehicleStats.get(vid) || { inquiries: 0, proposals: 0, visits: 0 };
            cur.visits += 1;
            vehicleStats.set(vid, cur);
          }
        }
        const demandWithoutProgress = Array.from(vehicleStats.entries())
          .filter(([, st]) => st.inquiries > 0 && st.proposals === 0 && st.visits === 0)
          .map(([vid, st]) => {
            const v = vehicleById.get(vid);
            return {
              vehicleId: String(vid),
              title: v ? `${v.brand} ${v.model} (${v.year})` : `Veículo #${vid}`,
              status: v?.status || 'Desconhecido',
              inquiries: st.inquiries,
              proposals: st.proposals,
              visits: st.visits,
            };
          })
          .sort((a, b) => b.inquiries - a.inquiries);

        // 6. Reactivation review queue (proposals without follow-up > 24h or active interest on available vehicles)
        const reactivationQueue: ManagementMetrics['reactivationQueue'] = [];
        const nowMs = Date.now();
        for (const s of sessions) {
          if (s.stage === 'Fechado' || s.stage === 'Perdido') continue;
          const ageHours = (nowMs - new Date(s.updated_at).getTime()) / 3600000;
          const v = s.focused_vehicle_id ? vehicleById.get(Number(s.focused_vehicle_id)) : null;
          if (
            (proposalSessions.has(String(s.session_id)) && ageHours >= 1) ||
            (v && v.status === 'Disponível' && ageHours >= 12)
          ) {
            const customer = s.lead_name ? String(s.lead_name) : 'Cliente';
            const vTitle = v ? `${v.brand} ${v.model} ${v.year}` : 'o veículo consultado';
            const reason = proposalSessions.has(String(s.session_id))
              ? 'Proposta emitida aguardando retorno'
              : 'Interesse sem retorno em veículo disponível';
            reactivationQueue.push({
              id: `react-${s.session_id}`,
              reason,
              sessionId: String(s.session_id),
              customerName: customer,
              customerPhone: s.lead_phone ? String(s.lead_phone) : null,
              vehicleId: v ? v.id : null,
              vehicleTitle: vTitle,
              draftMessage: `Olá ${customer}! Passando para saber se ficou alguma dúvida sobre ${vTitle}${v ? ` (${formatBRL(v.price)})` : ''}. Se quiser, posso revisar as condições ou separar um horário para você conhecer pessoalmente.`,
              lastActivityAt: String(s.updated_at),
            });
          }
        }

        const metrics: ManagementMetrics = {
          avgFirstHumanReplyMinutes,
          humanReplySampleSize: replyDeltasMin.length,
          queueByAssignee: Array.from(assigneeMap.values()).sort((a, b) => b.total - a.total),
          funnel,
          lossReasons: Array.from(lossMap.values()).sort((a, b) => b.count - a.count),
          demandWithoutProgress,
          reactivationQueue: reactivationQueue.slice(0, 20),
        };

        res.setHeader('Cache-Control', 'no-store');
        res.json(metrics);
      } catch (err: unknown) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Erro ao calcular indicadores de gestão.',
        });
      }
    }
  );

  // ==========================================================================
  // 9. INTERNAL COPILOT — AUTHORIZED LIVE DB QUERIES + STOCK ALTERNATIVES + DRAFTS
  // ==========================================================================

  app.post(
    '/api/admin/copilot/query',
    requirePerm('today:view'),
    async (req: StaffAuthenticatedRequest, res) => {
      try {
        const user = req.adminUser!;
        const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
        const sessionId =
          typeof req.body?.sessionId === 'string' ? req.body.sessionId.trim() : null;
        const vehicleId =
          req.body?.vehicleId && Number.isFinite(Number(req.body.vehicleId))
            ? Number(req.body.vehicleId)
            : null;
        const mode = typeof req.body?.mode === 'string' ? req.body.mode : 'auto';
        const norm = query
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '');

        const [vehiclesRes, dealershipResult] = await Promise.all([
          pool.query<ApiVehicleRow>('SELECT * FROM vehicles ORDER BY id DESC'),
          getPersistedDealershipConfig(),
        ]);
        const vehicles = vehiclesRes.rows.map(mapDbVehicleToFrontend);

        // 1. Transmission / Data-quality conflict query
        if (
          norm.includes('divergencia') ||
          norm.includes('cambio') ||
          norm.includes('conflito') ||
          norm.includes('fipe') ||
          norm.includes('incompleto')
        ) {
          const flagged = vehicles
            .map((v) => ({ v, q: analyzeVehicleDataQuality(v), f: computeFipeMetrics(v) }))
            .filter(
              ({ q, f, v }) =>
                !q.canonicalTransmission ||
                q.hasTransmissionConflict ||
                q.hasBrandModelMismatch ||
                (norm.includes('fipe') && (!v.fipePrice || !f.fipeReferenceMonth))
            );

          const result: CopilotQueryResult = {
            mode: 'deterministic_query',
            answer:
              flagged.length > 0
                ? `Encontrei ${flagged.length} veículo(s) com pendência cadastral para conferência da equipe:`
                : 'Nenhum veículo com divergência de câmbio ou pendência crítica encontrada no estoque atual.',
            records: flagged.map(({ v, q }) => ({
              type: 'vehicle',
              id: v.id,
              title: `${v.brand} ${v.model} (${v.year})`,
              subtitle:
                q.conflictDetail ||
                (q.hasBrandModelMismatch
                  ? 'Divergência entre marca e modelo no cadastro'
                  : 'FIPE incompleta ou sem mês de referência'),
              actionLabel: 'Abrir cadastro',
            })),
          };
          res.json(result);
          return;
        }

        // 2. Simulation / financing follow-up query
        if (
          norm.includes('simulacao') ||
          norm.includes('financiamento') ||
          norm.includes('retorno') ||
          norm.includes('aguardando')
        ) {
          if (!hasPermission(user.roleCode, 'sessions:view_own')) {
            res.status(403).json({
              error: 'Seu perfil não tem permissão para consultar atendimentos comerciais.',
            });
            return;
          }
          const canSeeAll = hasPermission(user.roleCode, 'sessions:view_all');
          const rowsRes = await pool.query(
            `SELECT DISTINCT ON (s.session_id)
               s.session_id, s.lead_name, s.lead_phone, s.stage, s.assigned_user_name,
               s.first_human_reply_at, s.updated_at, m.content
             FROM chat_sessions s
             JOIN chat_messages m ON m.session_id = s.session_id
             WHERE ($1::boolean = true OR s.assigned_user_id IS NULL OR s.assigned_user_id = $2)
               AND (
                 LOWER(m.content) LIKE '%simula%' OR LOWER(m.content) LIKE '%entrada%'
                 OR LOWER(m.content) LIKE '%financ%' OR LOWER(m.content) LIKE '%48x%'
               )
               AND COALESCE(s.stage, 'Novo Lead') NOT IN ('Fechado', 'Perdido')
             ORDER BY s.session_id, s.updated_at DESC
             LIMIT 20`,
            [canSeeAll, user.id]
          );

          const result: CopilotQueryResult = {
            mode: 'deterministic_query',
            answer:
              rowsRes.rows.length > 0
                ? `Encontrei ${rowsRes.rows.length} atendimento(s) com pedido de simulação/financiamento em aberto:`
                : 'Nenhum atendimento pendente com pedido de simulação encontrado no seu escopo.',
            records: rowsRes.rows.map((r) => ({
              type: 'session',
              id: String(r.session_id),
              title: r.lead_name ? String(r.lead_name) : `Sessão ${String(r.session_id).slice(0, 8)}`,
              subtitle: `${r.stage || 'Novo Lead'} · ${r.assigned_user_name || 'Sem responsável'} · ${r.first_human_reply_at ? 'Com retorno humano' : 'Aguardando 1º retorno humano'}`,
              actionLabel: 'Abrir atendimento',
            })),
          };
          res.json(result);
          return;
        }

        // 3. Stock alternatives for a vehicle (especially if sold or customer wants comparisons)
        if (mode === 'alternatives' || norm.includes('alternativa') || norm.includes('parecido')) {
          const target = vehicleId
            ? vehicles.find((v) => Number(v.id) === vehicleId) || null
            : null;
          const available = vehicles.filter(
            (v) => v.status === 'Disponível' && (!target || v.id !== target.id)
          );
          const ranked = available
            .map((v) => {
              const priceDelta = target ? v.price - target.price : 0;
              const kmDelta = target ? v.km - target.km : 0;
              const score = target
                ? Math.abs(priceDelta) / 1000 + Math.abs(kmDelta) / 5000
                : v.price / 1000;
              return { v, priceDelta, kmDelta, score };
            })
            .sort((a, b) => a.score - b.score)
            .slice(0, 4);

          const soldNotice =
            target && target.status !== 'Disponível'
              ? `Atenção: ${target.brand} ${target.model} está com status "${target.status}". `
              : '';

          const result: CopilotQueryResult = {
            mode: 'stock_alternatives',
            answer: target
              ? `${soldNotice}Alternativas disponíveis no estoque comparadas a ${target.brand} ${target.model} (${formatBRL(target.price)} · ${formatKm(target.km)}):`
              : `Opções atualmente disponíveis no estoque (${ranked.length} selecionadas):`,
            records: ranked.map(({ v, priceDelta, kmDelta }) => {
              const q = analyzeVehicleDataQuality(v);
              const priceDiffStr = target
                ? `${priceDelta >= 0 ? '+' : ''}${formatBRL(priceDelta)}`
                : formatBRL(v.price);
              const kmDiffStr = target
                ? `${kmDelta >= 0 ? '+' : ''}${Math.round(kmDelta / 1000)} mil km`
                : formatKm(v.km);
              return {
                type: 'vehicle',
                id: v.id,
                title: `${v.brand} ${v.model} (${v.year}) — ${formatBRL(v.price)}`,
                subtitle: `${formatKm(v.km)} · ${q.canonicalTransmission && !q.hasTransmissionConflict ? q.canonicalTransmission : 'Câmbio a confirmar'} · Diferença: ${priceDiffStr} | ${kmDiffStr}`,
                actionLabel: 'Ver no estoque',
              };
            }),
          };
          res.json(result);
          return;
        }

        // 4. Draft reply or structured summary for an active session (never auto-sends!)
        if (sessionId && (mode === 'draft_reply' || mode === 'summary' || norm.includes('rascunho') || norm.includes('resposta') || norm.includes('resum'))) {
          if (!hasPermission(user.roleCode, 'sessions:view_own')) {
            res.status(403).json({ error: 'Sem permissão para ler este atendimento.' });
            return;
          }
          const [sRes, mRes] = await Promise.all([
            pool.query('SELECT * FROM chat_sessions WHERE session_id = $1 LIMIT 1', [sessionId]),
            pool.query(
              'SELECT sender, content, created_at FROM chat_messages WHERE session_id = $1 ORDER BY id ASC LIMIT 40',
              [sessionId]
            ),
          ]);
          const sess = sRes.rows[0];
          if (!sess) {
            res.status(404).json({ error: 'Atendimento não encontrado.' });
            return;
          }
          const ctx = safeJsonParse<SessionNegotiationContext>(sess.context_json, {});
          const focusId = sess.focused_vehicle_id || (ctx.focusedVehicleId ? Number(ctx.focusedVehicleId) : null);
          const focusVeh = focusId ? vehicles.find((v) => Number(v.id) === focusId) || null : null;
          const customerName = sess.lead_name ? String(sess.lead_name) : 'tudo bem';
          const officialAddr = formatDealershipAddress(dealershipResult.config);

          if (mode === 'summary' || norm.includes('resum')) {
            const clientMsgs = mRes.rows.filter((m) => m.sender === 'user');
            const summaryLines = [
              `Cliente: ${sess.lead_name || 'Não identificado'}${sess.lead_phone ? ` (${sess.lead_phone})` : ''}`,
              `Etapa: ${sess.stage || 'Novo Lead'} · Responsável: ${sess.assigned_user_name || 'Sem responsável'}`,
              `Veículo em foco: ${focusVeh ? `${focusVeh.brand} ${focusVeh.model} (${focusVeh.year}) — ${formatBRL(focusVeh.price)}` : 'Nenhum definido'}`,
              ctx.financingSummary
                ? `Financiamento: Entrada ${formatBRL(ctx.financingSummary.downPayment)} · Saldo ${formatBRL(ctx.financingSummary.principalBalance)} (${ctx.financingSummary.months || '?'}x)`
                : 'Financiamento: Não simulado',
              ctx.tradeInSummary?.brandModel
                ? `Troca: ${ctx.tradeInSummary.brandModel} ${ctx.tradeInSummary.yearText || ''}`.trim()
                : 'Troca: Não informada',
              `Última mensagem do cliente: "${clientMsgs[clientMsgs.length - 1]?.content?.slice(0, 140) || '—'}"`,
            ];
            res.json({
              mode: 'summary',
              answer: summaryLines.join('\n'),
              records: [],
            } satisfies CopilotQueryResult);
            return;
          }

          // Deterministic draft reply ready for human review (never sent automatically)
          const draftParts: string[] = [];
          draftParts.push(`Olá${sess.lead_name ? `, ${customerName}` : ''}! Aqui é ${user.name.split(' ')[0]}, da ${dealershipResult.config.tradeName || 'Armazém do Carro'}.`);
          if (focusVeh) {
            draftParts.push(
              `Acompanhei seu interesse no ${focusVeh.brand} ${focusVeh.model} ${focusVeh.year} (${formatBRL(focusVeh.price)} · ${formatKm(focusVeh.km)}).`
            );
          }
          if (ctx.financingSummary) {
            draftParts.push(
              `Sobre a simulação com ${formatBRL(ctx.financingSummary.downPayment)} de entrada, o saldo principal antes de encargos fica em ${formatBRL(ctx.financingSummary.principalBalance)}. Posso enviar sua proposta formal ou verificar a taxa aprovada no seu CPF.`
            );
          } else if (ctx.tradeInSummary?.brandModel) {
            draftParts.push(
              `Para avançarmos na pré-avaliação do seu ${ctx.tradeInSummary.brandModel}, pode enviar fotos externas, internas e do painel por aqui mesmo.`
            );
          } else {
            draftParts.push(
              'Como posso te ajudar a dar o próximo passo — prefere receber a proposta detalhada ou agendar uma visita?'
            );
          }
          if (officialAddr) {
            draftParts.push(`Nosso showroom fica em ${officialAddr}.`);
          }

          res.json({
            mode: 'draft_reply',
            answer:
              'Rascunho sugerido com base no histórico e no estoque atual. Revise antes de enviar (nenhuma mensagem foi disparada).',
            draftText: draftParts.join(' '),
            records: [],
          } satisfies CopilotQueryResult);
          return;
        }

        // Default helpful operational overview
        res.json({
          mode: 'deterministic_query',
          answer:
            'Você pode perguntar: "Quais clientes pediram simulação e ainda precisam de retorno?", "Quais carros têm divergência de câmbio?", ou pedir alternativas para um veículo específico.',
          records: [],
        } satisfies CopilotQueryResult);
      } catch (err: unknown) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Erro ao executar consulta do copiloto.',
        });
      }
    }
  );

  // ==========================================================================
  // SITE E VITRINE — CONFIGURAÇÃO E SINCRONIZAÇÃO DE ESTOQUE EXTERNO
  // ==========================================================================

  app.get(
    '/api/admin/external-storefront/status',
    requirePerm('settings:edit_dealership'),
    async (_req, res) => {
      try {
        const { config } = await deps.getPersistedDealershipConfig();
        const slug = (config.publicStoreSlug || 'armazem-do-carro').trim();
        const summary = await getExternalSourceSummary(slug);
        res.setHeader('Cache-Control', 'no-store');
        res.json({
          storeSlug: slug,
          storefrontMode: config.storefrontMode || 'internal',
          externalCatalogUrl: config.externalCatalogUrl || '',
          externalHomeUrl: config.externalHomeUrl || '',
          source: summary,
        });
      } catch (err: unknown) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Erro ao consultar status da vitrine externa.',
        });
      }
    }
  );

  app.post(
    '/api/admin/external-storefront/validate-link',
    requirePerm('settings:edit_dealership'),
    async (req: StaffAuthenticatedRequest, res) => {
      try {
        const { config } = await deps.getPersistedDealershipConfig();
        const slug = (config.publicStoreSlug || 'armazem-do-carro').trim();
        const rawUrl =
          typeof req.body?.url === 'string'
            ? req.body.url.trim()
            : (config.externalCatalogUrl || '').trim();
        const result = await validatePublicStorefrontLink(slug, rawUrl);
        await recordStaffAudit({
          user: req.adminUser,
          action: 'external_storefront_link_validated',
          entityType: 'external_storefront',
          entityId: slug,
          details: { ok: result.ok, detail: result.detail },
        });
        res.json(result);
      } catch (err: unknown) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Erro ao validar link público da vitrine.',
        });
      }
    }
  );

  app.patch(
    '/api/admin/external-storefront/config',
    requirePerm('settings:edit_dealership'),
    async (req: StaffAuthenticatedRequest, res) => {
      try {
        const { config } = await deps.getPersistedDealershipConfig();
        const slug = (config.publicStoreSlug || 'armazem-do-carro').trim();
        const result = await saveExternalSourceConfig(slug, {
          sourceType: req.body?.sourceType,
          feedUrl: req.body?.feedUrl,
          authHeaderName: req.body?.authHeaderName,
          authHeaderValue: req.body?.authHeaderValue,
          clearAuthHeader: Boolean(req.body?.clearAuthHeader),
          syncIntervalMinutes: req.body?.syncIntervalMinutes,
        });
        if (!result.ok) {
          res.status(400).json({ error: result.error || 'Configuração de fonte externa inválida.' });
          return;
        }
        await recordStaffAudit({
          user: req.adminUser,
          action: 'external_storefront_source_updated',
          entityType: 'external_storefront',
          entityId: slug,
          details: {
            sourceType: result.summary?.sourceType,
            syncIntervalMinutes: result.summary?.syncIntervalMinutes,
          },
        });
        res.json({ ok: true, source: result.summary });
      } catch (err: unknown) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Erro ao salvar fonte de estoque externo.',
        });
      }
    }
  );

  app.post(
    '/api/admin/external-storefront/test',
    requirePerm('settings:edit_dealership'),
    async (req: StaffAuthenticatedRequest, res) => {
      try {
        const { config } = await deps.getPersistedDealershipConfig();
        const slug = (config.publicStoreSlug || 'armazem-do-carro').trim();
        const result = await testExternalSourceConnection(slug, {
          sourceType: req.body?.sourceType,
          feedUrl: typeof req.body?.feedUrl === 'string' ? req.body.feedUrl : undefined,
          authHeaderName:
            typeof req.body?.authHeaderName === 'string' ? req.body.authHeaderName : undefined,
          authHeaderValue:
            typeof req.body?.authHeaderValue === 'string' ? req.body.authHeaderValue : undefined,
        });
        res.json(result);
      } catch (err: unknown) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Erro ao testar conexão com o estoque externo.',
        });
      }
    }
  );

  app.post(
    '/api/admin/external-storefront/sync',
    requirePerm('settings:edit_dealership'),
    async (req: StaffAuthenticatedRequest, res) => {
      try {
        const { config } = await deps.getPersistedDealershipConfig();
        const slug = (config.publicStoreSlug || 'armazem-do-carro').trim();
        const result = await syncExternalInventory(slug);
        await recordStaffAudit({
          user: req.adminUser,
          action: 'external_storefront_synced',
          entityType: 'external_storefront',
          entityId: slug,
          details: {
            ok: result.ok,
            status: result.status,
            syncedCount: result.syncedCount,
            removedCount: result.removedCount,
          },
        });
        res.json(result);
      } catch (err: unknown) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Erro ao sincronizar estoque externo.',
        });
      }
    }
  );
}
