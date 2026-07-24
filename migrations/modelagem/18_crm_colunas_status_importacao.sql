-- Colunas correspondentes aos status presentes na base CSV de leads.

DO $$
DECLARE
  v_zaploto_id UUID;
BEGIN
  SELECT id INTO v_zaploto_id
  FROM public.zaploto_tenants
  WHERE slug = 'zaploto'
  LIMIT 1;

  -- Abre espaço antes das colunas genéricas já existentes.
  UPDATE public.crm_columns
     SET sort_order = sort_order + 10,
         updated_at = now()
   WHERE zaploto_id = v_zaploto_id
     AND key NOT IN ('status_pendente', 'status_encerrado', 'status_nao_responde', 'status_em_atendimento', 'status_convertido')
     AND sort_order < 10;

  INSERT INTO public.crm_columns
    (zaploto_id, key, title, color, sort_order, is_system, is_active, auto_rule)
  VALUES
    (v_zaploto_id, 'status_pendente',       'Pendente',       'amber',   0, true, true, NULL),
    (v_zaploto_id, 'status_em_atendimento', 'Em Atendimento', 'blue',    1, true, true, NULL),
    (v_zaploto_id, 'status_nao_responde',   'Não Responde',   'orange',  2, true, true, NULL),
    (v_zaploto_id, 'status_convertido',     'Convertido',     'emerald', 3, true, true, NULL),
    (v_zaploto_id, 'status_encerrado',      'Encerrado',      'rose',    4, true, true, NULL)
  ON CONFLICT (zaploto_id, key) DO UPDATE
    SET title = EXCLUDED.title,
        color = EXCLUDED.color,
        sort_order = EXCLUDED.sort_order,
        is_system = true,
        is_active = true,
        updated_at = now();
END $$;

NOTIFY pgrst, 'reload schema';
