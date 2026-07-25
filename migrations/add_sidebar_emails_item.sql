-- "E-mails" NÃO fica na sidebar lateral: o acesso é só pelo atalho da tela
-- /admin (Painel Administrativo), visível para super_admin e admin.
-- Esta migration existiu numa versão anterior para inserir o item também no
-- sidebar dinâmico multi-tenant (zaploto_sidebar_items); esta versão desfaz
-- isso — remove o item 'admin_emails' e seus vínculos de papel, caso a versão
-- anterior já tenha rodado. Idempotente: não faz nada se o item nunca existiu.

DELETE FROM zaploto_role_sidebar
 WHERE sidebar_item_id IN (
   SELECT id FROM zaploto_sidebar_items WHERE code = 'admin_emails'
 );

DELETE FROM zaploto_sidebar_items WHERE code = 'admin_emails';
