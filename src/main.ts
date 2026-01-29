import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { json, urlencoded } from 'express';
import * as fs from 'fs';
import * as path from 'path';

async function bootstrap() {
  // Em produção: garantir apenas que o diretório /data existe.
  // NUNCA copiar o banco do repositório para /data — isso sobrescreveria dados
  // criados online (usuários, etc.) com uma versão antiga do banco versionada no Git.
  // Se /data/saas-dev.sqlite não existir, o TypeORM criará um banco novo (synchronize: true).
  const dbTarget = process.env.SQLITE_DB || '/data/saas-dev.sqlite';
  if (dbTarget.startsWith('/data/')) {
    try {
      const dataDir = path.dirname(dbTarget);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
    } catch (error) {
      // Silencioso - TypeORM pode falhar ao criar o arquivo depois
    }
  }

  const app = await NestFactory.create(AppModule);
  
  // 📦 Configurar limites de body para uploads grandes (100MB)
  app.use(json({ limit: '100mb' }));
  app.use(urlencoded({ extended: true, limit: '100mb' }));

  // 🎯 CORS Configuration - Lê ALLOWED_ORIGINS do .env
  let allowedOrigins: string[] = [];

  // 1. Tentar ler ALLOWED_ORIGINS do .env (separado por vírgula)
  if (process.env.ALLOWED_ORIGINS) {
    allowedOrigins = process.env.ALLOWED_ORIGINS.split(',')
      .map(origin => origin.trim())
      .filter(origin => origin.length > 0);
  }
  // 2. Fallback para FRONTEND_URL (se existir)
  else if (process.env.FRONTEND_URL) {
    allowedOrigins = [process.env.FRONTEND_URL];
  }
  // 3. Fallback baseado no ambiente
  else {
    const isProduction = process.env.NODE_ENV === 'production';
    if (isProduction) {
      // Em produção, incluir domínios de produção por padrão
      allowedOrigins = [
        'https://clonepages.fabricadelowticket.com.br',
        'https://www.clonepages.fabricadelowticket.com.br'
      ];
    } else {
      // Em desenvolvimento, usar localhost
      allowedOrigins = ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'];
    }
  }

  // 4. Em desenvolvimento, permitir localhost automaticamente se ALLOW_LOCALHOST=true
  const isDevelopment = process.env.NODE_ENV === 'development';
  const allowLocalhost = process.env.ALLOW_LOCALHOST === 'true';
  
  if (isDevelopment && allowLocalhost) {
    // Adicionar localhost em várias portas comuns se não estiverem já na lista
    const localhostOrigins = [
      'http://localhost:5173',
      'http://localhost:3000',
      'http://localhost:8080',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:3000',
    ];
    
    localhostOrigins.forEach(origin => {
      if (!allowedOrigins.includes(origin)) {
        allowedOrigins.push(origin);
      }
    });
  }

  // Função para validar origem
  const corsOptions = {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Permitir requisições sem origem (ex: Postman, mobile apps)
      if (!origin) {
        return callback(null, true);
      }

      // Verificar se a origem está na lista permitida
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      // Em desenvolvimento, permitir qualquer localhost
      if (isDevelopment && (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:'))) {
        return callback(null, true);
      }

      // Em produção, permitir domínios fabricadelowticket.com.br
      if (!isDevelopment && origin.includes('fabricadelowticket.com.br')) {
        return callback(null, true);
      }

      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
    exposedHeaders: ['Content-Type', 'Authorization'],
    preflightContinue: false,
    optionsSuccessStatus: 204,
  };

  app.enableCors(corsOptions);
  
  // Middleware adicional para garantir CORS em todas as rotas
  app.use((req: any, res: any, next: any) => {
    const origin = req.headers.origin;
    
    // Verificar se a origem deve ser permitida
    let shouldAllow = false;
    if (origin) {
      if (allowedOrigins.includes(origin)) {
        shouldAllow = true;
      } else if (isDevelopment && (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:'))) {
        shouldAllow = true;
      } else if (!isDevelopment && origin.includes('fabricadelowticket.com.br')) {
        shouldAllow = true;
      }
    } else {
      // Sem origem (ex: Postman, mobile apps)
      shouldAllow = true;
    }
    
    if (shouldAllow && origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin');
    }
    
    // Responder a requisições OPTIONS (preflight) imediatamente
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    
    next();
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  
  const port = process.env.PORT ? Number(process.env.PORT) : 3333;
  await app.listen(port);
  console.log(`🚀 Backend rodando na porta ${port}`);
}

bootstrap();
