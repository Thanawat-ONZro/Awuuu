@echo off
rem aw - run a coding agent with Awuuu watching it.
rem   aw                                                 a short menu: what is here, what to type
rem   aw <claude|agy|hermes|opencode|codex> [args...]    start Awuuu, check the agent's hook, run the agent
rem   aw status                                          which agents are here and connected
rem   aw doctor                                          status + open the setup check
rem   aw setup [agent]                                   open Awuuu to connect an agent
rem   aw dashboard                                       open the Awuuu window at Sessions
rem   aw settings                                        open the Awuuu window where you left it
rem   aw help                                            the long version
rem
rem Environment (all optional):
rem   AW_DRY_RUN=1   print what would be started instead of starting it
rem   AW_ASCII=1     plain + / x marks instead of the check marks
rem   AWUUU_EXE      another awuuu.exe than the installed one
setlocal EnableExtensions EnableDelayedExpansion

if not defined AWUUU_EXE set "AWUUU_EXE=%LOCALAPPDATA%\Awuuu\awuuu.exe"
set "FIND=%SystemRoot%\System32\find.exe"
set "FINDSTR=%SystemRoot%\System32\findstr.exe"
set "HH=%HERMES_HOME%"
if not defined HH set "HH=%LOCALAPPDATA%\hermes"
set "AGENTS=claude agy hermes opencode codex"
set "RC=0"

if "%~1"=="" goto menu
if /I "%~1"=="status" goto status
if /I "%~1"=="doctor" goto doctor
if /I "%~1"=="help" goto help
if "%~1"=="--help" goto help
if "%~1"=="-h" goto help
if "%~1"=="/?" goto help
if /I "%~1"=="setup" goto setup
if /I "%~1"=="dashboard" goto dashboard
if /I "%~1"=="settings" goto settings

set "AGENT=%~1"
shift
set "ARGS="
:args_loop
if "%~1"=="" goto run
set ARGS=!ARGS! "%~1"
shift
goto args_loop

:run
call :known "!AGENT!"
if errorlevel 1 (
  echo.
  echo  aw doesn't know "!AGENT!".
  echo  Agents: aw claude ^| agy ^| hermes ^| opencode ^| codex
  echo  Everything else: aw help
  echo.
  goto fail
)
call :present %AGENT%
if errorlevel 1 (
  call :install_hint %AGENT%
  goto fail
)
call :start_awuuu
call :hooked %AGENT%
if not errorlevel 1 goto launch
echo.
echo  Awuuu isn't connected to %AGENT% yet, so the island won't see this session.
if defined AW_DRY_RUN (
  echo  [dry-run] would ask: Set it up now in Awuuu? [Y/N]
  goto launch
)
choice /C YN /N /M "  Set it up now in Awuuu? [Y/N] "
if errorlevel 2 goto run_without
call :open_awuuu %AGENT%
if errorlevel 1 goto fail
echo  Awuuu is open at %AGENT%. Connect it there, then run: aw %AGENT%
goto end

:run_without
echo  Running %AGENT% without Awuuu. To connect it later: aw setup %AGENT%
echo.

:launch
set "CMD=%AGENT%"
where %AGENT% >nul 2>nul
if not errorlevel 1 goto launch_now
rem Installed, but its command is not on PATH.
if /I "%AGENT%"=="opencode" (
  call :spawn "%LOCALAPPDATA%\Programs\@opencode-aidesktop\OpenCode.exe"
  goto end
)
if /I "%AGENT%"=="agy" (
  set "CMD="%LOCALAPPDATA%\agy\bin\agy.exe""
  goto launch_now
)
echo.
echo  %AGENT% is installed, but its command isn't on PATH in this terminal.
echo  Open a new terminal and try again, or run it once by its full path.
echo.
goto fail

:launch_now
if defined AW_DRY_RUN (
  echo  [dry-run] would run: !CMD!!ARGS!
  goto end
)
!CMD! !ARGS!
set "RC=!errorlevel!"
goto end

rem -- aw, aw status ----------------------------------------------------------

:menu
call :marks_on
echo.
echo    /\_/\    aw - run a coding agent with Awuuu watching
echo   ( o.o )   approvals, questions and progress show in the island
echo    ^> ^^ ^<
call :print_status
echo  Commands
echo    aw ^<agent^> [args]    run an agent, e.g.  aw claude
echo    aw setup ^<agent^>     connect an agent to Awuuu
echo    aw dashboard         open the Awuuu window at Sessions
echo    aw settings          open the Awuuu window where you left it
echo    aw help              everything, with examples
echo.
call :marks_off
goto end

:status
call :marks_on
call :print_status
echo  Run one: aw ^<agent^>    Connect one: aw setup ^<agent^>    More: aw help
echo.
call :marks_off
goto end

:print_status
echo.
call :running
if not errorlevel 1 (
  echo  Awuuu      running
) else if exist "%AWUUU_EXE%" (
  echo  Awuuu      not running - aw ^<agent^> starts it
) else (
  echo  Awuuu      not installed - https://github.com/Thanawat-ONZro/Awuuu/releases/latest
)
echo.
echo  Agents
for %%A in (%AGENTS%) do call :status_one %%A
echo.
exit /b 0

:status_one
set "NAME=%~1          "
set "NAME=!NAME:~0,10!"
call :present %1
if errorlevel 1 (
  echo    !NA! !NAME! not installed
  exit /b 0
)
call :hooked %1
if errorlevel 1 (
  echo    !NO! !NAME! installed, not connected    fix: aw setup %1
) else (
  echo    !YES! !NAME! connected                   run: aw %1
)
exit /b 0

