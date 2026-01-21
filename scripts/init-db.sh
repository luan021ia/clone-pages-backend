#!/bin/bash
# Script de inicialização do banco de dados
# Copia o banco do repositório para o volume persistente se não existir

set -e

DB_SOURCE="./saas-dev.sqlite"
DB_TARGET="/data/saas-dev.sqlite"

echo "🔍 [Init DB] Verificando banco de dados..."

# Criar diretório /data se não existir
mkdir -p /data

# Se o banco não existe no volume persistente, copiar do repositório
if [ ! -f "$DB_TARGET" ]; then
  if [ -f "$DB_SOURCE" ]; then
    echo "📦 [Init DB] Copiando banco do repositório para volume persistente..."
    cp "$DB_SOURCE" "$DB_TARGET"
    chmod 664 "$DB_TARGET"
    echo "✅ [Init DB] Banco copiado com sucesso!"
  else
    echo "ℹ️  [Init DB] Banco não encontrado no repositório. Será criado automaticamente pelo TypeORM."
  fi
else
  echo "✅ [Init DB] Banco já existe no volume persistente. Mantendo dados existentes."
fi
