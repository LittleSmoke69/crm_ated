'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Plus,
  Edit,
  Trash2,
  Save,
  X,
  Loader2,
  FileText,
  Video,
  Image,
  Music,
  Clock,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  LogIn,
  LogOut,
  UserPlus,
  Wifi,
  MessageSquare,
  Play,
  Zap,
} from 'lucide-react';

interface MaturationPlan {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  default_target_chat_id: string | null;
  steps_json: Array<{
    index: number;
    type: 'text' | 'video' | 'image' | 'audio';
    delaySec: number;
    target_chat_id?: string | null;
    payload: {
      text?: string;
      media_url?: string;
      caption?: string;
      mimetype?: string;
      filename?: string;
    };
  }>;
  created_at: string;
}

interface MasterInstance {
  id: string | null;
  evolution_instance_id: string | null;
  instance_name: string;
  status: string | null;
  available: boolean;
  health_score: number;
}

interface VirginInstance {
  id: string;
  instance_name: string;
  status: string;
  maturation_status: string | null;
  maturation_started_at: string | null;
  maturation_ends_at: string | null;
  maturation_paused_at: string | null;
  current_day: number | null;
  is_locked: boolean;
  created_at: string;
}

interface StepFormData {
  type: 'text' | 'video' | 'image' | 'audio';
  delay_seconds: number;
  target_chat_id?: string;
  payload: {
    text?: string;
    media_url?: string;
    caption?: string;
    mimetype?: string;
    filename?: string;
  };
}

export type VirginMessageItem = { type: 'text' | 'video' | 'image' | 'audio'; text?: string; media_path?: string; caption?: string };

interface Props {
  userId: string | null;
}

const VIRGIN_STATUS_LABEL: Record<string, string> = {
  '': 'Aguardando início',
  waiting_connection_test: 'Teste de conexão (24h)',
  contact_warmup: 'Conversas 1:1 (2h)',
  group_warmup: 'Grupo (24h)',
  posting_status: 'Postagem status',
  repeating_cycle: 'Ciclo repetido (dias 2-5)',
  completed: 'Concluído',
};

