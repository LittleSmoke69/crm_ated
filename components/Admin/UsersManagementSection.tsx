'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Edit,
  KeyRound,
  Link2,
  Plus,
  Shield,
  UserCheck,
  UserPlus,
  UserX,
  Users,
} from 'lucide-react';
import { Button, Modal, EmptyState, Banner, Skeleton } from '@/components/ui';
import ToastContainer from '@/components/Toast/ToastContainer';
import type { Toast as ToastMessage } from '@/components/Toast/Toast';

/** Tela "Usuários": gestão de admins, gerentes e captadores (aba Usuários do painel admin). */

type OverviewUser = {
  id: string;
  email: string;
  full_name: string | null;
  status: string | null;
  enroller: string | null;
  enroller_name: string | null;
  created_at: string;
  is_active: boolean;
  leads_count: number;
};

type TabKey = 'todos' | 'admins' | 'gerentes' | 'captadores';

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super Admin',
  admin: 'Administrador',
  gerente: 'Gerente',
  captador: 'Captador',
};

const ROLE_BADGE_CLASS: Record<string, string> = {
  super_admin: 'border-fuchsia-400/60 text-fuchsia-600 dark:text-fuchsia-300 bg-fuchsia-500/10',
  admin: 'border-blue-400/60 text-blue-600 dark:text-blue-300 bg-blue-500/10',
  gerente: 'border-emerald-400/60 text-emerald-600 dark:text-emerald-300 bg-emerald-500/10',
  captador: 'border-violet-400/60 text-violet-600 dark:text-violet-300 bg-violet-500/10',
};

const AVATAR_COLORS = ['bg-blue-500', 'bg-violet-500', 'bg-purple-500', 'bg-orange-500', 'bg-pink-500', 'bg-teal-500', 'bg-indigo-500'];

function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function handleFromEmail(email: string): string {
  return (email || '').split('@')[0] || email;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('pt-BR');
  } catch {
    return '';
  }
}

const inputClass =
  'w-full px-4 py-2 min-h-[44px] border border-gray-200 dark:border-gray-600 rounded-xl text-gray-800 dark:text-white bg-white dark:bg-[#333] placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:ring-2 focus:ring-[#E86A24]/30 focus:border-[#E86A24] focus:outline-none';

const outlineBtn =
  'flex items-center justify-center gap-1.5 px-3 py-2 min-h-[36px] rounded-lg text-sm font-medium border transition-colors touch-manipulation';

