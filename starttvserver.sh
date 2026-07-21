#!/bin/bash
# ==============================================================================
# TV2 — starttvserver Cloudflare Tunnel Launcher (Bash)
# ==============================================================================

echo "Iniciando o Servidor TV2..."

# 1. Obter a porta a partir do arquivo .env ou usar 3000 por padrão
PORT=3000
if [ -f .env ]; then
  # Extrai PORT do arquivo .env
  ENV_PORT=$(grep -E "^PORT=" .env | cut -d= -f2 | tr -d '\r' | tr -d ' ')
  if [ ! -z "$ENV_PORT" ]; then
    PORT=$ENV_PORT
  fi
fi

# 2. Iniciar o servidor Node.js em segundo plano
node src/server.js &
NODE_PID=$!

# Função para parar o servidor ao encerrar o script
cleanup() {
  echo ""
  echo "Encerrando o servidor Node.js (PID: $NODE_PID)..."
  kill $NODE_PID 2>/dev/null
  exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# Espera 3 segundos para o servidor iniciar completamente
sleep 3

echo ""
echo "Iniciando o Túnel da Cloudflare..."
echo "Aguarde a geração da URL pública (.trycloudflare.com) abaixo!"
echo "Pressione Ctrl+C para encerrar o servidor e o túnel."
echo ""

# 3. Iniciar o túnel apontando para a porta do Node.js
if [ -f "./cloudflared.exe" ]; then
  ./cloudflared.exe tunnel --url http://localhost:$PORT
elif [ -f "./cloudflared" ]; then
  ./cloudflared tunnel --url http://localhost:$PORT
else
  if command -v cloudflared &> /dev/null; then
    cloudflared tunnel --url http://localhost:$PORT
  else
    echo "Erro: Executável 'cloudflared' não foi encontrado."
    echo "Por favor, instale o cloudflared globalmente ou coloque o 'cloudflared.exe' na raiz do projeto."
    read -p "Pressione Enter para sair..."
  fi
fi
