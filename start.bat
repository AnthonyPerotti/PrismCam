@echo off
setlocal EnableDelayedExpansion
title PrismCam - Controle PTZ e Captura de Cameras IP

echo.
echo  =============================================================
echo        PrismCam - Controle PTZ e Captura de Cameras IP
echo  =============================================================
echo.

cd /d "%~dp0"

:: -----------------------------------------------------------------
:: 1. Verificacao / Instalacao Automatica do Node.js
:: -----------------------------------------------------------------
set "USE_LOCAL_NODE=0"

:: Verifica se o Node.js ja esta instalado no sistema global
where node >nul 2>nul
if %errorlevel% equ 0 (
    goto :node_ready
)

:: Verifica se ja temos o Node.js portatil na pasta bin\node
if exist "%~dp0bin\node\node.exe" (
    set "PATH=%~dp0bin\node;%PATH%"
    set "USE_LOCAL_NODE=1"
    goto :node_ready
)

:: Se nao existe em lugar nenhum, baixa e instala a versao portatil oficial
echo [INFO] Node.js nao foi detectado neste computador.
echo [INFO] Baixando e preparando o ambiente automaticamente (Node.js LTS)...
echo [INFO] Esse processo ocorre apenas na primeira execucao (download de ~29 MB).
echo.

if not exist "%~dp0bin" mkdir "%~dp0bin"
if not exist "%~dp0bin\node" mkdir "%~dp0bin\node"

set "NODE_URL=https://nodejs.org/dist/v20.18.0/node-v20.18.0-win-x64.zip"
set "ZIP_FILE=%TEMP%\prismcam-node-lts.zip"
set "EXTRACT_DIR=%TEMP%\prismcam-node-extract"

:: Tenta baixar via curl.exe (nativo no Windows 10/11)
where curl >nul 2>nul
if %errorlevel% equ 0 (
    echo [1/3] Baixando Node.js oficial...
    curl -L -# -o "%ZIP_FILE%" "%NODE_URL%"
) else (
    echo [1/3] Baixando Node.js via PowerShell...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (New-Object Net.WebClient).DownloadFile('%NODE_URL%', '%ZIP_FILE%')"
)

if not exist "%ZIP_FILE%" (
    echo.
    echo [ERRO] Nao foi possivel baixar o Node.js automaticamente.
    echo Verifique sua conexao com a internet ou instale manualmente em: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

:: Extrai o zip
echo [2/3] Extraindo arquivos...
where tar >nul 2>nul
if %errorlevel% equ 0 (
    tar -xf "%ZIP_FILE%" --strip-components=1 -C "%~dp0bin\node"
) else (
    if exist "%EXTRACT_DIR%" rmdir /s /q "%EXTRACT_DIR%" 2>nul
    mkdir "%EXTRACT_DIR%"
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '%ZIP_FILE%' -DestinationPath '%EXTRACT_DIR%' -Force"
    for /d %%D in ("%EXTRACT_DIR%\node-*") do (
        xcopy /s /e /y /q "%%D\*" "%~dp0bin\node\" >nul
    )
    rmdir /s /q "%EXTRACT_DIR%" 2>nul
)

:: Remove o arquivo zip temporario
del /f /q "%ZIP_FILE%" 2>nul

if not exist "%~dp0bin\node\node.exe" (
    echo.
    echo [ERRO] Falha ao extrair o Node.js.
    echo Por favor, instale o Node.js manualmente em: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

echo [3/3] Ambiente configurado com sucesso!
echo.

set "PATH=%~dp0bin\node;%PATH%"
set "USE_LOCAL_NODE=1"

:node_ready
for /f "tokens=*" %%V in ('node -v 2^>nul') do set "NODE_VERSION=%%V"
echo [INFO] Node.js ativo: %NODE_VERSION%

:: -----------------------------------------------------------------
:: 2. Verificacao / Instalacao das Dependencias (npm install)
:: -----------------------------------------------------------------
if not exist "node_modules" (
    echo.
    echo [INFO] Instalando dependencias do PrismCam e ferramentas de video...
    echo [INFO] Aguarde alguns instantes...
    echo.
    call npm install --no-audit --no-fund
    if %errorlevel% neq 0 (
        echo.
        echo [ERRO] Falha ao instalar dependencias do projeto via npm.
        pause
        exit /b 1
    )
    echo [INFO] Dependencias instaladas com sucesso!
)

:: -----------------------------------------------------------------
:: 3. Inicializacao do Servidor PrismCam
:: -----------------------------------------------------------------
echo.
echo [INFO] Iniciando o servidor PrismCam...
echo [INFO] Painel Web: http://localhost:3737
echo [INFO] API REST:   http://localhost:3737/api
echo.
echo Dica: Se o Firewall do Windows exibir um aviso, clique em "Permitir Acesso"
echo       para habilitar a descoberta de cameras na rede local.
echo.

:: Inicia o servidor Node.js (ele abre o navegador automaticamente assim que estiver pronto)
node src/server.js

if %errorlevel% neq 0 (
    echo.
    echo [AVISO] O servidor foi finalizado com erro (codigo: %errorlevel%).
    pause
)
