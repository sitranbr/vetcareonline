import React, { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { ClinicSettings } from '../types';
import { useAuth } from './AuthContext';
import { supabase } from '../lib/supabase';

interface SettingsContextType {
  settings: ClinicSettings;
  updateSettings: (newSettings: Partial<ClinicSettings>) => void;
  resetSettings: () => void;
}

const DEFAULT_SETTINGS: ClinicSettings = {
  systemName: 'Petcare Sistema Veterinário',
  name: 'Petcare',
  layoutMode: 'top',
  address: '',
  phone: '',
  email: '',
  document: '',
  logoUrl: ''
};

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const [settings, setSettings] = useState<ClinicSettings>(DEFAULT_SETTINGS);

  // Limpeza de cache antigo
  useEffect(() => {
    localStorage.removeItem('petcare_settings');
    localStorage.removeItem('piquet_settings');
  }, []);

  // Carrega configurações do Banco de Dados baseadas no usuário logado
  useEffect(() => {
    let isMounted = true;

    const loadSettings = async () => {
      // Se não houver usuário, usa o padrão (Petcare)
      if (!user) {
        if (isMounted) setSettings(DEFAULT_SETTINGS);
        return;
      }

      // Clínicas, Veterinários E Recepção têm personalização (White Label)
      if (user.role === 'vet' || user.role === 'clinic' || user.role === 'reception' || user.level === 5) {
        try {
          // APENAS a Recepção (Equipe Interna) deve herdar as configurações do criador (ownerId)
          // Clínicas e Vets parceiros devem carregar seus próprios dados, mesmo sendo convidados
          const isReception = user.role === 'reception' || user.level === 5;
          
          let targetUserId = user.id;
          let targetTable = user.role === 'vet' ? 'veterinarians' : 'clinics';
          
          if (isReception && user.ownerId) {
            // Para recepção, precisa buscar o role do criador para saber qual tabela usar
            const { data: ownerProfile } = await supabase
              .from('profiles')
              .select('role')
              .eq('id', user.ownerId)
              .limit(1);
            
            if (ownerProfile && ownerProfile.length > 0) {
              targetUserId = user.ownerId;
              // Usa a tabela correspondente ao role do criador
              targetTable = ownerProfile[0].role === 'vet' ? 'veterinarians' : 'clinics';
            } else {
              console.warn('⚠️ Perfil do criador não encontrado, usando configurações padrão');
              if (isMounted) setSettings(DEFAULT_SETTINGS);
              return;
            }
          }
          
          // CORREÇÃO CRÍTICA: Monta a query de select dinamicamente para evitar erro de coluna inexistente
          // Adicionado 'document' para veterinarians também, caso a RPC salve nele
          const selectQuery = targetTable === 'veterinarians' 
            ? 'name, crmv, document, phone, email, address, logo_url' 
            : 'name, document, phone, email, address, logo_url';

          // Busca dados vinculados ao perfil correto
          // Usando .limit(1) em vez de .maybeSingle() para evitar falhas silenciosas se houver registros duplicados
          const { data, error } = await supabase
            .from(targetTable)
            .select(selectQuery)
            .eq('profile_id', targetUserId)
            .limit(1);

          if (error) {
            console.error(`Erro ao buscar dados na tabela ${targetTable}:`, error);
          }

          if (isMounted && data && data.length > 0) {
            const record = data[0];
            setSettings(prev => ({
              ...prev,
              name: record.name || prev.name,
              // Mapeia corretamente o documento dependendo da tabela usada
              document: (targetTable === 'veterinarians' ? (record.document || record.crmv) : record.document) || prev.document,
              phone: record.phone || prev.phone,
              email: record.email || prev.email,
              address: record.address || prev.address,
              logoUrl: record.logo_url || ''
            }));
          } else if (isMounted) {
             // Se o usuário existe mas não tem dados na tabela específica ainda, mantém padrão
             setSettings(DEFAULT_SETTINGS);
          }
        } catch (err) {
          console.error("Erro ao carregar configurações:", err);
          if (isMounted) setSettings(DEFAULT_SETTINGS);
        }
      } else {
        // Admin ou outros níveis usam o padrão do sistema
        if (isMounted) setSettings(DEFAULT_SETTINGS);
      }
    };

    loadSettings();

    return () => { isMounted = false; };
  }, [user]); // Recarrega sempre que o usuário mudar (Login/Logout)

  const updateSettings = (newSettings: Partial<ClinicSettings>) => {
    setSettings(prev => ({ ...prev, ...newSettings }));
  };

  const resetSettings = () => {
    setSettings(DEFAULT_SETTINGS);
  };

  return (
    <SettingsContext.Provider value={{ settings, updateSettings, resetSettings }}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) throw new Error('useSettings must be used within a SettingsProvider');
  return context;
};
