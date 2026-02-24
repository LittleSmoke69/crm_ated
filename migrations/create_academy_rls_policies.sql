-- =====================================================
-- RLS e políticas para tabelas Academy
-- =====================================================

-- Função auxiliar: verifica se o usuário atual é admin ou super_admin
CREATE OR REPLACE FUNCTION public.is_academy_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND status IN ('super_admin', 'admin')
  );
$$;

-- academy_modules
ALTER TABLE academy_modules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "academy_modules_service_role"
  ON academy_modules FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "academy_modules_select_published"
  ON academy_modules FOR SELECT TO anon, authenticated
  USING (is_published = true);

CREATE POLICY "academy_modules_admin_write"
  ON academy_modules FOR ALL TO authenticated
  USING (is_academy_admin())
  WITH CHECK (is_academy_admin());

-- academy_lessons
ALTER TABLE academy_lessons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "academy_lessons_service_role"
  ON academy_lessons FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "academy_lessons_select_published"
  ON academy_lessons FOR SELECT TO anon, authenticated
  USING (is_published = true);

CREATE POLICY "academy_lessons_admin_write"
  ON academy_lessons FOR ALL TO authenticated
  USING (is_academy_admin())
  WITH CHECK (is_academy_admin());

-- academy_assets
ALTER TABLE academy_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "academy_assets_service_role"
  ON academy_assets FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "academy_assets_select_published"
  ON academy_assets FOR SELECT TO anon, authenticated
  USING (is_published = true);

CREATE POLICY "academy_assets_admin_write"
  ON academy_assets FOR ALL TO authenticated
  USING (is_academy_admin())
  WITH CHECK (is_academy_admin());

-- academy_lesson_attachments: select se a aula estiver publicada
ALTER TABLE academy_lesson_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "academy_lesson_attachments_service_role"
  ON academy_lesson_attachments FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "academy_lesson_attachments_select_public_lesson"
  ON academy_lesson_attachments FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM academy_lessons al
      WHERE al.id = academy_lesson_attachments.lesson_id AND al.is_published = true
    )
  );

CREATE POLICY "academy_lesson_attachments_admin_write"
  ON academy_lesson_attachments FOR ALL TO authenticated
  USING (is_academy_admin())
  WITH CHECK (is_academy_admin());

-- academy_user_progress: usuário só acessa seus próprios registros
ALTER TABLE academy_user_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "academy_user_progress_service_role"
  ON academy_user_progress FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "academy_user_progress_own"
  ON academy_user_progress FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- academy_vturb_snapshots: apenas admin e service_role
ALTER TABLE academy_vturb_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "academy_vturb_snapshots_service_role"
  ON academy_vturb_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "academy_vturb_snapshots_admin_read"
  ON academy_vturb_snapshots FOR SELECT TO authenticated
  USING (is_academy_admin());

CREATE POLICY "academy_vturb_snapshots_admin_write"
  ON academy_vturb_snapshots FOR ALL TO authenticated
  USING (is_academy_admin())
  WITH CHECK (is_academy_admin());
