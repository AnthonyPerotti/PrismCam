@echo off
setlocal EnableDelayedExpansion
title PrismCam - Controle PTZ e OBS

echo.
echo  =============================================================
echo        PrismCam - Controle PTZ e Captura de Cameras IP
echo  =============================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERRO] Node.js nao foi encontrado no sistema!
    echo Por favor, instale o Node.js em: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

cd /d "%~dp0"

if not exist "node_modules" (
    echo [INFO] Instalando dependencias do projeto...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERRO] Falha ao instalar dependencias do npm.
        pause
        exit /b 1
    )
)

echo [INFO] Iniciando o servidor PrismCam...
echo [INFO] Painel Web: http://localhost:4000
echo.

call npm start

if %errorlevel% neq 0 (
    echo.
    echo [AVISO] O processo foi finalizado com erro.
    pause
)
