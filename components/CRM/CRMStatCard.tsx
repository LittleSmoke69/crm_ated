import React from 'react';
import { LucideIcon } from 'lucide-react';

interface CRMStatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  iconColor: string;
  iconBg: string;
  valueColor?: string;
  dark?: boolean;
}

const CRMStatCard: React.FC<CRMStatCardProps> = ({ 
  label, 
  value, 
  icon: Icon, 
  iconColor, 
  iconBg,
  valueColor = "text-white",
  dark = true
}) => {
  return (
    <div className={`${dark ? 'bg-[#1a1f2e]' : 'bg-white'} p-5 rounded-2xl shadow-sm border ${dark ? 'border-gray-800' : 'border-gray-100'} flex items-center gap-4 transition-all hover:scale-[1.02]`}>
      <div className={`w-12 h-12 ${iconBg} rounded-xl flex items-center justify-center`}>
        <Icon className={`w-6 h-6 ${iconColor}`} />
      </div>
      <div>
        <p className={`text-[10px] font-bold ${dark ? 'text-gray-400' : 'text-gray-500'} uppercase tracking-wider`}>{label}</p>
        <p className={`text-xl md:text-2xl font-black ${valueColor} leading-tight mt-0.5`}>{value}</p>
      </div>
    </div>
  );
};

export default CRMStatCard;

