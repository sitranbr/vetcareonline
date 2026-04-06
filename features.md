# ETAPA 1 — ENTENDA O PROBLEMA E ESTABELEÇA OS REQUISITOS

O **Petcare** é uma plataforma SaaS para gestão de clínicas veterinárias e radiologistas volantes: cadastro de exames, laudos com PDF, tabela de preços por parceiro, controle financeiro com repasses e rede de parceiros com multi-tenant. Abaixo, requisitos funcionais e não funcionais alinhados ao estado atual do projeto.

---

## 1. REQUISITOS FUNCIONAIS

1. **Cadastro e gestão de exames:** Os usuários autorizados devem registrar exames com data, paciente, espécie (cachorro, gato, outros), tutor, modalidade (USG, RX, USG FAST, RX Controle, RX FAST, outros personalizados), período e vínculo a veterinário executor e clínica local.

2. **Múltiplos itens e estudos por atendimento:** O sistema deve permitir vários itens de exame em uma única operação e, para RX, número de estudos com impacto no cálculo; cada estudo RX pode ter sub-itens (tipo, descrição) com laudo e imagens por estudo.

3. **Requisitante externo e dono da máquina:** Deve ser possível informar veterinário requisitante e CRMV para o laudo; o cálculo financeiro deve considerar se o equipamento é do profissional volante ou da clínica (**machine owner**).

4. **Prévia financeira:** Antes de gravar, o usuário deve visualizar total, repasse ao profissional e repasse à clínica em tempo real.

5. **Editor de laudos e imagens:** Editor rico (formatação, listas, tabelas), upload de múltiplas imagens e laudos distintos por estudo RX quando aplicável.

6. **Geração de PDF de exame/laudo:** Geração de PDF com layout otimizado (ex.: grade de imagens), cabeçalho/rodapé com **white label** (logo e dados da clínica ou veterinário conforme contexto) e identificação do responsável no documento.

7. **Tabela de preços dinâmica:** Regras por clínica parceira, modalidade e período; taxas extras (equipamento/deslocamento); modalidades “Outros” com nome customizado; filtro por clínica; cópia de tabela entre clínicas parceiras.

8. **Painel financeiro e relatórios:** Resumo (faturamento, a receber, a pagar), split de repasses, relatórios exportáveis em PDF com filtros por data, visão por “máquina” (profissional vs. clínica) e gráficos/estatísticas (ex.: por modalidade).

9. **Perfis e permissões granulares:** Papéis (ex.: super admin, assinante, equipe) e permissões modulares por laudos, financeiro, preços, relatórios, exclusão de exames, equipe e configurações — com níveis principais e subníveis (conforme `UserPermissions` no código).

10. **Rede de parceiros:** Vincular/desvincular clínica e veterinário por e-mail, sem duplicidade de login desnecessária; contas convidadas (`owner_id`); clínicas convidadas pelo veterinário; parceiro enxerga apenas exames a ele vinculados quando em visão de parceiro.

11. **Seletor de contexto (tenant):** Usuários com múltiplos vínculos devem alternar o contexto operacional (ex.: “meu sistema” vs. clínica parceira), com dados e preços coerentes com o tenant selecionado.

12. **Cadastro de entidades e branding:** Gestão de veterinários e clínicas (incl. nome do responsável da clínica, logos, contatos); assinatura eletrônica opcional no perfil (`signature_url`).

13. **Administração da plataforma:** Super admin com painel de assinantes (criar, editar, bloquear) e ferramentas de manutenção (ex.: remoção de usuário/dados órfãos por e-mail).

14. **Fluxos de exclusão e segurança operacional:** Onde aplicável, exclusão de exames com confirmações/senhas conforme permissões (`bypass_delete_password`, etc.) e regras de visibilidade para parceiros (sem valores ou ações não autorizadas).

---

## 2. REQUISITOS NÃO FUNCIONAIS

1. **Isolamento multi-tenant:** Dados de cada assinante e contexto devem ser isolados no backend; uso de **RLS (Row Level Security)** no Supabase para garantir que consultas e mutações respeitem o tenant.

2. **Segurança de operações críticas:** Funções SQL sensíveis devem seguir boas práticas (**`SECURITY DEFINER`**, `search_path` fixo) para evitar escalonamento de privilégio e vazamento entre schemas.

