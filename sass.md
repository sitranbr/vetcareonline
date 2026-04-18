# Arquitetura SaaS - Petcare

Este documento descreve a arquitetura técnica do modelo **Software as a Service (SaaS)** implementado no Petcare, focando no isolamento de dados (Multi-tenancy) e na lógica de compartilhamento entre parceiros.

Requisitos funcionais e não funcionais de produto estão resumidos em [`features.md`](./features.md) (gestão de exames, equipe/parceiros, financeiro, painel Super Admin, UX e performance).

**Última atualização:** Abril 2026

---

## 1. Modelo de Dados Hierárquico

O sistema utiliza uma abordagem híbrida de multi-tenancy, onde a identidade (Login) é separada do contexto de trabalho (Tenant).

### Entidades Principais
1.  **Auth Users (`auth.users`):** Identidade única global (E-mail/Senha) gerenciada pelo Supabase Auth.
2.  **Profiles (`public.profiles`):** Dados públicos do usuário, nível de acesso e permissões modulares.
   - Campos principais: `id`, `email`, `name`, `role`, `level`, `owner_id`, `permissions`, `partners[]`
   - `role` inclui, entre outros, `admin`, `owner`, `vet`, `clinic`, `reception` (conforme políticas de laudo e telas administrativas).
   - A coluna `partners` é um array de texto (`text[]`) que armazena os IDs dos parceiros vinculados.
3.  **Tenants (`veterinarians` / `clinics`):** As entidades de negócio que possuem dados (Exames, Preços, Configurações).
   - Cada tenant possui um `profile_id` que vincula ao usuário de login.
   - Armazena dados de branding (logo, nome, contatos) para White Label.

### Níveis de Acesso (Hierarquia)
- **Nível 1:** Super Admin (acesso global)
- **Nível 2:** Owner (proprietário do tenant - não utilizado atualmente)
- **Nível 3:** Veterinário (tenant independente ou parceiro)
- **Nível 4:** Clínica (tenant independente ou parceiro)
- **Nível 5:** Recepção/Equipe (membro interno com `owner_id`)

### Relacionamento
*   Um **Usuário** pode ser dono de um **Tenant** (ex: Dr. João é dono do seu perfil de Veterinário).
*   Um **Usuário** pode ser membro da equipe de um **Tenant** (ex: Maria é recepcionista da Clínica Univet, com `owner_id` apontando para a clínica).
*   Um **Tenant** pode ter parceria com outro **Tenant** através do array `partners` na tabela `profiles`.
*   Um **Usuário Convidado** (Guest) possui `owner_id` diferente do próprio `id`, herdando configurações do criador.

---

## 2. Estratégia de Vínculo de Parceiros (Smart Linking)

Um dos maiores desafios em sistemas B2B veterinários é gerenciar a relação entre Clínicas e Veterinários Volantes sem duplicar cadastros. O Petcare resolve isso com a seguinte lógica:

### O Problema da Duplicidade
Em sistemas tradicionais, a Clínica A cadastra o "Dr. João" e a Clínica B também cadastra o "Dr. João". Isso cria dois logins diferentes para a mesma pessoa, fragmentando o histórico.

### A Solução Petcare
Utilizamos a coluna `partners` (array de texto) na tabela `profiles` para criar vínculos bidirecionais entre parceiros.

#### Fluxo de Vínculo

1.  **Busca Prévia (`findPartnerByEmail`):**
    *   O sistema primeiro busca o e-mail nas tabelas `profiles`, `veterinarians` e `clinics`.
    *   Retorna informações se o usuário já existe (nome, role, id).

2.  **Vínculo via RPC (`link_partner_by_email`):**
    *   Função `SECURITY DEFINER` que bypassa RLS para executar o vínculo.
    *   **Validações implementadas:**
      - Verifica se o usuário existe (retorna erro se não encontrado).
      - Impede auto-vínculo (não permite vincular a si mesmo).
      - Impede duplicidade (verifica se já está na lista de `partners`).
    *   **Vínculo Mútuo:**
      - Adiciona o ID do alvo no array `partners` do solicitante.
      - Adiciona o ID do solicitante no array `partners` do alvo.
      - Garante que ambos os perfis se vejam mutuamente.

