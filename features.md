# Documentação de Funcionalidades (Features) - Petcare

Este documento resume os **requisitos funcionais (RF)** e **não funcionais (RNF)** do produto. A arquitetura SaaS, multi-tenant, RLS e detalhes técnicos estão em [`sass.md`](./sass.md).

**Última atualização:** Abril 2026

---

## Requisitos Funcionais (RF)

### RF01 - Gestão de Exames e Laudos

- **CRUD de exames:** cadastro, edição e exclusão, com confirmação e fluxos de senha administrativa quando configurado (alinhado a permissões e bypasses em `sass.md`).
- **Estrutura do exame:** um ou mais itens por atendimento (modalidade, estudos, descrição); em **RX**, estudos categorizados (ex.: Abdômen, Crânio, Tórax) com laudo/imagem por estudo quando aplicável.
- **Modalidades:** `USG`, `RX`, `RX_CONTROLE`, `USG_FAST` e **modalidades personalizadas** (texto livre).
- **Períodos de precificação:** comercial, noturno, fim de semana (`fds`), feriado.
- **Contexto operacional:** vínculo a **veterinário responsável**, **clínica (local)** e **dono do equipamento** (profissional ou clínica) para cálculo de repasses.
- **Laudos:** editor com formatação rica (Rich Text), anexos de imagens e geração de **PDF** com cabeçalho/rodapé conforme **branding** do contexto (White Label).
- **Painel operacional (Dashboard):** abas principais — **Lista de exames** (filtros), **Novo exame**, **Relatórios** (intervalo de datas, filtros, visão agregada e **gráficos**), **Tabela de preços** — conforme permissões do usuário.
- **Status:** no modelo de dados, `exams.status` pode ser `pending`, `completed` ou `partial` (opcional). Na **lista do painel**, não há coluna “situação” com três rótulos; há **selo OK** quando o laudo está concluído (`completed`) e o botão de laudo reflete criar/editar.

### RF02 - Gestão de Equipe, Usuários e Parceiros

O sistema diferencia **membros internos** e **parceiros externos**; a persistência e as políticas de compartilhamento seguem o modelo descrito em `sass.md` (`profiles`, `owner_id`, `partners`, RPCs).

- **Membros internos (contas dependentes):** funcionários criados no painel do assinante; operam sob o tenant do assinante (`owner_id`), sem autonomia de tenant próprio.
- **Parceiros externos (contas independentes):** veterinários ou clínicas com assinatura própria; vínculo por e-mail e arrays de parceiros; desvincular **não** apaga histórico de exames compartilhado.
- **Gestão de usuários:** tela de administração de perfis (níveis, papéis `admin` | `owner` | `vet` | `clinic` | `reception`, objeto de permissões) para perfis autorizados.
- **Camada de cadastro no app:** registro de **veterinários** e **clínicas** com vínculos operacionais (ex.: clínicas vinculadas ao vet via `linked_clinic_ids`) para combos e regras de negócio no formulário de exame.

### RF03 - Gestão Financeira e Tabela de Preços

- **Precificação dinâmica** por modalidade, período, clínica (e escopo do parceiro quando filtrado).
- **Regras de preço** com rótulos de exibição (`label`, `periodLabel`), valor base e **repasses** (profissional / clínica).
- **Taxas extras:** valor único e/ou repartição entre profissional e clínica, conforme regra.
- **Cálculo automático** de totais e repasses a partir da tabela e do dono da máquina.
- **Cópia de tabela de preços** entre parceiros para configuração em massa.

### RF04 - Gestão de Assinantes (Painel SaaS - Super Admin)

- **CRUD** de assinantes (clínicas e veterinários), suspensão e exclusão conforme política.
- **Visualização hierárquica (tree view):** linhas expansíveis com detalhes operacionais por assinante.
- **Auditoria de parceiros:** ao expandir, lista de parceiros vinculados (clínicas ou veterinários).
- **Detalhamento de serviços:** por parceiro — modalidade, período, preço final configurado.
- **Estados vazios:** mensagens explícitas (ex.: nenhum parceiro vinculado).
- **Manutenção:** ferramenta de limpeza / exclusão definitiva de contas para cenários administrativos controlados.

### RF05 - Autenticação, Configurações e Identidade Visual

- **Autenticação:** login com Supabase Auth; recuperação de senha; sessão e hidratação do perfil a partir de `profiles`.
- **Configurações:** página dedicada com abas (geral, cadastros, dados do assinante, vínculos etc., conforme nível), incluindo **layout** (barra superior vs sidebar), logos e dados de contato.
- **Persistência de preferências de UI:** uso de armazenamento local para branding/layout quando aplicável, em conjunto com dados de negócio no backend (ver `sass.md`).

---

## Requisitos Não Funcionais (RNF)

### RNF01 - Segurança e Isolamento de Dados (Tenant Isolation)

- **Row Level Security (RLS)** no Supabase para que cada assinante acesse apenas o próprio dado e o compartilhado explicitamente (parceria, equipe, políticas de exame).
- **Permissões** em JSON no perfil, com flags de bypass para relatório e exclusão quando autorizado (detalhes em `sass.md`).
- **Proteção contra ações destrutivas:** confirmações e, quando aplicável, senha de administrador.

### RNF02 - Performance e Otimização

- **Lazy loading** no painel de Gestão SaaS: detalhes de parceiros e tabelas de preços carregados **ao expandir** a linha do assinante, evitando carga inicial excessiva.
- **Paginação** (ou equivalente) na listagem de exames para reduzir memória e tempo de renderização no cliente.
- **Consultas** conscientes do custo: carregamento sob demanda alinhado às telas administrativas expansíveis.

### RNF03 - Usabilidade (UX/UI)

- Interface **responsiva**, tipografia e espaçamento consistentes (**Tailwind CSS**).
- Ícones e feedback visual (**Lucide**, toasts, modais, spinners, indicadores ▶/▼ em listas expansíveis).
- **Ocultação contextual** de opções não aplicáveis (ex.: permissões administrativas em formulários de parceiro externo).
- **Relatórios:** visualizações gráficas (**ECharts**) para análise de período no Dashboard.

### RNF04 - Stack e Manutenibilidade

- Cliente web: **React**, **TypeScript**, **Vite**, roteamento com **React Router**, cliente **Supabase** para auth e dados.
- Relatórios PDF: **jsPDF** / fluxos de geração integrados ao app.
- Código organizado em **contextos** (autenticação, configurações, cadastros) e páginas por domínio (Dashboard, usuários, configurações).
