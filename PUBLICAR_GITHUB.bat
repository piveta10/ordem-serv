@echo off
chcp 65001 > nul
title Publicar Projeto no GitHub - Piveta Pinturas

echo ========================================================
echo    PIVETA PINTURAS - PUBLICACAO NO GITHUB & PAGES
echo ========================================================
echo.

where git >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [AVISO] O Git nao foi encontrado no seu computador!
    echo.
    echo Voce pode fazer o upload diretamente pelo navegador:
    echo 1. Acesse: https://github.com/new
    echo 2. Crie o repositorio (ex: piveta-os-tintas)
    echo 3. Clique em "uploading an existing file"
    echo 4. Arraste TODOS os arquivos e pastas (inclusive api, lib e package.json)!
    echo.
    echo Ou baixe o Git em: https://git-scm.com/download/win
    echo.
    pause
    exit /b
)

echo Inicializando repositorio Git...
git init
git add .
git commit -m "Sistema Piveta v2.1 - painel de producao e correcoes de seguranca"
git branch -M main

echo.
echo Digite ou cole a URL do seu repositorio no GitHub
echo Exemplo: https://github.com/seu-usuario/piveta-os-tintas.git
echo.
set /p REPO_URL="URL do Repositorio: "

if "%REPO_URL%"=="" (
    echo Nenhuma URL informada. Operacao cancelada.
    pause
    exit /b
)

git remote remove origin 2>nul
git remote add origin %REPO_URL%
echo.
echo Enviando arquivos para o GitHub...
git push -u origin main

echo.
echo ========================================================
echo   PROJETO ENVIADO COM SUCESSO!
echo ========================================================
echo.
echo O site da Vercel (ordem-servico-sigma.vercel.app) atualiza sozinho em 1 a 2 minutos.
echo Lembre: as pastas "api" e "lib" e o arquivo "package.json" precisam ir juntos.
echo Banco de dados: veja o passo a passo no README.md.
echo.
pause