3.  **Desvincular Parceiro (`unlinkPartner`):**
    *   Remove o ID do parceiro do array `partners` do usuário atual.
    *   Remove o ID do usuário atual do array `partners` do parceiro (vínculo reverso).
    *   Mantém a consistência bidirecional.

4.  **Acesso Convidado (Fallback):**
    *   Apenas se o usuário **não** existir, o sistema permite criar uma conta "Convidada" (Guest).
    *   Essa conta nasce com `owner_id` apontando para o criador.
    *   Pode ser "emancipada" futuramente se o usuário decidir assinar a plataforma (removendo o `owner_id`).

---

## 3. Segurança e Isolamento (RLS)

O isolamento de dados é garantido por **Row Level Security (RLS)** no PostgreSQL/Supabase.

### Políticas de Acesso (Policies)

#### 1. Visualização de Exames
Um usuário pode ver um exame SE:
*   Ele é o **Veterinário Responsável** (`veterinarian_id = auth.uid()`).
*   OU Ele é a **Clínica Proprietária** (`clinic_id = auth.uid()`).
*   OU Ele é **Membro da Equipe** do dono do exame (verificado via `owner_id`).
*   OU Ele é **Parceiro** do veterinário ou clínica responsável (verificado via array `partners`).

#### 2. Visualização de Parceiros (Política RLS)
Política implementada: `"Users can view partners profiles"`

Um usuário pode ver os dados de outro usuário (Nome, CRMV, Role) SE:
*   É o seu próprio perfil (`id = auth.uid()`).
*   OU O ID do usuário atual está na lista `partners` do perfil alvo (`partners @> ARRAY[auth.uid()::text]`).
*   Isso permite preencher dropdowns e listas sem expor a base inteira de usuários.
*   Garante visibilidade mútua: se A pode ver B, então B pode ver A.

#### 3. Gestão de Equipe
O sistema diferencia três tipos de usuários na lista de equipe:
*   **Membros Internos:** Usuários criados pelo tenant atual (`owner_id = tenant_id`).
*   **Parceiros Vinculados:** Usuários que estão no array `partners` do perfil atual.
*   **Parceiros Convidados:** Usuários com `owner_id` apontando para o tenant atual, mas que são parceiros externos.

### Funções de Segurança (SECURITY DEFINER)

Para evitar loops infinitos em políticas RLS complexas e garantir operações seguras, utilizamos funções `SECURITY DEFINER` com `search_path` protegido:

1.  **`link_partner_by_email`:** 
    *   Executa vínculo de parceiros bypassando RLS.
    *   Valida duplicidade, auto-vínculo e existência do usuário.
    *   Retorna JSON com `success` e `message` ou `name`.

2.  **`get_safe_my_level`:**
    *   Retorna o nível de acesso do usuário atual sem causar recursão em políticas RLS.
    *   Usado em políticas que precisam verificar permissões.

3.  **`delete_user_completely`:**
    *   Remove usuário e todos os dados relacionados (cascata).
    *   Limpa exames, tenants, perfis e vínculos.

### Blindagem de Funções
Todas as funções críticas possuem:
*   `SET search_path = public, auth` para prevenir injeção SQL.
*   Validação de tipos (UUID vs Text) para evitar erros de casting.
*   Tratamento de erros com mensagens claras.

---

## 4. White Label Dinâmico

O sistema adapta a interface e os documentos gerados com base no contexto do usuário logado.

### Carregamento de Configurações (`SettingsContext` e cadastros)

No **backend / dados**, o branding efetivo segue a hierarquia de tenant e `owner_id` descrita abaixo. No **cliente web**, o `SettingsContext` pode persistir preferências de interface (ex.: nome exibido, layout, logo) em `localStorage` (chave `piquet_settings`) em paralelo às fontes de verdade no Supabase, mantendo a experiência responsiva mesmo com latência ou trabalho offline limitado.

