# Análise: Persistência de Dados do Usuário e Banco de Dados

## Resumo do problema

Usuários adicionados **online** (em produção) parecem "sumir" após um **push** e redeploy. A base de dados usada em produção não parece estar integrada ou persistir entre deploys.

---

## Como a persistência está configurada hoje

### 1. Banco de dados

- **Backend**: NestJS + TypeORM + **SQLite**.
- **Arquivo do banco**:
  - **Desenvolvimento**: `SQLITE_DB=saas-dev.sqlite` (arquivo na raiz do projeto).
  - **Produção**: `SQLITE_DB=/data/saas-dev.sqlite` (arquivo em volume persistente).

### 2. O que acontece na subida do backend (`main.ts`) — após correção

No início do `bootstrap()`:

1. `dbTarget` = `process.env.SQLITE_DB` ou `/data/saas-dev.sqlite`.
2. **Se** `dbTarget` for em `/data/`: apenas garante que o diretório `/data` existe (cria se precisar).
3. **Não** se copia mais o banco do repositório para `/data`. Se `/data/saas-dev.sqlite` não existir, o TypeORM cria um banco novo (vazio) graças a `synchronize: true`.

Assim, em produção o banco em `/data/` nunca é sobrescrito por um arquivo versionado no Git.

### 3. Versionamento do banco

- No `.gitignore` há **`!saas-dev.sqlite`**, ou seja, o arquivo **não** é ignorado e **é versionado**.
- O arquivo `clone-pages-backend/saas-dev.sqlite` existe no repositório e vai junto no clone/build em produção.

---

## Por que os usuários “somem”

Dois efeitos se somam:

### Causa 1: Volume `/data` efêmero (ou recriado a cada deploy)

Em muitos provedores (Railway, Render, Fly.io, etc.):

- Cada **deploy** = novo container/instância.
- Se **não** houver um **volume persistente** montado em `/data`, o diretório `/data` é novo e vazio a cada deploy.
- O banco “real” de produção fica em `/data/saas-dev.sqlite`. Quando o container é recriado, esse arquivo **não existe** na nova instância.
- Conclusão: **tudo que foi criado online (usuários, etc.) estava apenas no disco da instância antiga**, que é descartada no redeploy. Por isso os dados “somem”.

### Causa 2: Cópia do banco do repositório para `/data`

Quando o app sobe em produção:

- `dbTarget` = `/data/saas-dev.sqlite`.
- Em ambiente efêmero, esse arquivo **não existe** (volume novo).
- O código entrando no `if (!fs.existsSync(dbTarget))` **copia** o `saas-dev.sqlite` do **build/repositório** para `/data/saas-dev.sqlite`.

Esse arquivo do repo é uma “foto” antiga do banco (sem o usuário que você adicionou online). Então:

- Mesmo que em algum cenário o volume persistisse, **na primeira vez** que o arquivo não existisse você estaria colocando o banco **antigo** do repo em produção e **sobrescrevendo** a expectativa de um banco “vazio e novo”.
- Em cenário efêmero, a cada deploy você **sempre** inicializa `/data/` com o banco do repo, e **nunca** usa um banco que já tinha os usuários de produção (porque esse banco não sobrevive ao redeploy sem volume persistente).

Resumindo: **os dados de produção não persistem entre deploys (volume efêmero) e, quando o app “inicializa” o banco em `/data`, ele usa o arquivo versionado, que não contém os usuários criados online.**

---

## O que fazer

### 1. Garantir volume persistente em produção (obrigatório)

**Se você usa Dokploy:** siga o guia **[DOKPLOY-VOLUME-PERSISTENTE.md](./DOKPLOY-VOLUME-PERSISTENTE.md)** — em resumo: na aplicação do backend, aba **Advanced → Volumes**, adicione um volume com **Mount Path** = **`/data`**.

Para os dados **realmente** persistirem entre deploys:

- Configure um **volume persistente** no serviço onde o backend roda.
- Monte esse volume em **`/data`** (ou no mesmo caminho definido em `SQLITE_DB`).
- Assim, `/data/saas-dev.sqlite` será o **mesmo** arquivo entre um deploy e outro, e usuários/tarefas criados online permanecem.

Exemplos:

- **Railway**: adicionar “Persistent Volume” e montar em `/data`.
- **Render**: adicionar “Disk” e montar em `/data`.
- **Docker**: usar um volume ou bind mount para `/data`.

Sem isso, **qualquer** dado em SQLite (usuários, etc.) será perdido a cada redeploy.

### 2. Não usar o banco do repositório para “inicializar” produção

Objetivo: **nunca** sobrescrever ou “semear” produção com o arquivo `saas-dev.sqlite` que vem do Git.

- **Em produção** (`SQLITE_DB` apontando para `/data/...`): **não** copiar `saas-dev.sqlite` do repositório para `/data/`. Se o arquivo em `/data/` não existir, deixar o TypeORM criar um banco **novo e vazio** (com `synchronize: true` já configurado).
- Assim, você evita colocar uma versão antiga do banco (sem o usuário online) em cima do caminho de produção.

A alteração no `main.ts` foi feita nesse sentido: em produção, apenas garantir o diretório `/data` e **não** copiar o arquivo do repo para `/data/saas-dev.sqlite`.

### 3. Não versionar o banco (recomendado)

- **Remover** a exceção `!saas-dev.sqlite` do `.gitignore` e **ignorar** `saas-dev.sqlite` (por exemplo com `*.sqlite` ou `saas-dev.sqlite`).
- Em **desenvolvimento**, o banco continua sendo criado localmente (TypeORM + seeds, se houver).
- Em **produção**, o banco fica apenas em `/data/` (volume persistente), criado pelo TypeORM na primeira vez ou já existente de deploys anteriores.

Isso evita que um “backup” antigo do banco no Git seja usado para inicializar produção e confunde menos o que é “fonte da verdade” (sempre o arquivo em `/data/` em produção).

---

## Checklist pós-correção

- [ ] **Volume persistente** em produção montado em `/data` (ou no caminho de `SQLITE_DB`).
- [ ] **Nunca** copiar `saas-dev.sqlite` do repositório para `/data` em produção (código já ajustado no `main.ts`).
- [ ] **Não** versionar `saas-dev.sqlite` (ajuste no `.gitignore` e remoção do arquivo do histórico/commit, se desejado).
- [ ] Após o primeiro deploy com volume persistente, usuários e dados criados online devem **persistir** entre pushes e redeploys.

---

## Referência rápida de arquivos

| Arquivo | Função |
|--------|--------|
| `src/main.ts` | Bootstrap; antes copiava o banco do repo para `/data` quando não existia – **ajustado** para não copiar em produção. |
| `src/app.module.ts` | Configuração TypeORM (SQLite, `synchronize: true`). |
| `src/config/ormconfig.ts` | DataSource para migrations (usa `SQLITE_DB`). |
| `.gitignore` | Tinha `!saas-dev.sqlite` (banco versionado) – **ajustado** para ignorar o arquivo. |
| `scripts/init-db.sh` | Script que copia banco do repo para `/data` – usar apenas se souber que não há dados em `/data`. |
