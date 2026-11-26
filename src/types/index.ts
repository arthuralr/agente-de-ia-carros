export type AppViewMode =
  | 'catalog'
  | 'home'
  | 'chat'
  | 'vehicle_detail'
  | 'privacy'
  | 'login'
  | 'admin';

export type StaffRole = 'vendedor' | 'assistente' | 'gestor' | 'administrador';

export interface AdminUser {
  id: number;
  name: string;
  email: string;
  role: string;
  roleCode: StaffRole;
  avatarUrl: string | null;
  active?: boolean;
  lastLoginAt?: string | null;
}

export type OperationMode = 'full' | 'agent_only';

export type NavModule =
  | 'hoje'
  | 'atendimentos'
  | 'estoque'
  | 'agenda_trocas'
  | 'divulgacao'
  | 'documentos'
  | 'gestao'
  | 'configuracoes'
  // Legacy aliases kept for full backwards compatibility
  | 'dashboard'
  | 'inventory'
  | 'crm'
  | 'chat_audit'
  | 'contracts'
  | 'social_ai'
  | 'settings';

export type VehicleStatus = 'Disponível' | 'Reservado' | 'Vendido';

export type VehicleCategory = 'SUVs' | 'Sedans' | 'Hatches' | 'Esportivos';

export interface Vehicle {
  id: string;
  brand: string;
  model: string;
  version: string;
  category?: VehicleCategory;
  year: string;
  km: number;
  price: number;
  fipePrice: number;
  fipeCode?: string;
  fipeReferenceMonth?: string | null;
  color: string;
  transmission: string;
  fuel: string;
  plate: string;
  renavam: string;
  chassis: string;
  status: VehicleStatus;
  imageUrl: string;
  gallery?: string[];
  optionals: string[];
  createdAt: string;
  // Optional metadata when vehicle comes from an external official dealership catalog
  officialUrl?: string | null;
  dataSource?: 'internal' | 'external';
  externalId?: string | null;
  sourceUpdatedAt?: string | null;
  priceConfirmed?: boolean;
  availabilityConfirmed?: boolean;
}

