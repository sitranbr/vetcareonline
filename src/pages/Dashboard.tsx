import React from 'react';
import { useAuth } from '../context/AuthContext';
import { AdminTenants } from './AdminTenants';
import { OperationalDashboard } from './OperationalDashboard';

// O item "Minha Equipe" no cabeçalho (Layout) segue canManageTeamAccess em lib/teamPermissions.ts

// Dashboard Wrapper que decide o que mostrar
export const Dashboard = () => {
  const { user } = useAuth();

  // Se for Super Admin, mostra o Painel SaaS (Gestão de Tenants)
  if (user?.level === 1) {
    return <AdminTenants />;
  }

  // Se for Tenant (Vet/Clínica) ou Recepção, mostra o Dashboard Operacional (Exames)
  return <OperationalDashboard />;
};
