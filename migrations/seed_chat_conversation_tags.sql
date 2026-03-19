-- =====================================================
-- Seed: etiquetas padrão para o chat (globais, zaploto_id NULL)
-- Execute após create_chat_conversation_tags.sql
-- Idempotente: não duplica se o nome já existir (para zaploto_id NULL).
-- =====================================================

-- Etiquetas sugeridas para atendimento:
-- Urgente, Reclamação, Dúvida, Venda, Suporte, Cobrança, Elogio, Segunda via,
-- Problema técnico, Informação, Retorno, Prioridade, Cliente novo, Reativação

INSERT INTO chat_conversation_tags (zaploto_id, name, color, sort_order)
SELECT NULL, 'Urgente', '#DC2626', 1
WHERE NOT EXISTS (SELECT 1 FROM chat_conversation_tags WHERE zaploto_id IS NULL AND LOWER(TRIM(name)) = 'urgente');

INSERT INTO chat_conversation_tags (zaploto_id, name, color, sort_order)
SELECT NULL, 'Reclamação', '#EA580C', 2
WHERE NOT EXISTS (SELECT 1 FROM chat_conversation_tags WHERE zaploto_id IS NULL AND LOWER(TRIM(name)) = 'reclamação');

INSERT INTO chat_conversation_tags (zaploto_id, name, color, sort_order)
SELECT NULL, 'Dúvida', '#2563EB', 3
WHERE NOT EXISTS (SELECT 1 FROM chat_conversation_tags WHERE zaploto_id IS NULL AND LOWER(TRIM(name)) = 'dúvida');

INSERT INTO chat_conversation_tags (zaploto_id, name, color, sort_order)
SELECT NULL, 'Venda', '#16A34A', 4
WHERE NOT EXISTS (SELECT 1 FROM chat_conversation_tags WHERE zaploto_id IS NULL AND LOWER(TRIM(name)) = 'venda');

INSERT INTO chat_conversation_tags (zaploto_id, name, color, sort_order)
SELECT NULL, 'Suporte', '#8CD955', 5
WHERE NOT EXISTS (SELECT 1 FROM chat_conversation_tags WHERE zaploto_id IS NULL AND LOWER(TRIM(name)) = 'suporte');

INSERT INTO chat_conversation_tags (zaploto_id, name, color, sort_order)
SELECT NULL, 'Cobrança', '#B91C1C', 6
WHERE NOT EXISTS (SELECT 1 FROM chat_conversation_tags WHERE zaploto_id IS NULL AND LOWER(TRIM(name)) = 'cobrança');

INSERT INTO chat_conversation_tags (zaploto_id, name, color, sort_order)
SELECT NULL, 'Elogio', '#7C3AED', 7
WHERE NOT EXISTS (SELECT 1 FROM chat_conversation_tags WHERE zaploto_id IS NULL AND LOWER(TRIM(name)) = 'elogio');

INSERT INTO chat_conversation_tags (zaploto_id, name, color, sort_order)
SELECT NULL, 'Segunda via', '#0D9488', 8
WHERE NOT EXISTS (SELECT 1 FROM chat_conversation_tags WHERE zaploto_id IS NULL AND LOWER(TRIM(name)) = 'segunda via');

INSERT INTO chat_conversation_tags (zaploto_id, name, color, sort_order)
SELECT NULL, 'Problema técnico', '#4B5563', 9
WHERE NOT EXISTS (SELECT 1 FROM chat_conversation_tags WHERE zaploto_id IS NULL AND LOWER(TRIM(name)) = 'problema técnico');

INSERT INTO chat_conversation_tags (zaploto_id, name, color, sort_order)
SELECT NULL, 'Informação', '#0284C7', 10
WHERE NOT EXISTS (SELECT 1 FROM chat_conversation_tags WHERE zaploto_id IS NULL AND LOWER(TRIM(name)) = 'informação');

INSERT INTO chat_conversation_tags (zaploto_id, name, color, sort_order)
SELECT NULL, 'Retorno', '#CA8A04', 11
WHERE NOT EXISTS (SELECT 1 FROM chat_conversation_tags WHERE zaploto_id IS NULL AND LOWER(TRIM(name)) = 'retorno');

INSERT INTO chat_conversation_tags (zaploto_id, name, color, sort_order)
SELECT NULL, 'Prioridade', '#C026D3', 12
WHERE NOT EXISTS (SELECT 1 FROM chat_conversation_tags WHERE zaploto_id IS NULL AND LOWER(TRIM(name)) = 'prioridade');

INSERT INTO chat_conversation_tags (zaploto_id, name, color, sort_order)
SELECT NULL, 'Cliente novo', '#059669', 13
WHERE NOT EXISTS (SELECT 1 FROM chat_conversation_tags WHERE zaploto_id IS NULL AND LOWER(TRIM(name)) = 'cliente novo');

INSERT INTO chat_conversation_tags (zaploto_id, name, color, sort_order)
SELECT NULL, 'Reativação', '#0E7490', 14
WHERE NOT EXISTS (SELECT 1 FROM chat_conversation_tags WHERE zaploto_id IS NULL AND LOWER(TRIM(name)) = 'reativação');