export interface FipePriceEntry {
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

export interface FipeLookupResult {
  codigoFipe: string;
  cached: boolean;
  items: FipePriceEntry[];
  recommended: FipePriceEntry;
}

export type LeadStage = 'Novo Lead' | 'Em Atendimento' | 'Proposta' | 'Fechado';

export interface ChatReplyContext {
  id: string;
  sender: 'ia' | 'cliente';
  preview: string;
}

export interface ChatAttachment {
  url: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
}

export interface ChatAudioMeta {
  url: string;
  mimeType: string;
  durationSec?: number;
  transcription?: string;
}

export type ChatTriageStage = 'ask_name' | 'ask_phone' | 'complete';

export interface VehicleSearchFilters {
  transmission?: 'automatico' | 'manual' | null;
  maxPrice?: number | null;
  minPrice?: number | null;
  maxKm?: number | null;
  minYear?: number | null;
  brand?: string | null;
  model?: string | null;
  belowFipeOnly?: boolean | null;
}

export interface VehicleCardData {
  id: string;
  brand: string;
  model: string;
  version: string;
  year: string;
  price: number;
  km: number;
  status: VehicleStatus;
  fuel: string;
  transmission: string;
  transmissionConfirmed: boolean;
  transmissionConflictNote?: string | null;
  imageUrl: string;
  fipePrice: number | null;
  fipeReferenceMonth: string | null;
  fipeDiffBrl: number | null;
  fipeDiffPct: number | null;
  isConfirmedBelowFipeOffer: boolean;
  sheetPath: string;
  sheetUrl: string;
  officialUrl?: string | null;
  isExternalUrl?: boolean;
  dataSource?: 'internal' | 'external';
  priceConfirmed?: boolean;
  availabilityConfirmed?: boolean;
  alternativeNote?: string | null;
}

export interface VehicleComparisonData {
  vehicles: VehicleCardData[];
  rows: Array<{ label: string; values: string[] }>;
  highlights: string[];
}

export interface VehicleFinancingSummary {
  vehicleId: string;
  vehicleTitle: string;
  vehiclePrice: number;
  downPayment: number;
  principalBalance: number;
  months: number | null;
  monthlyRatePct: number | null;
  estimatedInstallment: number | null;
  isIllustrativeOnly: boolean;
  note: string;
}

export interface ChatSuggestedAction {
  id: string;
  label: string;
  kind: 'prompt' | 'open_sheet' | 'compare' | 'attach_photos' | 'handoff';
  promptText?: string;
  vehicleId?: string;
  sheetPath?: string;
}

export interface ChatMessage {
  id: string;
  sender: 'ia' | 'cliente';
  text: string;
  timestamp: string;
  replyTo?: ChatReplyContext;
  audio?: ChatAudioMeta;
  attachment?: ChatAttachment;
  isHumanConsultant?: boolean;
  senderLabel?: string;
  dbId?: number;
  broadcastId?: number;
  vehicleCards?: VehicleCardData[];
  comparison?: VehicleComparisonData | null;
  financingSummary?: VehicleFinancingSummary | null;
  promptAttachPhotos?: boolean;
  suggestedActions?: ChatSuggestedAction[];
  stockQueryError?: boolean;
  isVisitInquiryOnly?: boolean;
  suppressHandoff?: boolean;
}

export interface Lead {
  id: string;
  name: string;
  whatsapp: string;
  email: string;
  cpf: string;
  rg: string;
  address: string;
  city: string;
  vehicleInterestId: string;
  vehicleInterestLabel: string;
  stage: LeadStage;
  source: 'Chat IA do Site' | 'WhatsApp Direto' | 'Instagram' | 'Showroom';
  createdAt: string;
  lastActivity: string;
  visitScheduled?: string;
  proposalValue?: number;
  notes: string;
  lgpdConsent?: boolean;
  lgpdConsentAt?: string;
  chatSessionId?: string;
  tag?: string | null;
  chatHistory: ChatMessage[];
}

export type SessionAutomationMode = 'ai_active' | 'human_active' | 'paused';
export type SessionCommercialStage =
  | 'Novo Lead'
  | 'Em Atendimento'
  | 'Proposta'
  | 'Visita'
  | 'Fechado'
  | 'Perdido';

export interface SessionNegotiationContext {
  activeFilters?: VehicleSearchFilters | null;
  focusedVehicleId?: string | null;
  budgetMax?: number | null;
  financingSummary?: VehicleFinancingSummary | null;
  tradeInSummary?: {
    brandModel?: string;
    yearText?: string;
    km?: number | null;
    transmission?: string;
    pendingItems?: string[];
  } | null;
  visitStatus?: 'consultada' | 'solicitada' | 'confirmada' | null;
  nextAction?: string | null;
  sourceCampaign?: string | null;
}

export interface ChatSessionSummary {
  id: number;
  sessionId: string;
  leadName: string | null;
  leadPhone: string | null;
  origem: string;
  tag?: string | null;
  aiSummary?: string | null;
  aiSummaryUpdatedAt?: string | null;
  whatsappHandoffAt?: string | null;
  handoffStatus?: string | null;
  assignedUserId?: number | null;
  assignedUserName?: string | null;
  assignedAt?: string | null;
  firstHumanReplyAt?: string | null;
  automationMode?: SessionAutomationMode;
  stage?: SessionCommercialStage;
  lossReason?: string | null;
  focusedVehicleId?: number | null;
  context?: SessionNegotiationContext | null;
  version?: number;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessage: string | null;
  lastSender: 'user' | 'assistant' | null;
}

export type MessageDeliveryChannel =
  | 'ai_auto'
  | 'human_chat'
  | 'suggested_draft'
  | 'whatsapp_manual_log'
  | 'chat';

export interface ChatAuditMessage {
  id: number;
  sessionId: string;
  sender: 'user' | 'assistant';
  content: string;
  replyToId?: string | null;
  replyToPreview?: string | null;
  replyToSender?: 'user' | 'assistant' | null;
  audioUrl?: string | null;
  transcription?: string | null;
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  attachmentMime?: string | null;
  attachmentDownloadUrl?: string | null;
  senderLabel?: string | null;
  isHumanConsultant?: boolean;
  authorUserId?: number | null;
  deliveryChannel?: MessageDeliveryChannel | null;
  createdAt: string;
}

export interface AdminNotificationItem {
  id: string;
  type: 'chat_message' | 'new_lead';
  title: string;
  preview: string;
  sessionId?: string | null;
  leadId?: string | null;
  leadPhone?: string | null;
  origem?: string | null;
  createdAt: string;
}

export interface ChatBroadcastRecord {
  id: number;
  title: string | null;
  message: string;
  createdBy: string | null;
  createdAt: string;
}

export type DocumentType = 'contrato' | 'recibo' | 'vistoria' | 'garantia';

export interface ContractRecord {
  id: string;
  clientName: string;
  clientCpf: string;
  vehicleId: string;
  vehicleLabel: string;
  finalPrice: number;
  paymentMethod: string;
  createdAt: string;
}

export interface GeneratedPostResponse {
  headline: string;
  legenda: string;
  gatilhos: string[];
  ctaWhatsapp: string;
  hashtags: string[];
  roteiroReels: string;
}

export interface ActivityLog {
  id: string;
  title: string;
  detail: string;
  time: string;
  category: 'estoque' | 'crm' | 'contrato';
}

export type StorefrontMode = 'internal' | 'external';

export type ExternalInventorySourceType =
  | 'json_feed'
  | 'structured_site'
  | 'site_connector';

export type WidgetPosition = 'bottom-right' | 'bottom-left';

export type ExternalSourceHealthStatus =
  | 'not_configured'
  | 'ok'
  | 'empty'
  | 'stale'
  | 'unavailable'
  | 'error'
  | 'connector_required';

export interface ExternalInventorySourceSummary {
  storeSlug: string;
  sourceType: ExternalInventorySourceType;
  feedUrl: string;
  hasAuthHeader: boolean;
  authHeaderName: string;
  syncIntervalMinutes: number;
  publicLinkStatus: 'unverified' | 'valid' | 'invalid';
  publicLinkCheckedAt: string | null;
  publicLinkDetail: string | null;
  connectionStatus: ExternalSourceHealthStatus;
  lastSyncAttemptAt: string | null;
  lastSyncSuccessAt: string | null;
  lastSyncCount: number;
  availableCount: number;
  lastError: string | null;
}

export interface DealershipSettings {
  tradeName: string;
  legalName: string;
  cnpj: string;
  stateRegistration: string;
  phone: string;
  whatsapp: string;
  salesWhatsapp?: string;
  salesWhatsappLabel?: string;
  financingWhatsapp?: string;
  financingWhatsappLabel?: string;
  email: string;
  address: string;
  city: string;
  state: string;
  hoursWeekdays: string;
  hoursSaturday: string;
  hoursSunday: string;
  minResaleMarginPct: number;
  defaultSocialCta: string;
  aiAssistantName: string;
  warrantyDays: number;
  warrantyKm: number;
  financingMonthlyRatePct?: number | null;
  logoUrl?: string;
  // Storefront mode & external site configuration (public-safe fields ONLY)
  publicStoreSlug?: string;
  storefrontMode?: StorefrontMode;
  externalCatalogUrl?: string;
  externalHomeUrl?: string;
  // Floating agent widget configuration
  widgetEnabled?: boolean;
  widgetPosition?: WidgetPosition;
  widgetLabel?: string;
  widgetAllowedOrigins?: string[];
}

// ============================================================================
// CENTRAL DA REVENDA — WORKFLOW, AGENDA, TROCAS, DIVULGAÇÃO, DOCUMENTOS, GESTÃO
// ============================================================================

export interface StaffInviteRecord {
  id: number;
  name: string;
  email: string;
  roleCode: StaffRole;
  invitedByName: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

export interface StaffTaskRecord {
  id: number;
  sessionId: string | null;
  leadId: number | null;
  vehicleId: number | null;
  assignedUserId: number | null;
  assignedUserName: string | null;
  title: string;
  notes: string | null;
  dueAt: string | null;
  status: 'pendente' | 'concluida' | 'cancelada';
  createdByName: string | null;
  completedAt: string | null;
  createdAt: string;
}

export type VisitStatus =
  | 'consultada'
  | 'solicitada'
  | 'confirmada'
  | 'realizada'
  | 'cancelada';

export interface VisitRecord {
  id: number;
  sessionId: string | null;
  leadId: number | null;
  vehicleId: number | null;
  vehicleLabel: string | null;
  customerName: string | null;
  customerPhone: string | null;
  status: VisitStatus;
  scheduledDate: string | null;
  scheduledTime: string | null;
  assignedUserId: number | null;
  assignedUserName: string | null;
  notes: string | null;
  createdByName: string | null;
  updatedByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export type TradeInStatus =
  | 'aguardando_dados'
  | 'aguardando_fotos'
  | 'em_avaliacao'
  | 'aprovada'
  | 'recusada';

export interface TradeInRecord {
  id: number;
  sessionId: string | null;
  leadId: number | null;
  targetVehicleId: number | null;
  customerName: string | null;
  customerPhone: string | null;
  brandModel: string;
  yearText: string | null;
  versionText: string | null;
  transmission: string | null;
  km: number | null;
  color: string | null;
  plate: string | null;
  conditionNotes: string | null;
  photos: Array<{ url: string; name: string }>;
  pendingItems: string[];
  status: TradeInStatus;
  approvedValue: number | null;
  evaluatedByName: string | null;
  evaluatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type MarketingFormat = 'feed' | 'stories' | 'classificado' | 'carrossel';

export interface MarketingDraftRecord {
  id: number;
  vehicleId: number;
  format: MarketingFormat;
  title: string;
  caption: string;
  selectedPhotoUrl: string | null;
  selectedPhotos: string[];
  templateConfig: Record<string, unknown>;
  snapshotPrice: number;
  snapshotStatus: string;
  publicSheetUrl: string | null;
  trackingSource: string | null;
  createdByName: string | null;
  updatedByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export type DocumentTypeSlug =
  | 'proposta_comercial'
  | 'pre_avaliacao_troca'
  | 'ficha_visita'
  | 'termo_entrega'
  | 'recibo'
  | 'contrato';

export interface DocumentFieldSchema {
  key: string;
  label: string;
  type: 'text' | 'number' | 'currency' | 'date' | 'select' | 'boolean' | 'textarea';
  required: boolean;
  options?: string[];
  source?: 'vehicle' | 'session' | 'lead' | 'financing' | 'trade_in' | 'dealership';
  showWhen?: {
    field: string;
    equals: boolean | string;
  };
}

export interface DocumentTemplateRecord {
  id: number;
  slug: string;
  name: string;
  docType: DocumentTypeSlug;
  version: number;
  status: 'ativo' | 'rascunho' | 'arquivado';
  isExampleTemplate: boolean;
  allowedRoles: StaffRole[];
  fieldsSchema: DocumentFieldSchema[];
  bodyTemplate: string;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IssuedDocumentRecord {
  id: number;
  idempotencyKey: string | null;
  templateId: number | null;
  templateSlug: string;
  templateName: string;
  templateVersion: number;
  docType: DocumentTypeSlug;
  sessionId: string | null;
  leadId: number | null;
  vehicleId: number | null;
  supersedesDocumentId: number | null;
  issuedById: number | null;
  issuedByName: string;
  dealershipSnapshot: DealershipSettings;
  vehicleSnapshot: Partial<Vehicle> | null;
  values: Record<string, string | number | boolean | null>;
  calculatedTotals: {
    vehiclePrice: number;
    downPayment: number;
    tradeInValue: number;
    principalBalance: number;
    installments: number | null;
    monthlyRatePct: number | null;
    estimatedInstallment: number | null;
    calculationType: string;
    note: string;
  } | null;
  renderedText: string;
  createdAt: string;
}

export interface TodayActionSummary {
  awaitingReply: ChatSessionSummary[];
  proposalsToFollowUp: Array<{
    documentId: number;
    sessionId: string | null;
    vehicleId: number | null;
    customerName: string;
    vehicleTitle: string;
    principalBalance: number;
    createdAt: string;
  }>;
  visitsToday: VisitRecord[];
  pendingTradeIns: TradeInRecord[];
  pendingTasks: StaffTaskRecord[];
  incompleteVehicles: Array<{
    id: string;
    title: string;
    status: VehicleStatus;
    issues: string[];
  }>;
}

export interface ManagementMetrics {
  avgFirstHumanReplyMinutes: number | null;
  humanReplySampleSize: number;
  queueByAssignee: Array<{
    assigneeName: string;
    assigneeId: number | null;
    total: number;
    awaitingReply: number;
    sessions: Array<{ sessionId: string; leadName: string | null; stage: string }>;
  }>;
  funnel: {
    interesse: number;
    proposta: number;
    visita: number;
    venda: number;
  };
  lossReasons: Array<{ reason: string; count: number; sessionIds: string[] }>;
  demandWithoutProgress: Array<{
    vehicleId: string;
    title: string;
    status: string;
    inquiries: number;
    proposals: number;
    visits: number;
  }>;
  reactivationQueue: Array<{
    id: string;
    reason: string;
    sessionId: string | null;
    customerName: string;
    customerPhone: string | null;
    vehicleId: string | null;
    vehicleTitle: string;
    draftMessage: string;
    lastActivityAt: string;
  }>;
}

export interface CopilotQueryResult {
  answer: string;
  mode: 'deterministic_query' | 'stock_alternatives' | 'draft_reply' | 'summary';
  draftText?: string | null;
  records: Array<{
    type: 'session' | 'vehicle' | 'visit' | 'trade_in' | 'document';
    id: string;
    title: string;
    subtitle: string;
    actionLabel: string;
  }>;
}

