-- Armazena URL da foto de perfil do contato para exibir avatar no chat.
ALTER TABLE chat_conversations
ADD COLUMN IF NOT EXISTS profile_pic_url TEXT;

COMMENT ON COLUMN chat_conversations.profile_pic_url IS
'URL pública da foto de perfil do contato (quando fornecida pelo webhook/provider).';
