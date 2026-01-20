import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { json, urlencoded } from 'express';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  
  // 📦 Configurar limites de body para uploads grandes (100MB)
  app.use(json({ limit: '100mb' }));
  app.use(urlencoded({ extended: true, limit: '100mb' }));
  console.log('📦 [BodyParser] Limite configurado: 100MB para JSON e URL-encoded');

  // 🎯 CORS Configuration - Lê ALLOWED_ORIGINS do .env
  let allowedOrigins: string[] = [];

  // 1. Tentar ler ALLOWED_ORIGINS do .env (separado por vírgula)
  if (process.env.ALLOWED_ORIGINS) {
    allowedOrigins = process.env.ALLOWED_ORIGINS.split(',')
      .map(origin => origin.trim())
      .filter(origin => origin.length > 0);
    console.log('📋 [CORS] Usando ALLOWED_ORIGINS do .env:', allowedOrigins);
  }
  // 2. Fallback para FRONTEND_URL (se existir)
  else if (process.env.FRONTEND_URL) {
    allowedOrigins = [process.env.FRONTEND_URL];
    console.log('📋 [CORS] Usando FRONTEND_URL do .env:', allowedOrigins);
  }
  // 3. Fallback para desenvolvimento local
  else {
    allowedOrigins = ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'];
    console.log('📋 [CORS] Usando origens padrão de desenvolvimento:', allowedOrigins);
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
    
    console.log('✅ [CORS] Localhost permitido automaticamente em desenvolvimento');
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
      if (isDevelopment && origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
        return callback(null, true);
      }

      console.warn(`⚠️ [CORS] Origem bloqueada: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  };

  app.enableCors(corsOptions);

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  
  // 📦 Servir arquivos estáticos do frontend (produção)
  const frontendPath = join(__dirname, '..', '..', 'frontend', 'dist');
  app.useStaticAssets(frontendPath, {
    index: false, // Não servir index.html automaticamente
    setHeaders: (res, path) => {
      // Configurar MIME types corretos para módulos JavaScript
      if (path.endsWith('.js')) {
        res.setHeader('Content-Type', 'application/javascript');
      } else if (path.endsWith('.mjs')) {
        res.setHeader('Content-Type', 'application/javascript');
      } else if (path.endsWith('.css')) {
        res.setHeader('Content-Type', 'text/css');
      } else if (path.endsWith('.json')) {
        res.setHeader('Content-Type', 'application/json');
      }
    }
  });
  
  // Para qualquer rota não-API, servir o index.html (SPA routing)
  app.use((req: any, res: any, next: any) => {
    // Se não for uma rota de API, servir o index.html
    if (!req.path.startsWith('/api') && 
        !req.path.startsWith('/users') && 
        !req.path.startsWith('/tasks') && 
        !req.path.startsWith('/webhooks') &&
        !req.path.startsWith('/render') &&
        !req.path.match(/\.[a-zA-Z0-9]+$/)) { // Se não tiver extensão de arquivo
      res.sendFile(join(frontendPath, 'index.html'));
    } else {
      next();
    }
  });
  
  console.log(`📂 [StaticAssets] Servindo frontend de: ${frontendPath}`);
  
  const port = process.env.PORT ? Number(process.env.PORT) : 3333;
  await app.listen(port);
  console.log(`🚀 Backend is running on: http://localhost:${port}`);
  console.log(`🌐 CORS enabled for origins:`, allowedOrigins);
}

bootstrap();
