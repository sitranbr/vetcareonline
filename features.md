# Documentação de Funcionalidades (Features) - Petcare

## Requisitos Funcionais (RF)

### RF01 - Gestão de Exames e Laudos
- Cadastro, edição e exclusão de exames.
- Emissão de laudos médicos com suporte a formatação rica (Rich Text) e anexos de imagens.
- Geração de relatórios e laudos em PDF com cabeçalho personalizado (White Label).

### RF02 - Gestão de Equipe e Parceiros (Arquitetura de Vínculos)
O sistema diferencia estritamente dois tipos de membros:
- **Membros Internos (Contas Dependentes):** Funcionários (ex: recepcionistas, administradores locais) criados dentro do painel do assinante. Eles operam sob o "guarda-chuva" (Tenant) do assinante e não possuem tabelas de preços próprias ou autonomia de tenant.
- **Parceiros Externos (Contas Independentes):** Veterinários ou Clínicas que possuem sua própria assinatura/conta no sistema. O vínculo é feito via e-mail. Eles mantêm autonomia sobre seus dados, mas podem compartilhar tabelas de preços e realizar exames em conjunto. A desvinculação não apaga o histórico de exames.

### RF03 - Gestão Financeira e Tabela de Preços
- Precificação dinâmica baseada em Modalidade, Período, Clínica e Veterinário.
- Cálculo automático de repasses (Profissional vs Clínica) e taxas extras de equipamento.
- Ferramenta de **Cópia de Tabela de Preços** entre parceiros para facilitar a configuração em massa.

### RF04 - Gestão de Assinantes (Painel SaaS - Super Admin)
- Criação, edição, suspensão e exclusão de assinantes (Clínicas e Veterinários).
- **Visualização Hierárquica (Tree View):** Estrutura expansível (estilo diretório) que permite visualizar os detalhes operacionais de cada assinante diretamente na listagem.
- **Auditoria de Parceiros:** Ao expandir um assinante, o sistema lista todos os seus parceiros vinculados (clínicas ou veterinários).
- **Detalhamento de Serviços:** Exibição dos serviços oferecidos por cada parceiro, incluindo modalidade, período e preço final configurado.
- Exibição de mensagens de estado vazio (ex: "Nenhum parceiro vinculado") quando o assinante não possui conexões.
- Ferramenta de limpeza manual de banco de dados para exclusão definitiva de contas.

---

## Requisitos Não Funcionais (RNF)

### RNF01 - Segurança e Isolamento de Dados (Tenant Isolation)
- Implementação de Row Level Security (RLS) no Supabase para garantir que assinantes só acessem seus próprios dados e os dados compartilhados explicitamente via vínculos de parceria.
- Proteção contra exclusão acidental (exigência de senha de administrador para ações destrutivas).

### RNF02 - Performance e Otimização
- **Lazy Loading (Carregamento sob demanda):** No painel de Gestão SaaS, os detalhes dos parceiros e tabelas de preços só são carregados do banco de dados no momento em que o Super Admin expande a linha do assinante. Isso evita múltiplas queries desnecessárias e previne a sobrecarga inicial da página.
- Paginação na listagem de exames para otimizar a renderização e o consumo de memória no frontend.

### RNF03 - Usabilidade (UX/UI)
- Interface responsiva e limpa, utilizando Tailwind CSS.
- Feedbacks visuais claros (toasts, modais de confirmação, spinners de carregamento, ícones de expansão ▶/▼).
- Ocultação inteligente de opções não aplicáveis (ex: esconder permissões administrativas para parceiros externos no formulário de equipe para evitar erros de configuração).