1.  **Identificação do Tenant (Branding efetivo):**
    *   Para **assinante raiz** (sem `owner_id` ou `owner_id = id`): busca configurações da tabela correspondente (`veterinarians` ou `clinics`) usando `profile_id = user.id`.
    *   Para **equipe interna / recepção** (`role = reception` ou `level = 5` com `owner_id`): **herda branding do owner** (assinante).
    *   Para **parceiro convidado** (vet/clínica com `owner_id` apontando para o assinante): **herda branding do owner**.
    *   Quando herda branding: determina a **tabela alvo** (`veterinarians` vs `clinics`) lendo o `role` do perfil do criador (owner) antes de buscar o registro de branding.

2.  **Dados Carregados:**
    *   Nome da empresa/profissional
    *   Documento (CRMV para veterinários, CNPJ para clínicas)
    *   Endereço, telefone, e-mail
    *   Logo (`logo_url`)
    *   Nome do sistema (`systemName`)

3.  **Aplicação:**
    *   **Frontend:** O `SettingsContext` carrega as configurações e disponibiliza via hook `useSettings()`.
    *   **Relatórios PDF:** O gerador de PDF recebe o objeto de `branding` em tempo real, garantindo que um laudo emitido pelo "Dr. João" saia com o logo dele, mesmo que o exame tenha sido feito na "Clínica A".
    *   **Interface:** Cabeçalho, rodapé e elementos visuais adaptam-se automaticamente.

### Limpeza de Cache
O cliente pode limpar ou migrar entradas antigas do `localStorage` (incluindo referências legadas ao nome "Piquet") para evitar branding desatualizado em relação ao banco.

---

## 5. Sistema de Permissões Modulares

O Petcare combina **nível numérico** (`level`), **papel** (`role`: `admin`, `owner`, `vet`, `clinic`, `reception`) e um objeto **`permissions`** (JSON) persistido em `profiles.permissions`, com defaults aplicados quando o campo vem vazio.

### Flags em `UserPermissions` (aplicação)

| Flag | Significado |
|------|-------------|
| `view_financials` | Ver valores monetários (resumos, tabelas, repasses) |
| `manage_prices` | Editar tabela de preços |
| `export_reports` | Gerar relatórios / PDF |
| `delete_exams` | Excluir exames |
| `manage_users` | Criar/editar usuários da equipe (quando a tela consulta `profiles`) |
| `manage_settings` | Acessar configurações gerais / administrativas |
| `bypass_report_password` | Emitir relatório sem senha de administrador |
| `bypass_delete_password` | Excluir exame sem senha de administrador |

**Laudos / edição de conteúdo clínico:** além das flags acima, o fluxo de laudo costuma restringir edição a papéis como **veterinário** ou **owner** (recepção e outros perfis ficam em modo predominantemente leitura/exportação, conforme a tela).

### Permissões padrão por nível (referência do app)

Valores típicos ao hidratar o perfil (podem ser sobrescritos pelo JSON em `profiles.permissions`):

- **Níveis 1–2 (Admin / Owner):** todas as flags relevantes habilitadas, incluindo bypass de senha e gestão de usuários/configurações.
- **Nível 3 (Veterinário):** `view_financials`, `export_reports`, `delete_exams` habilitados; `manage_prices` e `manage_settings` em geral desabilitados; `bypass_report_password` habilitado; `bypass_delete_password` e `manage_users` em geral desabilitados.
- **Nível 4 (Clínica):** perfil semelhante ao veterinário nos defaults atuais do cliente (financeiro e exportação; gestão de preços e configurações dependem de flag explícita ou evolução de produto).
- **Nível 5 (Recepção):** `export_reports` e `delete_exams` podem estar habilitados; `view_financials`, `manage_prices` e `manage_settings` em geral desabilitados; bypasses em geral desabilitados.

Subníveis adicionais no JSON (ex.: granularidade por módulo) podem ser evoluídos sem quebrar o modelo acima.

---

## 6. Contexto de Tenant (Tenant Switching)

O sistema permite que usuários com múltiplos vínculos alternem entre diferentes contextos de trabalho.

