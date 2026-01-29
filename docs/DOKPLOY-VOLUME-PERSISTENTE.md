# Dokploy: Volume persistente para o banco (não perder usuários no deploy)

Com deploy via **push no GitHub**, a cada novo deploy o Dokploy recria o container. Sem um **volume persistente**, o arquivo do banco (`/data/saas-dev.sqlite`) é apagado e você perde usuários e dados criados online.

A solução é configurar **um volume** no Dokploy para o **backend**, montado em **`/data`**. Assim o mesmo banco é reutilizado em todos os deploys.

---

## Passo a passo no Dokploy (interface em inglês)

Use estes nomes exatamente como aparecem na tela:

1. Abra o **Dokploy** no seu VPS.
2. Entre no **Project** onde está o backend (Clone Pages).
3. Abra a **Application** do backend (a que sobe a API, não o frontend).
4. Clique na aba **Advanced** (atalho: `g` + `a`).
5. Na seção **Volumes**, clique para **adicionar um volume** (Add Volume / Create).
6. Configure:
   - **Type**: **Volume** (recomendado) ou **Bind**.
   - **Mount Path** (caminho dentro do container): **`/data`**
   - Se for **Volume**: em **Volume Name** use, por exemplo, **`clone-pages-backend-data`** (o Dokploy cria o volume no host).
   - Se for **Bind**: em **Host Path** use um caminho no servidor, ex.: **`/var/dokploy/data/clone-pages-backend`** e garanta que a pasta exista no VPS.
7. Salve (**Save**) e faça um **Redeploy** da aplicação (botão **Deploy** ou **Redeploy**).

**Importante:** o Dokploy avisa: *"Please remember to click Redeploy after adding, editing, or deleting a mount to apply the changes."* Ou seja, depois de criar (ou alterar/remover) um volume, é obrigatório clicar em **Redeploy** para as mudanças valerem.

Depois disso, o diretório `/data` dentro do container passa a ser persistente: o arquivo `saas-dev.sqlite` fica no volume e **não é apagado** quando você faz push e o Dokploy redeploya. Novos usuários e dados permanecem.

---

## Conferir variável de ambiente

Na aba **Environment** da aplicação do **backend**, confira se existe:

- **`SQLITE_DB`** = **`/data/saas-dev.sqlite`**

(Se não estiver definido, o backend já usa esse valor por padrão em produção.)

---

## Resumo (nomes em inglês)

| Onde | O quê |
|------|--------|
| **Advanced** → **Volumes** | Adicionar volume com **Mount Path** = **`/data`** |
| **Environment** (backend) | `SQLITE_DB=/data/saas-dev.sqlite` |

Depois de configurar o volume **uma vez**, pode continuar fazendo push e melhorias no código: os dados dos usuários (e o restante do banco) permanecem entre os deploys.
