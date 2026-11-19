@echo off
chcp 65001 >nul
title Prova assistente IA di Leggio
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0prova.ps1" %*
echo.
echo Premi un tasto per chiudere questa finestra.
pause >nul
