# PIVETA PINTURAS INDUSTRIAIS
## Sistema Web de Ordem de Serviço & Controle de Estoque de Tintas

Sistema web para gestão operacional de pintura eletrostática a pó, controle de ordem de serviço, parâmetros de cura de estufa, inspeção de limpeza/pré-tratamento da superfície e controle rigoroso de estoque físico de tintas em quilogramas (KG).

---

### 🚀 Como Usar

- **Acesse:** https://ordem-servico-sigma.vercel.app/ e entre com seu usuário e senha (computador ou celular).
- **Todos veem os mesmos dados.** Tudo é gravado no banco de dados **Neon (Postgres)** da Vercel. Quando alguém lança uma OS, mexe no estoque ou cadastra um cliente, os outros aparelhos recebem a atualização sozinhos em poucos segundos (sem precisar recarregar).
- No topo aparece o selo **● Sincronizado** (verde), **● Salvando…** (amarelo) ou **● Sem conexão** (vermelho — o sistema guarda a alteração e envia assim que a internet voltar; não feche a página nesse caso).
- Se duas pessoas alterarem **o mesmo registro ao mesmo tempo**, a segunda gravação é recusada com um aviso e a tela é atualizada — nada é sobrescrito sem querer.
- **Primeiro acesso do sistema:** quando o banco está vazio, aparece a tela *Primeiro acesso* para criar o Administrador principal.
- ⚠️ O sistema **não abre mais com duplo clique em `index.html`**: ele precisa do servidor (Vercel) e do banco.

---

### 🆕 Novidades da versão 2.1

- **Painel de Produção em colunas** (Aguardando / Em produção / Concluídas), com temperatura e tempo de cura em destaque em cada OS e barras de estoque ao lado (as tintas mais perto do mínimo aparecem primeiro).
- **Ficha da OS** (toque no cartão): no celular ocupa a tela toda, com caixas grandes de limpeza, pesagem e o saldo que vai sobrar da tinta. Botões *Salvar e iniciar* / *Salvar e concluir*.
- **Menos botões por OS**: a ação principal da etapa, *Balança* e o menu **⋯** (ficha, PDF, editar, excluir).
- **Segurança**: o servidor confere o tipo de cada campo, só aceita baixa de tinta do operador quando ela bate com o consumo lançado na OS, não deixa repetir número de OS (OS nova com número já usado recebe o próximo livre) e aumenta a espera a cada senha errada.
- **Nada se perde sem aviso**: se o servidor recusar uma gravação (alguém mexeu no mesmo registro), o Painel mostra a lista do que não foi salvo para lançar de novo.
- Tirar ou trocar a tinta de uma OS devolve o consumo ao estoque; CSV exportado protegido para o Excel.

---

### 🗄️ Configurar o Banco de Dados Neon na Vercel (uma única vez)

1. Envie para o GitHub **todos** os arquivos desta pasta, inclusive as pastas `api/` e `lib/` e o arquivo `package.json` (use o `PUBLICAR_GITHUB.bat` ou o upload pelo site do GitHub).
2. Na Vercel, abra o projeto → aba **Storage** → **Create Database** → escolha **Neon (Postgres)** → crie (plano Free serve) → **Connect Project** e marque o projeto do sistema de OS.
   A Vercel cria sozinha a variável `DATABASE_URL` (e `POSTGRES_URL`).
3. Vá em **Deployments** → no último deploy, **⋯ → Redeploy** (necessário para o projeto enxergar a variável nova).
4. Abra o site: aparece **Primeiro acesso**. Crie o Administrador. As tabelas são criadas automaticamente.
5. *(Opcional, recomendado)* Em **Settings → Environment Variables** crie `SESSION_SECRET` com um texto longo e aleatório (assim as sessões não dependem da URL do banco). Se trocar esse valor, todos precisam entrar de novo.

**Trazer os dados que já estavam no navegador:** em *Usuários & Sistema* (como ADM) aparece o aviso **"Dados antigos encontrados neste aparelho"** no aparelho onde os dados foram lançados — clique em *Enviar dados deste aparelho para o banco*. Ou use **Restaurar Backup** com um JSON exportado antes. (Atenção: restaurar **substitui** os dados atuais; usuários não são alterados.)

**Custo/consumo:** o plano Free do Neon basta para uso de escritório. Para economizar, a tela só consulta atualizações enquanto está aberta, visível e em uso (pausa após ~3 min sem toque/teclado).

---

### 📋 Atendimento Completo aos Requisitos Solicitados

