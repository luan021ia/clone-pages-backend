const fs = require('fs');
const path = require('path');

/**
 * Script para copiar o build do frontend para dentro do backend
 * Usado em produção quando o backend serve os arquivos estáticos
 */

const frontendDistPath = path.join(__dirname, '..', '..', 'frontend', 'dist');
const backendFrontendPath = path.join(__dirname, '..', 'frontend');

console.log('📦 Copiando build do frontend para o backend...');
console.log(`   Origem: ${frontendDistPath}`);
console.log(`   Destino: ${backendFrontendPath}`);

// Verificar se o diretório de origem existe
if (!fs.existsSync(frontendDistPath)) {
  console.error('❌ Erro: Diretório de build do frontend não encontrado!');
  console.error(`   Certifique-se de buildar o frontend primeiro: cd ../frontend && npm run build`);
  process.exit(1);
}

// Criar diretório de destino se não existir
if (!fs.existsSync(backendFrontendPath)) {
  fs.mkdirSync(backendFrontendPath, { recursive: true });
}

// Função para copiar recursivamente
function copyRecursive(src, dest) {
  const stats = fs.statSync(src);
  
  if (stats.isDirectory()) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    
    const files = fs.readdirSync(src);
    files.forEach(file => {
      copyRecursive(path.join(src, file), path.join(dest, file));
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

// Copiar arquivos
try {
  copyRecursive(frontendDistPath, backendFrontendPath);
  console.log('✅ Frontend copiado com sucesso!');
} catch (error) {
  console.error('❌ Erro ao copiar frontend:', error.message);
  process.exit(1);
}