export default function MaturadorSection({ userId }: Props) {
  const [plans, setPlans] = useState<MaturationPlan[]>([]);
  const [masterInstances, setMasterInstances] = useState<MasterInstance[]>([]);
  const [virginInstances, setVirginInstances] = useState<VirginInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState<MaturationPlan | null>(null);
  const [expandedPlan, setExpandedPlan] = useState<string | null>(null);
  const [expandedVirgin, setExpandedVirgin] = useState<string | null>(null);
  const [virginLogs, setVirginLogs] = useState<Record<string, { event_type: string; message: string | null; created_at: string }[]>>({});
  const [virginActioning, setVirginActioning] = useState<string | null>(null);

  // Gerenciar instâncias no maturador (admin)
  const [allEvolutionInstances, setAllEvolutionInstances] = useState<any[]>([]);
  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  const [maturadorActioning, setMaturadorActioning] = useState<string | null>(null);
  const [adminDataLoaded, setAdminDataLoaded] = useState(false);
  const [selectedInstanceIds, setSelectedInstanceIds] = useState<Set<string>>(new Set());
  const [bulkAssignUserId, setBulkAssignUserId] = useState<string>('');
  const [bulkAssigning, setBulkAssigning] = useState(false);
  const [bulkActioning, setBulkActioning] = useState<'maturador' | 'auto' | 'remove-maturador' | 'remove-auto' | null>(null);
  const [virginMessages, setVirginMessages] = useState<VirginMessageItem[]>([]);
  const [virginMessagesSaving, setVirginMessagesSaving] = useState(false);
  const [virginUploading, setVirginUploading] = useState<number | null>(null);
  const [virginPreviewUrls, setVirginPreviewUrls] = useState<Record<number, string>>({});
  const [virginPreviewFiles, setVirginPreviewFiles] = useState<Record<number, File>>({});
  const virginBlobUrlsRef = React.useRef<Set<string>>(new Set());
  const [instancesPage, setInstancesPage] = useState(1);

  const INSTANCES_PER_PAGE = 6;
  const totalInstancesPages = Math.max(1, Math.ceil(allEvolutionInstances.length / INSTANCES_PER_PAGE));
  const paginatedInstances = allEvolutionInstances.slice(
    (instancesPage - 1) * INSTANCES_PER_PAGE,
    instancesPage * INSTANCES_PER_PAGE
  );

  // Formulário
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formTargetChatId, setFormTargetChatId] = useState('');
  const [formSteps, setFormSteps] = useState<StepFormData[]>([]);

  useEffect(() => {
    if (userId) {
      loadData();
    }
  }, [userId]);

  useEffect(() => {
    if (userId) {
      loadAdminData();
    }
  }, [userId]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(allEvolutionInstances.length / INSTANCES_PER_PAGE));
    if (instancesPage > totalPages) {
      setInstancesPage(totalPages);
    }
  }, [allEvolutionInstances.length, instancesPage]);

  useEffect(() => {
    virginMessages.forEach((msg, idx) => {
      if ((msg.type === "video" || msg.type === "image" || msg.type === "audio") && msg.media_path && !virginPreviewUrls[idx] && !virginPreviewFiles[idx]) {
        fetchVirginPreviewUrl(msg.media_path, idx);
      }
    });
  }, [virginMessages]);

  useEffect(() => {
    return () => {
      virginBlobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      virginBlobUrlsRef.current.clear();
    };
  }, []);

  async function loadAdminData() {
    try {
      const [instRes, usersRes, virginRes] = await Promise.all([
        fetch('/api/admin/evolution/instances'),
        fetch('/api/admin/users'),
        fetch('/api/admin/maturation/virgin-messages'),
      ]);
      const instData = await instRes.json();
      const usersData = await usersRes.json();
      const virginData = await virginRes.json();
      if (instRes.ok && instData.data) {
        setAllEvolutionInstances(Array.isArray(instData.data) ? instData.data : []);
      }
      if (usersRes.ok && usersData.data) {
        setAdminUsers(Array.isArray(usersData.data) ? usersData.data : []);
      }
      if (virginRes.ok && virginData.data?.messages) {
        const msgs = Array.isArray(virginData.data.messages) ? virginData.data.messages : [];
        setVirginMessages(msgs.map((m: any) => ({
          type: m.type || 'text',
          text: m.text,
          media_path: m.media_path,
          caption: m.caption,
        })));
        setVirginPreviewFiles({});
        setVirginPreviewUrls({});
      }
    } catch (e) {
      console.error('Erro ao carregar dados admin:', e);
    } finally {
      setAdminDataLoaded(true);
    }
  }

  function isValidVirginMessage(m: VirginMessageItem): boolean {
    if (m.type === 'text') return !!m.text?.trim();
    return !!m.media_path?.trim();
  }

  async function saveVirginMessages() {
    const toSave = virginMessages.filter(isValidVirginMessage);
    if (toSave.length === 0) {
      alert('Adicione ao menos uma mensagem válida (texto ou mídia com arquivo).');
      return;
    }
    setVirginMessagesSaving(true);
    try {
      const res = await fetch('/api/admin/maturation/virgin-messages', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: toSave }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setVirginMessages(data.data?.messages || toSave);
      } else {
        alert(data.error || 'Erro ao salvar mensagens');
      }
    } catch (e) {
      console.error(e);
      alert('Erro ao salvar mensagens');
    } finally {
      setVirginMessagesSaving(false);
    }
  }

  async function uploadVirginMedia(file: File, type: 'video' | 'image' | 'audio', index: number) {
    setVirginUploading(index);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('type', type);
      const res = await fetch('/api/admin/maturation/virgin-messages/upload', { method: 'POST', body: form });
      const data = await res.json();
      if (res.ok && data.data?.path) {
        const next = [...virginMessages];
        const item = next[index];
        if (item && item.type === type) {
          next[index] = { ...item, media_path: data.data.path };
          setVirginMessages(next);
        }
        setVirginPreviewFiles((prev) => {
          const u = { ...prev };
          delete u[index];
          return u;
        });
        const urlRes = await fetch(`/api/admin/maturation/virgin-messages/signed-url?path=${encodeURIComponent(data.data.path)}`);
        const urlData = await urlRes.json();
        if (urlRes.ok && urlData.data?.url) {
          const signedUrl = urlData.data.url;
          setVirginPreviewUrls((prev) => {
            const old = prev[index];
            if (old?.startsWith("blob:")) {
              URL.revokeObjectURL(old);
              virginBlobUrlsRef.current.delete(old);
            }
            return { ...prev, [index]: signedUrl };
          });
        }
      } else {
        alert(data.error || 'Erro no upload');
      }
    } catch (e) {
      console.error(e);
      alert('Erro no upload');
    } finally {
      setVirginUploading(null);
    }
  }

  function setVirginPreviewForFile(index: number, file: File | null) {
    if (file) {
      const url = URL.createObjectURL(file);
      virginBlobUrlsRef.current.add(url);
      setVirginPreviewFiles((prev) => ({ ...prev, [index]: file }));
      setVirginPreviewUrls((prev) => {
        const old = prev[index];
        if (old && old.startsWith("blob:")) {
          URL.revokeObjectURL(old);
          virginBlobUrlsRef.current.delete(old);
        }
        return { ...prev, [index]: url };
      });
    } else {
      setVirginPreviewFiles((prev) => {
        const u = { ...prev };
        delete u[index];
        return u;
      });
      setVirginPreviewUrls((prev) => {
        const old = prev[index];
        if (old && old.startsWith("blob:")) {
          URL.revokeObjectURL(old);
          virginBlobUrlsRef.current.delete(old);
        }
        const u = { ...prev };
        delete u[index];
        return u;
      });
    }
  }

  async function fetchVirginPreviewUrl(path: string, index: number) {
    try {
      const res = await fetch(`/api/admin/maturation/virgin-messages/signed-url?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (res.ok && data.data?.url) {
        setVirginPreviewUrls((prev) => ({ ...prev, [index]: data.data.url }));
      }
    } catch (e) {
      console.error('Erro ao carregar preview:', e);
    }
  }

  async function loadData() {
    try {
      setLoading(true);
      
      const [plansRes, instancesRes, virginRes] = await Promise.all([
        fetch('/api/maturation/plans', { headers: { 'X-User-Id': userId || '' } }),
        fetch('/api/maturation/master-instances', { headers: { 'X-User-Id': userId || '' } }),
        fetch('/api/maturation/virgin-instances', { headers: { 'X-User-Id': userId || '' } }),
      ]);
      
      const [plansData, instancesData, virginData] = await Promise.all([
        plansRes.json(),
        instancesRes.json(),
        virginRes.json(),
      ]);
      
      setPlans(plansData.plans || []);
      setMasterInstances(instancesData.instances || []);
      setVirginInstances(virginData.data?.instances || []);
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchVirginLogs(instanceId: string) {
    try {
      const res = await fetch(`/api/maturation/virgin-instances/${instanceId}/logs`, {
        headers: { 'X-User-Id': userId || '' },
      });
      const data = await res.json();
      if (data.data?.logs) {
        setVirginLogs((prev) => ({ ...prev, [instanceId]: data.data.logs }));
      }
    } catch (e) {
      console.error('Erro ao carregar logs:', e);
    }
  }

  async function virginAction(instanceId: string, action: string) {
    setVirginActioning(instanceId);
    try {
      const res = await fetch(`/api/maturation/virgin-instances/${instanceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId || '' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data.success) {
        await loadData();
        if (expandedVirgin === instanceId) {
          fetchVirginLogs(instanceId);
        }
      } else {
        alert(data.error || 'Erro ao executar ação');
      }
    } catch (e) {
      console.error('Erro:', e);
      alert('Erro ao executar ação');
    } finally {
      setVirginActioning(null);
    }
  }

  function openCreateModal() {
    setEditingPlan(null);
    setFormName('');
    setFormDescription('');
    setFormTargetChatId('');
    setFormSteps([{ type: 'text', delay_seconds: 5, payload: { text: '' } }]);
    setShowModal(true);
  }

  function openEditModal(plan: MaturationPlan) {
    setEditingPlan(plan);
    setFormName(plan.name);
    setFormDescription(plan.description || '');
    setFormTargetChatId(plan.default_target_chat_id || '');
    setFormSteps(
      plan.steps_json.map((step) => ({
        type: step.type,
        delay_seconds: step.delaySec,
        target_chat_id: step.target_chat_id ?? '',
        payload: step.payload,
      }))
    );
    setShowModal(true);
  }

  function addStep() {
    setFormSteps([...formSteps, { type: 'text', delay_seconds: 5, target_chat_id: '', payload: { text: '' } }]);
  }

  function removeStep(index: number) {
    if (formSteps.length === 1) {
      alert('É necessário ao menos um step');
      return;
    }
    setFormSteps(formSteps.filter((_, i) => i !== index));
  }

  function updateStep(index: number, field: string, value: any) {
    const newSteps = [...formSteps];
    if (field === 'type') {
      newSteps[index] = {
        ...newSteps[index],
        type: value,
        payload: value === 'text' ? { text: '' } : { media_url: '', caption: '' },
      };
    } else if (field === 'delay_seconds') {
      newSteps[index] = { ...newSteps[index], delay_seconds: value };
    } else if (field === 'target_chat_id') {
      newSteps[index] = { ...newSteps[index], target_chat_id: value };
    } else {
      newSteps[index] = {
        ...newSteps[index],
        payload: { ...newSteps[index].payload, [field]: value },
      };
    }
    setFormSteps(newSteps);
  }

  async function handleSave() {
    if (!formName.trim()) {
      alert('Nome do plano é obrigatório');
      return;
    }
    
    if (formSteps.length === 0) {
      alert('É necessário ao menos um step');
      return;
    }
    
    // Valida steps
    for (let i = 0; i < formSteps.length; i++) {
      const step = formSteps[i];
      if (step.type === 'text' && !step.payload.text?.trim()) {
        alert(`Step ${i + 1}: texto é obrigatório`);
        return;
      }
      if (['video', 'image', 'audio'].includes(step.type) && !step.payload.media_url?.trim()) {
        alert(`Step ${i + 1}: URL da mídia é obrigatória`);
        return;
      }
    }
    
    try {
      setSaving(true);
      
      const url = editingPlan
        ? `/api/maturation/plans/${editingPlan.id}`
        : '/api/maturation/plans';
      
      const method = editingPlan ? 'PUT' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId || '',
        },
        body: JSON.stringify({
          name: formName.trim(),
          description: formDescription.trim() || null,
          default_target_chat_id: formTargetChatId.trim() || null,
          steps: formSteps,
        }),
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        alert(data.error || 'Erro ao salvar plano');
        return;
      }
      
      setShowModal(false);
      await loadData();
    } catch (error) {
      console.error('Erro ao salvar:', error);
      alert('Erro ao salvar plano');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(planId: string) {
    if (!confirm('Tem certeza que deseja excluir este plano?')) {
      return;
    }
    
    try {
      const res = await fetch(`/api/maturation/plans/${planId}`, {
        method: 'DELETE',
        headers: { 'X-User-Id': userId || '' },
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        alert(data.error || 'Erro ao excluir plano');
        return;
      }
      
      await loadData();
    } catch (error) {
      console.error('Erro ao excluir:', error);
      alert('Erro ao excluir plano');
    }
  }

  function isInMaturador(evolutionInstanceId: string): boolean {
    return masterInstances.some(
      (m) => m.evolution_instance_id === evolutionInstanceId && (m as any).source === 'master_instances'
    );
  }

  async function addToMaturador(evolutionInstanceId: string) {
    setMaturadorActioning(evolutionInstanceId);
    try {
      const res = await fetch('/api/admin/maturation/master-instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ evolution_instance_id: evolutionInstanceId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        await loadData();
        await loadAdminData();
      } else {
        alert(data.error || 'Erro ao adicionar ao maturador');
      }
    } catch (e) {
      console.error(e);
      alert('Erro ao adicionar ao maturador');
    } finally {
      setMaturadorActioning(null);
    }
  }

  async function removeFromMaturador(evolutionInstanceId: string) {
    if (!confirm('Remover esta instância do maturador?')) return;
    setMaturadorActioning(evolutionInstanceId);
    try {
      const res = await fetch('/api/admin/maturation/master-instances', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ evolution_instance_id: evolutionInstanceId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        await loadData();
        await loadAdminData();
      } else {
        alert(data.error || 'Erro ao remover do maturador');
      }
    } catch (e) {
      console.error(e);
      alert('Erro ao remover do maturador');
    } finally {
      setMaturadorActioning(null);
    }
  }

  async function assignInstanceToUser(evolutionInstanceId: string, targetUserId: string | null) {
    setMaturadorActioning(evolutionInstanceId);
    try {
      const res = await fetch(`/api/admin/evolution/instances/${evolutionInstanceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: targetUserId || null }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        await loadAdminData();
      } else {
        alert(data.error || 'Erro ao atribuir usuário');
      }
    } catch (e) {
      console.error(e);
      alert('Erro ao atribuir usuário');
    } finally {
      setMaturadorActioning(null);
    }
  }

  async function setAutoMaturacao(evolutionInstanceId: string, maturationType: 'virgem' | 'maturado') {
    setMaturadorActioning(evolutionInstanceId);
    try {
      const res = await fetch(`/api/admin/evolution/instances/${evolutionInstanceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maturation_type: maturationType }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        await loadAdminData();
        await loadData();
      } else {
        alert(data.error || 'Erro ao alterar auto maturação');
      }
    } catch (e) {
      console.error(e);
      alert('Erro ao alterar auto maturação');
    } finally {
      setMaturadorActioning(null);
    }
  }

  function toggleInstanceSelection(id: string) {
    setSelectedInstanceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllInstances() {
    setSelectedInstanceIds(new Set(allEvolutionInstances.map((ev: any) => ev.id)));
  }

  function clearSelection() {
    setSelectedInstanceIds(new Set());
  }

  async function bulkAssignToUser() {
    if (!bulkAssignUserId || selectedInstanceIds.size === 0) {
      alert('Selecione ao menos uma instância e um usuário.');
      return;
    }
    setBulkAssigning(true);
    try {
      let ok = 0;
      let fail = 0;
      for (const id of selectedInstanceIds) {
        const res = await fetch(`/api/admin/evolution/instances/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: bulkAssignUserId }),
        });
        const data = await res.json();
        if (res.ok && data.success) ok++;
        else fail++;
      }
      await loadAdminData();
      setSelectedInstanceIds(new Set());
      setBulkAssignUserId('');
      alert(`${ok} instância(s) atribuída(s).${fail > 0 ? ` ${fail} falha(s).` : ''}`);
    } catch (e) {
      console.error(e);
      alert('Erro ao atribuir em lote');
    } finally {
      setBulkAssigning(false);
    }
  }

  async function bulkAddToMaturador() {
    if (selectedInstanceIds.size === 0) {
      alert('Selecione ao menos uma instância.');
      return;
    }
    const toAdd = Array.from(selectedInstanceIds).filter((id) => !isInMaturador(id));
    if (toAdd.length === 0) {
      alert('As instâncias selecionadas já estão no maturador.');
      return;
    }
    setBulkActioning('maturador');
    try {
      let ok = 0;
      let fail = 0;
      for (const id of toAdd) {
        const res = await fetch('/api/admin/maturation/master-instances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ evolution_instance_id: id }),
        });
        const data = await res.json();
        if (res.ok && data.success) ok++;
        else fail++;
      }
      await loadData();
      await loadAdminData();
      setSelectedInstanceIds(new Set());
      alert(`${ok} instância(s) adicionada(s) ao maturador.${fail > 0 ? ` ${fail} falha(s).` : ''}`);
    } catch (e) {
      console.error(e);
      alert('Erro ao adicionar ao maturador');
    } finally {
      setBulkActioning(null);
    }
  }

  async function bulkRemoveFromMaturador() {
    if (selectedInstanceIds.size === 0) return;
    const toRemove = Array.from(selectedInstanceIds).filter((id) => isInMaturador(id));
    if (toRemove.length === 0) {
      alert('Nenhuma das instâncias selecionadas está no maturador.');
      return;
    }
    if (!confirm(`Remover ${toRemove.length} instância(s) do maturador?`)) return;
    setBulkActioning('remove-maturador');
    try {
      let ok = 0;
      let fail = 0;
      for (const id of toRemove) {
        const res = await fetch('/api/admin/maturation/master-instances', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ evolution_instance_id: id }),
        });
        const data = await res.json();
        if (res.ok && data.success) ok++;
        else fail++;
      }
      await loadData();
      await loadAdminData();
      setSelectedInstanceIds(new Set());
      alert(`${ok} instância(s) removida(s) do maturador.${fail > 0 ? ` ${fail} falha(s).` : ''}`);
    } catch (e) {
      console.error(e);
      alert('Erro ao remover do maturador');
    } finally {
      setBulkActioning(null);
    }
  }

  async function bulkAddToAutoMat() {
    if (selectedInstanceIds.size === 0) {
      alert('Selecione ao menos uma instância.');
      return;
    }
    const toAdd = allEvolutionInstances.filter(
      (ev: any) => selectedInstanceIds.has(ev.id) && ev.maturation_type !== 'virgem'
    );
    if (toAdd.length === 0) {
      alert('As instâncias selecionadas já estão na auto maturação.');
      return;
    }
    setBulkActioning('auto');
    try {
      let ok = 0;
      let fail = 0;
      for (const ev of toAdd) {
        const res = await fetch(`/api/admin/evolution/instances/${ev.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ maturation_type: 'virgem' }),
        });
        const data = await res.json();
        if (res.ok && data.success) ok++;
        else fail++;
      }
      await loadAdminData();
      await loadData();
      setSelectedInstanceIds(new Set());
      alert(`${ok} instância(s) adicionada(s) à auto maturação.${fail > 0 ? ` ${fail} falha(s).` : ''}`);
    } catch (e) {
      console.error(e);
      alert('Erro ao adicionar à auto maturação');
    } finally {
      setBulkActioning(null);
    }
  }

  async function bulkRemoveFromAutoMat() {
    if (selectedInstanceIds.size === 0) return;
    const toRemove = allEvolutionInstances.filter(
      (ev: any) => selectedInstanceIds.has(ev.id) && ev.maturation_type === 'virgem'
    );
    if (toRemove.length === 0) {
      alert('Nenhuma das instâncias selecionadas está na auto maturação.');
      return;
    }
    if (!confirm(`Remover ${toRemove.length} instância(s) da auto maturação?`)) return;
    setBulkActioning('remove-auto');
    try {
      let ok = 0;
      let fail = 0;
      for (const ev of toRemove) {
        const res = await fetch(`/api/admin/evolution/instances/${ev.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ maturation_type: 'maturado' }),
        });
        const data = await res.json();
        if (res.ok && data.success) ok++;
        else fail++;
      }
      await loadAdminData();
      await loadData();
      setSelectedInstanceIds(new Set());
      alert(`${ok} instância(s) removida(s) da auto maturação.${fail > 0 ? ` ${fail} falha(s).` : ''}`);
    } catch (e) {
      console.error(e);
      alert('Erro ao remover da auto maturação');
    } finally {
      setBulkActioning(null);
    }
  }

  function getStepIcon(type: string) {
    switch (type) {
      case 'text':
        return <FileText className="w-4 h-4" />;
      case 'video':
        return <Video className="w-4 h-4" />;
      case 'image':
        return <Image className="w-4 h-4" />;
      case 'audio':
        return <Music className="w-4 h-4" />;
      default:
        return <FileText className="w-4 h-4" />;
    }
  }

  function getStepLabel(type: string) {
    switch (type) {
      case 'text':
        return 'Texto';
      case 'video':
        return 'Vídeo';
      case 'image':
        return 'Imagem';
      case 'audio':
        return 'Áudio';
      default:
        return type;
    }
  }

  const availableInstances = masterInstances.filter((i) => i.available).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Bloco: Escolher ou montar o fluxo de mensagens (Maturador vs Auto maturador) */}
      <div className="bg-gradient-to-br from-[#0A5C5C]/10 to-[#8CD955]/10 rounded-xl border border-[#0A5C5C]/20 p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#0A5C5C]/20 flex items-center justify-center shrink-0">
            <MessageSquare className="w-5 h-5 text-[#0A5C5C]" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              Fluxo de mensagens do Maturador e do Auto maturador
            </h3>
            <p className="text-sm text-gray-600 mt-1">
              Configure abaixo o tipo de mensagem ou o plano que será usado. Depois, defina quais instâncias participam de cada modo.
            </p>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white/80 rounded-lg border border-[#0A5C5C]/30 p-4">
                <div className="flex items-center gap-2 text-[#0A5C5C] font-medium">
                  <Play className="w-4 h-4" />
                  Maturador (manual)
                </div>
                <p className="text-xs text-gray-600 mt-1">
                  Você monta um <strong>plano de mensagens</strong> (texto, vídeo, imagem, áudio com delays). Ao clicar em <strong>Start</strong> na tela Maturador, <strong>todas as instâncias mestre</strong> enviam as mensagens do plano para os números/conversas entre si.
                </p>
                <Link
                  href="/maturador"
                  className="inline-flex items-center gap-1.5 mt-3 text-sm font-medium text-[#0A5C5C] hover:text-[#0A5C5C]/80"
                >
                  <Play className="w-4 h-4" />
                  Ir para Maturador e dar Start
                </Link>
              </div>
              <div className="bg-white/80 rounded-lg border border-amber-200 p-4">
                <div className="flex items-center gap-2 text-amber-800 font-medium">
                  <Zap className="w-4 h-4" />
                  Auto maturador
                </div>
                <p className="text-xs text-gray-600 mt-1">
                  O mesmo conceito de fluxo de mensagens, mas <strong>automático</strong>: instâncias marcadas como <strong>virgem</strong> entram em maturação sozinhas (5 dias). Configure a lista de mensagens usadas no warmup 1:1 na seção abaixo.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Header com estatísticas */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#0A5C5C]/10 flex items-center justify-center">
              <FileText className="w-5 h-5 text-[#0A5C5C]" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Planos Ativos</p>
              <p className="text-2xl font-bold text-gray-800">{plans.length}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
              availableInstances > 0 ? 'bg-green-100' : 'bg-yellow-100'
            }`}>
              <CheckCircle2 className={`w-5 h-5 ${
                availableInstances > 0 ? 'text-green-600' : 'text-yellow-600'
              }`} />
            </div>
            <div>
              <p className="text-sm text-gray-500">Instâncias Mestre</p>
              <p className="text-2xl font-bold text-gray-800">
                {availableInstances} / {masterInstances.length}
              </p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <button
            onClick={openCreateModal}
            className="w-full h-full flex items-center justify-center gap-2 text-[#8CD955] hover:text-[#7BC84A] font-medium"
          >
            <Plus className="w-5 h-5" />
            <span>Novo Plano</span>
          </button>
        </div>
      </div>

      {/* Gerenciar instâncias no maturador (admin) - layout em cards + multi-select */}
      {adminDataLoaded && allEvolutionInstances.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-800">Gerenciar instâncias</h3>
            <p className="text-sm text-gray-500 mt-1">
              Adicione instâncias ao <strong>Maturador (manual)</strong> ou à <strong>Auto maturação (virgem)</strong> para que elas usem os fluxos de mensagens configurados acima. Todas as instâncias no maturador enviam mensagens quando você dá Start na tela Maturador; as virgens rodam o fluxo automaticamente.
            </p>
          </div>

          {/* Barra: seleção em lote + atribuir */}
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex flex-wrap items-center gap-3">
            <span className="text-sm text-gray-600">
              {selectedInstanceIds.size > 0 ? (
                <strong>{selectedInstanceIds.size}</strong>
              ) : (
                '0'
              )}{' '}
              selecionada(s)
            </span>
            {selectedInstanceIds.size > 0 && (
              <>
                <button
                  type="button"
                  onClick={clearSelection}
                  className="text-xs text-gray-500 hover:text-gray-700 underline"
                >
                  Limpar seleção
                </button>
                <span className="text-gray-300">|</span>
              </>
            )}
            <button
              type="button"
              onClick={selectAllInstances}
              className="text-xs text-[#0A5C5C] hover:underline"
            >
              Selecionar todas
            </button>
            <span className="text-gray-300">|</span>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={bulkAddToMaturador}
                disabled={!!bulkActioning || bulkAssigning || selectedInstanceIds.size === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[#0A5C5C] bg-[#0A5C5C]/10 hover:bg-[#0A5C5C]/20 border border-[#0A5C5C]/30 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {bulkActioning === 'maturador' ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
                Adicionar ao maturador
              </button>
              <button
                type="button"
                onClick={bulkRemoveFromMaturador}
                disabled={!!bulkActioning || bulkAssigning || selectedInstanceIds.size === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {bulkActioning === 'remove-maturador' ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
                Remover do maturador
              </button>
              <button
                type="button"
                onClick={bulkAddToAutoMat}
                disabled={!!bulkActioning || bulkAssigning || selectedInstanceIds.size === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {bulkActioning === 'auto' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Adicionar à auto mat.
              </button>
              <button
                type="button"
                onClick={bulkRemoveFromAutoMat}
                disabled={!!bulkActioning || bulkAssigning || selectedInstanceIds.size === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {bulkActioning === 'remove-auto' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Remover da auto mat.
              </button>
            </div>
            <div className="flex-1 min-w-0" />
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={bulkAssignUserId}
                onChange={(e) => setBulkAssignUserId(e.target.value)}
                disabled={bulkAssigning || !!bulkActioning || selectedInstanceIds.size === 0}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-[200px] bg-white text-gray-800 disabled:opacity-50 focus:ring-2 focus:ring-[#0A5C5C] focus:border-[#0A5C5C]"
              >
                <option value="" className="text-gray-600">— Atribuir selecionadas a —</option>
                {adminUsers.map((u: any) => (
                  <option key={u.id} value={u.id} className="text-gray-800">
                    {u.full_name || u.email || u.id}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={bulkAssignToUser}
                disabled={bulkAssigning || !!bulkActioning || !bulkAssignUserId || selectedInstanceIds.size === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#0A5C5C] text-white text-sm rounded-lg hover:bg-[#0A5C5C]/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {bulkAssigning ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                Aplicar
              </button>
            </div>
          </div>

          <div className="p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {paginatedInstances.map((ev: any) => {
                const inMaturador = isInMaturador(ev.id);
                const busy = maturadorActioning === ev.id;
                const currentUserId = ev.user_id ?? '';
                const inAutoMaturacao = ev.maturation_type === 'virgem';
                const isConnected = ev.status === 'open' || ev.status === 'connected' || ev.status === 'ok';
                const selected = selectedInstanceIds.has(ev.id);
                return (
                  <div
                    key={ev.id}
                    className={`rounded-xl border-2 transition-all shadow-sm ${
                      selected ? 'border-[#0A5C5C] bg-[#0A5C5C]/5 ring-1 ring-[#0A5C5C]/20' : isConnected ? 'border-green-200 bg-green-50/50' : 'border-gray-200 bg-gray-50'
                    }`}
                  >
                    <div className="p-4 flex flex-col gap-3">
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleInstanceSelection(ev.id)}
                          className="mt-1 rounded border-gray-300 text-[#0A5C5C] focus:ring-[#0A5C5C]"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`font-semibold ${isConnected ? 'text-green-800' : 'text-gray-800'}`}>
                              {ev.instance_name || ev.id}
                            </span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ev.is_master ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>
                              {ev.is_master ? 'Mestre' : 'Normal'}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
                            <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-green-500' : 'bg-gray-400'}`} />
                            {ev.status || '—'}
                            {inMaturador && ' • Maturador'}
                            {inAutoMaturacao && ' • Virgem'}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2">
                        <span className="text-xs font-medium text-gray-600">Maturador / Auto maturação</span>
                        <div className="flex flex-wrap gap-2">
                          {inMaturador ? (
                            <button
                              type="button"
                              onClick={() => removeFromMaturador(ev.id)}
                              disabled={busy}
                              className="inline-flex items-center gap-1.5 text-sm font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg px-3 py-2 disabled:opacity-50 transition-colors"
                            >
                              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
                              Sair do maturador
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => addToMaturador(ev.id)}
                              disabled={busy}
                              className="inline-flex items-center gap-1.5 text-sm font-medium text-[#0A5C5C] bg-[#0A5C5C]/10 hover:bg-[#0A5C5C]/20 border border-[#0A5C5C]/30 rounded-lg px-3 py-2 disabled:opacity-50 transition-colors"
                            >
                              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
                              Entrar no maturador
                            </button>
                          )}
                          {inAutoMaturacao ? (
                            <button
                              type="button"
                              onClick={() => setAutoMaturacao(ev.id, 'maturado')}
                              disabled={busy}
                              className="inline-flex items-center gap-1.5 text-sm font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg px-3 py-2 disabled:opacity-50 transition-colors"
                            >
                              Sair da auto mat.
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setAutoMaturacao(ev.id, 'virgem')}
                              disabled={busy}
                              className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg px-3 py-2 disabled:opacity-50 transition-colors"
                            >
                              Entrar na auto mat.
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="pt-2 border-t border-gray-100">
                        <label className="text-xs font-medium text-gray-600 block mb-1.5">Atribuir a usuário</label>
                        <select
                          value={currentUserId}
                          onChange={(e) => assignInstanceToUser(ev.id, e.target.value || null)}
                          disabled={busy}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-800 disabled:opacity-50 focus:ring-2 focus:ring-[#0A5C5C] focus:border-[#0A5C5C]"
                        >
                          <option value="" className="text-gray-600">— Nenhum —</option>
                          {adminUsers.map((u: any) => (
                            <option key={u.id} value={u.id} className="text-gray-800">
                              {u.full_name || u.email || u.id}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {totalInstancesPages > 1 && (
              <div className="mt-4 pt-4 border-t border-gray-200 flex items-center justify-between flex-wrap gap-2">
                <p className="text-sm text-gray-600">
                  Página <strong>{instancesPage}</strong> de <strong>{totalInstancesPages}</strong>
                  {' · '}
                  <span className="text-gray-500">
                    {allEvolutionInstances.length} instância(s) no total
                  </span>
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setInstancesPage((p) => Math.max(1, p - 1))}
                    disabled={instancesPage <= 1}
                    className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Anterior
                  </button>
                  <button
                    type="button"
                    onClick={() => setInstancesPage((p) => Math.min(totalInstancesPages, p + 1))}
                    disabled={instancesPage >= totalInstancesPages}
                    className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Próxima
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Configurar mensagens da auto maturação (virgem) – usado no Auto maturador */}
      {adminDataLoaded && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-4 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-amber-600" />
                Fluxo de mensagens do Auto maturador
              </h3>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">Automático</span>
            </div>
            <p className="text-sm text-gray-500 mt-1">
              Mensagens enviadas durante o warmup 1:1 da auto maturação (texto, vídeo, imagem ou áudio). O sistema escolhe uma aleatoriamente para cada envio. Arquivos de mídia são salvos no Supabase Storage.
            </p>
          </div>
          <div className="p-4 space-y-3">
            {virginMessages.length === 0 ? (
              <p className="text-sm text-gray-500">Nenhuma mensagem configurada. Adicione abaixo (texto, vídeo, imagem ou áudio).</p>
            ) : null}
            <div className="space-y-3 max-h-[420px] overflow-y-auto">
              {virginMessages.map((msg, idx) => (
                <div key={idx} className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                  <div className="flex gap-2 items-center flex-wrap mb-2">
                    <select
                      value={msg.type}
                      onChange={(e) => {
                        const next = [...virginMessages];
                        const t = e.target.value as VirginMessageItem['type'];
                        next[idx] = t === 'text' ? { type: 'text', text: '' } : { type: t, media_path: '', caption: '' };
                        setVirginMessages(next);
                      }}
                      className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm bg-white font-medium text-gray-800"
                    >
                      <option value="text">Texto</option>
                      <option value="video">Vídeo</option>
                      <option value="image">Imagem</option>
                      <option value="audio">Áudio</option>
                    </select>
                    <span className="text-xs text-gray-600">#{idx + 1}</span>
                    <button
                      type="button"
                      onClick={() => {
                        const oldUrl = virginPreviewUrls[idx];
                        if (oldUrl?.startsWith("blob:")) {
                          URL.revokeObjectURL(oldUrl);
                          virginBlobUrlsRef.current.delete(oldUrl);
                        }
                        setVirginMessages(virginMessages.filter((_, i) => i !== idx));
                        setVirginPreviewUrls((prev) => {
                          const next: Record<number, string> = {};
                          Object.entries(prev).forEach(([k, v]) => {
                            const i = Number(k);
                            if (i < idx) next[i] = v;
                            if (i > idx) next[i - 1] = v;
                          });
                          return next;
                        });
                        setVirginPreviewFiles((prev) => {
                          const next: Record<number, File> = {};
                          Object.entries(prev).forEach(([k, f]) => {
                            const i = Number(k);
                            if (i < idx) next[i] = f;
                            if (i > idx) next[i - 1] = f;
                          });
                          return next;
                        });
                      }}
                      className="ml-auto p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg shrink-0"
                      title="Remover"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  {msg.type === 'text' ? (
                    <input
                      type="text"
                      value={msg.text ?? ''}
                      onChange={(e) => {
                        const next = [...virginMessages];
                        next[idx] = { ...next[idx], text: e.target.value };
                        setVirginMessages(next);
                      }}
                      placeholder="Digite a mensagem de texto..."
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-800 placeholder:text-gray-500 focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                    />
                  ) : (
                    <div className="space-y-2">
                      {!virginPreviewUrls[idx] && !virginPreviewFiles[idx] ? (
                        <label className="flex flex-col items-center justify-center border-2 border-dashed border-amber-200 rounded-lg p-6 cursor-pointer hover:border-amber-400 hover:bg-amber-50/50 transition-colors">
                          <span className="text-amber-700 mb-2">
                            {virginUploading === idx ? <Loader2 className="w-8 h-8 animate-spin" /> : (msg.type === 'video' ? <Video className="w-8 h-8" /> : msg.type === 'image' ? <Image className="w-8 h-8" /> : <Music className="w-8 h-8" />)}
                          </span>
                          <span className="text-sm font-medium text-amber-800">
                            {msg.media_path ? 'Substituir arquivo' : `Arraste ou clique para enviar ${msg.type === 'video' ? 'vídeo' : msg.type === 'image' ? 'imagem' : 'áudio'}`}
                          </span>
                          <span className="text-xs text-gray-500 mt-1">
                            {msg.type === 'video' ? 'MP4, WEBM, OGG' : msg.type === 'image' ? 'JPEG, PNG, GIF, WEBP' : 'MP3, WAV, OGG'}
                          </span>
                          <input
                            type="file"
                            accept={msg.type === 'video' ? 'video/*' : msg.type === 'image' ? 'image/*' : 'audio/*'}
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                setVirginPreviewForFile(idx, file);
                                uploadVirginMedia(file, msg.type as 'video' | 'image' | 'audio', idx);
                              }
                              e.target.value = '';
                            }}
                          />
                        </label>
                      ) : (
                        <div className="border border-amber-200 rounded-lg p-4 bg-amber-50/50 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-amber-800">
                              {msg.type === 'video' ? 'Vídeo' : msg.type === 'image' ? 'Imagem' : 'Áudio'}
                            </span>
                            <div className="flex items-center gap-2">
                              <label className="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-amber-700 bg-amber-100 border border-amber-200 rounded cursor-pointer hover:bg-amber-200">
                                {virginUploading === idx ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Substituir'}
                                <input
                                  type="file"
                                  accept={msg.type === 'video' ? 'video/*' : msg.type === 'image' ? 'image/*' : 'audio/*'}
                                  className="hidden"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                      setVirginPreviewForFile(idx, file);
                                      uploadVirginMedia(file, msg.type as 'video' | 'image' | 'audio', idx);
                                    }
                                    e.target.value = '';
                                  }}
                                />
                              </label>
                            </div>
                          </div>
                          {msg.type === 'image' && virginPreviewUrls[idx] && (
                            <img
                              src={virginPreviewUrls[idx]}
                              alt="Preview"
                              className="max-w-full max-h-40 rounded-lg object-contain mx-auto border border-gray-200"
                              onError={() => {}}
                            />
                          )}
                          {msg.type === 'video' && virginPreviewUrls[idx] && (
                            <video
                              src={virginPreviewUrls[idx]}
                              controls
                              className="max-w-full max-h-40 rounded-lg mx-auto border border-gray-200"
                              onError={() => {}}
                            />
                          )}
                          {msg.type === 'audio' && virginPreviewUrls[idx] && (
                            <div className="bg-white rounded-lg p-3 border border-gray-200">
                              <audio
                                src={virginPreviewUrls[idx]}
                                controls
                                className="w-full"
                                preload="metadata"
                                onError={() => {}}
                              />
                            </div>
                          )}
                          {(virginPreviewFiles[idx] || msg.media_path) && (
                            <p className="text-xs text-gray-500 truncate">
                              {virginPreviewFiles[idx]?.name ?? (msg.media_path?.split('/').pop() || msg.media_path)}
                            </p>
                          )}
                        </div>
                      )}
                      {(msg.type === 'video' || msg.type === 'image') && (
                        <input
                          type="text"
                          value={msg.caption ?? ''}
                          onChange={(e) => {
                            const next = [...virginMessages];
                            next[idx] = { ...next[idx], caption: e.target.value };
                            setVirginMessages(next);
                          }}
                          placeholder="Legenda (opcional)"
                          className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                        />
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setVirginMessages([...virginMessages, { type: 'text', text: '' }])}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-amber-600 hover:bg-amber-50 rounded-lg border border-amber-200"
              >
                <Plus className="w-4 h-4" />
                Adicionar mensagem
              </button>
              <button
                type="button"
                onClick={saveVirginMessages}
                disabled={virginMessagesSaving || virginMessages.filter(isValidVirginMessage).length === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white text-sm rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {virginMessagesSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Salvar mensagens
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Instâncias em maturação virgem (maturation_type = virgem; maturation_status = etapa ou null) */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="p-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-800">Instâncias em maturação (virgem)</h3>
          <p className="text-sm text-gray-500 mt-1">Auto maturação 5 dias – dia atual, status, logs e ações admin</p>
          {virginInstances.length > 0 && (
            <p className="text-xs text-gray-500 mt-1">
              <strong>maturation_type:</strong> virgem · <strong>maturation_status:</strong> em maturação ({virginInstances.filter((vi) => vi.maturation_status != null).length}) ou aguardando início ({virginInstances.filter((vi) => vi.maturation_status == null).length})
            </p>
          )}
        </div>
        {virginInstances.length === 0 ? (
          <div className="p-6 text-center text-gray-500 text-sm">
            Nenhuma instância com maturation_type virgem no momento.
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {virginInstances.map((vi) => {
              const isExpanded = expandedVirgin === vi.id;
              const logs = virginLogs[vi.id] || [];
              const isPaused = !!vi.maturation_paused_at;
              const daysLeft = vi.maturation_ends_at
                ? Math.max(0, Math.ceil((new Date(vi.maturation_ends_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
                : null;
              return (
                <div key={vi.id} className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-medium text-gray-800">{vi.instance_name}</span>
                      <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-800">
                        Dia {vi.current_day ?? '-'}/5
                      </span>
                      <span className="text-xs text-gray-500">
                        {VIRGIN_STATUS_LABEL[vi.maturation_status ?? ''] ?? vi.maturation_status ?? 'Aguardando início'}
                      </span>
                      {isPaused && (
                        <span className="text-xs px-2 py-0.5 rounded bg-gray-200 text-gray-700">Pausada</span>
                      )}
                      {daysLeft !== null && vi.maturation_status !== 'completed' && (
                        <span className="text-xs text-gray-500">{daysLeft}d restantes</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {vi.maturation_status != null && vi.maturation_status !== 'completed' && (
                        <>
                          <button
                            onClick={() => virginAction(vi.id, isPaused ? 'resume' : 'pause')}
                            disabled={virginActioning === vi.id}
                            className="px-3 py-1.5 text-xs rounded bg-gray-100 hover:bg-gray-200 text-gray-700 disabled:opacity-50"
                          >
                            {virginActioning === vi.id ? '...' : isPaused ? 'Retomar' : 'Pausar'}
                          </button>
                          <button
                            onClick={() => virginAction(vi.id, 'force_complete')}
                            disabled={virginActioning === vi.id}
                            className="px-3 py-1.5 text-xs rounded bg-green-100 hover:bg-green-200 text-green-800 disabled:opacity-50"
                          >
                            Forçar conclusão
                          </button>
                          <button
                            onClick={() => virginAction(vi.id, 'restart')}
                            disabled={virginActioning === vi.id}
                            className="px-3 py-1.5 text-xs rounded bg-blue-100 hover:bg-blue-200 text-blue-800 disabled:opacity-50"
                          >
                            Reiniciar
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => virginAction(vi.id, 'block')}
                        disabled={virginActioning === vi.id}
                        className="px-3 py-1.5 text-xs rounded bg-red-100 hover:bg-red-200 text-red-800 disabled:opacity-50"
                      >
                        Bloquear manual
                      </button>
                      <button
                        onClick={() => {
                          setExpandedVirgin(isExpanded ? null : vi.id);
                          if (!isExpanded && !virginLogs[vi.id]) fetchVirginLogs(vi.id);
                        }}
                        className="p-1.5 text-gray-400 hover:text-gray-600 rounded"
                        title="Ver logs"
                      >
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t border-gray-100">
                      <p className="text-xs font-medium text-gray-600 mb-2">Logs</p>
                      <div className="max-h-40 overflow-y-auto space-y-1 text-xs font-mono bg-gray-50 rounded p-2">
                        {logs.length === 0 ? (
                          <span className="text-gray-400">Carregando...</span>
                        ) : (
                          logs.map((log, i) => (
                            <div key={i} className="flex gap-2 text-gray-600">
                              <span className="text-gray-400 shrink-0">{new Date(log.created_at).toLocaleString()}</span>
                              <span className="text-amber-700">{log.event_type}</span>
                              {log.message && <span>{log.message}</span>}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Lista de Planos – usado no Maturador (manual) */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-lg font-semibold text-gray-800">Fluxo de mensagens do Maturador (manual)</h3>
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#0A5C5C]/10 text-[#0A5C5C]">Start na tela Maturador</span>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Monte o plano (texto, vídeo, imagem, áudio com delays). Ao clicar em <strong>Start</strong> na tela Maturador, <strong>todas as instâncias mestre</strong> enviam as mensagens deste plano para os números/conversas entre si.
          </p>
        </div>
        
        {plans.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>Nenhum plano cadastrado</p>
            <button
              onClick={openCreateModal}
              className="mt-4 text-[#8CD955] hover:underline"
            >
              Criar primeiro plano
            </button>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {plans.map((plan) => (
              <div key={plan.id} className="p-4">
                <div className="flex items-center justify-between">
                  <div
                    className="flex-1 cursor-pointer"
                    onClick={() => setExpandedPlan(expandedPlan === plan.id ? null : plan.id)}
                  >
                    <div className="flex items-center gap-3">
                      <h4 className="font-medium text-gray-800">{plan.name}</h4>
                      <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700">
                        {plan.steps_json.length} steps
                      </span>
                    </div>
                    {plan.description && (
                      <p className="text-sm text-gray-500 mt-1">{plan.description}</p>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openEditModal(plan)}
                      className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      title="Editar"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(plan.id)}
                      className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Excluir"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setExpandedPlan(expandedPlan === plan.id ? null : plan.id)}
                      className="p-2 text-gray-400 hover:text-gray-600 rounded-lg transition-colors"
                    >
                      {expandedPlan === plan.id ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
                
                {/* Steps expandidos */}
                {expandedPlan === plan.id && (
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <div className="space-y-3">
                      {plan.steps_json.map((step, index) => (
                        <div
                          key={index}
                          className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg"
                        >
                          <div className="w-8 h-8 rounded-full bg-white border border-gray-200 flex items-center justify-center text-sm font-medium text-gray-600">
                            {index + 1}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              {getStepIcon(step.type)}
                              <span className="text-sm font-medium text-gray-700">
                                {getStepLabel(step.type)}
                              </span>
                              <span className="text-xs text-gray-400 flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {step.delaySec}s
                              </span>
                            </div>
                            {step.type === 'text' && step.payload.text && (
                              <p className="text-sm text-gray-600">{step.payload.text}</p>
                            )}
                            {['video', 'image', 'audio'].includes(step.type) && step.payload.media_url && (
                              <div className="space-y-1">
                                <p className="text-xs text-gray-400 truncate">{step.payload.media_url}</p>
                                {step.payload.caption && (
                                  <p className="text-sm text-gray-600">{step.payload.caption}</p>
                                )}
                              </div>
                            )}
                            {step.target_chat_id && (
                              <p className="text-xs text-amber-600 mt-1">
                                Enviar para grupo: <code className="bg-amber-50 px-1 rounded">{step.target_chat_id}</code>
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    
                    {plan.default_target_chat_id && (
                      <div className="mt-3 text-xs text-gray-500">
                        Chat padrão: <code className="bg-gray-100 px-1 py-0.5 rounded">{plan.default_target_chat_id}</code>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal de Criar/Editar */}
      {showModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-800">
                {editingPlan ? 'Editar Plano' : 'Novo Plano'}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            {/* Conteúdo */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Nome */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nome do Plano *
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Ex: Maturação Inicial"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-700 focus:ring-2 focus:ring-[#0A5C5C] focus:border-transparent"
                />
              </div>
              
              {/* Descrição */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Descrição
                </label>
                <textarea
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Descrição opcional do plano"
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-700 resize-none focus:ring-2 focus:ring-[#0A5C5C] focus:border-transparent"
                />
              </div>
              
              {/* Target Chat ID Padrão (opcional: destino padrão do job; steps podem ter "Enviar para grupo" próprio) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Target Chat ID Padrão (opcional)
                </label>
                <input
                  type="text"
                  value={formTargetChatId}
                  onChange={(e) => setFormTargetChatId(e.target.value)}
                  placeholder="Ex: 1203...@g.us (grupo ou número)"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-700 focus:ring-2 focus:ring-[#0A5C5C] focus:border-transparent"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Destino padrão do job. Em cada step você pode opcionalmente definir &quot;Enviar para grupo&quot; para enviar no meio do fluxo.
                </p>
              </div>
              
              {/* Steps */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700">
                    Steps de Mensagens *
                  </label>
                  <button
                    type="button"
                    onClick={addStep}
                    className="text-sm text-[#8CD955] hover:text-[#7BC84A] flex items-center gap-1"
                  >
                    <Plus className="w-4 h-4" />
                    Adicionar Step
                  </button>
                </div>
                
                <div className="space-y-4">
                  {formSteps.map((step, index) => (
                    <div
                      key={index}
                      className="bg-gray-50 rounded-lg p-4 border border-gray-200"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm font-medium text-gray-700">
                          Step {index + 1}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeStep(index)}
                          className="text-red-500 hover:text-red-600"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Tipo</label>
                          <select
                            value={step.type}
                            onChange={(e) => updateStep(index, 'type', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-700 bg-white text-sm"
                          >
                            <option value="text">Texto</option>
                            <option value="video">Vídeo</option>
                            <option value="image">Imagem</option>
                            <option value="audio">Áudio</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Delay (segundos)</label>
                          <input
                            type="number"
                            value={step.delay_seconds}
                            onChange={(e) => updateStep(index, 'delay_seconds', parseInt(e.target.value) || 5)}
                            min={1}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-700 text-sm"
                          />
                        </div>
                      </div>
                      <div className="mb-3">
                        <label className="block text-xs text-gray-500 mb-1">Enviar para grupo (opcional)</label>
                        <input
                          type="text"
                          value={step.target_chat_id ?? ''}
                          onChange={(e) => updateStep(index, 'target_chat_id', e.target.value)}
                          placeholder="Ex: 1203...@g.us — deixe vazio para usar o destino padrão do job"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-700 text-sm focus:ring-2 focus:ring-[#0A5C5C] focus:border-transparent"
                        />
                      </div>
                      {step.type === 'text' ? (
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Mensagem</label>
                          <textarea
                            value={step.payload.text || ''}
                            onChange={(e) => updateStep(index, 'text', e.target.value)}
                            placeholder="Digite a mensagem de texto..."
                            rows={3}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-700 resize-none text-sm"
                          />
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">URL da Mídia *</label>
                            <input
                              type="url"
                              value={step.payload.media_url || ''}
                              onChange={(e) => updateStep(index, 'media_url', e.target.value)}
                              placeholder="https://..."
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-700 text-sm"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">Legenda</label>
                            <input
                              type="text"
                              value={step.payload.caption || ''}
                              onChange={(e) => updateStep(index, 'caption', e.target.value)}
                              placeholder="Legenda opcional"
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-700 text-sm"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            
            {/* Footer */}
            <div className="p-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 bg-[#8CD955] text-white rounded-lg hover:bg-[#7BC84A] disabled:opacity-50 flex items-center gap-2"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Salvar
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
