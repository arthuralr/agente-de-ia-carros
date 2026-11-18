export type AppViewMode = 'catalog' | 'home' | 'chat' | 'privacy' | 'login' | 'admin';

export interface AdminUser {
  id: number;
  name: string;
  email: string;
  role: string;
  avatarUrl: string | null;
}

export type NavModule =
  | 'dashboard'
  | 'inventory'
  | 'crm'
  | 'contracts'
  | 'social_ai'
  | 'radar'
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

export type LeadStage = 'Novo Lead' | 'Em Atendimento' | 'Proposta' | 'Fechado';

export interface ChatMessage {
  id: string;
  sender: 'ia' | 'cliente';
  text: string;
  timestamp: string;
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
  chatHistory: ChatMessage[];
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

export interface RadarOpportunity {
  id: string;
  title: string;
  brand: string;
  model: string;
  year: string;
  km: number;
  askingPrice: number;
  fipePrice: number;
  discountPercent?: number;
  source: 'OLX' | 'Webmotors' | 'Marketplace';
  link?: string;
  city: string;
  distanceKm: number;
  postedAgo: string;
  sellerType: 'Particular' | 'Repasse';
  highlights: string;
  imageUrl: string;
  saved: boolean;
  imported: boolean;
}

export interface ActivityLog {
  id: string;
  title: string;
  detail: string;
  time: string;
  category: 'estoque' | 'crm' | 'contrato' | 'radar';
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
  radarDefaultRadiusKm: number;
  minResaleMarginPct: number;
  defaultSocialCta: string;
  aiAssistantName: string;
  warrantyDays: number;
  warrantyKm: number;
}
