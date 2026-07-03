import React from 'react';
import { LucideIcon } from 'lucide-react';
import { zapStatCard, zapStatCardAccent } from '@/lib/zap-card-styles';

interface CRMStatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  iconColor: string;
  iconBg: string;
  valueColor?: string;
  accent?: boolean;
}

const CRMStatCard: React.FC<CRMStatCardProps> = ({
  label,
  value,
  icon: Icon,
  iconColor,
  iconBg,
  valueColor = 'text-white',
  accent = false,
}) => {
  return (
    <div
      className={`${accent ? zapStatCardAccent : zapStatCard} flex items-center gap-4 transition-all hover:border-[#E86A24]/40`}
    >
      <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${iconBg}`}>
        <Icon className={`h-6 w-6 ${iconColor}`} />
      </div>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</p>
        <p className={`mt-0.5 text-xl font-black leading-tight md:text-2xl ${valueColor}`}>{value}</p>
      </div>
    </div>
  );
};

export default CRMStatCard;
