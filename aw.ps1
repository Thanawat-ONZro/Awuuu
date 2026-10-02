<#
.SYNOPSIS
    Awuuu CLI Companion Wrapper for PowerShell
.DESCRIPTION
    Wraps AI coding agents (Claude Code, Codex CLI, Antigravity CLI, Hermes Agent, OpenCode)
    to synchronize permissions, approvals, and status with the Awuuu Dynamic Island.
#>

param(
    [Parameter(Position=0)]
    [string]$Agent,
    [Parameter(ValueFromRemainingArguments=$true)]
    [string[]]$RemainingArgs
)

if ([string]::IsNullOrWhiteSpace($Agent) -or $Agent -in @("help", "--help", "-h", "/?")) {
    Write-Host @"

  /\_/\    Awuuu CLI Companion Wrapper
 ( o.o )   Unified AI Coding Island for Windows
  > ^ <    Claude Code | Codex CLI | AGY | Hermes | OpenCode

Usage:
  aw <agent> [args...]

Supported Agents:
  aw claude     Launch Claude Code session
  aw codex      Launch Codex CLI session
  aw agy        Launch Antigravity CLI (AGY) session
  aw hermes     Launch Hermes Agent session
  aw opencode   Launch OpenCode session

Active sessions automatically connect to the Awuuu Dynamic Island
for 1-click approvals, status indicators, and permission queues!

"@ -ForegroundColor Cyan
    exit 0
}

$env:AWUUU_ACTIVE = "1"
$env:AWUUU_SESSION_ORIGIN = "aw-cli"

$cmd = Get-Command $Agent -ErrorAction SilentlyContinue

if ($null -eq $cmd) {
    switch ($Agent.ToLower()) {
        "claude"   { & claude @RemainingArgs }
        "codex"    { & codex @RemainingArgs }
        "agy"      { & agy @RemainingArgs }
        "hermes"   { & hermes @RemainingArgs }
        "opencode" { & opencode @RemainingArgs }
        default {
            Write-Error "Command or agent '$Agent' not found on PATH."
            exit 1
        }
    }
} else {
    & $Agent @RemainingArgs
}
