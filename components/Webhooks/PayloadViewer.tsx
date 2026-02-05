'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { Copy, CheckCircle2, Search, ChevronRight, ChevronDown, FileJson, Network, Table as TableIcon } from 'lucide-react';

interface PayloadViewerProps {
  payload: any;
  normalized?: any;
}

type ViewMode = 'tree' | 'json' | 'table';

interface TreeNode {
  key: string;
  value: any;
  path: string;
  children?: TreeNode[];
  isArray: boolean;
}

// Função para gerar path no formato n8n
const generateN8nPath = (path: string): string => {
  if (!path || path === 'json') return '{{$json}}';
  // Remove o prefixo "json." e converte para formato n8n
  const n8nPath = path.replace(/^json\./, '').replace(/^json/, '');
  return `{{$json.${n8nPath}}}`;
};

// Função para converter objeto em árvore
const objectToTree = (obj: any, parentPath: string = 'json'): TreeNode[] => {
  if (obj === null || obj === undefined) {
    return [{
      key: String(obj),
      value: obj,
      path: parentPath,
      isArray: false,
    }];
  }

  if (Array.isArray(obj)) {
    return obj.map((item, index) => ({
      key: `[${index}]`,
      value: item,
      path: `${parentPath}[${index}]`,
      children: typeof item === 'object' && item !== null ? objectToTree(item, `${parentPath}[${index}]`) : undefined,
      isArray: Array.isArray(item),
    }));
  }

  if (typeof obj === 'object') {
    return Object.entries(obj).map(([key, value]) => {
      const currentPath = parentPath === 'json' ? `json.${key}` : `${parentPath}.${key}`;
      const node: TreeNode = {
        key,
        value,
        path: currentPath,
        isArray: Array.isArray(value),
      };
      if (typeof value === 'object' && value !== null) {
        node.children = objectToTree(value, currentPath);
      }
      return node;
    });
  }

  return [{
    key: String(obj),
    value: obj,
    path: parentPath,
    isArray: false,
  }];
};

