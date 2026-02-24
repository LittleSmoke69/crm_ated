-- =====================================================
-- Migration: Miniatura da aula + Sistema de comentários
-- =====================================================

-- 1. Miniatura na aula
ALTER TABLE academy_lessons
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

COMMENT ON COLUMN academy_lessons.thumbnail_url IS 'URL ou path no Storage da miniatura da aula';

-- 2. Comentários na aula (dúvidas)
CREATE TABLE IF NOT EXISTS academy_lesson_comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lesson_id UUID NOT NULL REFERENCES academy_lessons(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  parent_id UUID REFERENCES academy_lesson_comments(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_academy_lesson_comments_lesson ON academy_lesson_comments(lesson_id);
CREATE INDEX IF NOT EXISTS idx_academy_lesson_comments_user ON academy_lesson_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_academy_lesson_comments_parent ON academy_lesson_comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_academy_lesson_comments_created ON academy_lesson_comments(lesson_id, created_at);

COMMENT ON TABLE academy_lesson_comments IS 'Comentários/dúvidas nas aulas da Academy';

-- RLS para comentários
ALTER TABLE academy_lesson_comments ENABLE ROW LEVEL SECURITY;

-- service_role tem acesso total
CREATE POLICY "academy_lesson_comments_service_role"
  ON academy_lesson_comments FOR ALL TO service_role USING (true) WITH CHECK (true);

-- usuários autenticados podem ler comentários de aulas publicadas
CREATE POLICY "academy_lesson_comments_select_public_lesson"
  ON academy_lesson_comments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM academy_lessons al
      WHERE al.id = academy_lesson_comments.lesson_id AND al.is_published = true
    )
  );

-- usuários autenticados podem inserir comentários em aulas publicadas
CREATE POLICY "academy_lesson_comments_insert_authenticated"
  ON academy_lesson_comments FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM academy_lessons al
      WHERE al.id = academy_lesson_comments.lesson_id AND al.is_published = true
    )
  );

-- usuário pode atualizar/deletar apenas seus próprios comentários
CREATE POLICY "academy_lesson_comments_update_own"
  ON academy_lesson_comments FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "academy_lesson_comments_delete_own"
  ON academy_lesson_comments FOR DELETE TO authenticated
  USING (user_id = auth.uid());
