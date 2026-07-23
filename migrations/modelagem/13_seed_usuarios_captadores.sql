-- =====================================================
-- MODELAGEM 13 — usuários importados da planilha
-- Senha inicial de todos: 123mudar (bcrypt cost 12).
-- Idempotente: atualiza pelo username e insere apenas quando não existe.
-- =====================================================

DO $$
DECLARE
  v RECORD;
  v_profile_id UUID;
  v_tenant_id UUID;
  v_password_hash CONSTANT TEXT := '$2b$12$3SsLXDSAaDT.hnRo7ziSbuqpyGsPw90XkSdNei5SB42JKtzjWNVay';
BEGIN
  SELECT id INTO v_tenant_id
  FROM public.zaploto_tenants
  WHERE slug = 'zaploto';

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant zaploto não encontrado';
  END IF;

  -- Administrador principal solicitado para o ambiente.
  UPDATE public.profiles
  SET username = 'carlinhosbig',
      password_hash = v_password_hash,
      status = 'admin',
      enroller = NULL,
      zaploto_id = v_tenant_id,
      updated_at = now()
  WHERE lower(trim(email)) = 'carlinhosbigdata@gmail.com';

  IF NOT FOUND THEN
    INSERT INTO public.profiles
      (user_id, full_name, email, username, password_hash, status, zaploto_id, created_at, updated_at)
    VALUES
      (gen_random_uuid(), 'Carlinhos Big Data', 'carlinhosbigdata@gmail.com', 'carlinhosbig', v_password_hash, 'admin', v_tenant_id, now(), now());
  END IF;

  FOR v IN
    SELECT * FROM (VALUES
      ('Administrador',       'administrador',       NULL,          'admin',    true,  NULL,              '2026-04-05'),
      ('Victor Martins',      'victorgerente',       NULL,          'gerente',  true,  NULL,              '2026-04-28'),
      ('Renato Cardoso',      'renatogerente',       NULL,          'gerente',  false, NULL,              '2026-04-20'),
      ('Ricardo Gutierrez',   'ricardogerente',      NULL,          'gerente',  true,  NULL,              '2026-04-08'),
      ('Wesley Oliveira',     'wesleyoliveira',      NULL,          'captador', true,  'victorgerente',   '2026-07-20'),
      ('Victoria Almeida',    'victoriaalmeida',     NULL,          'captador', true,  'ricardogerente',  '2026-07-16'),
      ('Bianca Nogueira',     'biancanogueira',      NULL,          'captador', true,  'victorgerente',   '2026-07-14'),
      ('Olivia Albuquerque',  'oliviaalbuquerque',   NULL,          'captador', true,  'victorgerente',   '2026-07-14'),
      ('Isabelly Queiroz',    'isabellyqueiroz',     NULL,          'captador', true,  'ricardogerente',  '2026-07-08'),
      ('Clara Medeiros',      'claramedeiros',       NULL,          'captador', true,  'ricardogerente',  '2026-07-03'),
      ('Victoria Alencar',    'victoriaalencar',     NULL,          'captador', true,  'victorgerente',   '2026-07-02'),
      ('Emanuela Souza',      'emanuelasouza',       NULL,          'captador', true,  'victorgerente',   '2026-06-22'),
      ('Mariana Ferraz',      'marianaferraz',       NULL,          'captador', true,  'victorgerente',   '2026-06-02'),
      ('Bruna Oliveira',      'brunaoliveira',       NULL,          'captador', true,  'victorgerente',   '2026-06-01'),
      ('Diego Andrade',       'diegoandrade',        '11936227744', 'captador', true,  'ricardogerente',  '2026-05-19'),
      ('Isadora Monteiro',    'isadoramonteiro',     NULL,          'captador', true,  'victorgerente',   '2026-05-05'),
      ('Emanuela Souza',      'natanaguiar',         NULL,          'captador', true,  'victorgerente',   '2026-05-05'),
      ('Thiago Verseli',      'thiagoverseli',       NULL,          'captador', true,  'victorgerente',   '2026-05-04'),
      ('Eduardo Guerra',      'eduardoguerra',       NULL,          'captador', true,  'victorgerente',   '2026-05-04'),
      ('Isabelalider',        'isabelalider',        NULL,          'captador', true,  'victorgerente',   '2026-04-28'),
      ('Marcos Pierre',       'marcospierre',        NULL,          'captador', false, 'renatogerente',   '2026-04-20'),
      ('Fernanda Alencar',    'fernandaalencar',     NULL,          'captador', false, 'renatogerente',   '2026-04-20'),
      ('Gisely Duarte',       'giselyduarte',        NULL,          'captador', false, 'renatogerente',   '2026-04-20'),
      ('Mariana Ballini',     'marianaballini',      NULL,          'captador', false, 'renatogerente',   '2026-04-20'),
      ('Pricila Pugliese',    'priciliapugliese',    NULL,          'captador', true,  'ricardogerente',  '2026-04-08'),
      ('Isabely Queiroz',     'felipecavalcante',    NULL,          'captador', false, 'ricardogerente',  '2026-04-08'),
      ('Clara Medeiros',      'laurapontes',         NULL,          'captador', false, 'ricardogerente',  '2026-04-08'),
      ('Mariana Sampaio',     'marianasampaio',      NULL,          'captador', true,  'ricardogerente',  '2026-04-08'),
      ('Maya Garcia',         'mayagarcia',          NULL,          'captador', true,  'ricardogerente',  '2026-04-08'),
      ('Otavio Guerra',       'otavioguerra',        NULL,          'captador', false, 'ricardogerente',  '2026-04-08'),
      ('Cecilia Mendes',      'ceciliamendes',       NULL,          'captador', true,  'ricardogerente',  '2026-04-08'),
      ('Flávio Apolinário',   'pedrosampaio',        NULL,          'captador', false, 'ricardogerente',  '2026-04-08'),
      ('Pedro Santos',        'pedrosantos',         NULL,          'admin',    true,  NULL,              '2026-07-23'),
      ('Franklin',            'franklin',            NULL,          'admin',    true,  NULL,              '2026-07-23')
    ) AS seed(full_name, username, telefone, status, is_active, manager_username, registered_at)
  LOOP
    SELECT id INTO v_profile_id
    FROM public.profiles
    WHERE lower(username) = v.username
    LIMIT 1;

    IF v_profile_id IS NULL THEN
      INSERT INTO public.profiles
        (user_id, full_name, email, username, telefone, password_hash, status, zaploto_id, created_at, updated_at)
      VALUES
        (gen_random_uuid(), v.full_name, v.username || '@capdosucesso.co.uk', v.username,
         v.telefone, v_password_hash, v.status, v_tenant_id, v.registered_at::timestamptz, now())
      RETURNING id INTO v_profile_id;
    ELSE
      UPDATE public.profiles
      SET full_name = v.full_name,
          telefone = COALESCE(v.telefone, telefone),
          password_hash = v_password_hash,
          status = v.status,
          enroller = CASE WHEN v.status IN ('super_admin', 'admin') THEN NULL ELSE enroller END,
          zaploto_id = v_tenant_id,
          updated_at = now()
      WHERE id = v_profile_id;
    END IF;

    INSERT INTO public.user_settings
      (user_id, max_leads_per_day, max_instances, is_admin, is_active, created_at, updated_at)
    VALUES
      (v_profile_id, 100, 20, v.status IN ('super_admin', 'admin'), v.is_active, now(), now())
    ON CONFLICT (user_id) DO UPDATE
      SET is_admin = EXCLUDED.is_admin,
          is_active = EXCLUDED.is_active,
          updated_at = now();

    v_profile_id := NULL;
  END LOOP;

  -- Vincula captadores aos gerentes após todos os perfis existirem.
  FOR v IN
    SELECT * FROM (VALUES
      ('wesleyoliveira','victorgerente'), ('victoriaalmeida','ricardogerente'),
      ('biancanogueira','victorgerente'), ('oliviaalbuquerque','victorgerente'),
      ('isabellyqueiroz','ricardogerente'), ('claramedeiros','ricardogerente'),
      ('victoriaalencar','victorgerente'), ('emanuelasouza','victorgerente'),
      ('marianaferraz','victorgerente'), ('brunaoliveira','victorgerente'),
      ('diegoandrade','ricardogerente'), ('isadoramonteiro','victorgerente'),
      ('natanaguiar','victorgerente'), ('thiagoverseli','victorgerente'),
      ('eduardoguerra','victorgerente'), ('isabelalider','victorgerente'),
      ('marcospierre','renatogerente'), ('fernandaalencar','renatogerente'),
      ('giselyduarte','renatogerente'), ('marianaballini','renatogerente'),
      ('priciliapugliese','ricardogerente'), ('felipecavalcante','ricardogerente'),
      ('laurapontes','ricardogerente'), ('marianasampaio','ricardogerente'),
      ('mayagarcia','ricardogerente'), ('otavioguerra','ricardogerente'),
      ('ceciliamendes','ricardogerente'), ('pedrosampaio','ricardogerente')
    ) AS hierarchy(username, manager_username)
  LOOP
    UPDATE public.profiles AS child
    SET enroller = manager.id,
        updated_at = now()
    FROM public.profiles AS manager
    WHERE lower(child.username) = v.username
      AND lower(manager.username) = v.manager_username;
  END LOOP;

  -- Garante settings ativos do administrador principal.
  SELECT id INTO v_profile_id
  FROM public.profiles
  WHERE username = 'carlinhosbig';

  INSERT INTO public.user_settings
    (user_id, max_leads_per_day, max_instances, is_admin, is_active, created_at, updated_at)
  VALUES
    (v_profile_id, 100, 20, true, true, now(), now())
  ON CONFLICT (user_id) DO UPDATE
    SET is_admin = true,
        is_active = true,
        updated_at = now();
END $$;

-- Verificação resumida após a importação.
SELECT
  p.status,
  s.is_active,
  count(*) AS total
FROM public.profiles p
JOIN public.user_settings s ON s.user_id = p.id
WHERE p.zaploto_id = (SELECT id FROM public.zaploto_tenants WHERE slug = 'zaploto')
GROUP BY p.status, s.is_active
ORDER BY p.status, s.is_active DESC;
