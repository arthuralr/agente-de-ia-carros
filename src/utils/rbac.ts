import type { NavModule, StaffRole } from '../types';

export type StaffPermission =
  | 'today:view'
  | 'sessions:view_own'
  | 'sessions:view_all'
  | 'sessions:claim'
  | 'sessions:assign_others'
  | 'sessions:reply'
  | 'sessions:delete_lgpd'
  | 'inventory:view'
  | 'inventory:edit'
  | 'inventory:delete'
  | 'visits:view'
  | 'visits:manage'
  | 'trade_ins:view'
  | 'trade_ins:manage'
  | 'trade_ins:approve_value'
  | 'marketing:view'
  | 'marketing:create'
  | 'documents:view'
  | 'documents:emit_commercial'
  | 'documents:emit_operational'
  | 'documents:manage_templates'
  | 'management:view'
  | 'settings:view'
  | 'settings:edit_dealership'
  | 'team:manage';

export const STAFF_ROLE_META: Record<
  StaffRole,
  { label: string; shortLabel: string; description: string }
> = {
  vendedor: {
    label: 'Vendedor',
    shortLabel: 'Vendedor',
    description:
      'Atendimentos atribuídos ou disponíveis, consulta de estoque, propostas, tarefas, agenda e divulgação.',
  },
  assistente: {
    label: 'Assistente Administrativo',
    shortLabel: 'Assistente',
    description:
      'Fichas e pendências de estoque, fotos de troca, agenda e emissão de documentos operacionais.',
  },
  gestor: {
    label: 'Gestor Comercial',
    shortLabel: 'Gestor',
    description:
      'Fila completa da equipe, redistribuição de atendimentos, estoque, indicadores comerciais e acompanhamento.',
  },
  administrador: {
    label: 'Administrador',
    shortLabel: 'Admin',
    description:
      'Acesso integral: configurações oficiais da loja, equipe, permissões, biblioteca de modelos e integrações.',
  },
};

const ROLE_PERMISSIONS: Record<StaffRole, ReadonlySet<StaffPermission>> = {
  vendedor: new Set<StaffPermission>([
    'today:view',
    'sessions:view_own',
    'sessions:claim',
    'sessions:reply',
    'inventory:view',
    'visits:view',
    'visits:manage',
    'trade_ins:view',
    'trade_ins:manage',
    'marketing:view',
    'marketing:create',
    'documents:view',
    'documents:emit_commercial',
  ]),
  assistente: new Set<StaffPermission>([
    'today:view',
    'inventory:view',
    'inventory:edit',
    'visits:view',
    'visits:manage',
    'trade_ins:view',
    'trade_ins:manage',
    'documents:view',
    'documents:emit_commercial',
    'documents:emit_operational',
  ]),
  gestor: new Set<StaffPermission>([
    'today:view',
    'sessions:view_own',
    'sessions:view_all',
    'sessions:claim',
    'sessions:assign_others',
    'sessions:reply',
    'inventory:view',
    'inventory:edit',
    'visits:view',
    'visits:manage',
    'trade_ins:view',
    'trade_ins:manage',
    'trade_ins:approve_value',
    'marketing:view',
    'marketing:create',
    'documents:view',
    'documents:emit_commercial',
    'documents:emit_operational',
    'management:view',
  ]),
  administrador: new Set<StaffPermission>([
    'today:view',
    'sessions:view_own',
    'sessions:view_all',
    'sessions:claim',
    'sessions:assign_others',
    'sessions:reply',
    'sessions:delete_lgpd',
    'inventory:view',
    'inventory:edit',
    'inventory:delete',
    'visits:view',
    'visits:manage',
    'trade_ins:view',
    'trade_ins:manage',
    'trade_ins:approve_value',
    'marketing:view',
    'marketing:create',
    'documents:view',
    'documents:emit_commercial',
    'documents:emit_operational',
    'documents:manage_templates',
    'management:view',
    'settings:view',
    'settings:edit_dealership',
    'team:manage',
  ]),
};

/**
 * Normalizes legacy role labels (e.g. "Gerente Comercial" in existing Neon rows)
 * into one of the four canonical RBAC staff roles without breaking existing accounts.
 */
export function normalizeStaffRole(
  roleCode?: string | null,
  legacyRoleLabel?: string | null
): StaffRole {
  const code = (roleCode || '').trim().toLowerCase();
  if (
    code === 'vendedor' ||
    code === 'assistente' ||
    code === 'gestor' ||
    code === 'administrador'
  ) {
    return code;
  }

  const label = (legacyRoleLabel || code).trim().toLowerCase();
  if (label.includes('vendedor') || label.includes('consultor')) {
    return 'vendedor';
  }
  if (label.includes('assistente') || label.includes('administrativo')) {
    return 'assistente';
  }
  if (label.includes('gestor') || label.includes('supervisor')) {
    return 'gestor';
  }
  // Legacy default admin account ("Gerente Comercial" / "Admin") preserves full admin access
  return 'administrador';
}

export function hasPermission(
  role: StaffRole | null | undefined,
  permission: StaffPermission
): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

const MODULE_PERMISSION_MAP: Record<NavModule, StaffPermission> = {
  hoje: 'today:view',
  atendimentos: 'sessions:view_own',
  estoque: 'inventory:view',
  agenda_trocas: 'visits:view',
  divulgacao: 'marketing:view',
  documentos: 'documents:view',
  gestao: 'management:view',
  configuracoes: 'settings:view',
  // Legacy module aliases mapped seamlessly
  dashboard: 'today:view',
  inventory: 'inventory:view',
  crm: 'sessions:view_own',
  chat_audit: 'sessions:view_own',
  contracts: 'documents:view',
  social_ai: 'marketing:view',
  settings: 'settings:view',
};

export const PRIMARY_CENTRAL_MODULES: NavModule[] = [
  'hoje',
  'atendimentos',
  'estoque',
  'agenda_trocas',
  'divulgacao',
  'documentos',
  'gestao',
  'configuracoes',
];

export function canAccessModule(
  role: StaffRole | null | undefined,
  module: NavModule
): boolean {
  const reqPerm = MODULE_PERMISSION_MAP[module];
  if (!reqPerm) return false;
  return hasPermission(role, reqPerm);
}

export function getAllowedModules(role: StaffRole | null | undefined): NavModule[] {
  return PRIMARY_CENTRAL_MODULES.filter((m) => canAccessModule(role, m));
}

export function getDefaultModuleForRole(role: StaffRole | null | undefined): NavModule {
  const allowed = getAllowedModules(role);
  return allowed[0] || 'hoje';
}

export function canEmitTemplateForRole(
  role: StaffRole | null | undefined,
  allowedRoles: string[]
): boolean {
  if (!role) return false;
  if (role === 'administrador') return true;
  return allowedRoles.includes(role);
}