### Camada de aplicação (cliente)

No app atual, o **`RegistryContext`** mantém veterinários e clínicas (cadastro operacional), e o painel identifica o **tenant efetivo** do usuário logado comparando o e-mail da sessão aos registros de `veterinarians` / `clinics`. Vínculos **vet ↔ clínicas** usam listas como `linked_clinic_ids` para filtrar combos e exames de forma consistente. O bloco abaixo descreve a **visão completa SaaS** (multi-contexto e parceiros via `profiles.partners`) quando todas as rotas e estados estão ativos.

### Implementação (`AuthContext` — modelo completo)

1.  **Tenant Atual (`currentTenant`):**
    *   Representa o contexto de trabalho atual (Veterinário ou Clínica).
    *   Contém: `id`, `name`, `type` ('vet' | 'clinic'), `isMe` (se é a própria conta ou de um parceiro).

2.  **Tenants Disponíveis (`availableTenants`):**
    *   Lista de todos os tenants que o usuário pode acessar.
    *   Inclui o próprio tenant e parceiros vinculados.

3.  **Carregamento Automático:**
    *   Ao fazer login, o sistema busca o tenant vinculado ao perfil (`profile_id`).
    *   Se não encontrar por `profile_id`, tenta buscar por e-mail e vincula automaticamente.
    *   Define um tenant provisório baseado no perfil do usuário até carregar dados completos.

4.  **Alternância (`switchTenant`):**
    *   Permite alternar entre diferentes tenants disponíveis.
    *   Atualiza o contexto de trabalho e recarrega configurações relacionadas.

### Contexto de Parceiro (assinante Clínica)

Além do tenant principal, existe um **modo de contexto de parceiro** usado no Dashboard quando o usuário é **assinante do tipo clínica** (conta raiz) e precisa **visualizar um subconjunto de dados “em nome” de um parceiro** vinculado via `profiles.partners`.

- **Seletor de contexto (root profile)**: um UUID (perfil raiz do parceiro) define o “recorte” de visualização.
- **Fechamento transitivo de equipe do parceiro**: para localizar exames do parceiro de forma consistente, o sistema calcula o conjunto de veterinários pertencentes à árvore do parceiro (profileId = raiz, ownerId = raiz e subordinados cujo owner aponta para membros já incluídos).
- **Filtro de exames com clínica parceira convidada**: quando a clínica local (onde o exame foi realizado) é uma **clínica parceira convidada**, o filtro considera:
  - **local do exame** = a clínica logada (unidade/parceira)
  - **executor** = veterinários pertencentes ao tenant/árvore do assinante/parceiro selecionado
  - Isso evita o erro clássico de filtrar por `clinic_id = clinic do assinante` quando os exames estão registrados na **unidade parceira**.

---

## 7. Detalhes Técnicos de Implementação

### Estrutura de Dados

#### Tabela `profiles`
```sql
- id: uuid (PK, FK para auth.users)
- email: text
- name: text
- role: text ('admin' | 'owner' | 'vet' | 'clinic' | 'reception')
- level: integer (1-5)
- owner_id: uuid (nullable, FK para profiles.id)
- permissions: jsonb
- partners: text[] (array de UUIDs como texto)
```

#### Tabelas de Tenant
- `veterinarians`: `id`, `profile_id`, `name`, `crmv`, `email`, `logo_url`, `linked_clinic_ids[]`
- `clinics`: `id`, `profile_id`, `name`, `document`, `email`, `logo_url`, `responsible_name`

### Funções RPC Principais

1.  **`link_partner_by_email(target_email, requester_id, requester_type)`**
    - Retorna: `{success: boolean, message?: string, name?: string}`
    - Validações: existência, auto-vínculo, duplicidade
    - Executa vínculo mútuo nos arrays `partners`

2.  **`delete_user_completely(target_user_id)`**
    - Remove usuário e todos os dados relacionados em cascata
    - Limpa exames, tenants, perfis e vínculos

3.  **`update_my_email_bypass(new_email)`**
    - Atualiza e-mail do usuário atual bypassando validações de RLS