// Componente de nó da árvore
const TreeNodeComponent: React.FC<{
  node: TreeNode;
  level: number;
  searchTerm: string;
  onCopyPath: (path: string) => void;
  expandedKeys: Set<string>;
  onToggleExpand: (path: string) => void;
}> = ({ node, level, searchTerm, onCopyPath, expandedKeys, onToggleExpand }) => {
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = expandedKeys.has(node.path);
  const indent = level * 20;

  // Verifica se o nó ou seus filhos correspondem à busca
  const matchesSearch = useMemo(() => {
    if (!searchTerm) return true;
    const searchLower = searchTerm.toLowerCase();
    const keyMatch = node.key.toLowerCase().includes(searchLower);
    const valueMatch = typeof node.value === 'string' && node.value.toLowerCase().includes(searchLower);
    const pathMatch = node.path.toLowerCase().includes(searchLower);
    
    if (keyMatch || valueMatch || pathMatch) return true;
    if (hasChildren) {
      // Verifica se algum filho corresponde
      return node.children!.some(child => 
        child.key.toLowerCase().includes(searchLower) ||
        (typeof child.value === 'string' && child.value.toLowerCase().includes(searchLower))
      );
    }
    return false;
  }, [searchTerm, node, hasChildren]);

  if (!matchesSearch && !hasChildren) return null;

  const getValueDisplay = (val: any): string => {
    if (val === null) return 'null';
    if (val === undefined) return 'undefined';
    if (typeof val === 'string') return `"${val.substring(0, 100)}${val.length > 100 ? '...' : ''}"`;
    if (typeof val === 'object') {
      if (Array.isArray(val)) return `Array(${val.length})`;
      return `Object(${Object.keys(val).length})`;
    }
    return String(val);
  };

  const valueType = typeof node.value;
  const isPrimitive = valueType !== 'object' || node.value === null;
  const displayValue = isPrimitive ? getValueDisplay(node.value) : (Array.isArray(node.value) ? `Array(${node.value.length})` : `Object(${Object.keys(node.value).length})`);

  return (
    <div className={`${!matchesSearch ? 'hidden' : ''}`}>
      <div
        className="flex items-start gap-1 py-1 hover:bg-gray-50 rounded px-1 group"
        style={{ paddingLeft: `${indent}px` }}
      >
        {hasChildren ? (
          <button
            onClick={() => onToggleExpand(node.path)}
            className="flex-shrink-0 w-4 h-4 flex items-center justify-center hover:bg-gray-200 rounded"
          >
            {isExpanded ? (
              <ChevronDown className="w-3 h-3 text-gray-600" />
            ) : (
              <ChevronRight className="w-3 h-3 text-gray-600" />
            )}
          </button>
        ) : (
          <div className="w-4" />
        )}
        
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className="text-sm font-medium text-blue-800">{node.key}</span>
          <span className="text-sm text-gray-700">:</span>
          <span className={`text-sm ${
            valueType === 'string' ? 'text-green-900' :
            valueType === 'number' ? 'text-purple-900' :
            valueType === 'boolean' ? 'text-orange-900' :
            'text-gray-900'
          }`}>
            {displayValue}
          </span>
          <button
            onClick={() => onCopyPath(node.path)}
            className="opacity-0 group-hover:opacity-100 ml-auto flex-shrink-0 px-2 py-1 text-xs text-gray-500 hover:text-[#8CD955] transition"
            title="Copiar path"
          >
            <Copy className="w-3 h-3" />
          </button>
        </div>
      </div>
      
      {hasChildren && isExpanded && (
        <div>
          {node.children!.map((child, idx) => (
            <TreeNodeComponent
              key={child.path || idx}
              node={child}
              level={level + 1}
              searchTerm={searchTerm}
              onCopyPath={onCopyPath}
              expandedKeys={expandedKeys}
              onToggleExpand={onToggleExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// Componente de tabela para arrays de objetos
const TableView: React.FC<{ data: any[]; onCopyPath: (path: string) => void }> = ({ data, onCopyPath }) => {
  if (!Array.isArray(data) || data.length === 0) {
    return <div className="p-4 text-gray-500">Nenhum array de objetos encontrado</div>;
  }

  // Verifica se todos os itens são objetos
  const allObjects = data.every(item => typeof item === 'object' && item !== null && !Array.isArray(item));
  
  if (!allObjects) {
    return <div className="p-4 text-gray-500">A visualização em tabela só está disponível para arrays de objetos</div>;
  }

  const keys = useMemo(() => {
    const allKeys = new Set<string>();
    data.forEach(item => {
      Object.keys(item).forEach(key => allKeys.add(key));
    });
    return Array.from(allKeys);
  }, [data]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="px-4 py-2 text-left font-semibold text-gray-900">#</th>
            {keys.map(key => (
              <th key={key} className="px-4 py-2 text-left font-semibold text-gray-900 border-l border-gray-200">
                {key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((item, idx) => (
            <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
              <td className="px-4 py-2 text-gray-900 font-mono text-xs font-medium">{idx}</td>
              {keys.map(key => (
                <td key={key} className="px-4 py-2 border-l border-gray-100">
                  <div className="flex items-center gap-2 group">
                    <span className="text-gray-900">
                      {typeof item[key] === 'object' ? JSON.stringify(item[key]).substring(0, 100) : String(item[key] ?? 'N/A')}
                    </span>
                    <button
                      onClick={() => onCopyPath(`json[${idx}].${key}`)}
                      className="opacity-0 group-hover:opacity-100 px-1 py-0.5 text-xs text-gray-500 hover:text-[#8CD955] transition"
                      title="Copiar path"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export const PayloadViewer: React.FC<PayloadViewerProps> = ({ payload, normalized }) => {
  const [viewMode, setViewMode] = useState<ViewMode>('tree');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set(['json']));
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<'input' | 'normalized'>('input');

  const currentData = selectedSource === 'input' ? payload : (normalized || payload);

  const tree = useMemo(() => {
    if (!currentData) return [];
    return objectToTree(currentData);
  }, [currentData]);

  const handleToggleExpand = useCallback((path: string) => {
    setExpandedKeys(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleCopyPath = useCallback(async (path: string) => {
    const n8nPath = generateN8nPath(path);
    try {
      await navigator.clipboard.writeText(n8nPath);
      setCopiedPath(path);
      setTimeout(() => setCopiedPath(null), 2000);
    } catch (err) {
      console.error('Erro ao copiar path:', err);
    }
  }, []);

  const expandAll = useCallback(() => {
    const allPaths = new Set<string>();
    const collectPaths = (nodes: TreeNode[]) => {
      nodes.forEach(node => {
        allPaths.add(node.path);
        if (node.children) {
          collectPaths(node.children);
        }
      });
    };
    collectPaths(tree);
    setExpandedKeys(allPaths);
  }, [tree]);

  const collapseAll = useCallback(() => {
    setExpandedKeys(new Set(['json']));
  }, []);

  // Verifica se há array de objetos para visualização em tabela
  const hasTableData = useMemo(() => {
    if (!currentData || typeof currentData !== 'object') return false;
    if (Array.isArray(currentData)) {
      return currentData.length > 0 && currentData.every(item => typeof item === 'object' && item !== null && !Array.isArray(item));
    }
    // Procura arrays de objetos no objeto raiz
    const findArrayOfObjects = (obj: any): boolean => {
      if (Array.isArray(obj)) {
        return obj.length > 0 && obj.every(item => typeof item === 'object' && item !== null && !Array.isArray(item));
      }
      if (typeof obj === 'object' && obj !== null) {
        return Object.values(obj).some(val => findArrayOfObjects(val));
      }
      return false;
    };
    return findArrayOfObjects(currentData);
  }, [currentData]);

  return (
    <div className="flex flex-col h-full">
      {/* Header com abas e controles */}
      <div className="border-b border-gray-200 bg-gray-50">
        {/* Seletor de source (input/normalized) */}
        {normalized && (
          <div className="px-4 py-2 border-b border-gray-200 flex gap-2">
            <button
              onClick={() => setSelectedSource('input')}
              className={`px-3 py-1 text-sm rounded transition ${
                selectedSource === 'input'
                  ? 'bg-[#8CD955] text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              Input (raw)
            </button>
            <button
              onClick={() => setSelectedSource('normalized')}
              className={`px-3 py-1 text-sm rounded transition ${
                selectedSource === 'normalized'
                  ? 'bg-[#8CD955] text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              Normalized
            </button>
          </div>
        )}

        {/* Abas e busca */}
        <div className="px-4 py-2 flex items-center justify-between gap-4">
          <div className="flex gap-2">
            <button
              onClick={() => setViewMode('tree')}
              className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded transition ${
                viewMode === 'tree'
                  ? 'bg-[#8CD955] text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
              }`}
            >
              <Network className="w-4 h-4" />
              Tree
            </button>
            <button
              onClick={() => setViewMode('json')}
              className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded transition ${
                viewMode === 'json'
                  ? 'bg-[#8CD955] text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
              }`}
            >
              <FileJson className="w-4 h-4" />
              JSON
            </button>
            {hasTableData && (
              <button
                onClick={() => setViewMode('table')}
                className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded transition ${
                  viewMode === 'table'
                    ? 'bg-[#8CD955] text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
                }`}
              >
                <TableIcon className="w-4 h-4" />
                Table
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {viewMode === 'tree' && (
              <>
                <button
                  onClick={expandAll}
                  className="px-2 py-1 text-xs text-gray-600 hover:text-gray-800"
                >
                  Expandir tudo
                </button>
                <button
                  onClick={collapseAll}
                  className="px-2 py-1 text-xs text-gray-600 hover:text-gray-800"
                >
                  Recolher tudo
                </button>
              </>
            )}
            <div className="relative flex items-center">
              <Search className="absolute left-2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar chaves/valores..."
                className="pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Conteúdo */}
      <div className="flex-1 overflow-auto p-4 min-h-0">
        {viewMode === 'tree' && (
          <div className="font-mono text-sm">
            {tree.length === 0 ? (
              <div className="text-gray-700 p-4">Nenhum dado para exibir</div>
            ) : (
              tree.map((node, idx) => (
                <TreeNodeComponent
                  key={node.path || idx}
                  node={node}
                  level={0}
                  searchTerm={searchTerm}
                  onCopyPath={handleCopyPath}
                  expandedKeys={expandedKeys}
                  onToggleExpand={handleToggleExpand}
                />
              ))
            )}
          </div>
        )}

        {viewMode === 'json' && (
          <div className="h-full overflow-auto">
            <pre className="bg-gray-50 p-4 rounded-lg text-xs text-gray-900 font-mono whitespace-pre-wrap">
              {JSON.stringify(currentData, null, 2)}
            </pre>
          </div>
        )}

        {viewMode === 'table' && (
          <div className="h-full overflow-auto">
            {Array.isArray(currentData) ? (
              <TableView data={currentData} onCopyPath={handleCopyPath} />
            ) : (
              <div className="text-gray-500 p-4">
                A visualização em tabela está disponível apenas para arrays de objetos no nível raiz.
              </div>
            )}
          </div>
        )}

        {/* Feedback de cópia */}
        {copiedPath && (
          <div className="fixed bottom-4 right-4 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 z-50">
            <CheckCircle2 className="w-4 h-4" />
            <span className="text-sm font-medium">Path copiado: {generateN8nPath(copiedPath)}</span>
          </div>
        )}
      </div>
    </div>
  );
};

