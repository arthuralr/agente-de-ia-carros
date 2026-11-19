export type AppViewMode = 'catalog' | 'home' | 'chat' | 'privacy' | 'login' | 'admin';

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

export interface ChatMessage {
  id: string;
  sender: 'ia' | 'cliente';
  text: string;
  timestamp: string;
  replyTo?: ChatReplyContext;
  audio?: ChatAudioMeta;
  attachment?: ChatAttachment;
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
}