### Migrações Recentes

As migrações mais recentes (Fevereiro 2025 → Abril 2026) focaram em:
- Garantir existência da coluna `partners` com valor padrão `'{}'`
- Corrigir políticas RLS de visibilidade de parceiros
- Implementar validações de duplicidade no vínculo
- Blindar funções críticas com `search_path` protegido
- Corrigir conflitos de tipagem (UUID vs Text)
- Adicionar campos adicionais aos exames (species, requester_vet, requester_crmv)
- Implementar índice de performance para consultas frequentes
- Refinar **filtros de exames de parceiros** (incluindo cenários com clínica parceira convidada e fechamento transitivo de equipe)
- Ajustar **exibição de valores** no resumo operacional e relatórios conforme permissões (`view_financials` e subníveis)
- Padronizar o **filtro da tabela de preços** por escopo (vet|id / clinic|id), evitando incluir regras genéricas (“todos”) quando o usuário filtra um parceiro específico

---

## 8. Sistema de Exames e Laudos

### Estrutura de Exames

Um registro de exame agrega:

- **Dados do Paciente:** Nome; espécie quando aplicável (Cachorro, Gato, Outros) nos fluxos que preenchem laudo.
- **Dados do Requisitante:** Veterinário solicitante (nome e CRMV) quando o laudo exige esse cabeçalho.
- **Vínculos:** Veterinário responsável (executor), Clínica (local), Dono da máquina (`professional` | `clinic`) para cálculo de repasses.
- **Itens do exame:** Um ou mais itens (`ExamItem`) com modalidade, quantidade de estudos, descrição; em **RX**, estudos detalhados (`rx_studies`: tipos como Abdômen, Crânio, etc., laudo/imagem por estudo).
- **Modalidade (por item ou principal):** `USG`, `RX`, `RX_CONTROLE`, `USG_FAST`, ou texto livre para modalidades personalizadas.
- **Período:** `comercial`, `noturno`, `fds`, `feriado`.
- **Valores Financeiros:** Total, Repasse Profissional, Repasse Clínica.
- **Conteúdo:** Laudo (HTML rico), imagens anexadas, status (`pending`, `completed`, `partial`).
- **Lista no painel:** não há coluna “situação” com três estados nomeados em português; quando o laudo está concluído, a linha exibe o selo **OK** (e o botão de laudo passa a “editar”). Outros valores de `status` não aparecem como rótulos fixos na grade.

### Editor de Laudos

- **Editor WYSIWYG:** Formatação rica de texto, tabelas, listas
- **Upload de Imagens:** Múltiplas imagens por exame
- **Layout de PDF:** Grade otimizada (8 imagens por página)
- **White Label:** Cabeçalho e rodapé do PDF usam automaticamente o branding do veterinário responsável

### Cálculo de Repasses

O sistema calcula automaticamente os repasses baseado em:
- **Dono da Máquina:** Se é do profissional ou da clínica
- **Tabela de Preços:** Valores configurados por modalidade e período
- **Taxas Extras:** Configuráveis por regra (valor único ou repartição `taxaExtraProfessional` / `taxaExtraClinic`)
- **Split:** Divisão automática entre profissional e clínica

---

## 9. Tabela de Preços Dinâmica

### Características

- **Regras por Clínica:** Cada clínica pode ter sua própria tabela de preços
- **Regras por Parceiro:** Veterinários podem definir preços diferentes para cada clínica parceira
- **Modalidades Personalizadas:** Suporte para exames customizados (ex: Ecocardiograma)
- **Taxas Extras:** Configuração de taxas de uso de equipamento ou deslocamento; podem ser decompostas em parte profissional e parte clínica (`taxaExtraProfessional`, `taxaExtraClinic`) além de valor único (`taxaExtra`).
- **Períodos:** Diferentes valores para comercial, noturno, fim de semana e feriado; rótulos de exibição (`label`, `periodLabel`) por regra quando necessário.
- **Cópia em massa:** ferramenta de **cópia de tabela de preços** entre parceiros (RF03 em `features.md`) para alinhar precificação sem redigitar regras.

