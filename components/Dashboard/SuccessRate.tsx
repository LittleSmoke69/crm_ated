'use client';

import React from 'react';

interface SuccessRateProps {
  rate: number;
}

const SuccessRate: React.FC<SuccessRateProps> = ({ rate }) => {
  return (
    <div className="bg-gray-100 rounded-xl shadow-md p-6 border border-gray-200">
      <h3 className="text-lg font-semibold text-gray-800 mb-4">Sucesso de Adição aos Grupos</h3>
      <div className="text-center">
        <div className="text-6xl font-bold mb-4" style={{ color: '#8CD955' }}>{rate}%</div>
        <div className="relative w-full h-8 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="absolute top-0 left-0 h-full transition-all duration-500 rounded-full"
            style={{ 
              width: `${rate}%`,
              background: 'linear-gradient(to right, #A8E677, #8CD955)'
            }}
          />
        </div>
        <p className="text-sm text-gray-500 mt-2">Taxa de sucesso</p>
      </div>
    </div>
  );
};

export default SuccessRate;

