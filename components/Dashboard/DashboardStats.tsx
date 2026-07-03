'use client';

import React from 'react';
import { MessageSquare, UserPlus, Clock, Wifi, XCircle, AlertCircle } from 'lucide-react';
import KPICard from './KPICard';

interface DashboardStatsProps {
  kpiSent: number;
  kpiAdded: number;
  kpiPending: number;
  kpiConnected: number;
  kpiFailedSends: number;
  kpiFailedAdds: number;
}

const DashboardStats: React.FC<DashboardStatsProps> = ({
  kpiSent,
  kpiAdded,
  kpiPending,
  kpiConnected,
  kpiFailedSends,
  kpiFailedAdds,
}) => {
  const kpis = [
    { label: 'Mensagens Enviadas', value: kpiSent, icon: MessageSquare, gradient: 'from-[#EF9057] to-[#E86A24]' },
    { label: 'Adicionados ao Grupo', value: kpiAdded, icon: UserPlus, gradient: 'from-[#EF9057] to-[#E86A24]' },
    { label: 'Pendentes', value: kpiPending, icon: Clock, gradient: 'from-[#EF9057] to-[#E86A24]' },
    { label: 'Instâncias Conectadas', value: kpiConnected, icon: Wifi, gradient: 'from-[#EF9057] to-[#E86A24]' },
    { label: 'Disparos com Falha', value: kpiFailedSends, icon: XCircle, gradient: 'from-[#EF9057] to-[#E86A24]' },
    { label: 'Falhas ao Adicionar', value: kpiFailedAdds, icon: AlertCircle, gradient: 'from-[#EF9057] to-[#E86A24]' },
  ];

  return (
    <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 w-full">
      {kpis.map((kpi, index) => (
        <KPICard
          key={index}
          label={kpi.label}
          value={kpi.value}
          icon={kpi.icon}
          gradient={kpi.gradient}
        />
      ))}
    </section>
  );
};

export default DashboardStats;

