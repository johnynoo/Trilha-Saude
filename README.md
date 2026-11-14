# TrilhaSaúde + MySQL

Adaptação do protótipo TrilhaSaúde originalmente feito em HTML, CSS e JavaScript,
agora com **Node.js (back-end)**, **API REST**, **MySQL 8+** e **sessões no servidor**.

## Estrutura

```text
TrilhaSaude-MySQL/
├── public/
│   ├── index.html      # Interface original
│   ├── style.css       # Estilos originais
│   └── app.js          # Eventos e chamadas à API
├── server.js           # API Express, autenticação e MySQL
├── schema.sql          # Banco, tabelas e relacionamentos
├── package.json        # Dependências e comandos
├── .env.example        # Modelo da configuração de conexão
├── .gitignore
└── README.md
```

## Requisitos

- Node.js 20 ou superior e npm
- MySQL Server 8.0 ou superior, acessível via TCP
- Um editor de código (por exemplo, VS Code)

## Instalação (Windows / Linux / macOS)

### 1. Crie o banco de dados

Abra o **MySQL Workbench**, terminal `mysql` ou ferramenta equivalente. Execute **todo**
o arquivo `schema.sql` com uma conta MySQL que possa criar o banco.

Opcional, mas recomendado: crie uma conta do MySQL específica para este app.
Execute como administrador do MySQL, **trocando a senha abaixo**:

```sql
CREATE USER 'trilhosaude_app'@'127.0.0.1'
IDENTIFIED BY 'substitua-por-senha-longa-e-unica';
GRANT SELECT, INSERT, UPDATE, DELETE ON trilhasaude.*
TO 'trilhosaude_app'@'127.0.0.1';
```

Se a conta já existir, **não** repita `CREATE USER`; redefina a senha ou reutilize as credenciais.
Se a conexão vier de outro host, configure as permissões de rede e do usuário corretamente.
Não publique o MySQL diretamente na internet.

### 2. Configure as credenciais

Copie `.env.example` para `.env` e edite esse novo arquivo:

```dotenv
NODE_ENV=development
HOST=127.0.0.1
PORT=3000
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=trilhosaude_app
DB_PASSWORD=substitua-por-senha-longa-e-unica
DB_NAME=trilhosaude
```

No PowerShell (estando na pasta do projeto), o comando para copiar é:

```powershell
Copy-Item .env.example .env
```

O `.env` não deve ser enviado ao GitHub, porque guarda credenciais.

### 3. Instale dependências e inicie

No terminal, na pasta principal do projeto:

```powershell
npm install
npm start
```

Abra **http://127.0.0.1:3000** no navegador.

> **Não use** o Live Server, `file://` ou abra `index.html` diretamente: é o servidor
> Express que disponibiliza o front-end e as rotas `/api/...` na mesma origem.

O servidor **não cria as tabelas automaticamente**. Caso a inicialização informe erro,
confira o MySQL, o `.env` e se executou `schema.sql`.

## Como os dados são gravados

| Funcionalidade | MySQL |
|---|---|
| Cadastro e login | `users`, `sessions` |
| Perfil, lembretes e etapa da jornada | `users` |
| Consultas e confirmações | `appointments` |
| Exames e mudança de situação | `exams` |
| Notificações | `notifications` |
| Mensagens simuladas | `messages` |

Todas as tabelas de conteúdo usam `user_id`, e as consultas do servidor filtram pelo
ID da pessoa autenticada. Uma sessão é identificada por token aleatório guardado em
cookie `HttpOnly`, enquanto apenas o hash desse token fica no MySQL.
As senhas recebem hash com `scrypt` e sal individual. A API utiliza parâmetros SQL
(`?`) para reduzir riscos de SQL injection.

**Fluxo:** Interface JS → requisição `fetch('/api/...')` → Express → pool `mysql2`
→ MySQL → resposta JSON → interface atualizada.

Exemplo de consulta real:

```sql
SELECT id, name, email FROM users;
SELECT id, user_id, title, appt_at FROM appointments;
SELECT id, user_id, name, exam_date, status FROM exams;
```

## Rotas principais

| Método | Endpoint | Ação |
|---|---|---|
| POST | `/api/register` | Criar conta |
| POST | `/api/login` | Entrar |
| POST | `/api/logout` | Encerrar sessão |
| GET | `/api/me` | Ler conta e dados vinculados |
| PATCH | `/api/me/profile` | Atualizar nome/telefone |
| PATCH | `/api/me/reminders` | Alterar lembretes |
| PATCH | `/api/me/progress` | Avançar/voltar jornada |
| DELETE | `/api/me` | Excluir conta e dados relacionados |
| POST | `/api/appointments` | Criar consulta |
| PATCH/DELETE | `/api/appointments/:id` | Confirmar/excluir consulta |
| POST | `/api/exams` | Criar exame |
| PATCH/DELETE | `/api/exams/:id` | Alterar/excluir exame |
| PATCH | `/api/notifications/:id/read` | Marcar notificação como lida |
| POST | `/api/notifications/read-all` | Marcar todas como lidas |
| DELETE | `/api/notifications` | Limpar notificações |
| POST | `/api/messages` | Mensagem demonstrativa |

## Importante sobre os dados anteriores

Os registros do protótipo original ficam no `localStorage` do navegador.
**Eles não são migrados automaticamente**: é necessário criar uma nova conta
e recadastrar informações de teste. Isso evita copiar para o servidor
credenciais do login demonstrativo antigo, que não eram autenticação de produção.

## Privacidade e limites desta entrega

**Projeto acadêmico demonstrativo. Não coloque dados médicos reais de pacientes
nem disponibilize publicamente como serviço de saúde.**

- As mensagens são simulações locais no servidor: **não há equipe real recebendo mensagens**.
- Para produção com dados de saúde, faltam análise formal de segurança, adequação à
  LGPD, HTTPS, gestão de segredos, controle de acesso avançado, auditoria, recuperação
  de senha, backups criptografados, políticas de retenção/consentimento e testes de segurança.
- Não há disparo externo de notificações: o lembrete é gerado quando uma pessoa
  autenticada abre o aplicativo dentro das 24h que antecedem uma consulta.
- Datas/horas de consultas são gravadas em **UTC** no MySQL e exibidas no fuso
  horário do navegador. Datas de exames não recebem conversão de fuso.
- O limitador de login opera em memória. Em produção com várias instâncias,
  use um armazenamento distribuído para o rate limit.
- Ao testar em HTTP local, o cookie não usa `Secure`; em `NODE_ENV=production`,
  o atributo é exigido e o aplicativo deve estar atrás de HTTPS.

## Teste rápido de funcionamento

1. Inicie o banco e `npm start`.
2. Crie uma conta com senha de no mínimo 8 caracteres.
3. Registre uma consulta e um exame; confirme a consulta e altere o status do exame.
4. Atualize seu perfil e marque uma notificação como lida.
5. Saia, feche o navegador, reabra e faça login: os dados persistirão no MySQL.
6. No Workbench, execute as consultas SQL da seção “Como os dados são gravados”.

## Solução de problemas

- `ECONNREFUSED 127.0.0.1:3306`: serviço MySQL parado ou porta diferente.
- `Access denied for user`: usuário/senha/permissões do MySQL incorretos.
- `Unknown database` / `Table 'trilhosaude.users' doesn't exist`: execute `schema.sql`.
- `Failed to fetch`: abra `http://127.0.0.1:3000` e confira o processo `npm start`.
- Login anterior não entra: o cadastro demonstrativo salvo no navegador não é
  reaproveitado; faça um cadastro de teste no sistema novo.