| Nº | Requisito Solicitado | Onde Encontrar & Como Funciona |
|---|---|---|
| **1** | **Gera Ordem de Serviço Simples e Objetiva** | Botão dourado **"+ Nova Ordem de Serviço"** no topo. Numeração automática sequencial (ex: `OS-2026-001`, `OS-2026-002`), campos limpos e objetivos. |
| **2** | **Menu de Ferramentas & Painel Inicial Visível com as OS** | Menu lateral esquerdo completo (Painel Inicial, Ordens de Serviço, Estoque de Tintas, Clientes, Relatório Real, Configurações). O Painel Inicial exibe cards de métricas (KPIs) e a lista imediata das OS em andamento com ações rápidas. |
| **3** | **Cadastro de Clientes** | Módulo de Clientes com Razão Social, CNPJ/CPF, Contato, Telefone, E-mail e Cidade. Os clientes aparecem automaticamente no seletor da Nova OS. |
| **4** | **Número da OS, NF, Cliente, Cor, Data de Entrada, Temperatura e Tempo de Cura Super Visíveis** | Bloco de Parâmetros de Cura da Estufa com **fundo amarelo e tipografia gigante** (`200 °C` e `15 MIN`), alerta de não retirar peças antes do tempo, além de todos os dados cadastrais obrigatórios. |
| **5** | **Controle de Limpeza e Pré-tratamento com Checkboxes e Nome do Colaborador** | Seção com caixas assinaláveis para **Limpeza Manual**, **Jateamento** e **Banho Químico**, campo de texto para o **Colaborador Responsável** (ex: Carlos Eduardo) e **Data/Hora da Limpeza**. |
| **6** | **Lançar Quantidade de Tinta em KG (Retirada, Devolução/Sobra e Consumo Líquido)** | Apontamento na balança com cálculo automático instantâneo: `Consumo Líquido = Retirada - Devolução`. O estoque da respectiva tinta é deduzido em tempo real com histórico rastreável. |
| **7** | **Aviso de Estoque Baixo a 10 kg** | Regra configurada a `10.0 kg`. Quando qualquer tinta atinge ou fica abaixo de 10 kg: exibe **alerta vermelho pulsante** no topo da tela, badge vermelho no menu lateral e destaque em vermelho na listagem. |
| **8** | **Login para ADM e Usuários** | Tela de login com usuário e senha. O ADM cria usuários, redefine senhas e controla o estoque; o Operador emite OS, aponta a balança e imprime. Senhas provisórias são trocadas no primeiro acesso. |
| **9** | **Gerar PDF para Impressão da OS para Produção** | Botão **"PDF"** / **"🖨️ Imprimir OS / Salvar PDF"**. Formata o documento **exatamente igual ao modelo oficial da Piveta Pinturas** em folha A4 vertical para envio à fábrica. |
| **10** | **Relatório de Estoque de Tinta Real** | Aba exclusiva com saldo físico real de cada tinta (código RAL, tipo, acabamento, lote, entradas e consumo em OS). Botão para **Imprimir Relatório** e **Exportar Planilha Excel (CSV)**. |
| **11** | **Movimentar o Estoque Apenas ADM** | Bloqueio de segurança: entradas de compra por Nota Fiscal, ajustes de inventário e saídas manuais exigem privilégio de **Administrador**. Usuários operadores recebem aviso de acesso negado caso tentem alterar saldos diretamente. |

---

### 👥 Usuários e Senhas

- Perfis: **Administrador (ADM)** e **Operador de Produção**.
- O ADM cadastra novos usuários em **Usuários & Sistema**. Todo usuário novo (ou com senha provisória) é obrigado a **trocar a senha no primeiro acesso**.
- As senhas provisórias de instalação são repassadas pelo responsável e **não ficam neste arquivo**.
- Em **Usuários & Sistema** o ADM também edita os dados da empresa que saem no cabeçalho da OS impressa.

---

### 💾 Backup e Segurança
- Na aba **"Usuários & Sistema"** (somente ADM): **Exportar Backup (JSON)** salva uma cópia de OS, tintas, clientes, movimentações e dados da empresa; **Restaurar Backup** carrega esse arquivo (substitui os dados atuais). Faça um backup de tempos em tempos.
- O Neon também mantém histórico do banco (restauração pelo painel do Neon, conforme o plano).
- Senhas são guardadas **criptografadas (scrypt)** no servidor; a sessão usa cookie protegido (HttpOnly). As permissões (ADM x Operador) são verificadas **no servidor**, não só na tela.
- O Operador consegue: emitir/editar OS, cadastrar clientes e baixar tinta pela OS. Todo o resto (cadastro de tintas, entradas/ajustes de estoque, exclusões, dados da empresa, usuários, backup) é só do ADM.
