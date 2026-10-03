@echo off
rem aw - run a coding agent with Awuuu watching it.
rem   aw <claude|agy|hermes|opencode|codex> [args...]   start Awuuu, check the agent's hook, run the agent
rem   aw status                                          which agents are here and connected
rem   aw setup <agent>                                   open Awuuu's Settings at that agent
setlocal EnableExtensions EnableDelayedExpansion

set "AWUUU_EXE=%LOCALAPPDATA%\Awuuu\awuuu.exe"
set "FIND=%SystemRoot%\System32\find.exe"
set "FINDSTR=%SystemRoot%\System32\findstr.exe"
set "HH=%HERMES_HOME%"
if not defined HH set "HH=%LOCALAPPDATA%\hermes"

if "%~1"=="" goto status
if /I "%~1"=="status" goto status
if /I "%~1"=="help" goto help
if "%~1"=="--help" goto help
if "%~1"=="-h" goto help
if /I "%~1"=="setup" goto setup

set "AGENT=%~1"
shift
set "ARGS="
:args_loop
if "%~1"=="" goto run
set ARGS=!ARGS! "%~1"
shift
goto args_loop

:run
call :known %AGENT%
if errorlevel 1 (
  echo  aw doesn't know "%AGENT%". Try: aw claude ^| agy ^| hermes ^| opencode ^| codex
  goto end
)
call :start_awuuu
call :present %AGENT%
if errorlevel 1 (
  call :install_hint %AGENT%
  goto end
)
call :hooked %AGENT%
if errorlevel 1 (
  echo.
  echo  Awuuu isn't connected to %AGENT% yet, so the island won't see this session.
  choice /C YN /N /M "  Set it up now in Awuuu's Settings? [Y/N] "
  if not errorlevel 2 (
    if exist "%AWUUU_EXE%" start "" "%AWUUU_EXE%" --settings=%AGENT%
    echo  Install the hook there, then run: aw %AGENT%
    goto end
  )
  echo  Running %AGENT% without Awuuu.
  echo.
)
if /I "%AGENT%"=="opencode" (
  where opencode >nul 2>nul
  if errorlevel 1 (
    start "" "%LOCALAPPDATA%\Programs\@opencode-aidesktop\OpenCode.exe"
    goto end
  )
)
%AGENT% !ARGS!
goto end

:status
echo.
echo  Awuuu
tasklist /FI "IMAGENAME eq awuuu.exe" 2>nul | "%FIND%" /I "awuuu.exe" >nul
if errorlevel 1 (echo    not running) else (echo    running)
echo.
echo  Agents
for %%A in (claude agy hermes opencode codex) do call :status_one %%A
echo.
echo  aw ^<agent^> runs one; aw setup ^<agent^> connects it.
echo.
goto end

:status_one
call :present %1
if errorlevel 1 (
  echo    %1	- not installed on this PC
  exit /b 0
)
call :hooked %1
if errorlevel 1 (echo    %1	- installed, not connected   ^(aw setup %1^)) else (echo    %1	- connected)
exit /b 0

rem -- helpers (errorlevel 0 = yes) ------------------------------------------

:known
for %%A in (claude agy hermes opencode codex) do if /I "%~1"=="%%A" exit /b 0
exit /b 1

:present
if /I "%~1"=="agy" if exist "%LOCALAPPDATA%\agy\bin\agy.exe" exit /b 0
if /I "%~1"=="hermes" if exist "%HH%\config.yaml" exit /b 0
if /I "%~1"=="opencode" if exist "%LOCALAPPDATA%\Programs\@opencode-aidesktop\OpenCode.exe" exit /b 0
where %~1 >nul 2>nul
exit /b %errorlevel%

:hooked
set "HF="
set "PAT=awuuu-hook"
if /I "%~1"=="claude" set "HF=%USERPROFILE%\.claude\settings.json"
if /I "%~1"=="agy" set "HF=%USERPROFILE%\.gemini\config\hooks.json"
if /I "%~1"=="codex" set "HF=%USERPROFILE%\.codex\hooks.json"
if /I "%~1"=="hermes" (
  set "HF=%HH%\config.yaml"
  set "PAT=>>> awuuu >>>"
)
if /I "%~1"=="opencode" (
  if exist "%USERPROFILE%\.config\opencode\plugin\awuuu.js" exit /b 0
  exit /b 1
)
if not defined HF exit /b 1
if not exist "!HF!" exit /b 1
"%FINDSTR%" /L /C:"!PAT!" "!HF!" >nul 2>nul
exit /b %errorlevel%

:install_hint
echo.
echo  %~1 isn't installed on this PC.
if /I "%~1"=="claude" echo  Get it: https://docs.claude.com/claude-code
if /I "%~1"=="agy" echo  Get it: https://antigravity.google
if /I "%~1"=="hermes" echo  Get it: https://hermes-agent.nousresearch.com
if /I "%~1"=="opencode" echo  Get it: https://opencode.ai
if /I "%~1"=="codex" echo  Get it: https://developers.openai.com/codex/cli
echo.
exit /b 0

:start_awuuu
tasklist /FI "IMAGENAME eq awuuu.exe" 2>nul | "%FIND%" /I "awuuu.exe" >nul
if errorlevel 1 (
  if exist "%AWUUU_EXE%" (
    start "" "%AWUUU_EXE%"
  ) else (
    echo  Awuuu is not installed in %LOCALAPPDATA%\Awuuu - the agent runs without the island.
  )
)
exit /b 0

:setup
if "%~2"=="" (
  echo  Usage: aw setup ^<claude^|agy^|hermes^|opencode^|codex^>
  goto end
)
if not exist "%AWUUU_EXE%" (
  echo  Awuuu is not installed in %LOCALAPPDATA%\Awuuu.
  goto end
)
start "" "%AWUUU_EXE%" --settings=%~2
echo  Opened Awuuu's Settings at %~2.
goto end

:help
echo.
echo    /\_/\    aw - run a coding agent with Awuuu watching
echo   ( o.o )
echo    ^> ^^ ^<
echo.
echo  Usage:
echo    aw claude    [args]   Claude Code
echo    aw agy       [args]   Antigravity CLI
echo    aw hermes    [args]   Hermes Agent
echo    aw opencode  [args]   OpenCode
echo    aw codex     [args]   Codex CLI
echo    aw status             which agents are here and connected to Awuuu
echo    aw setup ^<agent^>      open Awuuu's Settings to connect that agent
echo.
echo  aw starts Awuuu if it isn't running and checks the agent's hook (offering
echo  to set it up), then runs the agent. Approvals, questions and progress then
echo  show in the island.
echo.
:end
endlocal
