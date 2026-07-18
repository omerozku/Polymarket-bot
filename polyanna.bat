@echo off
title Polyanna - Polymarket Bot
cd /d "%~dp0"
echo ============================================
echo   POLYANNA - Polymarket Trading Bot
echo   Dashboard: http://localhost:3001
echo   Durdurmak icin Ctrl+C
echo ============================================
echo.
npx tsx bot-with-dashboard.ts
pause
