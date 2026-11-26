import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Download,
  FileSignature,
  FileText,
  History,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
} from 'lucide-react';
import type {
  AdminUser,
  DealershipSettings,
  DocumentFieldSchema,
  DocumentTemplateRecord,
  DocumentTypeSlug,
  IssuedDocumentRecord,
  Lead,
  StaffRole,
  Vehicle,
} from '../../types';
import { adminFetch } from '../../utils/authSession';
import {
  buildPrefilledDocumentValues,
  computeDocumentFinancials,
  getMissingRequiredFields,
  isFieldVisible,
  renderDocumentPreviewText,
} from '../../utils/documentEngine';
import { formatBRL } from '../../utils/formatters';
import { canEmitTemplateForRole, hasPermission } from '../../utils/rbac';
import { ContractsModule } from './ContractsModule';

export interface DocumentPreselectState {
  sessionId?: string | null;
  leadId?: string | null;
  vehicleId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  downPayment?: number | null;
  installments?: number | null;
  documentId?: number | null;
}

interface DocumentosModuleProps {
  currentUser: AdminUser;
  vehicles: Vehicle[];
  leads: Lead[];
  settings: DealershipSettings;
  preselect?: DocumentPreselectState | null;
  onClearPreselect?: () => void;
  onUnauthorized: () => void;
  onDocumentIssued?: (doc: IssuedDocumentRecord) => void;
}

const DOC_TYPE_OPTIONS: Array<{ value: DocumentTypeSlug; label: string }> = [
  { value: 'proposta_comercial', label: 'Proposta Comercial' },
  { value: 'pre_avaliacao_troca', label: 'Pré-Avaliação de Troca' },
  { value: 'ficha_visita', label: 'Ficha de Visita / Test-Drive' },
  { value: 'termo_entrega', label: 'Checklist / Termo de Entrega' },
  { value: 'recibo', label: 'Recibo' },
  { value: 'contrato', label: 'Contrato' },
];

