@echo off
rem aw - run a coding agent with Awuuu watching it.
rem   aw claude | agy | hermes | opencode [args...]   start Awuuu if needed, check its hooks, run the agent
rem   aw setup <agent>                                 open Awuuu's Settings at that agent
setlocal EnableExtensions

set "AWUUU_EXE=%LOCALAPPDATA%\Awuuu\awuuu.exe"

if "%~1"=="" goto help
if /I "%~1"=="help" goto help
if "%~1"=="--help" goto help
if "%~1"=="-h" goto help
if /I "%~1"=="setup" goto setup

set "AGENT=%~1"
shift
set "ARGS="
:args_loop
if "%~1"=="" goto start_awuuu
set ARGS=%ARGS% "%~1"
shift
goto args_loop

:start_awuuu
tasklist /FI "IMAGENAME eq awuuu.exe" 2>nul | find /I "awuuu.exe" >nul
if errorlevel 1 (
  if exist "%AWUUU_EXE%" (
    start "" "%AWUUU_EXE%"
  ) else (
    echo  Awuuu is not installed in %LOCALAPPDATA%\Awuuu - the agent runs without the island.
  )
)

call :check_hooks %AGENT%

if /I "%AGENT%"=="opencode" (
  rem OpenCode is the desktop app on this machine when there is no CLI.
  where opencode >nul 2>nul
  if errorlevel 1 (
    if exist "%LOCALAPPDATA%\Programs\@opencode-aidesktop\OpenCode.exe" (
      start "" "%LOCALAPPDATA%\Programs\@opencode-aidesktop\OpenCode.exe"
      goto end
    )
  )
)
%AGENT% %ARGS%
goto end

:check_hooks
set "MISSING="
if /I "%~1"=="claude" (
  findstr /C:"awuuu-hook" "%USERPROFILE%\.claude\settings.json" >nul 2>nul || set "MISSING=1"
)
if /I "%~1"=="agy" (
  findstr /C:"awuuu-hook" "%USERPROFILE%\.gemini\config\hooks.json" >nul 2>nul || set "MISSING=1"
)
if /I "%~1"=="hermes" (
  set "HH=%HERMES_HOME%"
  if not defined HH set "HH=%LOCALAPPDATA%\hermes"
  call findstr /C:">>> awuuu >>>" "%%HH%%\config.yaml" >nul 2>nul || set "MISSING=1"
)
if /I "%~1"=="opencode" (
  if not exist "%USERPROFILE%\.config\opencode\plugin\awuuu.js" set "MISSING=1"
)
if defined MISSING (
  echo.
  echo  Awuuu isn't hooked into %~1 yet, so the island won't see this session.
  echo  Run:  aw setup %~1
  echo.
)
exit /b 0

:setup
if "%~2"=="" (
  echo  Usage: aw setup ^<claude^|agy^|hermes^|opencode^>
  goto end
)
if not exist "%AWUUU_EXE%" (
  echo  Awuuu is not installed in %LOCALAPPDATA%\Awuuu.
  goto end
)
start "" "%AWUUU_EXE%" --settings=%~2
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
echo    aw setup ^<agent^>      open Awuuu's Settings to install that agent's hooks
echo.
echo  aw starts Awuuu if it isn't running and tells you when the agent's hooks
echo  are missing; approvals, questions and progress then show in the island.
echo.
:end
endlocal
