-- O atendimento Evolution é exclusivamente 1:1. Remove conversas de grupos já
-- importadas; mensagens são removidas pela FK ON DELETE CASCADE.
DELETE FROM public.chat_conversations
 WHERE instance_id IS NOT NULL
   AND (is_group = true OR lower(remote_jid) LIKE '%@g.us');
