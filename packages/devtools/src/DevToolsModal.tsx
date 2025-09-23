"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DevToolsHooks } from "./DevToolsHooks";

declare const process: {
  env?: Record<string, string | undefined>;
};

const MESSAGE_NAMESPACE = "assistant-ui-devtools";
const DEFAULT_FRAME_URL = "https://devtools-frame.assistant-ui.com";
const LOCAL_FRAME_URL = "http://localhost:3010";
const IGNORED_API_KEYS = new Set([
  "registerModelContextProvider",
  "on",
  "subscribe",
]);

type SerializedEventLog = {
  time: string;
  event: string;
  data: unknown;
};

type ApiSnapshot = {
  id: number;
  state: Record<string, unknown>;
  logs: SerializedEventLog[];
  modelContext?: Record<string, unknown>;
};

const isDarkMode = (): boolean => {
  if (typeof document === "undefined") return false;
  return (
    document.documentElement.classList.contains("dark") ||
    document.body.classList.contains("dark")
  );
};

const resolveFrameUrl = (): string => {
  if (typeof window !== "undefined") {
    const override = (window as any).__ASSISTANT_UI_DEVTOOLS_FRAME_URL__;
    if (typeof override === "string" && override.length > 0) {
      return override;
    }

    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
      return LOCAL_FRAME_URL;
    }
  }

  const envOverride =
    typeof process !== "undefined"
      ? process.env?.NEXT_PUBLIC_ASSISTANT_UI_DEVTOOLS_FRAME_URL
      : undefined;
  if (envOverride) {
    return envOverride;
  }

  return DEFAULT_FRAME_URL;
};

const sanitizeForMessage = (value: unknown, seen = new WeakSet()): unknown => {
  if (value === null || typeof value === "undefined") return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "function") {
    return "[Function]";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Map) {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of value.entries()) {
      result[String(key)] = sanitizeForMessage(entry, seen);
    }
    return result;
  }
  if (value instanceof Set) {
    return Array.from(value).map((entry) => sanitizeForMessage(entry, seen));
  }
  if (Array.isArray(value)) {
    if (seen.has(value as unknown as object)) return "[Circular]";
    seen.add(value as unknown as object);
    return value
      .map((entry) => sanitizeForMessage(entry, seen))
      .filter((item) => item !== undefined);
  }
  if (typeof value === "object") {
    if (seen.has(value as object)) return "[Circular]";
    seen.add(value as object);
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = sanitizeForMessage(entry, seen);
    }
    return result;
  }
  return value;
};

const serializeModelContext = (context: unknown) => {
  const sanitized = sanitizeForMessage(context);
  return sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)
    ? (sanitized as Record<string, unknown>)
    : undefined;
};

const collectSnapshots = (devTools: DevToolsHooks): ApiSnapshot[] => {
  const snapshots: ApiSnapshot[] = [];

  for (const [id, api] of devTools.getApis()) {
    const state: Record<string, unknown> = {};

    if (api) {
      for (const [name, scope] of Object.entries(api)) {
        if (IGNORED_API_KEYS.has(name)) continue;

        if (typeof scope === "function") {
          try {
            const scopeState = scope();
            if (scopeState && typeof scopeState.getState === "function") {
              state[name] = sanitizeForMessage(scopeState.getState());
            }
          } catch (error) {
            state[name] = { error: String(error) };
          }
        }
      }
    }

    let modelContext: Record<string, unknown> | undefined;
    const runtimeGetter = (api as any)?.__internal_getRuntime;
    if (typeof runtimeGetter === "function") {
      try {
        const runtime = runtimeGetter();
        const threadRuntime = runtime?.thread;
        if (threadRuntime && typeof threadRuntime.getModelContext === "function") {
          modelContext = serializeModelContext(threadRuntime.getModelContext());
        }
      } catch (error) {
        console.error("Error getting model context:", error);
      }
    }

    const logs = devTools.getEventLogs(id).map<SerializedEventLog>((log) => ({
      event: log.event,
      data: sanitizeForMessage(log.data),
      time: log.time.toISOString(),
    }));

    snapshots.push({
      id,
      state,
      logs,
      modelContext,
    });
  }

  return snapshots;
};

