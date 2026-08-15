@echo off
title Bot Santuario Santa Rita

REM Usa pushd em vez de cd /d: o cmd.exe nao aceita caminho de rede (UNC,
REM tipo \\wsl.localhost\...) como pasta atual e cairia silenciosamente em
REM C:\Windows, fazendo o .env "sumir". pushd mapeia o UNC numa letra de
REM drive temporaria e resolve isso.
pushd "%~dp0"

if not exist ".env" (
    echo.
    echo ERRO: arquivo .env nao encontrado.
    echo Copie o .env.example para .env e preencha os valores.
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo Instalando dependencias pela primeira vez...
    call npm install
    if errorlevel 1 (
        echo.
        echo ERRO: falha ao instalar as dependencias.
        pause
        exit /b 1
    )
)

echo Rodando os testes automatizados...
call npm test
if errorlevel 1 (
    echo.
    echo ERRO: os testes falharam. O bot NAO sera iniciado.
    echo Corrija o problema indicado acima antes de tentar novamente.
    echo.
    pause
    exit /b 1
)

echo Iniciando o sistema de atendimento...
REM Usa "npx pm2" em vez de "pm2" direto: o atalho pm2.cmd que o npm cria
REM as vezes nao e reconhecido pelo cmd.exe (bug conhecido do shim em
REM instalacoes do Windows fora do ingles). npx acha o pm2 ja instalado
REM sem essa dependencia do PATH.
call npx pm2 start ecosystem.config.js
if errorlevel 1 (
    echo.
    echo ERRO ao iniciar pelo pm2. Verifique se o pm2 esta instalado:
    echo   npm install -g pm2
    pause
    exit /b 1
)

echo.
echo Bot rodando em segundo plano.
echo Para ver o QR Code ou os logs:  npx pm2 logs mitra_bot
echo Para parar:                     npx pm2 stop mitra_bot
popd
pause