export default function UsersManagementSection({
  adminUserId,
  isSuperAdmin = false,
  getTenantHeader,
}: {
  adminUserId: string | null;
  isSuperAdmin?: boolean;
  getTenantHeader?: () => Record<string, string>;
}) {
  const [users, setUsers] = useState<OverviewUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('todos');
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Modais
  const [createRole, setCreateRole] = useState<'admin' | 'gerente' | 'captador' | null>(null);
  const [createForm, setCreateForm] = useState({ fullName: '', email: '', password: '', enroller: '' });
  const [editUser, setEditUser] = useState<OverviewUser | null>(null);
  const [editForm, setEditForm] = useState({ fullName: '', email: '' });
  const [passwordUser, setPasswordUser] = useState<OverviewUser | null>(null);
  const [passwordValue, setPasswordValue] = useState('');
  const [managerUser, setManagerUser] = useState<OverviewUser | null>(null);
  const [managerValue, setManagerValue] = useState('');
  const [toggleUser, setToggleUser] = useState<OverviewUser | null>(null);

  const showToast = (msg: string, type: 'success' | 'error') => {
    setToasts((prev) => [...prev, { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, message: msg, type }]);
  };
  const removeToast = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id));

  const headers = useCallback((): Record<string, string> => ({
    'Content-Type': 'application/json',
    ...(adminUserId ? { 'X-User-Id': adminUserId } : {}),
    ...(getTenantHeader ? getTenantHeader() : {}),
  }), [adminUserId, getTenantHeader]);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/admin/users/overview', { headers: headers() });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || json.error || 'Erro ao carregar usuários');
      setUsers((json.data || []) as OverviewUser[]);
    } catch (e: any) {
      setLoadError(e?.message || 'Erro ao carregar usuários');
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const counts = useMemo(() => ({
    todos: users.length,
    admins: users.filter((u) => u.status === 'admin' || u.status === 'super_admin').length,
    gerentes: users.filter((u) => u.status === 'gerente').length,
    captadores: users.filter((u) => u.status === 'captador').length,
  }), [users]);

  const visible = useMemo(() => {
    if (tab === 'admins') return users.filter((u) => u.status === 'admin' || u.status === 'super_admin');
    if (tab === 'gerentes') return users.filter((u) => u.status === 'gerente');
    if (tab === 'captadores') return users.filter((u) => u.status === 'captador');
    return users;
  }, [users, tab]);

  /** Superiores válidos para captador: gerentes + admins/super admins. */
  const captadorSuperiors = useMemo(
    () => users.filter((u) => u.status === 'gerente' || u.status === 'admin' || u.status === 'super_admin'),
    [users]
  );
  // ----- Mutations -----

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createRole) return;
    if (createRole === 'captador' && !createForm.enroller) {
      showToast('Selecione o gerente do captador.', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/admin/users/create', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          email: createForm.email.trim(),
          fullName: createForm.fullName.trim(),
          password: createForm.password,
          status: createRole,
          enroller: createRole === 'admin' ? null : (createForm.enroller || null),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || json.error || 'Erro ao criar usuário');
      showToast(`${ROLE_LABEL[createRole]} criado com sucesso!`, 'success');
      setCreateRole(null);
      setCreateForm({ fullName: '', email: '', password: '', enroller: '' });
      loadUsers();
    } catch (e: any) {
      showToast(e?.message || 'Erro ao criar usuário', 'error');
    } finally {
      setBusy(false);
    }
  };

  const patchUser = async (body: Record<string, unknown>, successMsg: string): Promise<boolean> => {
    setBusy(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || json.error || 'Erro ao salvar');
      showToast(successMsg, 'success');
      loadUsers();
      return true;
    } catch (e: any) {
      showToast(e?.message || 'Erro ao salvar', 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editUser) return;
    const ok = await patchUser(
      { targetUserId: editUser.id, fullName: editForm.fullName.trim() || null, email: editForm.email.trim() },
      'Usuário atualizado com sucesso!'
    );
    if (ok) setEditUser(null);
  };

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordUser) return;
    if (passwordValue.trim().length < 8) {
      showToast('A senha deve ter pelo menos 8 caracteres.', 'error');
      return;
    }
    const ok = await patchUser({ targetUserId: passwordUser.id, password: passwordValue.trim() }, 'Senha alterada com sucesso!');
    if (ok) {
      setPasswordUser(null);
      setPasswordValue('');
    }
  };

  const submitManager = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!managerUser) return;
    if (!managerValue) {
      showToast('Selecione o novo gerente.', 'error');
      return;
    }
    const ok = await patchUser({ targetUserId: managerUser.id, enroller: managerValue }, 'Gerente atualizado com sucesso!');
    if (ok) setManagerUser(null);
  };

  const submitToggleActive = async () => {
    if (!toggleUser) return;
    const activating = !toggleUser.is_active;
    const ok = await patchUser(
      { targetUserId: toggleUser.id, isActive: activating },
      activating ? 'Usuário reativado com sucesso!' : 'Usuário desativado. Ele não conseguirá mais entrar.'
    );
    if (ok) setToggleUser(null);
  };

  // ----- UI helpers -----

  const canManage = (u: OverviewUser) => {
    if (u.id === adminUserId) return false; // nunca a própria conta
    if (u.status === 'super_admin' && !isSuperAdmin) return false;
    return true;
  };

  const tabBtn = (key: TabKey, label: string, count: number) => (
    <button
      key={key}
      onClick={() => setTab(key)}
      className={`px-4 py-2 min-h-[40px] rounded-lg text-sm font-semibold transition-colors touch-manipulation ${
        tab === key
          ? 'bg-[#E86A2415] dark:bg-[#E86A2425] text-[#E86A24] border border-[#E86A24]/50'
          : 'text-gray-600 dark:text-gray-400 border border-transparent hover:bg-gray-100 dark:hover:bg-white/5'
      }`}
    >
      {label} <span className="opacity-70">({count})</span>
    </button>
  );

  // Shell de modal do kit (ESC, clique no overlay, superfície padrão)
  const modalShell = (title: string, onClose: () => void, children: React.ReactNode) => (
    <Modal open onClose={onClose} title={title} size="sm">
      {children}
    </Modal>
  );

  return (
    <div className="space-y-6">
      <ToastContainer toasts={toasts} onClose={removeToast} />

      {/* Cabeçalho */}
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Usuários</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">Gerencie administradores, gerentes e captadores</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="secondary"
            onClick={() => { setCreateRole('admin'); setCreateForm({ fullName: '', email: '', password: '', enroller: '' }); }}
            icon={<Shield className="w-4 h-4 text-blue-500 dark:text-blue-300" />}
          >
            Novo Admin
          </Button>
          <Button
            variant="secondary"
            onClick={() => { setCreateRole('gerente'); setCreateForm({ fullName: '', email: '', password: '', enroller: '' }); }}
            icon={<UserCheck className="w-4 h-4 text-emerald-500 dark:text-emerald-300" />}
          >
            Novo Gerente
          </Button>
          <Button
            onClick={() => { setCreateRole('captador'); setCreateForm({ fullName: '', email: '', password: '', enroller: '' }); }}
            icon={<Plus className="w-4 h-4" />}
          >
            Novo Captador
          </Button>
        </div>
      </div>

      {/* Abas */}
      <div className="flex flex-wrap gap-1">
        {tabBtn('todos', 'Todos', counts.todos)}
        {tabBtn('admins', 'Admins', counts.admins)}
        {tabBtn('gerentes', 'Gerentes', counts.gerentes)}
        {tabBtn('captadores', 'Captadores', counts.captadores)}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-[#2a2a2a] p-5 space-y-3">
              <div className="flex items-center gap-3">
                <Skeleton className="w-11 h-11 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
              <Skeleton className="h-3 w-36" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>
      ) : loadError ? (
        <Banner
          variant="error"
          title="Erro ao carregar usuários"
          action={
            <Button variant="danger" size="sm" onClick={loadUsers}>
              Tentar novamente
            </Button>
          }
        >
          {loadError}
        </Banner>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-[#2a2a2a]">
          <EmptyState
            icon={<Users className="w-8 h-8" />}
            title="Nenhum usuário nesta aba"
            description="Use os botões acima para cadastrar admins, gerentes ou captadores."
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visible.map((u) => {
            const role = u.status || 'captador';
            const displayName = u.full_name || handleFromEmail(u.email);
            return (
              <div key={u.id} className={`rounded-2xl border bg-white dark:bg-[#2a2a2a] border-gray-200 dark:border-gray-600 p-5 flex flex-col gap-3 transition-colors hover:border-[#E86A24]/40 ${u.is_active ? '' : 'opacity-70'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-11 h-11 rounded-full ${avatarColor(u.id)} text-white flex items-center justify-center font-bold text-base flex-shrink-0`}>
                      {displayName.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-gray-900 dark:text-white truncate">{displayName}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">@{handleFromEmail(u.email)}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                    <span className={`px-2.5 py-0.5 rounded-md text-[11px] font-semibold border ${ROLE_BADGE_CLASS[role] || 'border-gray-400/50 text-gray-600 dark:text-gray-300 bg-gray-500/10'}`}>
                      {ROLE_LABEL[role] || role}
                    </span>
                    <span className={`px-2.5 py-0.5 rounded-md text-[11px] font-semibold border ${u.is_active ? 'border-emerald-400/60 text-emerald-600 dark:text-emerald-300 bg-emerald-500/10' : 'border-red-400/60 text-red-600 dark:text-red-300 bg-red-500/10'}`}>
                      {u.is_active ? 'Ativo' : 'Inativo'}
                    </span>
                  </div>
                </div>

                <div className="text-sm space-y-1.5">
                  {role === 'captador' && (
                    <>
                      <p className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                        <Users className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                        {u.leads_count} lead{u.leads_count === 1 ? '' : 's'} atribuído{u.leads_count === 1 ? '' : 's'}
                      </p>
                      <p className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                        <Link2 className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                        Gerente:{' '}
                        {u.enroller_name ? (
                          <button onClick={() => { setManagerUser(u); setManagerValue(u.enroller || ''); }} className="text-emerald-600 dark:text-emerald-400 hover:underline font-medium">
                            {u.enroller_name}
                          </button>
                        ) : (
                          <span className="text-amber-600 dark:text-amber-400">sem gerente</span>
                        )}
                      </p>
                    </>
                  )}
                  {role === 'gerente' && (
                    <p className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                      <Users className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                      {users.filter((x) => x.enroller === u.id && x.status === 'captador').length} captador(es) na equipe
                    </p>
                  )}
                  <p className="text-gray-500 dark:text-gray-500 text-xs pt-1">Cadastrado em {formatDate(u.created_at)}</p>
                </div>

                <div className="border-t border-gray-200 dark:border-gray-600 pt-3 mt-auto flex flex-wrap gap-2">
                  <button
                    onClick={() => { setEditUser(u); setEditForm({ fullName: u.full_name || '', email: u.email }); }}
                    className={`${outlineBtn} border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700`}
                  >
                    <Edit className="w-3.5 h-3.5 text-[#E86A24]" /> Editar
                  </button>
                  <button
                    onClick={() => { setPasswordUser(u); setPasswordValue(''); }}
                    className={`${outlineBtn} border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700`}
                  >
                    <KeyRound className="w-3.5 h-3.5 text-amber-500" /> Senha
                  </button>
                  {role === 'captador' && (
                    <button
                      onClick={() => { setManagerUser(u); setManagerValue(u.enroller || ''); }}
                      className={`${outlineBtn} border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700`}
                    >
                      <Link2 className="w-3.5 h-3.5 text-emerald-500" /> Gerente
                    </button>
                  )}
                  {canManage(u) && (
                    <button
                      onClick={() => setToggleUser(u)}
                      className={`${outlineBtn} ${u.is_active ? 'border-red-500/50 text-red-600 dark:text-red-400 hover:bg-red-500/10' : 'border-emerald-500/50 text-emerald-600 dark:text-emerald-300 hover:bg-emerald-500/10'}`}
                    >
                      {u.is_active ? <><UserX className="w-3.5 h-3.5" /> Desativar</> : <><UserPlus className="w-3.5 h-3.5" /> Ativar</>}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal: criar usuário */}
      {createRole && modalShell(`Novo ${ROLE_LABEL[createRole]}`, () => setCreateRole(null), (
        <form onSubmit={submitCreate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Nome completo</label>
            <input type="text" value={createForm.fullName} onChange={(e) => setCreateForm({ ...createForm, fullName: e.target.value })} className={inputClass} placeholder="Nome do usuário" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Email *</label>
            <input type="email" value={createForm.email} onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} className={inputClass} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Senha *</label>
            <input type="password" value={createForm.password} onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })} className={inputClass} required minLength={8} />
          </div>
          {createRole === 'captador' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Gerente *</label>
              <select value={createForm.enroller} onChange={(e) => setCreateForm({ ...createForm, enroller: e.target.value })} className={inputClass} required>
                <option value="">Selecione...</option>
                {captadorSuperiors.map((g) => (
                  <option key={g.id} value={g.id}>
                    {(g.full_name || g.email)}{g.status !== 'gerente' ? ` (${ROLE_LABEL[g.status || '']})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
          {createRole === 'gerente' && (
            <p className="text-xs text-gray-500 dark:text-gray-400">O gerente é criado sem superior; os captadores dele são atribuídos depois.</p>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setCreateRole(null)}>Cancelar</Button>
            <Button type="submit" loading={busy}>Criar</Button>
          </div>
        </form>
      ))}

      {/* Modal: editar */}
      {editUser && modalShell('Editar usuário', () => setEditUser(null), (
        <form onSubmit={submitEdit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Nome completo</label>
            <input type="text" value={editForm.fullName} onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })} className={inputClass} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Email *</label>
            <input type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} className={inputClass} required />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setEditUser(null)}>Cancelar</Button>
            <Button type="submit" loading={busy}>Salvar</Button>
          </div>
        </form>
      ))}

      {/* Modal: senha */}
      {passwordUser && modalShell(`Nova senha — ${passwordUser.full_name || passwordUser.email}`, () => setPasswordUser(null), (
        <form onSubmit={submitPassword} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Nova senha *</label>
            <input type="password" value={passwordValue} onChange={(e) => setPasswordValue(e.target.value)} className={inputClass} required minLength={8} placeholder="Mínimo 8 caracteres" />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setPasswordUser(null)}>Cancelar</Button>
            <Button type="submit" loading={busy}>Alterar senha</Button>
          </div>
        </form>
      ))}

      {/* Modal: trocar gerente */}
      {managerUser && modalShell(`Gerente de ${managerUser.full_name || managerUser.email}`, () => setManagerUser(null), (
        <form onSubmit={submitManager} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Novo gerente *</label>
            <select value={managerValue} onChange={(e) => setManagerValue(e.target.value)} className={inputClass} required>
              <option value="">Selecione...</option>
              {captadorSuperiors.map((g) => (
                <option key={g.id} value={g.id}>
                  {(g.full_name || g.email)}{g.status !== 'gerente' ? ` (${ROLE_LABEL[g.status || '']})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setManagerUser(null)}>Cancelar</Button>
            <Button type="submit" loading={busy}>Salvar</Button>
          </div>
        </form>
      ))}

      {/* Modal: ativar/desativar */}
      {toggleUser && modalShell(toggleUser.is_active ? 'Desativar usuário' : 'Reativar usuário', () => setToggleUser(null), (
        <div className="space-y-4">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {toggleUser.is_active ? (
              <>Tem certeza que deseja desativar <strong>{toggleUser.full_name || toggleUser.email}</strong>? O usuário não conseguirá mais entrar no sistema até ser reativado.</>
            ) : (
              <>Reativar <strong>{toggleUser.full_name || toggleUser.email}</strong>? O usuário voltará a conseguir entrar no sistema.</>
            )}
          </p>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setToggleUser(null)}>Cancelar</Button>
            <Button
              variant={toggleUser.is_active ? 'danger' : 'success'}
              onClick={submitToggleActive}
              loading={busy}
            >
              {toggleUser.is_active ? 'Desativar' : 'Reativar'}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
