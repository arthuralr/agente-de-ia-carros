import React from 'react';
import {
  ArrowLeft,
  Database,
  FileCheck2,
  Lock,
  MessageSquare,
  ShieldCheck,
  Trash2,
  UserCheck,
} from 'lucide-react';
import { DealershipSettings } from '../../types';
import { formatWhatsAppLink } from '../../utils/formatters';

interface PrivacyPolicyPageProps {
  settings: DealershipSettings;
  onBack: () => void;
  onOpenChat: () => void;
}

export const PrivacyPolicyPage: React.FC<PrivacyPolicyPageProps> = ({
  settings,
  onBack,
  onOpenChat,
}) => {
  return (
    <div className="min-h-screen bg-[#09090B] text-zinc-100 flex flex-col">
      {/* Slim Top Bar */}
      <header className="sticky top-0 z-30 h-16 border-b border-white/[0.08] bg-[#09090B]/95 backdrop-blur-md">
        <div className="max-w-4xl mx-auto h-full px-5 sm:px-8 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 text-xs sm:text-sm font-medium text-zinc-300 hover:text-white transition-colors min-h-[44px]"
          >
            <ArrowLeft className="w-4 h-4 text-zinc-400" />
            <span>Voltar à Vitrine</span>
          </button>

          <button
            type="button"
            onClick={onOpenChat}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-500 transition-colors whitespace-nowrap"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Consultor Online</span>
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-4xl w-full mx-auto px-5 sm:px-8 py-10 sm:py-14 space-y-8">
        <div className="space-y-3 border-b border-white/[0.08] pb-8">
          <div className="inline-flex items-center gap-2 text-xs font-medium text-red-400">
            <ShieldCheck className="w-4 h-4" />
            <span>Conformidade LGPD · Lei nº 13.709/2018</span>
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-white">
            Política de Privacidade e Proteção de Dados
          </h1>
          <p className="text-sm text-zinc-400 leading-relaxed max-w-2xl">
            A <strong className="text-zinc-200">{settings.tradeName}</strong>{' '}
            ({settings.legalName}, CNPJ {settings.cnpj}) adota práticas de
            minimização de dados e transparência em todos os atendimentos
            realizados na vitrine digital e pelo Consultor Virtual de IA.
          </p>
        </div>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <article className="bg-[#111114] border border-white/[0.08] rounded-xl p-6 space-y-3">
            <div className="flex items-center gap-2.5 text-white">
              <UserCheck className="w-4 h-4 text-red-500 shrink-0" />
              <h2 className="font-display text-base font-semibold">
                1. Minimização dos Dados Coletados
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
              No atendimento digital e pelo agente de IA solicitamos apenas os
              dados estritamente necessários para iniciar sua consulta:
              <strong className="text-white"> nome</strong>,{' '}
              <strong className="text-white">telefone/WhatsApp</strong> e o
              veículo de interesse, além do histórico das mensagens trocadas no
              atendimento.
            </p>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Não solicitamos CPF, RG, dados bancários ou documentos sensíveis
              pelo chat automatizado. Informações cadastrais para faturamento só
              são tratadas presencialmente ou na etapa formal de contrato.
            </p>
          </article>

          <article className="bg-[#111114] border border-white/[0.08] rounded-xl p-6 space-y-3">
            <div className="flex items-center gap-2.5 text-white">
              <FileCheck2 className="w-4 h-4 text-red-500 shrink-0" />
              <h2 className="font-display text-base font-semibold">
                2. Finalidade e Consentimento Ativo
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
              Seus dados de contato são registrados somente após seu{' '}
              <strong className="text-white">consentimento ativo (opt-in)</strong>{' '}
              e utilizados exclusivamente para:
            </p>
            <ul className="text-xs sm:text-sm text-zinc-400 space-y-1.5 list-disc pl-4">
              <li>Retorno comercial sobre disponibilidade e laudo cautelar;</li>
              <li>Simulação de financiamento ou avaliação de troca solicitada;</li>
              <li>Agendamento de visita ao showroom e envio de ofertas alinhadas ao seu interesse.</li>
            </ul>
          </article>

          <article className="bg-[#111114] border border-white/[0.08] rounded-xl p-6 space-y-3">
            <div className="flex items-center gap-2.5 text-white">
              <Database className="w-4 h-4 text-red-500 shrink-0" />
              <h2 className="font-display text-base font-semibold">
                3. Armazenamento Seguro e Acesso Restrito
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
              Os registros e o histórico de conversas são armazenados em banco
              de dados PostgreSQL gerenciado (Neon) com conexão criptografada
              TLS/SSL. O acesso ao painel CRM é protegido por autenticação
              corporativa e tokens de sessão seguros, restrito à equipe comercial
              autorizada.
            </p>
            <p className="text-xs text-zinc-400 leading-relaxed">
              A {settings.tradeName} não vende, aluga nem compartilha listas de
              contatos com terceiros para fins publicitários externos.
            </p>
          </article>

          <article className="bg-[#111114] border border-white/[0.08] rounded-xl p-6 space-y-3">
            <div className="flex items-center gap-2.5 text-white">
              <Trash2 className="w-4 h-4 text-red-500 shrink-0" />
              <h2 className="font-display text-base font-semibold">
                4. Direitos do Titular e Exclusão Definitiva
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
              Nos termos do Art. 18 da LGPD, você pode solicitar a qualquer
              momento a confirmação de tratamento, correção, revogação do
              consentimento ou a{' '}
              <strong className="text-white">
                exclusão definitiva dos seus dados e histórico de chat
              </strong>{' '}
              do nosso banco de dados.
            </p>
            <p className="text-xs text-zinc-400 leading-relaxed">
              O pedido é executado diretamente pelo gestor no painel
              administrativo após solicitação pelo canal abaixo.
            </p>
          </article>
        </section>

        <section className="bg-[#111114] border border-white/[0.08] rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-medium text-zinc-200">
              <Lock className="w-4 h-4 text-red-500" />
              <span>Canal do Controlador / Encarregado de Dados (DPO)</span>
            </div>
            <p className="text-xs text-zinc-400">
              {settings.legalName} · {settings.address}, {settings.city}/
              {settings.state} · E-mail:{' '}
              <span className="text-zinc-200 font-mono">{settings.email}</span>
            </p>
          </div>

          <a
            href={formatWhatsAppLink(
              settings.whatsapp,
              `Olá! Gostaria de exercer meus direitos da LGPD (acesso ou exclusão de dados) na ${settings.tradeName}.`
            )}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold text-white bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.1] transition-colors whitespace-nowrap shrink-0"
          >
            <span>Solicitar via WhatsApp</span>
          </a>
        </section>
      </main>
    </div>
  );
};
