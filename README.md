# Clone Pages - Backend

API NestJS para clonagem e edição de páginas web, com integração Kiwify para pagamentos.

## 🚀 Tecnologias

- **NestJS** com TypeScript
- **TypeORM** para ORM
- **SQLite** (dev) / **PostgreSQL** (prod)
- **JWT** para autenticação
- **Puppeteer** para web scraping
- **Jest** para testes

## 📦 Instalação

```bash
npm install
```

## 🛠 Desenvolvimento

```bash
npm run dev
```

A API estará disponível em `http://localhost:3333`

## 🔧 Configuração

Copie `.env.example` para `.env` e configure:

```bash
PORT=3333
JWT_SECRET=your-secret-key
SQLITE_DB=saas-dev.sqlite

# Kiwify Webhook
KIWIFY_TOKEN=seu-token
KIWIFY_PRODUCT_ID=seu-product-id
```

## 📝 Scripts Disponíveis

| Script | Descrição |
|--------|-----------|
| `npm run dev` | Inicia servidor com hot reload |
| `npm run build` | Compila TypeScript |
| `npm run start` | Executa versão compilada |
| `npm run start:prod` | Executa em produção |
| `npm test` | Executa testes |
| `npm run test:watch` | Testes em modo watch |
| `npm run test:cov` | Relatório de cobertura |
| `npm run lint` | Verifica código |

## 🏗 Estrutura

```
backend/
├── src/
│   ├── modules/        # Módulos da aplicação
│   │   ├── users/      # Gerenciamento de usuários
│   │   ├── licenses/   # Sistema de licenças
│   │   ├── clone/      # Clonagem de páginas
│   │   └── webhooks/   # Webhooks (Kiwify)
│   ├── database/      # Entidades e seeds
│   └── common/         # Utilitários compartilhados
└── dist/               # Build compilado
```

## 🔗 Endpoints Principais

- `POST /users/login` - Autenticação
- `POST /users` - Registro
- `GET /users/me` - Usuário atual
- `POST /api/clone` - Clonar página
- `POST /webhooks/kiwify` - Webhook Kiwify

## 🚢 Deploy

### Deploy Automático (Dokploy)

O projeto está configurado para deploy automático via Git push:

1. **Build de produção:**
```bash
npm run build
```

2. **Commit e push (aciona deploy automático):**
```bash
git add .
git commit -m "Deploy: atualização"
git push origin main
```

O Dokploy detecta o push e faz o build automaticamente.

### Deploy com Frontend Integrado (Servidor único)

Se você quer que o backend sirva os arquivos estáticos do frontend:

1. **Buildar o frontend primeiro:**
```bash
cd ../frontend
npm run build
cd ../backend
```

2. **Buildar o backend com frontend:**
```bash
npm run build:full
```

Isso irá compilar o TypeScript do backend e copiar os arquivos buildados do frontend.

3. **Deploy automático via Git:**
```bash
git add .
git commit -m "Deploy: backend + frontend"
git push origin main
```

### Deploy Separado (Servidores diferentes)

Se você tem frontend e backend em servidores separados:

1. **Buildar apenas o backend:**
```bash
npm run build
```

2. **Deploy via Git:**
```bash
git add .
git commit -m "Deploy: backend"
git push origin main
```

### Variáveis de Ambiente em Produção

Configure no painel do Dokploy ou em `.env`:

```bash
PORT=3333
JWT_SECRET=sua-chave-secreta
ALLOWED_ORIGINS=https://clonepages.fabricadelowticket.com.br
KIWIFY_TOKEN=seu-token
KIWIFY_PRODUCT_ID=seu-product-id
```

### Verificar Deploy

- Backend API: `https://bclone.fabricadelowticket.com.br/api/clone`
- Frontend (se integrado): `https://bclone.fabricadelowticket.com.br/`

## 📞 Conexão com Frontend

- **Frontend separado**: `https://clonepages.fabricadelowticket.com.br`
- **Frontend integrado**: Servido pelo backend em `/`

Configure `ALLOWED_ORIGINS` no `.env` para permitir requisições CORS.

### ⚠️ Importante: Rate Limiting no Deploy

**Problema conhecido:** O Dokploy pode ignorar deploys quando há múltiplos pushes muito próximos (em poucos minutos).

**Solução:**
- Aguardar **2-3 minutos entre pushes** quando houver múltiplos commits
- Agrupar mudanças relacionadas em um único commit quando possível
- Se o deploy não for acionado, aguardar alguns minutos e fazer um novo push de teste

**Sintomas:**
- ✅ Push realizado com sucesso
- ✅ Commit aparece no GitHub
- ❌ Mas o deploy não é acionado no Dokploy

Se isso acontecer, aguarde alguns minutos e faça um novo push.
