'use client';

import React from 'react';
import { Phone } from 'lucide-react';

interface TopPerformersChartProps {
  data?: Array<{ name: string; phone?: string; value: number }>;
  title: string;
  color?: string;
  valueLabel?: string;
}

// Função para formatar telefone
const formatPhone = (phone: string | undefined): string => {
  if (!phone) return 'Não informado';
  const digits = phone.replace(/\D/g, '');
  
  // Remove o 55 do início se existir (código do país)
  let cleanDigits = digits.startsWith('55') ? digits.slice(2) : digits;
  
  // Se tem 11 dígitos (DDD + número celular com 9)
  if (cleanDigits.length === 11) {
    const ddd = cleanDigits.slice(0, 2);
    const number = cleanDigits.slice(2);
    // Celular: (XX) 9XXXX-XXXX
    return `(${ddd}) ${number.slice(0, 5)}-${number.slice(5)}`;
  }
  
  // Se tem 10 dígitos (DDD + número)
  if (cleanDigits.length === 10) {
    const ddd = cleanDigits.slice(0, 2);
    const number = cleanDigits.slice(2);
    // Verifica se é celular (começa com 9) ou fixo
    if (number[0] === '9') {
      // Celular: (XX) 9XXXX-XXXX
      return `(${ddd}) ${number.slice(0, 5)}-${number.slice(5)}`;
    } else {
      // Fixo: (XX) XXXX-XXXX
      return `(${ddd}) ${number.slice(0, 4)}-${number.slice(4)}`;
    }
  }
  
  // Se não conseguir formatar, retorna o original
  return phone;
};

// Função para normalizar telefone para link tel:
const normalizePhoneForTel = (phone: string | undefined): string => {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  // Se não começa com 55, adiciona
  return digits.startsWith('55') ? digits : `55${digits}`;
};

export default function TopPerformersChart({ 
  data, 
  title, 
  color = '#E86A24',
  valueLabel = 'Valor'
}: TopPerformersChartProps) {
  if (!data || !Array.isArray(data) || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500 dark:text-gray-400">
        Nenhum dado disponível
      </div>
    );
  }

  return (
    <div className="w-full">
      <h3 className="text-sm font-bold text-gray-600 dark:text-gray-400 mb-4">{title}</h3>
      <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
        {data.map((item, index) => (
          <div
            key={index}
            className="bg-gradient-to-r from-gray-50 to-white dark:from-[#2a2a2a] dark:to-[#1e1e1e] border border-gray-200 dark:border-[#404040] rounded-lg p-3 hover:shadow-md hover:border-[#E86A24]/30 transition-all"
          >
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-[#E86A24] flex items-center justify-center shadow-sm">
                    <span className="text-xs font-bold text-white">{index + 1}</span>
                  </div>
                  <p className="text-sm font-bold text-gray-800 dark:text-gray-100 truncate">{item.name}</p>
                </div>
                <div className="flex items-center gap-1.5 mt-1.5 ml-9">
                  <Phone className="w-3.5 h-3.5 text-gray-400" />
                  {item.phone ? (
                    <a
                      href={`https://wa.me/${normalizePhoneForTel(item.phone)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-gray-600 dark:text-gray-300 hover:text-[#E86A24] font-medium transition-colors"
                      title="Abrir conversa no WhatsApp"
                    >
                      {formatPhone(item.phone)}
                    </a>
                  ) : (
                    <span className="text-xs text-gray-400 italic">Não informado</span>
                  )}
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5 font-medium">{valueLabel}</p>
                <p className="text-base font-bold text-[#E86A24]">
                  R$ {item.value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