3. **Autenticação e bloqueio:** Integração com **Supabase Auth**; suporte a suspensão de acesso pelo super admin (`access_blocked` no perfil), impedindo uso da conta quando aplicável.

4. **Disponibilidade e deploy:** Aplicação preparada para deploy estático (ex.: **Netlify**) com variáveis de ambiente para URL e chave anônima do Supabase (`VITE_SUPABASE_*`).

5. **Qualidade de PDF e tipografia:** Geração de PDF deve priorizar legibilidade — uso de fonte corporativa quando disponível (ex.: **Inter** embutida via `public/fonts`, com fallback para Helvetica) e tratamento de falha de carregamento de logo/fonte sem quebrar o fluxo.

6. **Resiliência da interface:** Em falhas de carregamento de perfil ou sessão, o sistema deve oferecer caminhos de recuperação (ex.: retry, sair e relogar após timeout de loading).

7. **Consistência de marca:** Cabeçalhos de sistema e documentos devem refletir a identidade do tenant (nome Petcare como fallback de marca, dados reais do cliente quando configurados).

8. **Separação de leitura e regras de negócio:** O desenho deve permitir evolução da taxa de leitura vs. escrita típica de SaaS (dashboards e listagens otimizadas no cliente; persistência e políticas no Postgres/Supabase).

9. **Auditoria e prevenção de erros:** Validações e travas contra exclusões acidentais ou vínculos duplicados, alinhadas às políticas de banco e funções dedicadas.

10. **Experiência multi-contexto:** Alternância de tenant não deve misturar listas financeiras, preços ou exames de contextos diferentes sem troca explícita de contexto.

---

## Referência — Tabelas do sistema

| Tabela | Descrição |
|--------|-----------|
| **profiles** | Perfis de usuário vinculados ao Auth. Campos: id, email, name, role, level, permissions, owner_id, partners, signature_url, access_blocked, created_at, updated_at. |
| **veterinarians** | Cadastro de veterinários. Campos: id, name, crmv, document, address, phone, email, logo_url, is_default, linked_clinic_ids, profile_id, created_at. |
| **clinics** | Cadastro de clínicas. Campos: id, name, document, address, phone, email, logo_url, is_default, profile_id, responsible_name, created_at. |
| **price_rules** | Regras de preço por clínica/modalidade/período. Campos: id, clinic_id, modality, period, label, period_label, valor, repasse_professional, repasse_clinic, taxa_extra, taxa_extra_professional, taxa_extra_clinic, observacoes, created_at. |
| **exams** | Exames realizados. Campos: id, date, pet_name, modality, period, studies, study_description, rx_studies, veterinarian_id, clinic_id, machine_owner, total_value, repasse_professional, repasse_clinic, status, report_content, report_images, requester_vet, requester_crmv, species, created_at. |

**Tabelas Supabase (padrão):** `auth.users`; `storage.buckets` (logos, imagens de laudos).

---

## Referência — Esclarecimento das vinculações

| Conceito | O que é | Como funciona |
|----------|---------|---------------|
| **Vínculo profissional (no exame)** | Relação entre veterinário executor e clínica local em cada exame | Todo exame registra `veterinarian_id` e `clinic_id`. Vet e clínica precisam estar vinculados como parceiros para aparecer no formulário. |
| **Parceiro (`linked_clinic_ids`)** | Clínicas onde o veterinário está autorizado a atender | Armazenada no vet; relação bidirecional iniciada por convite por e-mail. |
| **Quem convida** | Clínica ou veterinário | Fluxo “Vincular parceiro” com busca por e-mail e validação. |
| **Acesso convidado** | Conta sem assinatura própria | `owner_id` apontando para o assinante; permissões restritas. |
| **Clínicas convidadas** | Clínica cadastrada pelo vet para expandir a rede | Vet pode lançar exames nessa clínica. |
| **Seletor de contexto** | Alternar “meu sistema” e parceiros | Lista de clínicas; ao escolher, opera no contexto dela. |

**O vinculado precisa ser assinante?** Não é obrigatório: basta existir em `profiles` e ter entidade em `veterinarians` ou `clinics`. Pode ser convidado. Se o e-mail não existir em `profiles`, o fluxo pode permitir cadastro manual e “Criar acesso” depois.