function createIdempotencyKey(): string {
  return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const DocumentosModule: React.FC<DocumentosModuleProps> = ({
  currentUser,
  vehicles,
  leads,
  settings,
  preselect,
  onClearPreselect,
  onUnauthorized,
  onDocumentIssued,
}) => {
  const canManageTemplates = hasPermission(
    currentUser.roleCode,
    'documents:manage_templates'
  );
  const canSeeLegacyContracts = hasPermission(
    currentUser.roleCode,
    'documents:emit_operational'
  );

  const [tab, setTab] = useState<'emitir' | 'historico' | 'modelos' | 'legado'>(
    'emitir'
  );
  const [templates, setTemplates] = useState<DocumentTemplateRecord[]>([]);
  const [documents, setDocuments] = useState<IssuedDocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Issue form state
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(
    null
  );
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>(
    preselect?.vehicleId || vehicles[0]?.id || ''
  );
  const [linkedSessionId, setLinkedSessionId] = useState<string | null>(
    preselect?.sessionId || null
  );
  const [supersedesDocumentId, setSupersedesDocumentId] = useState<
    number | null
  >(null);
  const [values, setValues] = useState<
    Record<string, string | number | boolean>
  >({});
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() =>
    createIdempotencyKey()
  );
  const [issuing, setIssuing] = useState(false);
  const [downloadingDocId, setDownloadingDocId] = useState<number | null>(null);
  const [lastIssuedDoc, setLastIssuedDoc] =
    useState<IssuedDocumentRecord | null>(null);

  // Template admin form state
  const [newTplSlug, setNewTplSlug] = useState('');
  const [newTplName, setNewTplName] = useState('');
  const [newTplType, setNewTplType] =
    useState<DocumentTypeSlug>('proposta_comercial');
  const [newTplStatus, setNewTplStatus] = useState<'ativo' | 'rascunho'>(
    'ativo'
  );
  const [newTplBody, setNewTplBody] = useState('');
  const [newTplRoles, setNewTplRoles] = useState<StaffRole[]>([
    'vendedor',
    'assistente',
    'gestor',
    'administrador',
  ]);
  const [savingTpl, setSavingTpl] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [tplRes, docsRes] = await Promise.all([
        adminFetch('/api/admin/document-templates'),
        adminFetch('/api/admin/documents'),
      ]);
      if (tplRes.status === 401 || docsRes.status === 401) {
        onUnauthorized();
        return;
      }
      if (tplRes.ok) {
        const d = (await tplRes.json()) as {
          templates?: DocumentTemplateRecord[];
        };
        const list = Array.isArray(d.templates) ? d.templates : [];
        setTemplates(list);
      }
      if (docsRes.ok) {
        const d = (await docsRes.json()) as {
          documents?: IssuedDocumentRecord[];
        };
        setDocuments(Array.isArray(d.documents) ? d.documents : []);
      }
    } catch {
      setErrorMsg('Erro ao carregar modelos e histórico de documentos.');
    } finally {
      setLoading(false);
    }
  }, [onUnauthorized]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const activeTemplates = useMemo(() => {
    return templates.filter(
      (t) =>
        t.status === 'ativo' &&
        canEmitTemplateForRole(currentUser.roleCode, t.allowedRoles)
    );
  }, [templates, currentUser.roleCode]);

  useEffect(() => {
    if (selectedTemplateId === null && activeTemplates.length > 0) {
      setSelectedTemplateId(activeTemplates[0].id);
    }
  }, [activeTemplates, selectedTemplateId]);

  const selectedTemplate = useMemo(
    () =>
      activeTemplates.find((t) => t.id === selectedTemplateId) ||
      activeTemplates[0] ||
      null,
    [activeTemplates, selectedTemplateId]
  );

  const selectedVehicle = useMemo(
    () => vehicles.find((v) => String(v.id) === String(selectedVehicleId)) || null,
    [vehicles, selectedVehicleId]
  );

  // Handle preselection from Atendimentos / Hoje / Estoque
  useEffect(() => {
    if (!preselect) return;
    if (preselect.documentId) {
      setTab('historico');
      onClearPreselect?.();
      return;
    }
    if (preselect.vehicleId) {
      setSelectedVehicleId(preselect.vehicleId);
    }
    if (preselect.sessionId) {
      setLinkedSessionId(preselect.sessionId);
    }
    setTab('emitir');
    setSupersedesDocumentId(null);
    setIdempotencyKey(createIdempotencyKey());
  }, [preselect, onClearPreselect]);

  // Auto-prefill fields whenever template or vehicle changes
  useEffect(() => {
    if (!selectedTemplate) return;
    const prefilled = buildPrefilledDocumentValues(selectedTemplate, {
      dealership: settings,
      vehicle: selectedVehicle,
      customerName: preselect?.customerName,
      customerPhone: preselect?.customerPhone,
      downPayment: preselect?.downPayment,
      installments: preselect?.installments,
      salespersonName: currentUser.name,
    });
    setValues((prev) => {
      // Preserve user-typed customer fields if already filled and not overridden by preselect
      const merged = { ...prefilled };
      if (!preselect?.customerName && prev.customer_name) {
        merged.customer_name = prev.customer_name;
      }
      if (!preselect?.customerPhone && prev.customer_phone) {
        merged.customer_phone = prev.customer_phone;
      }
      if (
        preselect?.downPayment === undefined &&
        prev.down_payment !== undefined &&
        prev.down_payment !== ''
      ) {
        merged.down_payment = prev.down_payment;
      }
      if (
        preselect?.installments === undefined &&
        prev.installments !== undefined &&
        prev.installments !== ''
      ) {
        merged.installments = prev.installments;
      }
      return merged;
    });
    setIdempotencyKey(createIdempotencyKey());
    if (preselect && !preselect.documentId) {
      onClearPreselect?.();
    }
  }, [
    selectedTemplate?.id,
    selectedVehicle?.id,
    settings,
    currentUser.name,
    preselect,
    onClearPreselect,
  ]);

  const missingRequired = useMemo(() => {
    if (!selectedTemplate) return [];
    return getMissingRequiredFields(selectedTemplate.fieldsSchema, values);
  }, [selectedTemplate, values]);

  const calculatedTotals = useMemo(
    () => computeDocumentFinancials(values, settings),
    [values, settings]
  );

  const previewText = useMemo(() => {
    if (!selectedTemplate) return '';
    return renderDocumentPreviewText({
      template: selectedTemplate,
      dealership: settings,
      values,
      totals: calculatedTotals,
      issuedByName: currentUser.name,
    });
  }, [selectedTemplate, settings, values, calculatedTotals, currentUser.name]);

  const handleFieldChange = (
    field: DocumentFieldSchema,
    raw: string | boolean
  ) => {
    setValues((prev) => {
      if (field.type === 'boolean') {
        return { ...prev, [field.key]: Boolean(raw) };
      }
      if (field.type === 'currency' || field.type === 'number') {
        if (raw === '') return { ...prev, [field.key]: '' };
        const n = Number(String(raw).replace(',', '.'));
        return { ...prev, [field.key]: Number.isFinite(n) ? n : '' };
      }
      return { ...prev, [field.key]: String(raw) };
    });
    // Regenerate idempotency key when form content intentionally changes
    setIdempotencyKey(createIdempotencyKey());
  };

  const handleDownloadPdf = async (docId: number, templateSlug: string) => {
    setDownloadingDocId(docId);
    setErrorMsg(null);
    try {
      const res = await adminFetch(`/api/admin/documents/${docId}/pdf`);
      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || 'Falha ao baixar PDF do documento.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${templateSlug}-${String(docId).padStart(5, '0')}.pdf`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Erro ao gerar download do PDF.'
      );
    } finally {
      setDownloadingDocId(null);
    }
  };

  const handleIssueDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTemplate || missingRequired.length > 0) return;

    setIssuing(true);
    setErrorMsg(null);
    try {
      const res = await adminFetch('/api/admin/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: selectedTemplate.id,
          sessionId: linkedSessionId,
          vehicleId: selectedVehicle ? Number(selectedVehicle.id) : null,
          supersedesDocumentId,
          idempotencyKey,
          values,
        }),
      });
      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        document?: IssuedDocumentRecord;
        error?: string;
        missingFields?: string[];
      };
      if (!res.ok || !data.document) {
        throw new Error(
          data.error || 'Não foi possível emitir o documento.'
        );
      }

      setLastIssuedDoc(data.document);
      setSupersedesDocumentId(null);
      setNotice(
        `Documento #${String(data.document.id).padStart(5, '0')} emitido com snapshot imutável.`
      );
      onDocumentIssued?.(data.document);
      await loadData();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Erro ao emitir documento.'
      );
    } finally {
      setIssuing(false);
    }
  };

  const handleSupersedeDocument = (doc: IssuedDocumentRecord) => {
    const matchingTpl =
      activeTemplates.find((t) => t.slug === doc.templateSlug) ||
      activeTemplates[0] ||
      null;
    if (matchingTpl) setSelectedTemplateId(matchingTpl.id);
    if (doc.vehicleId) setSelectedVehicleId(String(doc.vehicleId));
    setLinkedSessionId(doc.sessionId);
    setSupersedesDocumentId(doc.id);
    const copiedValues: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(doc.values || {})) {
      if (v !== null && v !== undefined) copiedValues[k] = v;
    }
    setValues(copiedValues);
    setIdempotencyKey(createIdempotencyKey());
    setTab('emitir');
    setNotice(
      `Reemitindo versão revisada substituindo documento #${String(doc.id).padStart(5, '0')}. O original permanece preservado no histórico.`
    );
  };

  const handleCreateTemplateVersion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageTemplates || !newTplSlug.trim() || !newTplName.trim() || !newTplBody.trim()) {
      return;
    }
    setSavingTpl(true);
    setErrorMsg(null);
    try {
      const baseExisting = templates.find((t) => t.slug === newTplSlug.trim());
      const res = await adminFetch('/api/admin/document-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: newTplSlug.trim(),
          name: newTplName.trim(),
          docType: newTplType,
          status: newTplStatus,
          isExampleTemplate: false,
          allowedRoles: newTplRoles,
          fieldsSchema:
            baseExisting?.fieldsSchema ||
            templates.find((t) => t.docType === newTplType)?.fieldsSchema ||
            [],
          bodyTemplate: newTplBody.trim(),
        }),
      });
      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || 'Falha ao salvar nova versão do modelo.');
      }
      setNotice('Nova versão do modelo gravada. Documentos já emitidos permanecem intactos.');
      setNewTplBody('');
      await loadData();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao salvar modelo.');
    } finally {
      setSavingTpl(false);
    }
  };

  const handleToggleTemplateStatus = async (
    tpl: DocumentTemplateRecord,
    nextStatus: 'ativo' | 'rascunho' | 'arquivado'
  ) => {
    try {
      const res = await adminFetch(
        `/api/admin/document-templates/${tpl.id}/status`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: nextStatus }),
        }
      );
      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      await loadData();
    } catch {
      setErrorMsg('Erro ao alterar status do modelo.');
    }
  };

  return (
    <div className="space-y-5">
      {/* Sub-tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-[#111114] border border-white/[0.08] rounded-lg">
          <button
            type="button"
            onClick={() => setTab('emitir')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
              tab === 'emitir'
                ? 'bg-zinc-800 text-white'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Emitir Documento</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('historico')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
              tab === 'historico'
                ? 'bg-zinc-800 text-white'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Histórico Emitido ({documents.length})</span>
          </button>
          {canManageTemplates && (
            <button
              type="button"
              onClick={() => setTab('modelos')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                tab === 'modelos'
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Biblioteca de Modelos</span>
            </button>
          )}
          {canSeeLegacyContracts && (
            <button
              type="button"
              onClick={() => setTab('legado')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                tab === 'legado'
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <FileSignature className="w-3.5 h-3.5" />
              <span>Contratos Impressos (Clássico)</span>
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => void loadData()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-300 bg-[#111114] hover:bg-white/[0.06] border border-white/[0.08]"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Atualizar</span>
        </button>
      </div>

      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-red-950/50 border border-red-600/40 text-xs text-red-200 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {notice && (
        <div className="p-3.5 rounded-xl bg-emerald-950/50 border border-emerald-500/35 text-xs text-emerald-200 flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{notice}</span>
          </span>
          {lastIssuedDoc && (
            <button
              type="button"
              disabled={downloadingDocId === lastIssuedDoc.id}
              onClick={() =>
                void handleDownloadPdf(
                  lastIssuedDoc.id,
                  lastIssuedDoc.templateSlug
                )
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              {downloadingDocId === lastIssuedDoc.id ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              <span>Baixar PDF agora</span>
            </button>
          )}
        </div>
      )}

      {/* TAB 1: EMITIR DOCUMENTO (ZERO TOKENS) */}
      {tab === 'emitir' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Guided Collector Form */}
          <form
            onSubmit={(e) => void handleIssueDocument(e)}
            className="xl:col-span-7 bg-[#111114] border border-white/[0.08] rounded-xl p-5 space-y-5"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Modelo de documento
                </label>
                <select
                  value={selectedTemplate?.id || ''}
                  onChange={(e) => {
                    setSelectedTemplateId(Number(e.target.value));
                    setSupersedesDocumentId(null);
                  }}
                  className="w-full px-3 py-2.5 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white focus:outline-none"
                >
                  {activeTemplates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id} className="bg-zinc-950">
                      {tpl.name} (v{tpl.version})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Vincular veículo do estoque
                </label>
                <select
                  value={selectedVehicleId}
                  onChange={(e) => setSelectedVehicleId(e.target.value)}
                  className="w-full px-3 py-2.5 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white focus:outline-none"
                >
                  <option value="" className="bg-zinc-950">
                    Sem veículo vinculado
                  </option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id} className="bg-zinc-950">
                      #{v.id} · {v.brand} {v.model} {v.year} ({formatBRL(v.price)})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {supersedesDocumentId && (
              <div className="p-3 rounded-lg bg-amber-950/35 border border-amber-500/35 text-xs text-amber-200 flex items-center justify-between gap-2">
                <span>
                  Substituindo emissão anterior #{String(supersedesDocumentId).padStart(5, '0')} (histórico anterior será preservado).
                </span>
                <button
                  type="button"
                  onClick={() => setSupersedesDocumentId(null)}
                  className="text-amber-300 underline"
                >
                  Cancelar
                </button>
              </div>
            )}

            {/* Guided missing fields bar */}
            {missingRequired.length > 0 && (
              <div className="p-3 rounded-lg bg-amber-950/35 border border-amber-500/30 text-xs text-amber-200 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-amber-100">
                    Faltam {missingRequired.length} campo(s) obrigatório(s) antes de emitir:
                  </p>
                  <p className="text-amber-200/85 mt-0.5">
                    {missingRequired.map((f) => f.label).join(' · ')}
                  </p>
                </div>
              </div>
            )}

            {/* Dynamic Schema Fields */}
            {selectedTemplate && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {selectedTemplate.fieldsSchema.map((field) => {
                  if (!isFieldVisible(field, values)) return null;
                  const val = values[field.key];
                  const isMissing = missingRequired.some(
                    (m) => m.key === field.key
                  );
                  const isWide =
                    field.type === 'textarea' || field.type === 'boolean';

                  return (
                    <div
                      key={field.key}
                      className={isWide ? 'sm:col-span-2' : ''}
                    >
                      {field.type === 'boolean' ? (
                        <label className="flex items-center gap-2.5 py-2 text-xs font-medium text-zinc-200 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={Boolean(val)}
                            onChange={(e) =>
                              handleFieldChange(field, e.target.checked)
                            }
                            className="w-4 h-4 rounded border-white/20 accent-red-600"
                          />
                          <span>{field.label}</span>
                        </label>
                      ) : (
                        <>
                          <label className="block text-xs font-medium text-zinc-300 mb-1">
                            {field.label}
                            {field.required && (
                              <span className="text-red-400 ml-1">*</span>
                            )}
                          </label>
                          {field.type === 'select' && field.options ? (
                            <select
                              value={String(val ?? '')}
                              onChange={(e) =>
                                handleFieldChange(field, e.target.value)
                              }
                              className={`w-full px-3 py-2 bg-[#09090B] border rounded-lg text-sm text-white focus:outline-none ${
                                isMissing
                                  ? 'border-amber-500/60'
                                  : 'border-white/[0.1] focus:border-red-600'
                              }`}
                            >
                              {field.options.map((opt) => (
                                <option
                                  key={opt}
                                  value={opt}
                                  className="bg-zinc-950"
                                >
                                  {opt}
                                </option>
                              ))}
                            </select>
                          ) : field.type === 'textarea' ? (
                            <textarea
                              rows={3}
                              value={String(val ?? '')}
                              onChange={(e) =>
                                handleFieldChange(field, e.target.value)
                              }
                              className={`w-full px-3 py-2 bg-[#09090B] border rounded-lg text-sm text-white focus:outline-none ${
                                isMissing
                                  ? 'border-amber-500/60'
                                  : 'border-white/[0.1] focus:border-red-600'
                              }`}
                            />
                          ) : (
                            <input
                              type={
                                field.type === 'date'
                                  ? 'date'
                                  : field.type === 'currency' ||
                                      field.type === 'number'
                                    ? 'number'
                                    : 'text'
                              }
                              step={field.type === 'currency' ? '0.01' : undefined}
                              value={val === undefined || val === null ? '' : String(val)}
                              onChange={(e) =>
                                handleFieldChange(field, e.target.value)
                              }
                              className={`w-full px-3 py-2 bg-[#09090B] border rounded-lg text-sm text-white focus:outline-none ${
                                field.type === 'currency' ||
                                field.type === 'number'
                                  ? 'font-mono tabular-nums'
                                  : ''
                              } ${
                                isMissing
                                  ? 'border-amber-500/60'
                                  : 'border-white/[0.1] focus:border-red-600'
                              }`}
                            />
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Deterministic Financial Summary Box */}
            {selectedTemplate?.docType === 'proposta_comercial' &&
              calculatedTotals.vehiclePrice > 0 && (
                <div className="p-4 rounded-xl bg-[#09090B] border border-white/[0.1] space-y-2 text-xs">
                  <p className="font-semibold text-zinc-200">
                    Demonstrativo Financeiro (Cálculo determinístico)
                  </p>
                  <div className="flex justify-between text-zinc-400">
                    <span>Valor do veículo</span>
                    <span className="font-mono tabular-nums text-white">
                      {formatBRL(calculatedTotals.vehiclePrice)}
                    </span>
                  </div>
                  <div className="flex justify-between text-zinc-400">
                    <span>Entrada informada</span>
                    <span className="font-mono tabular-nums text-zinc-200">
                      - {formatBRL(calculatedTotals.downPayment)}
                    </span>
                  </div>
                  {calculatedTotals.tradeInValue > 0 && (
                    <div className="flex justify-between text-zinc-400">
                      <span>Troca pré-aprovada</span>
                      <span className="font-mono tabular-nums text-zinc-200">
                        - {formatBRL(calculatedTotals.tradeInValue)}
                      </span>
                    </div>
                  )}
                  <div className="pt-2 border-t border-white/[0.08] flex justify-between font-semibold text-sm">
                    <span className="text-white">
                      Saldo principal antes de encargos
                    </span>
                    <span className="font-mono tabular-nums text-emerald-400">
                      {formatBRL(calculatedTotals.principalBalance)}
                    </span>
                  </div>
                  {calculatedTotals.installments && (
                    <p className="text-[11px] text-zinc-400">
                      {calculatedTotals.estimatedInstallment &&
                      calculatedTotals.monthlyRatePct
                        ? `Estimativa ilustrativa (${calculatedTotals.installments}x a ${calculatedTotals.monthlyRatePct.toFixed(2)}% a.m.): ${formatBRL(calculatedTotals.estimatedInstallment)}`
                        : `Prazo solicitado: ${calculatedTotals.installments}x — parcela final depende da análise bancária.`}
                    </p>
                  )}
                  <p className="text-[11px] text-zinc-500">
                    {calculatedTotals.note}
                  </p>
                </div>
              )}

            <div className="flex flex-wrap items-center justify-end gap-3 pt-2 border-t border-white/[0.06]">
              <button
                type="submit"
                disabled={issuing || !selectedTemplate || missingRequired.length > 0}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {issuing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <FileText className="w-4 h-4" />
                )}
                <span>
                  {issuing
                    ? 'Emitindo documento...'
                    : 'Emitir Documento e Salvar Snapshot'}
                </span>
              </button>
            </div>
          </form>

          {/* Live Document Preview */}
          <div className="xl:col-span-5 bg-[#111114] border border-white/[0.08] rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-white">
                Pré-visualização do Documento
              </h3>
              {selectedTemplate && (
                <span className="text-[11px] font-mono text-zinc-500">
                  {selectedTemplate.slug} · v{selectedTemplate.version}
                </span>
              )}
            </div>
            <pre className="p-4 rounded-lg bg-[#09090B] border border-white/[0.08] text-xs text-zinc-200 whitespace-pre-wrap font-sans leading-relaxed max-h-[600px] overflow-y-auto">
              {previewText || 'Selecione um modelo para visualizar o documento.'}
            </pre>
            <p className="text-[11px] text-zinc-500">
              Ao emitir, o endereço oficial da loja, os dados do veículo e a versão do modelo são congelados em snapshot imutável para download em PDF a qualquer momento.
            </p>
          </div>
        </div>
      )}

      {/* TAB 2: HISTÓRICO IMUTÁVEL */}
      {tab === 'historico' && (
        <div className="bg-[#111114] border border-white/[0.08] rounded-xl overflow-hidden">
          {documents.length === 0 ? (
            <div className="py-12 px-6 text-center text-xs text-zinc-500">
              Nenhum documento emitido ainda.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/[0.08] text-xs font-medium text-zinc-400 bg-white/[0.01]">
                    <th className="py-3 px-4">Nº / Modelo</th>
                    <th className="py-3 px-4">Cliente & Veículo</th>
                    <th className="py-3 px-4 text-right">Saldo / Valor</th>
                    <th className="py-3 px-4">Emissão & Snapshot</th>
                    <th className="py-3 px-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06] text-xs">
                  {documents.map((doc) => (
                    <tr key={doc.id} className="hover:bg-white/[0.02]">
                      <td className="py-3 px-4">
                        <p className="font-mono font-semibold text-white tabular-nums">
                          #{String(doc.id).padStart(5, '0')}
                        </p>
                        <p className="text-zinc-300 mt-0.5">
                          {doc.templateName} (v{doc.templateVersion})
                        </p>
                        {doc.supersedesDocumentId && (
                          <p className="text-[10px] text-amber-400 mt-0.5">
                            Substitui #{String(doc.supersedesDocumentId).padStart(5, '0')}
                          </p>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-medium text-zinc-100">
                          {String(doc.values.customer_name || 'Cliente não informado')}
                        </p>
                        <p className="text-zinc-400 mt-0.5">
                          {String(doc.values.vehicle_title || 'Sem veículo vinculado')}
                        </p>
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                        {doc.calculatedTotals && doc.calculatedTotals.vehiclePrice > 0 ? (
                          <div>
                            <p className="text-white font-semibold">
                              {formatBRL(doc.calculatedTotals.principalBalance)}
                            </p>
                            <p className="text-[10px] text-zinc-500">
                              Veículo {formatBRL(doc.calculatedTotals.vehiclePrice)}
                            </p>
                          </div>
                        ) : (
                          <span className="text-zinc-500">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <p className="text-zinc-300">
                          {new Date(doc.createdAt).toLocaleString('pt-BR', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                        <p className="text-[11px] text-zinc-500 truncate max-w-[240px]">
                          {doc.issuedByName} · {doc.dealershipSnapshot.address || doc.dealershipSnapshot.tradeName}
                        </p>
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={downloadingDocId === doc.id}
                            onClick={() =>
                              void handleDownloadPdf(doc.id, doc.templateSlug)
                            }
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-500 disabled:opacity-50"
                          >
                            {downloadingDocId === doc.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Download className="w-3.5 h-3.5" />
                            )}
                            <span>PDF</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSupersedeDocument(doc)}
                            className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-zinc-300 bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08]"
                          >
                            Reemitir
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: BIBLIOTECA DE MODELOS (ADMIN) */}
      {tab === 'modelos' && canManageTemplates && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          <div className="xl:col-span-7 bg-[#111114] border border-white/[0.08] rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-white">
              Modelos Versionados
            </h3>
            <div className="divide-y divide-white/[0.06]">
              {templates.map((tpl) => (
                <div
                  key={tpl.id}
                  className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-semibold text-white">
                        {tpl.name}
                      </p>
                      <span className="text-[10px] font-mono text-zinc-400">
                        v{tpl.version} · {tpl.slug}
                      </span>
                      <span
                        className={`text-[10px] font-medium ${
                          tpl.status === 'ativo'
                            ? 'text-emerald-400'
                            : tpl.status === 'rascunho'
                              ? 'text-amber-400'
                              : 'text-zinc-500'
                        }`}
                      >
                        {tpl.status}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-500 mt-0.5">
                      Perfis: {tpl.allowedRoles.join(', ')}
                      {tpl.isExampleTemplate ? ' · Modelo de exemplo (revisar texto jurídico)' : ''}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setNewTplSlug(tpl.slug);
                        setNewTplName(tpl.name);
                        setNewTplType(tpl.docType);
                        setNewTplBody(tpl.bodyTemplate);
                        setNewTplRoles(tpl.allowedRoles);
                      }}
                      className="px-2.5 py-1 rounded-md text-[11px] font-medium text-zinc-300 bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08]"
                    >
                      Nova versão
                    </button>
                    {tpl.status !== 'ativo' ? (
                      <button
                        type="button"
                        onClick={() =>
                          void handleToggleTemplateStatus(tpl, 'ativo')
                        }
                        className="px-2.5 py-1 rounded-md text-[11px] font-medium text-emerald-300 bg-emerald-600/15 hover:bg-emerald-600/25 border border-emerald-500/30"
                      >
                        Ativar
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          void handleToggleTemplateStatus(tpl, 'arquivado')
                        }
                        className="px-2.5 py-1 rounded-md text-[11px] font-medium text-zinc-400 bg-white/[0.04] hover:bg-white/[0.08]"
                      >
                        Arquivar
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <form
            onSubmit={(e) => void handleCreateTemplateVersion(e)}
            className="xl:col-span-5 bg-[#111114] border border-white/[0.08] rounded-xl p-5 space-y-4"
          >
            <h3 className="text-sm font-semibold text-white">
              Criar Modelo ou Publicar Nova Versão
            </h3>
            <p className="text-xs text-zinc-400">
              Usar o mesmo identificador (slug) cria automaticamente a versão seguinte sem alterar documentos já emitidos.
            </p>
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Slug identificador *
              </label>
              <input
                required
                type="text"
                value={newTplSlug}
                onChange={(e) => setNewTplSlug(e.target.value)}
                placeholder="ex: proposta-comercial"
                className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] rounded-lg text-sm text-white font-mono focus:outline-none focus:border-red-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Nome exibido *
              </label>
              <input
                required
                type="text"
                value={newTplName}
                onChange={(e) => setNewTplName(e.target.value)}
                placeholder="Ex: Proposta Comercial Oficial"
                className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] rounded-lg text-sm text-white focus:outline-none focus:border-red-600"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Tipo
                </label>
                <select
                  value={newTplType}
                  onChange={(e) =>
                    setNewTplType(e.target.value as DocumentTypeSlug)
                  }
                  className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] rounded-lg text-xs text-white focus:outline-none"
                >
                  {DOC_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value} className="bg-zinc-950">
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Status inicial
                </label>
                <select
                  value={newTplStatus}
                  onChange={(e) =>
                    setNewTplStatus(e.target.value as 'ativo' | 'rascunho')
                  }
                  className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] rounded-lg text-xs text-white focus:outline-none"
                >
                  <option value="ativo" className="bg-zinc-950">
                    Ativo
                  </option>
                  <option value="rascunho" className="bg-zinc-950">
                    Rascunho
                  </option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Cláusulas / Texto institucional *
              </label>
              <textarea
                required
                rows={5}
                value={newTplBody}
                onChange={(e) => setNewTplBody(e.target.value)}
                placeholder="Informe o texto jurídico ou condições comerciais oficiais..."
                className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] rounded-lg text-xs text-white focus:outline-none focus:border-red-600"
              />
            </div>
            <button
              type="submit"
              disabled={savingTpl}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-500 disabled:opacity-50"
            >
              {savingTpl ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              <span>Salvar Nova Versão</span>
            </button>
          </form>
        </div>
      )}

      {/* TAB 4: CONTRATOS CLÁSSICOS (BACKWARD COMPATIBILITY) */}
      {tab === 'legado' && canSeeLegacyContracts && (
        <ContractsModule
          leads={leads}
          vehicles={vehicles}
          settings={settings}
          preselectedLeadId={preselect?.leadId || null}
          preselectedVehicleId={preselect?.vehicleId || null}
          onClearPreselection={() => onClearPreselect?.()}
          onContractCreated={() => {}}
          onUnauthorized={onUnauthorized}
        />
      )}
    </div>
  );
};
