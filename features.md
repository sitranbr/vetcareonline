# Documentação de Funcionalidades e Requisitos - Petcare

Este documento detalha os requisitos funcionais (RF) e não funcionais (RNF) do sistema Petcare, bem como as regras de negócio essenciais para o seu funcionamento.

---

## 1. Requisitos Funcionais (RF)

### RF01 - Autenticação e Gestão de Sessão
- O sistema deve permitir o login de usuários via e-mail e senha.
- O sistema deve suportar recuperação de senha via link enviado ao e-mail.
- O sistema deve diferenciar níveis de acesso (Super Admin, Clínica, Veterinário, Recepção/Equipe).

### RF02 - Gestão de Equipe e Parceiros (Regra de Negócio Crítica)
O sistema deve permitir que assinantes gerenciem quem tem acesso ao seu ambiente. Existe uma separação estrita entre membros da equipe e parceiros de negócio:

#### Diferenciação: Membros Internos vs. Parceiros Externos
* **Membros Internos (Contas Dependentes):**
  - **Criação:** Criados diretamente no painel do assinante (em "Minha Equipe" > "Adicionar Membro" > "Equipe Interna").
  - **Comportamento:** Ficam amarrados ao assinante através da propriedade `owner_id`.
  - **Casos de Uso:** Recepcionistas, auxiliares, administradores locais da clínica.
  - **Limitação:** Não podem ser compartilhados com outras clínicas. Se o assinante principal for suspenso ou excluído, os membros internos perdem o acesso automaticamente.

* **Parceiros Externos (Contas Independentes):**
  - **Criação:** Devem ser criados como **Assinantes Independentes** pelo Super Admin (no painel SaaS) ou através de um convite de parceria para um e-mail não cadastrado.
  - **Comportamento:** Possuem sua própria conta raiz (sem `owner_id` restritivo). O vínculo com outras clínicas é feito através da lista de `partners` (parcerias bidirecionais).
  - **Casos de Uso:** Veterinários volantes que prestam serviço para múltiplas clínicas simultaneamente, ou Clínicas que terceirizam exames para múltiplos veterinários.
  - **Vantagem:** Aparecem no formulário de exames e na tabela de preços de **todas** as clínicas às quais estão vinculados, mantendo total independência de acesso e dados.

### RF03 - Gestão de Exames e Laudos
- O sistema deve permitir o cadastro de exames (USG, RX, etc.) vinculando Paciente, Clínica e Veterinário Executor.
- O sistema deve permitir a emissão, edição e aprovação de laudos médicos com suporte a formatação rica (Rich Text) e anexos de imagens.
- O sistema deve permitir a geração de PDFs dos laudos com a assinatura eletrônica do veterinário responsável.

### RF04 - Gestão Financeira e Repasses
- O sistema deve calcular automaticamente o valor total do exame, o repasse do profissional e o repasse da clínica com base na Tabela de Preços.
- O sistema deve considerar quem é o proprietário da máquina (Clínica ou Profissional) para o cálculo de retenção.
- O sistema deve apresentar um dashboard com o resumo financeiro (Faturamento, A Pagar, Receita Líquida).

### RF05 - Tabela de Preços e Regras de Cobrança
- O sistema deve permitir o cadastro de regras de preços baseadas em: Modalidade, Período (Comercial, Feriado, Noturno, etc.), Clínica e Veterinário.
- O sistema deve permitir a cópia de tabelas de preços entre parceiros para facilitar a configuração.
- O sistema deve suportar a adição de taxas extras (ex: deslocamento, uso de equipamento).

### RF06 - Relatórios e Exportação
- O sistema deve permitir a filtragem de exames por período, paciente, clínica ou veterinário.
- O sistema deve exportar relatórios financeiros em formato PDF agrupados por veterinário ou clínica.

### RF07 - Configurações da Empresa (White Label)
- O sistema deve permitir que clínicas e veterinários personalizem sua logomarca, nome fantasia, endereço e contatos.
- Os laudos e recibos gerados devem refletir a identidade visual (White Label) do contexto atual (Clínica ou Veterinário independente).

---

## 2. Requisitos Não Funcionais (RNF)

### RNF01 - Segurança e Controle de Acesso
- **Isolamento de Dados (Multi-tenant):** O banco de dados deve utilizar Row Level Security (RLS) do PostgreSQL/Supabase para garantir que um assinante (e sua equipe) acesse apenas os dados (exames, preços, perfis) pertencentes ao seu próprio tenant ou aos seus parceiros explicitamente vinculados.
- **Proteção de Rotas:** Rotas do frontend devem ser protegidas pelo React Router, redirecionando usuários não autenticados para a tela de login.
- **Senhas:** As senhas não devem ser trafegadas em texto plano e devem ser gerenciadas de forma segura pelo Supabase Auth.

### RNF02 - Desempenho e Escalabilidade
- O sistema deve carregar a listagem inicial de exames de forma paginada para evitar sobrecarga no frontend e no banco de dados.
- O tempo de resposta para operações de CRUD (Create, Read, Update, Delete) não deve exceder 2 segundos em condições normais de rede.
- Imagens anexadas aos laudos devem ser armazenadas de forma otimizada em buckets (Supabase Storage).

### RNF03 - Usabilidade e Responsividade
- A interface de usuário (UI) deve ser responsiva, adaptando-se a dispositivos móveis (smartphones), tablets e desktops.
- O sistema deve fornecer feedback visual imediato (toasts, modais, spinners) para ações do usuário (salvamento, exclusão, erros de rede).
- A navegação deve ser intuitiva, com menus que se adaptam dinamicamente às permissões do usuário logado.

### RNF04 - Disponibilidade e Confiabilidade
- O sistema deve estar hospedado em infraestrutura de alta disponibilidade (ex: Netlify para o frontend, Supabase para o backend).
- O sistema deve tratar falhas de rede graciosamente, exibindo mensagens de erro amigáveis e opções de "Tentar Novamente".

### RNF05 - Manutenibilidade e Arquitetura
- O código frontend deve ser desenvolvido utilizando React com TypeScript para garantir tipagem estática e redução de bugs.
- A estilização deve ser feita utilizando Tailwind CSS para manter a consistência e facilitar a manutenção.
- O estado global da aplicação deve ser gerenciado através de Context API (AuthContext, RegistryContext, SettingsContext) de forma modular.