export const DevToolsModal = () => {
  const devTools = useMemo(() => DevToolsHooks.getInstance(), []);

  const [isOpen, setIsOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(isDarkMode());
  const [buttonHover, setButtonHover] = useState(false);
  const [closeHover, setCloseHover] = useState(false);
  const [eventCount, setEventCount] = useState(0);
  const [bridgeReady, setBridgeReady] = useState(false);

  const frameUrl = useMemo(() => resolveFrameUrl(), []);
  const frameOrigin = useMemo(() => {
    if (typeof window === "undefined") {
      try {
        return new URL(frameUrl).origin;
      } catch {
        return DEFAULT_FRAME_URL;
      }
    }

    try {
      return new URL(frameUrl, window.location.href).origin;
    } catch {
      return DEFAULT_FRAME_URL;
    }
  }, [frameUrl]);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const frameWindowRef = useRef<Window | null>(null);
  const frameOriginRef = useRef(frameOrigin);
  const bridgeReadyRef = useRef(false);
  const autoRefreshRef = useRef(true);

  const styles = useMemo(() => getStyles(darkMode), [darkMode]);

  useEffect(() => {
    frameOriginRef.current = frameOrigin;
  }, [frameOrigin]);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const styleId = "devtools-modal-animations";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translate(-50%, -48%) scale(0.95);
          }
          to {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1);
          }
        }
      `;
      document.head.appendChild(style);
    }

    return () => {
      const style = document.getElementById(styleId);
      if (style && !document.querySelector("[data-devtools-modal]")) {
        style.remove();
      }
    };
  }, []);

  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;

    const checkDarkMode = () => setDarkMode(isDarkMode());
    const observer = new MutationObserver(checkDarkMode);

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    if (document.body !== document.documentElement) {
      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ["class"],
      });
    }

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const unsubscribe = devTools.subscribeToAllEvents(() => {
      let totalCount = 0;
      for (const [, logs] of devTools.getAllEventLogs()) {
        totalCount += logs.length;
      }
      setEventCount(totalCount);
    });

    return unsubscribe;
  }, [devTools]);

  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen]);

  const collectData = useCallback(() => collectSnapshots(devTools), [devTools]);

  const postMessageToFrame = useCallback(
    (type: string, payload?: unknown, requireReady = true) => {
      const frameWindow = frameWindowRef.current;
      const origin = frameOriginRef.current;
      if (!frameWindow || !origin) return;
      if (requireReady && !bridgeReadyRef.current) return;

      frameWindow.postMessage(
        {
          namespace: MESSAGE_NAMESPACE,
          type,
          payload,
        },
        origin,
      );
    },
    [],
  );

  const sendSnapshot = useCallback(() => {
    postMessageToFrame("devtools:data", collectData(), true);
  }, [collectData, postMessageToFrame]);

  const sendAutoRefresh = useCallback(() => {
    postMessageToFrame("devtools:auto-refresh", autoRefreshRef.current, false);
  }, [postMessageToFrame]);

  const handleFrameLoad = useCallback(() => {
    frameWindowRef.current = iframeRef.current?.contentWindow ?? null;
    bridgeReadyRef.current = false;
    setBridgeReady(false);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      frameWindowRef.current = null;
      bridgeReadyRef.current = false;
      setBridgeReady(false);
      return;
    }

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.namespace !== MESSAGE_NAMESPACE) return;

      if (event.source && event.source !== frameWindowRef.current) {
        frameWindowRef.current = event.source as Window;
      }

      switch (event.data.type) {
        case "devtools:frame-ready": {
          frameOriginRef.current = event.origin;
          bridgeReadyRef.current = true;
          setBridgeReady(true);
          autoRefreshRef.current = true;
          sendAutoRefresh();
          sendSnapshot();
          break;
        }
        case "devtools:ready": {
          bridgeReadyRef.current = true;
          setBridgeReady(true);
          sendAutoRefresh();
          sendSnapshot();
          break;
        }
        case "devtools:set-auto-refresh": {
          autoRefreshRef.current = Boolean(event.data.payload);
          sendAutoRefresh();
          if (autoRefreshRef.current) {
            sendSnapshot();
          }
          break;
        }
        case "devtools:request-refresh": {
          sendSnapshot();
          break;
        }
        case "devtools:clear-events": {
          devTools.clearAllEventLogs();
          sendSnapshot();
          break;
        }
        default:
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
      bridgeReadyRef.current = false;
      setBridgeReady(false);
    };
  }, [isOpen, sendAutoRefresh, sendSnapshot]);

  useEffect(() => {
    if (!isOpen) return;

    const unsubscribeApis = devTools.subscribe(() => {
      if (!autoRefreshRef.current) return;
      sendSnapshot();
    });

    const unsubscribeEvents = devTools.subscribeToAllEvents(() => {
      if (!autoRefreshRef.current) return;
      sendSnapshot();
    });

    if (bridgeReadyRef.current && autoRefreshRef.current) {
      sendSnapshot();
    }

    return () => {
      unsubscribeApis();
      unsubscribeEvents();
    };
  }, [devTools, isOpen, sendSnapshot]);

  useEffect(() => {
    if (isOpen && bridgeReady) {
      sendSnapshot();
    }
  }, [isOpen, bridgeReady, sendSnapshot]);

  return (
    <>
      <div style={styles.floatingContainer}>
        <button
          onClick={() => setIsOpen(true)}
          onMouseEnter={() => setButtonHover(true)}
          onMouseLeave={() => setButtonHover(false)}
          style={{
            ...styles.floatingButton,
            ...(buttonHover ? styles.floatingButtonHover : {}),
          }}
          aria-label="Open assistant-ui DevTools"
          title="Open assistant-ui DevTools"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={{ width: "100%", height: "100%" }}
          >
            <path
              d="M7 8L3 12L7 16"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M17 8L21 12L17 16"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M14 4L10 20"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        {eventCount > 0 && !isOpen && (
          <div style={styles.badge}>{eventCount > 99 ? "99+" : eventCount}</div>
        )}
      </div>

      {isOpen && (
        <>
          <div style={styles.backdrop} onClick={() => setIsOpen(false)} />

          <div style={styles.modal} data-devtools-modal>
            <div style={styles.modalHeader}>
              <h2 style={styles.modalTitle}>assistant-ui DevTools</h2>
              <button
                onClick={() => setIsOpen(false)}
                onMouseEnter={() => setCloseHover(true)}
                onMouseLeave={() => setCloseHover(false)}
                style={{
                  ...styles.closeButton,
                  ...(closeHover ? styles.closeButtonHover : {}),
                }}
                aria-label="Close DevTools"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M18 6L6 18"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M6 6L18 18"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>

            <div style={styles.modalContent}>
              <iframe
                ref={iframeRef}
                src={frameUrl}
                onLoad={handleFrameLoad}
                title="assistant-ui DevTools"
                style={{
                  width: "100%",
                  height: "100%",
                  border: "none",
                  borderRadius: "12px",
                  backgroundColor: "transparent",
                }}
              />
            </div>
          </div>
        </>
      )}
    </>
  );
};

interface Styles {
  floatingContainer: React.CSSProperties;
  floatingButton: React.CSSProperties;
  badge: React.CSSProperties;
  floatingButtonHover: React.CSSProperties;
  backdrop: React.CSSProperties;
  modal: React.CSSProperties;
  modalHeader: React.CSSProperties;
  modalTitle: React.CSSProperties;
  closeButton: React.CSSProperties;
  closeButtonHover: React.CSSProperties;
  modalContent: React.CSSProperties;
}

const getStyles = (darkMode: boolean): Styles => ({
  floatingContainer: {
    position: "fixed",
    bottom: "24px",
    right: "24px",
    zIndex: 2147483647,
  },
  floatingButton: {
    width: "48px",
    height: "48px",
    borderRadius: "9999px",
    border: "none",
    background: darkMode ? "#111827" : "#2563EB",
    color: darkMode ? "#e5e7eb" : "#f9fafb",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: darkMode
      ? "0 10px 40px rgba(0, 0, 0, 0.4)"
      : "0 10px 40px rgba(37, 99, 235, 0.35)",
    transition: "transform 0.2s ease, box-shadow 0.2s ease",
  },
  badge: {
    position: "absolute",
    top: "-6px",
    right: "-6px",
    background: "#EF4444",
    color: "#ffffff",
    borderRadius: "9999px",
    padding: "2px 6px",
    fontSize: "10px",
    fontWeight: 600,
    boxShadow: "0 4px 12px rgba(239, 68, 68, 0.4)",
  },
  floatingButtonHover: {
    transform: "translateY(-2px)",
    boxShadow: darkMode
      ? "0 16px 50px rgba(17, 24, 39, 0.55)"
      : "0 16px 50px rgba(37, 99, 235, 0.45)",
  },
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(15, 23, 42, 0.45)",
    backdropFilter: "blur(6px)",
    animation: "fadeIn 0.12s ease",
    zIndex: 2147483646,
  },
  modal: {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: "min(960px, 90vw)",
    height: "min(720px, 85vh)",
    background: darkMode ? "#09090b" : "#f8fafc",
    borderRadius: "16px",
    border: darkMode ? "1px solid rgba(63, 63, 70, 0.6)" : "1px solid rgba(148, 163, 184, 0.35)",
    boxShadow: darkMode
      ? "0 32px 120px rgba(0, 0, 0, 0.55)"
      : "0 32px 120px rgba(15, 23, 42, 0.35)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    animation: "slideIn 0.16s ease",
    zIndex: 2147483647,
  },
  modalHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 20px",
    borderBottom: darkMode ? "1px solid #27272a" : "1px solid #e2e8f0",
    background: darkMode ? "#111827" : "#f8fafc",
  },
  modalTitle: {
    margin: 0,
    fontSize: "14px",
    fontWeight: 600,
    color: darkMode ? "#e5e5e5" : "#1a1a1a",
    textTransform: "uppercase",
    letterSpacing: "0.2em",
    fontFamily:
      'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace',
  },
  closeButton: {
    background: "transparent",
    border: "none",
    color: darkMode ? "#a3a3a3" : "#737373",
    cursor: "pointer",
    padding: "4px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "4px",
    transition: "background 0.2s",
  },
  closeButtonHover: {
    background: darkMode ? "#262626" : "#e5e5e5",
  },
  modalContent: {
    flex: 1,
    overflow: "hidden",
    position: "relative",
    background: darkMode ? "#09090b" : "#f8fafc",
  },
});
