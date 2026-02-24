'use client';

import React from 'react';

interface GroupsCardProps {
  title: string;
  count: number;
  onViewAll?: () => void;
}

const GroupsCard: React.FC<GroupsCardProps> = ({ title, count, onViewAll }) => {
  return (
    <div className="bg-gray-100 dark:bg-[#2a2a2a] rounded-xl shadow-md p-6 border border-gray-200 dark:border-[#404040]">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white">{title}</h3>
        {onViewAll && (
          <button
            onClick={onViewAll}
            className="text-sm font-medium text-[#8CD955] dark:text-[#00ff00] hover:text-[#7BC84A] dark:hover:text-[#00e600] transition-colors"
          >
            Ver todas
          </button>
        )}
      </div>
      <div className="text-center">
        <div className="text-4xl font-bold" style={{ color: 'var(--zaploto-green)' }}>{count}</div>
        <p className="text-sm text-gray-500 dark:text-[#aaa] mt-2">grupos cadastrados</p>
      </div>
    </div>
  );
};

export default GroupsCard;

