export type AppViewMode =
  | 'catalog'
  | 'home'
  | 'chat'
  | 'vehicle_detail'
  | 'privacy'
  | 'login'
  | 'admin';

export interface AdminUser {
  id: number;
  name: string;
  email: string;
  role: string;
  avatarUrl: string | null;
}

export type OperationMode = 'full' | 'agent_only';

export type NavModule =
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
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessage: string | null;
  lastSender: 'user' | 'assistant' | null;
}

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
}
