@echo off
title TV2 - starttvserver Launcher
echo Iniciando o Servidor TV2...

:: 1. Tenta extrair a porta do arquivo .env ou usa 3000 por padrão
set PORT=3000
if exist .env (
    for /f "tokens=1,2 delims==" %%I in (.env) do (
        if "%%I"=="PORT" set PORT=%%J
    )
)

:: Remover espaços em branco da variável da porta
set PORT=%PORT: =%

:: 2. Inicia o servidor Node.js em segundo plano (porta %PORT%)
start /B node src/server.js

:: Aguarda 3 segundos para o servidor iniciar completamente
timeout /t 3 /nobreak >nul

echo.
echo Iniciando o Tunel da Cloudflare...
echo Copie a URL (https://....trycloudflare.com) que aparecer abaixo!
echo.

:: 3. Inicia o túnel apontando para a porta do Node.js
if exist cloudflared.exe (
    cloudflared.exe tunnel --url http://localhost:%PORT%
) else (
    where cloudflared >nul 2>nul
    if %errorlevel% equ 0 (
        cloudflared tunnel --url http://localhost:%PORT%
    ) else (
        echo Erro: O executavel 'cloudflared' nao foi encontrado.
        echo Por favor, coloque 'cloudflared.exe' nesta pasta ou instale o Cloudflare Tunnel globalmente.
        pause
    )
)
