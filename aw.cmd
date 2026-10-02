@echo off
setlocal

if "%~1"=="" goto help
if "%~1"=="help" goto help
if "%~1"=="--help" goto help
if "%~1"=="-h" goto help

set AGENT_CMD=%~1
shift

set ARGS=
:args_loop
if "%~1"=="" goto run
set ARGS=%ARGS% "%~1"
shift
goto args_loop

:run
set AWUUU_ACTIVE=1
set AWUUU_SESSION_ORIGIN=aw-cli

if /I "%AGENT_CMD%"=="claude" goto run_claude
if /I "%AGENT_CMD%"=="codex" goto run_codex
if /I "%AGENT_CMD%"=="agy" goto run_agy
if /I "%AGENT_CMD%"=="hermes" goto run_hermes
if /I "%AGENT_CMD%"=="opencode" goto run_opencode

%AGENT_CMD% %ARGS%
goto end

:run_claude
claude %ARGS%
goto end

:run_codex
codex %ARGS%
goto end

:run_agy
agy %ARGS%
goto end

:run_hermes
hermes %ARGS%
goto end

:run_opencode
opencode %ARGS%
goto end

:help
echo.
echo    /\_/\    Awuuu CLI Companion Wrapper
echo   ( o.o )   Unified AI Coding Island for Windows
echo    ^> ^^^<    Claude Code ^| Codex CLI ^| AGY ^| Hermes ^| OpenCode
echo.
echo  Usage:
echo    aw ^<agent^> [args...]
echo.
echo  Supported Agents:
echo    aw claude     Launch Claude Code session
echo    aw codex      Launch Codex CLI session
echo    aw agy        Launch Antigravity CLI (AGY) session
echo    aw hermes     Launch Hermes Agent session
echo    aw opencode   Launch OpenCode session
echo.
echo  Active sessions automatically connect to the Awuuu Dynamic Island
echo  for 1-click approvals, status indicators, and permission queues!
echo.
:end
endlocal