### Estrutura de PriceRule

```typescript
{
  id: string
  clinicId: string  // Vincula a regra a uma clínica específica
  modality: Modality
  period: Period | 'all'
  label: string
  periodLabel: string
  valor: number
  repasseProfessional: number
  repasseClinic: number
  taxaExtra?: number
  taxaExtraProfessional?: number
  taxaExtraClinic?: number
  observacoes: string
}
```

---

## 10. Painel Super Admin (gestão de assinantes SaaS)

Área destinada ao **Super Admin** para operar a base multi-tenant (RF04 em `features.md`):

- **CRUD de assinantes:** criação, edição, suspensão e exclusão de clínicas e veterinários.
- **Visualização hierárquica (tree view):** listagem expansível (estilo diretório) com detalhes operacionais por assinante sem poluir a visão inicial.
- **Auditoria de parceiros:** ao expandir um assinante, listagem dos parceiros vinculados (clínicas ou veterinários).
- **Detalhamento de serviços:** serviços configurados por parceiro (modalidade, período, preço final), com mensagens de estado vazio quando não houver vínculos.
- **Performance:** **lazy loading** — detalhes de parceiros e tabelas de preços são carregados sob demanda, no momento da expansão da linha, reduzindo consultas na carga inicial da página.
- **Manutenção:** ferramenta de limpeza manual / exclusão definitiva de contas para cenários administrativos controlados.

---

## 11. Considerações de Segurança e Performance

### Segurança

- **RLS em todas as tabelas:** Garantia de isolamento de dados no nível do banco
- **Funções blindadas:** Todas as operações críticas usam `SECURITY DEFINER` com `search_path` protegido
- **Validação de tipos:** Prevenção de erros de casting (UUID vs Text)
- **Prevenção de duplicidade:** Validações no vínculo de parceiros e criação de usuários
- **Ações destrutivas:** exclusão de exames, geração de relatórios sensíveis e fluxos equivalentes podem exigir confirmação e, quando configurado, senha de administrador (`bypass_*` para perfis autorizados)

### Performance

- **Índices:** Criados em colunas frequentemente consultadas (email, profile_id, owner_id)
- **Queries otimizadas:** Uso de `maybeSingle()` para evitar carregamento desnecessário
- **Cache inteligente:** Limpeza automática de cache antigo no localStorage
- **Lazy loading:** Carregamento sob demanda de dados de tenant, configurações e **detalhes no painel Super Admin** (expansão de linha).
- **Paginação:** listagem de exames pode usar paginação no frontend para limitar memória e tempo de renderização (ver RNF em `features.md`).

---

## 12. Fluxo de Autenticação e Sessão

### Inicialização

1. **Verificação de Sessão:** o cliente verifica sessão ativa no Supabase Auth (`getSession` / `onAuthStateChange`).
2. **Hidratação do perfil:** com sessão válida, carrega a linha em `profiles` e monta o objeto de usuário (nível, papel, `permissions`).
3. **Contexto operacional:** telas que dependem de clínica/veterinário combinam perfil com **`RegistryContext`** (e, na arquitetura completa, tenant vinculado e parceiros).
4. **Listas administrativas:** usuários com `manage_users` podem carregar `profiles` para gestão de equipe.

### Gerenciamento de Estado

- **AuthContext:** autenticação, perfil atual e, quando aplicável, lista de usuários para administração.
- **SettingsContext:** preferências de branding e layout (com persistência local quando usado).
- **RegistryContext:** cadastros de veterinários e clínicas utilizados no fluxo de exames e vínculos.
- **Sincronização:** hooks React; atualizações podem refletir mudanças de sessão em tempo real.

### Tratamento de Erros

- **Conectividade:** falhas de rede podem limitar operações até nova tentativa ou refresh.
- **Refresh Token:** renovação automática de sessão pelo cliente Supabase, quando configurado.
- **Mensagens:** erros de API e validação expostos de forma legível (toasts, modais), alinhado aos RNFs de usabilidade em `features.md`.
