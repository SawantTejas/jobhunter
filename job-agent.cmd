@echo off
node "%~dp0scripts\run.cjs" %*
exit /b %errorlevel%
