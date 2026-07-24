/** Mapeia o status (role) do perfil para a rota inicial de acesso. */
export function getLandingRouteByStatus(status: string | null | undefined): string {
  switch (status) {
    case 'super_admin':
    case 'admin':
      return '/admin';
    case 'gerente':
    case 'captador':
    // Legado (dados ainda não migrados): consultor era o antigo nome de captador
    case 'consultor':
      return '/crm/kanban';
    // Cargos legados remapeados pela migração new_role_line_super_admin_admin_gerente_captador.sql
    case 'dono_banca':
      return '/crm/kanban';
    case 'gestor':
    case 'auditoria':
      return '/admin';
    case 'suporte':
      return '/admin';
    default:
      return '/';
  }
}
