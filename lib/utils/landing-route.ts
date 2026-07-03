/** Mapeia o status (role) do perfil para a rota inicial de acesso. */
export function getLandingRouteByStatus(status: string | null | undefined): string {
  switch (status) {
    case 'super_admin':
    case 'admin':
      return '/admin';
    case 'dono_banca':
      return '/dono-banca';
    case 'gestor':
      return '/gestor-trafego';
    case 'gerente':
      return '/gerente';
    case 'consultor':
      return '/consultor';
    case 'auditoria':
      return '/admin';
    case 'suporte':
      return '/crm/kanban';
    default:
      return '/';
  }
}
