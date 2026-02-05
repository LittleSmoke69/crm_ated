'use client';

import React from 'react';
import { LucideIcon } from 'lucide-react';

interface KPICardProps {
  label: string;
  value: number;
  icon: LucideIcon;
  gradient: string;
}

const KPICard: React.FC<KPICardProps> = ({ label, value, icon: Icon, gradient }) => {
  return (
    <div className={`rounded-xl p-5 text-white shadow-lg bg-gradient-to-br ${gradient} flex items-center justify-between border border-white/10`}>
      <div>
        <p className="text-xs opacity-90">{label}</p>
        <p className="text-3xl font-extrabold mt-1">{value}</p>
      </div>
      <Icon className="w-8 h-8 opacity-80" />
    </div>
  );
};

export default KPICard;

