import "./setup-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleHook } from "../src/island/hooks";
import { buildError, type ViewActions } from "../src/views/views";
import { State } from "../src/core/state";

describe("Terminal & Log Focus fixes", () => {
  beforeEach(() => {
    State.tasks = [];
    State.agentSessions = [];
    State.focusId = null;
    State.agentFocusId = null;
  });

  describe("Fix C: Hook payload terminal_hwnd & ancestor_pids update/stale clearing", () => {
    it("captures initial terminal_hwnd and ancestor_pids", () => {
      handleHook({} as any, {
        hook_event_name: "PreToolUse",
        session_id: "session-1",
        terminal_hwnd: 12345,
        ancestor_pids: [100, 200],
      });

      const session = State.agentSessions.find((s) => s.id === "session_session-1");
      expect(session).toBeDefined();
      expect(session!.terminalHwnd).toBe(12345);
      expect(session!.ancestorPids).toEqual([100, 200]);
    });

    it("clears stale terminal_hwnd and ancestor_pids when subsequent event lacks them", () => {
      // First event with hwnd and pids
      handleHook({} as any, {
        hook_event_name: "PreToolUse",
        session_id: "session-1",
        terminal_hwnd: 12345,
        ancestor_pids: [100, 200],
      });

      const session = State.agentSessions.find((s) => s.id === "session_session-1");
      expect(session!.terminalHwnd).toBe(12345);
      expect(session!.ancestorPids).toEqual([100, 200]);

      // Next event for the same session has no hwnd or pids (e.g. ConPTY or closed)
      handleHook({} as any, {
        hook_event_name: "PostToolUse",
        session_id: "session-1",
      });

      expect(session!.terminalHwnd).toBeUndefined();
      expect(session!.ancestorPids).toBeUndefined();
    });

    it("overwrites terminal_hwnd and ancestor_pids when new values arrive", () => {
      handleHook({} as any, {
        hook_event_name: "PreToolUse",
        session_id: "session-1",
        terminal_hwnd: 12345,
        ancestor_pids: [100, 200],
      });

      const session = State.agentSessions.find((s) => s.id === "session_session-1");

      handleHook({} as any, {
        hook_event_name: "PostToolUse",
        session_id: "session-1",
        terminal_hwnd: 54321,
        ancestor_pids: [300],
      });

      expect(session!.terminalHwnd).toBe(54321);
      expect(session!.ancestorPids).toEqual([300]);
    });

    it("treats terminal_hwnd = 0 and empty ancestor_pids as absent", () => {
      handleHook({} as any, {
        hook_event_name: "PreToolUse",
        session_id: "session-1",
        terminal_hwnd: 12345,
        ancestor_pids: [100, 200],
      });

      const session = State.agentSessions.find((s) => s.id === "session_session-1");

      handleHook({} as any, {
        hook_event_name: "PostToolUse",
        session_id: "session-1",
        terminal_hwnd: 0,
        ancestor_pids: [],
      });

      expect(session!.terminalHwnd).toBeUndefined();
      expect(session!.ancestorPids).toBeUndefined();
    });
  });

  describe("Fix D: Show log button session validation in buildError", () => {
    it("surfaces note and does not switch view when task is not in agentSessions", () => {
      const actions: ViewActions = {
        setView: vi.fn(),
        showNote: vi.fn(),
        collapse: vi.fn(),
        setFocus: vi.fn(),
        setAgentFocus: vi.fn(),
        openTerminal: vi.fn(),
        focusTerminal: vi.fn(),
        removeSession: vi.fn(),
        beginMove: vi.fn(),
        openTarget: vi.fn(),
        openUrl: vi.fn(),
        decide: vi.fn(),
        toggleSound: vi.fn(),
        setVolume: vi.fn(),
        setAutoClose: vi.fn(),
        openSettingsWindow: vi.fn(),
        blip: vi.fn(),
      };

      // Set up an integration task as the alertTask (no agent session exists)
      const integrationTask = {
        id: "integration_github",
        name: "GitHub",
        color: "blue",
        state: "error" as const,
        stepIndex: 0,
        steps: ["Failed to fetch PRs"],
        source: "integration" as const,
        isIntegration: true,
      };
      State.tasks = [integrationTask];

      const errorView = buildError(actions);
      errorView.sync();

      const actionsRow = (errorView.el as any).querySelector(".actions");
      const showLogBtn = actionsRow?.children[0];
      expect(showLogBtn).toBeDefined();

      showLogBtn.dispatchEvent({ type: "click" });

      expect(actions.showNote).toHaveBeenCalledWith("That session's log is no longer available.");
      expect(actions.setAgentFocus).not.toHaveBeenCalled();
      expect(actions.setView).not.toHaveBeenCalled();
    });

    it("sets agent focus and switches to agents view when task is present in agentSessions", () => {
      const actions: ViewActions = {
        setView: vi.fn(),
        showNote: vi.fn(),
        collapse: vi.fn(),
        setFocus: vi.fn(),
        setAgentFocus: vi.fn(),
        openTerminal: vi.fn(),
        focusTerminal: vi.fn(),
        removeSession: vi.fn(),
        beginMove: vi.fn(),
        openTarget: vi.fn(),
        openUrl: vi.fn(),
        decide: vi.fn(),
        toggleSound: vi.fn(),
        setVolume: vi.fn(),
        setAutoClose: vi.fn(),
        openSettingsWindow: vi.fn(),
        blip: vi.fn(),
      };

      const agentTask = {
        id: "session_my-session",
        name: "my-session",
        color: "purple",
        state: "error" as const,
        stepIndex: 0,
        steps: ["Error in session"],
        source: "claude" as const,
        isIntegration: false,
      };
      State.tasks = [agentTask];
      State.agentSessions = [agentTask];

      const errorView = buildError(actions);
      errorView.sync();

      const actionsRow = (errorView.el as any).querySelector(".actions");
      const showLogBtn = actionsRow?.children[0];
      expect(showLogBtn).toBeDefined();

      showLogBtn.dispatchEvent({ type: "click" });

      expect(actions.setAgentFocus).toHaveBeenCalledWith("session_my-session");
      expect(actions.setView).toHaveBeenCalledWith("agents");
      expect(actions.showNote).not.toHaveBeenCalled();
    });
  });
});
