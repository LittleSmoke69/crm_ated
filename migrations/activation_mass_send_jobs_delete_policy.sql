-- Permite que o usuário exclua suas próprias campanhas de disparo em massa
CREATE POLICY "Users can delete own activation_mass_send_jobs"
  ON activation_mass_send_jobs FOR DELETE
  USING (auth.uid() = user_id);