rem The check marks need UTF-8; the console goes back to its own code page after.
:marks_on
set "YES=+"
set "NO=x"
set "NA=-"
set "OLDCP="
if defined AW_ASCII exit /b 0
for /f "tokens=2 delims=:" %%C in ('chcp 2^>nul') do set "OLDCP=%%C"
if not defined OLDCP exit /b 0
set "OLDCP=!OLDCP: =!"
set "OLDCP=!OLDCP:.=!"
chcp 65001 >nul 2>nul
if errorlevel 1 (
  set "OLDCP="
  exit /b 0
)
set "YES=✓"
set "NO=✗"
exit /b 0

:marks_off
if defined OLDCP chcp !OLDCP! >nul 2>nul
exit /b 0

rem -- aw setup, aw dashboard, aw settings ------------------------------------

:setup
if not "%~2"=="" goto setup_one
call :open_awuuu agents
if errorlevel 1 goto fail
echo  Opened Awuuu at Agents. To go straight to one: aw setup claude ^| agy ^| hermes ^| opencode ^| codex
goto end

:setup_one
call :known "%~2"
if errorlevel 1 (
  echo.
  echo  aw can't set up "%~2".
  echo  Agents: aw setup claude ^| agy ^| hermes ^| opencode ^| codex
  echo.
  goto fail
)
call :open_awuuu %~2
if errorlevel 1 goto fail
echo  Opened Awuuu at %~2. Connect it there, then run: aw %~2
goto end

:dashboard
call :open_awuuu sessions
if errorlevel 1 goto fail
echo  Opened Awuuu at Sessions.
goto end

:doctor
call :marks_on
call :print_status
call :marks_off
call :open_awuuu about
if errorlevel 1 goto fail
echo  Opened Awuuu at About - click Check my setup for Hermes, git and PATH.
goto end

:settings
call :open_awuuu settings
if errorlevel 1 goto fail
echo  Opened the Awuuu window.
goto end

rem -- helpers (errorlevel 0 = yes) ------------------------------------------

:known
for %%A in (%AGENTS%) do if /I "%~1"=="%%A" exit /b 0
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
if /I "%~1"=="claude" (
  echo  Install it: npm install -g @anthropic-ai/claude-code
  echo  More: https://docs.claude.com/claude-code
)
if /I "%~1"=="agy" echo  Get it: https://antigravity.google
if /I "%~1"=="hermes" echo  Get it: https://hermes-agent.nousresearch.com
if /I "%~1"=="opencode" (
  echo  Install it: npm install -g opencode-ai
  echo  More: https://opencode.ai
)
if /I "%~1"=="codex" (
  echo  Install it: npm install -g @openai/codex
  echo  More: https://developers.openai.com/codex/cli
)
echo  Then, in a new terminal: aw setup %~1   and   aw %~1
echo.
exit /b 0

:running
tasklist /FI "IMAGENAME eq awuuu.exe" 2>nul | "%FIND%" /I "awuuu.exe" >nul
exit /b %errorlevel%

:start_awuuu
call :running
if not errorlevel 1 exit /b 0
if exist "%AWUUU_EXE%" (
  call :spawn "%AWUUU_EXE%"
) else (
  echo  Awuuu isn't installed, so the agent runs without the island.
  echo  Get it: https://github.com/Thanawat-ONZro/Awuuu/releases/latest
)
exit /b 0

rem Opens the Awuuu window at a page or an agent (a running Awuuu takes it over).
:open_awuuu
if not exist "%AWUUU_EXE%" (
  echo.
  echo  Awuuu isn't installed - nothing at !AWUUU_EXE!
  echo  Get it: https://github.com/Thanawat-ONZro/Awuuu/releases/latest
  echo.
  exit /b 1
)
call :spawn "%AWUUU_EXE%" --settings=%~1
exit /b 0

:spawn
if defined AW_DRY_RUN (
  echo  [dry-run] would start: %*
) else (
  start "" %*
)
exit /b 0

:help
echo.
echo    /\_/\    aw - run a coding agent with Awuuu watching
echo   ( o.o )
echo    ^> ^^ ^<
echo.
echo  Run an agent
echo    aw claude    [args]   Claude Code
echo    aw agy       [args]   Antigravity CLI
echo    aw hermes    [args]   Hermes Agent
echo    aw opencode  [args]   OpenCode
echo    aw codex     [args]   Codex CLI
echo.
echo  Look and set up
echo    aw                    a short menu: what is here, what to type
echo    aw status             which agents are here and connected to Awuuu
echo    aw doctor             the same, then Awuuu's full setup check
echo    aw setup ^<agent^>      open Awuuu to connect that agent
echo    aw dashboard          open the Awuuu window at Sessions
echo    aw settings           open the Awuuu window where you left it
echo.
echo  Examples
echo    aw claude                     start Claude Code in this folder
echo    aw claude --resume            anything after the agent goes to the agent
echo    aw setup codex                connect Codex CLI, then: aw codex
echo.
echo  aw starts Awuuu if it isn't running and checks the agent's hook (offering
echo  to set it up), then runs the agent. Approvals, questions and progress then
echo  show in the island.
echo.
goto end

:fail
set "RC=1"
:end
endlocal & exit /b %RC%
