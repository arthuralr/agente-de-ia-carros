import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import { AdminUser } from '../../types';
import { setAdminSessionToken } from '../../utils/authSession';

interface AdminLoginPageProps {
  dealershipName: string;
  redirectNotice?: string | null;
  onLoginSuccess: (user: AdminUser) => void;
  onBackToCatalog: () => void;
}

export const AdminLoginPage: React.FC<AdminLoginPageProps> = ({
  dealershipName,
  redirectNotice,
  onLoginSuccess,
  onBackToCatalog,
}) => {
  const initialInviteToken = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('convite')?.trim() || '';
  }, []);

  const [mode, setMode] = useState<'login' | 'invite' | 'bootstrap'>(
    initialInviteToken ? 'invite' : 'login'
  );
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [bootstrapName, setBootstrapName] = useState('');
  const [inviteToken, setInviteToken] = useState(initialInviteToken);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch('/api/auth/bootstrap-status')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { needsBootstrap?: boolean } | null) => {
        if (active && data?.needsBootstrap === true) {
          setNeedsBootstrap(true);
          if (!initialInviteToken) {
            setMode('bootstrap');
          }
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [initialInviteToken]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (mode === 'bootstrap') {
      if (!bootstrapName.trim() || !email.trim()) {
        setErrorMsg('Informe nome completo e e-mail corporativo do primeiro administrador.');
        return;
      }
      if (password.length < 10) {
        setErrorMsg('Defina uma senha forte com pelo menos 10 caracteres.');
        return;
      }
      if (password !== confirmPassword) {
        setErrorMsg('As senhas digitadas não coincidem.');
        return;
      }
      setIsSubmitting(true);
      try {
        const res = await fetch('/api/auth/bootstrap-admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            name: bootstrapName.trim(),
            email: email.trim(),
            password,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          authenticated?: boolean;
          user?: AdminUser;
          token?: string;
          error?: string;
        };
        if (!res.ok || !data.authenticated || !data.user) {
          throw new Error(
            data.error || 'Não foi possível criar o administrador inicial.'
          );
        }
        if (data.token) {
          setAdminSessionToken(data.token);
        }
        onLoginSuccess(data.user);
      } catch (err: unknown) {
        setErrorMsg(
          err instanceof Error
            ? err.message
            : 'Erro ao configurar o primeiro administrador.'
        );
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (mode === 'invite') {
      if (!inviteToken.trim()) {
        setErrorMsg('Informe o código de convite recebido do administrador.');
        return;
      }
      if (password.length < 8) {
        setErrorMsg('Defina uma senha com pelo menos 8 caracteres.');
        return;
      }
      if (password !== confirmPassword) {
        setErrorMsg('As senhas digitadas não coincidem.');
        return;
      }
      setIsSubmitting(true);
      try {
        const res = await fetch('/api/auth/accept-invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            token: inviteToken.trim(),
            password,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          authenticated?: boolean;
          user?: AdminUser;
          token?: string;
          error?: string;
        };
        if (!res.ok || !data.authenticated || !data.user) {
          throw new Error(
            data.error || 'Não foi possível ativar sua conta com este convite.'
          );
        }
        if (data.token) {
          setAdminSessionToken(data.token);
        }
        onLoginSuccess(data.user);
      } catch (err: unknown) {
        setErrorMsg(
          err instanceof Error
            ? err.message
            : 'Erro ao aceitar convite no servidor.'
        );
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (!email.trim() || !password) {
      setErrorMsg('Preencha o e-mail corporativo e a senha para acessar a Central.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email: email.trim(),
          password,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        authenticated?: boolean;
        user?: AdminUser;
        token?: string;
        error?: string;
      };

      if (!res.ok || !data.authenticated || !data.user) {
        throw new Error(
          data.error || 'Não foi possível validar suas credenciais.'
        );
      }

      if (data.token) {
        setAdminSessionToken(data.token);
      }
      onLoginSuccess(data.user);
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Erro de conexão ao autenticar no servidor.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#09090B] text-zinc-100 flex flex-col justify-between">
      {/* Top Bar */}
      <header className="h-16 px-6 lg:px-10 border-b border-white/[0.08] flex items-center justify-between gap-6">
        <button
          type="button"
          onClick={onBackToCatalog}
          className="flex items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 rounded-md"
        >
          <div className="w-8 h-8 rounded-lg bg-red-600 flex items-center justify-center shrink-0">
            <svg
              viewBox="0 0 24 24"
              className="w-4 h-4 text-white"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 16h18" />
              <path d="M5 16l2.2-6.5A2 2 0 0 1 9.1 8h5.8a2 2 0 0 1 1.9 1.5L19 16" />
              <circle cx="7.5" cy="16" r="1.5" fill="currentColor" />
              <circle cx="16.5" cy="16" r="1.5" fill="currentColor" />
            </svg>
          </div>
          <span className="font-display font-semibold text-base tracking-tight text-white whitespace-nowrap">
            {dealershipName}
          </span>
        </button>

        <button
          type="button"
          onClick={onBackToCatalog}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium text-zinc-300 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] transition-colors whitespace-nowrap shrink-0"
        >
          <ArrowLeft className="w-3.5 h-3.5 text-zinc-400" />
          <span>Voltar à área pública</span>
        </button>
      </header>

      {/* Center Login Container */}
      <main className="flex-1 flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-[440px]">
          <div className="bg-[#111114] border border-white/[0.08] rounded-xl p-8">
            <div className="mb-6">
              <div className="flex items-center gap-2 text-xs font-medium text-red-500 mb-2">
                <Lock className="w-3.5 h-3.5" />
                <span>Acesso da Equipe · Central da Revenda</span>
              </div>
              <h1 className="font-display text-2xl font-semibold text-white tracking-tight">
                {mode === 'bootstrap'
                  ? 'Configurar Administrador Inicial'
                  : mode === 'invite'
                    ? 'Ativar Conta por Convite'
                    : 'Entrar na Central da Revenda'}
              </h1>
              <p className="text-sm text-zinc-400 mt-1.5 leading-relaxed">
                {mode === 'bootstrap'
                  ? 'Nenhuma conta administrativa existe neste ambiente. Cadastre o primeiro administrador para bloquear o acesso inicial.'
                  : mode === 'invite'
                    ? 'Defina sua senha individual para acessar atendimentos, estoque, divulgação e documentos conforme seu perfil.'
                    : 'Use sua conta individual de vendedor, assistente, gestor ou administrador.'}
              </p>
            </div>

            {redirectNotice && !errorMsg && (
              <div
                role="status"
                className="mb-5 px-3.5 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/25 text-xs text-amber-200 flex items-start gap-2.5"
              >
                <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span>{redirectNotice}</span>
              </div>
            )}

            {errorMsg && (
              <div
                role="alert"
                aria-live="polite"
                className="mb-5 px-3.5 py-3 rounded-lg bg-red-600/10 border border-red-600/30 text-xs text-red-200 flex items-start gap-2.5"
              >
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'bootstrap' && (
                <div>
                  <label
                    htmlFor="bootstrap-name"
                    className="block text-xs font-medium text-zinc-300 mb-1.5"
                  >
                    Nome do Administrador
                  </label>
                  <input
                    id="bootstrap-name"
                    type="text"
                    required
                    value={bootstrapName}
                    onChange={(e) => setBootstrapName(e.target.value)}
                    placeholder="Ex.: Diretor Comercial"
                    className="w-full px-3.5 py-2.5 rounded-lg bg-[#09090B] border border-white/[0.1] text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-red-600"
                  />
                </div>
              )}

              {mode === 'invite' ? (
                <div>
                  <label
                    htmlFor="invite-token"
                    className="block text-xs font-medium text-zinc-300 mb-1.5"
                  >
                    Token do Convite
                  </label>
                  <div className="relative">
                    <UserCheck className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="invite-token"
                      type="text"
                      required
                      value={inviteToken}
                      onChange={(e) => setInviteToken(e.target.value)}
                      placeholder="Cole o token recebido do administrador"
                      className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-[#09090B] border border-white/[0.1] text-sm font-mono text-white placeholder:text-zinc-600 focus:outline-none focus:border-red-600"
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label
                    htmlFor="admin-email"
                    className="block text-xs font-medium text-zinc-300 mb-1.5"
                  >
                    E-mail Corporativo
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="admin-email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="nome@revenda.com.br"
                      className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-[#09090B] border border-white/[0.1] text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600 transition-colors"
                    />
                  </div>
                </div>
              )}

              <div>
                <label
                  htmlFor="admin-password"
                  className="block text-xs font-medium text-zinc-300 mb-1.5"
                >
                  {mode === 'bootstrap'
                    ? 'Definir Senha Forte (mín. 10 caracteres)'
                    : mode === 'invite'
                      ? 'Definir Senha (mín. 8 caracteres)'
                      : 'Senha de Acesso'}
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="admin-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={
                      mode === 'login' ? 'current-password' : 'new-password'
                    }
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full pl-10 pr-11 py-2.5 rounded-lg bg-[#09090B] border border-white/[0.1] text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-zinc-500 hover:text-zinc-200 transition-colors"
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {(mode === 'invite' || mode === 'bootstrap') && (
                <div>
                  <label
                    htmlFor="confirm-password"
                    className="block text-xs font-medium text-zinc-300 mb-1.5"
                  >
                    Confirmar Senha
                  </label>
                  <input
                    id="confirm-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repita a senha"
                    className="w-full px-3.5 py-2.5 rounded-lg bg-[#09090B] border border-white/[0.1] text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-red-600"
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full mt-2 py-2.5 px-4 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-500 disabled:opacity-60 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Validando acesso...</span>
                  </>
                ) : (
                  <span>
                    {mode === 'bootstrap'
                      ? 'Criar Administrador e Entrar'
                      : mode === 'invite'
                        ? 'Ativar Conta e Entrar'
                        : 'Entrar na Central'}
                  </span>
                )}
              </button>
            </form>

            {!needsBootstrap && (
              <div className="mt-6 pt-5 border-t border-white/[0.08] flex items-center justify-between gap-2 text-xs text-zinc-400">
                <span>
                  {mode === 'invite'
                    ? 'Já possui conta ativa?'
                    : 'Recebeu um convite do administrador?'}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg(null);
                    setMode((prev) => (prev === 'login' ? 'invite' : 'login'));
                  }}
                  className="text-red-400 hover:text-red-300 font-medium transition-colors whitespace-nowrap"
                >
                  {mode === 'invite' ? 'Fazer login' : 'Aceitar convite'}
                </button>
              </div>
            )}
          </div>
        </div>
      </main>

      <footer className="py-5 px-6 text-center text-xs text-zinc-500 border-t border-white/[0.06]">
        {dealershipName} · Sessão protegida por cookie HttpOnly e controle de perfis no servidor
      </footer>
    </div>
  );
};
