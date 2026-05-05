'use client';

import React, { useEffect, useState } from 'react';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { ArrowLeft, Users, Phone, Mail, Calendar } from 'lucide-react';
import Link from '@/components/WhitelabelLink';
import { withTenantSlug } from '@/lib/utils/tenant-href';
import { useParams } from 'next/navigation';

interface Lead {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  origin: string;
  status: string;
  createdAt: string;
  statusDisparo: boolean;
  statusAddGp: boolean;
}

export default function ConsultorCrmPage() {
  const { checking, userId } = useRequireAuth();
  const params = useParams();
  const consultorId = params?.consultorId as string;
  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [consultorInfo, setConsultorInfo] = useState<{ email: string; full_name: string | null } | null>(null);

  useEffect(() => {
    if (!userId || !consultorId) return;

    const loadCrm = async () => {
      try {
        const response = await fetch(`/api/gerente/consultores/${consultorId}/crm`, {
          headers: {
            'X-User-Id': userId,
          },
        });

        if (response.ok) {
          const result = await response.json();
          if (result.success) {
            setLeads(result.data);
            
            // Busca informações do consultor (usando admin/users para buscar qualquer usuário)
            const profileResponse = await fetch(`/api/admin/users/${consultorId}`, {
              headers: {
                'X-User-Id': userId,
              },
            });
            if (profileResponse.ok) {
              const profileResult = await profileResponse.json();
              if (profileResult.success && profileResult.data?.user) {
                setConsultorInfo({
                  email: profileResult.data.user.email,
                  full_name: profileResult.data.user.full_name,
                });
              }
            }
          }
        }
      } catch (error) {
        console.error('Erro ao carregar CRM:', error);
      } finally {
        setLoading(false);
      }
    };

    loadCrm();
  }, [userId, consultorId]);

  const handleSignOut = async () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('user_id');
      sessionStorage.removeItem('profile_id');
      window.localStorage.removeItem('profile_id');
      document.cookie = 'user_id=; Path=/; Max-Age=0; SameSite=Lax';
      window.location.href = withTenantSlug('/login');
    }
  };

  if (checking || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-200 text-center">
          <p className="text-gray-700 font-medium">Carregando CRM do consultor...</p>
        </div>
      </div>
    );
  }

  return (
    <Layout onSignOut={handleSignOut}>
      <div className="space-y-6">
        {/* Header */}
        <div className="bg-white rounded-xl shadow-md p-6">
          <div className="flex items-center gap-4 mb-4">
            <Link
              href="/gerente"
              className="p-2 hover:bg-gray-100 rounded-lg transition"
            >
              <ArrowLeft className="w-5 h-5 text-gray-600" />
            </Link>
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-gray-800">CRM do Consultor</h1>
              {consultorInfo && (
                <p className="text-sm text-gray-500">
                  {consultorInfo.full_name || consultorInfo.email}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Estatísticas */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white rounded-xl shadow-md p-6">
            <div className="flex items-center gap-3 mb-2">
              <Users className="w-5 h-5 text-blue-600" />
              <h3 className="text-sm font-medium text-gray-500">Total de Leads</h3>
            </div>
            <p className="text-3xl font-bold text-gray-800">{leads.length}</p>
          </div>

          <div className="bg-white rounded-xl shadow-md p-6">
            <div className="flex items-center gap-3 mb-2">
              <Phone className="w-5 h-5 text-green-600" />
              <h3 className="text-sm font-medium text-gray-500">Com Disparo</h3>
            </div>
            <p className="text-3xl font-bold text-gray-800">
              {leads.filter(l => l.statusDisparo).length}
            </p>
          </div>

          <div className="bg-white rounded-xl shadow-md p-6">
            <div className="flex items-center gap-3 mb-2">
              <Users className="w-5 h-5 text-emerald-600" />
              <h3 className="text-sm font-medium text-gray-500">Adicionados em Grupo</h3>
            </div>
            <p className="text-3xl font-bold text-gray-800">
              {leads.filter(l => l.statusAddGp).length}
            </p>
          </div>
        </div>

        {/* Lista de Leads */}
        <div className="bg-white rounded-xl shadow-md p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Leads</h2>
          
          {leads.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Users className="w-12 h-12 mx-auto mb-2 text-gray-300" />
              <p>Nenhum lead encontrado</p>
            </div>
          ) : (
            <div className="space-y-4">
              {leads.map((lead) => (
                <div
                  key={lead.id}
                  className="border border-gray-200 rounded-lg p-4 hover:border-emerald-300 transition"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-800 mb-2">{lead.name}</h3>
                      
                      <div className="flex flex-wrap gap-4 text-sm text-gray-600">
                        <div className="flex items-center gap-2">
                          <Phone className="w-4 h-4" />
                          <span>{lead.phone}</span>
                        </div>
                        {lead.email && (
                          <div className="flex items-center gap-2">
                            <Mail className="w-4 h-4" />
                            <span>{lead.email}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4" />
                          <span>{new Date(lead.createdAt).toLocaleDateString('pt-BR')}</span>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-medium">
                          {lead.origin}
                        </span>
                        <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs font-medium">
                          {lead.status}
                        </span>
                        {lead.statusDisparo && (
                          <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-medium">
                            Disparo realizado
                          </span>
                        )}
                        {lead.statusAddGp && (
                          <span className="px-2 py-1 bg-emerald-100 text-emerald-700 rounded text-xs font-medium">
                            Adicionado em grupo
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}

