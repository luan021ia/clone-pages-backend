#!/usr/bin/env node

/**
 * Script para alternar entre ambientes de desenvolvimento e produção
 * Uso: node scripts/switch-env.js [dev|prod]
 */

const fs = require('fs');
const path = require('path');

const envFile = path.join(__dirname, '..', '.env');
const envDevFile = path.join(__dirname, '..', '.env.dev');
const envProdFile = path.join(__dirname, '..', '.env.prod');

const targetEnv = process.argv[2] || 'dev';

if (!['dev', 'prod'].includes(targetEnv)) {
  console.error('❌ Ambiente inválido. Use "dev" ou "prod"');
  process.exit(1);
}

const sourceFile = targetEnv === 'dev' ? envDevFile : envProdFile;
const envName = targetEnv === 'dev' ? 'DESENVOLVIMENTO' : 'PRODUÇÃO';

// Verificar se o arquivo fonte existe
if (!fs.existsSync(sourceFile)) {
  console.error(`❌ Arquivo ${sourceFile} não encontrado!`);
  console.log(`💡 Crie o arquivo .env.${targetEnv} baseado no .env.example`);
  process.exit(1);
}

// Copiar arquivo
try {
  fs.copyFileSync(sourceFile, envFile);
  console.log(`✅ Ambiente alterado para ${envName}`);
  console.log(`📄 Arquivo .env atualizado a partir de .env.${targetEnv}`);
  
  // Mostrar algumas variáveis importantes
  const envContent = fs.readFileSync(envFile, 'utf8');
  const nodeEnv = envContent.match(/NODE_ENV=(.+)/)?.[1] || 'não definido';
  const port = envContent.match(/PORT=(.+)/)?.[1] || 'não definido';
  const allowedOrigins = envContent.match(/ALLOWED_ORIGINS=(.+)/)?.[1] || 'não definido';
  
  console.log('\n📋 Configurações atuais:');
  console.log(`   NODE_ENV: ${nodeEnv}`);
  console.log(`   PORT: ${port}`);
  console.log(`   ALLOWED_ORIGINS: ${allowedOrigins.substring(0, 60)}...`);
  
} catch (error) {
  console.error('❌ Erro ao copiar arquivo:', error.message);
  process.exit(1);
}
