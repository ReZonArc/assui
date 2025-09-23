import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";

declare const process: {
  env: Record<string, string | undefined>;
};

interface HostBridge {
  sendToChild: (type: string, payload?: unknown) => void;
  subscribeToChild: (
    type: string,
    handler: (payload: unknown) => void,
  ) => () => void;
}

interface AssistantState {
  [key: string]: unknown;
}

interface EventLog {
  time: string;
  event: string;
  data: unknown;
}

interface ApiInfo {
  id: number;
  state: AssistantState;
  logs: EventLog[];
  modelContext?: Record<string, unknown>;
}

const sanitizeForMessage = (
  value: unknown,
  seen = new WeakSet<object>(),
): unknown => {
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
    return value.map((entry) => sanitizeForMessage(entry, seen));
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

const serializeResult = (apis: unknown): ApiInfo[] => {
  if (!Array.isArray(apis)) return [];

  return apis
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const api = entry as ApiInfo;
      return {
        id: api.id,
        state: sanitizeForMessage(api.state ?? {}) as AssistantState,
        modelContext: serializeModelContext(api.modelContext),
        logs: Array.isArray(api.logs)
          ? api.logs.map((log) => ({
              ...log,
              time:
                typeof log.time === "string"
                  ? log.time
                  : log.time instanceof Date
                    ? log.time.toISOString()
                    : new Date().toISOString(),
              data: sanitizeForMessage(log.data),
            }))
          : [],
      };
    })
    .filter((api): api is ApiInfo => Boolean(api));
};

const MESSAGE_NAMESPACE = "assistant-ui-devtools";
const DEFAULT_FRAME_URL = "https://devtools-frame.assistant-ui.com";
const LOCAL_FRAME_URL = "http://localhost:3010";

const resolveFrameUrl = (): string => {
  const explicit = process.env.DEVTOOLS_FRAME_URL;
  if (explicit && typeof explicit === "string") {
    return explicit;
  }

  if (process.env.NODE_ENV === "development") {
    return LOCAL_FRAME_URL;
  }

  return DEFAULT_FRAME_URL;
};

const DevToolsPanel: React.FC = () => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [bridge, setBridge] = useState<HostBridge | null>(null);
  const [bridgeReady, setBridgeReady] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const bridgeReadyRef = useRef(false);

  const frameUrl = useMemo(() => resolveFrameUrl(), []);
  const frameOrigin = useMemo(() => {
    try {
      return new URL(frameUrl).origin;
    } catch (error) {
      console.error("Invalid devtools frame URL", error);
      return new URL(DEFAULT_FRAME_URL).origin;
    }
  }, [frameUrl]);

  const fetchData = useCallback(() => {
    if (!bridge || !bridgeReadyRef.current) return;

    chrome.devtools.inspectedWindow.eval(
      `
      (function() {
        const hook = window.__ASSISTANT_UI_DEVTOOLS_HOOK__;
        if (!hook || !hook.apis) return null;

        const serialize = (value, seen = new WeakSet()) => {
          if (value === null || typeof value === 'undefined') return value;
          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            return value;
          }
          if (typeof value === 'function') {
            return '[Function]';
          }
          if (value instanceof Date) {
            return value.toISOString();
          }
          if (value instanceof Map) {
            const result = {};
            for (const [key, entry] of value.entries()) {
              result[String(key)] = serialize(entry, seen);
            }
            return result;
          }
          if (value instanceof Set) {
            return Array.from(value).map((entry) => serialize(entry, seen));
          }
          if (Array.isArray(value)) {
            if (seen.has(value)) return '[Circular]';
            seen.add(value);
            return value.map((entry) => serialize(entry, seen));
          }
          if (typeof value === 'object') {
            if (seen.has(value)) return '[Circular]';
            seen.add(value);
            const result = {};
            for (const [key, entry] of Object.entries(value || {})) {
              try {
                result[key] = serialize(entry, seen);
              } catch (error) {
                result[key] = `[Unserializable: ${String(error)}]`;
              }
            }
            return result;
          }
          return value;
        };

        const result = [];
        for (const [id, entry] of hook.apis) {
          const apiInfo = {
            id: id,
            state: {},
            logs: Array.isArray(entry.logs)
              ? entry.logs.map((log) => ({
                  event: log.event,
                  data: serialize(log.data),
                  time:
                    log.time instanceof Date
                      ? log.time.toISOString()
                      : new Date(log.time || Date.now()).toISOString(),
                }))
              : [],
            modelContext: null,
          };

          if (entry.api) {
            try {
              for (const [name, scope] of Object.entries(entry.api)) {
                if (name === 'registerModelContextProvider' || name === 'on' || name === 'subscribe') {
                  continue;
                }

                if (typeof scope === 'function') {
                  try {
                    const scopeState = scope();
                    if (scopeState && typeof scopeState.getState === 'function') {
                      apiInfo.state[name] = serialize(scopeState.getState());
                    }
                  } catch (e) {
                    apiInfo.state[name] = { error: String(e) };
                  }
                }
              }

              if (entry.api.__internal_getRuntime) {
                try {
                  const runtime = entry.api.__internal_getRuntime();
                  if (runtime && runtime.thread && runtime.thread.getModelContext) {
                    apiInfo.modelContext = serialize(runtime.thread.getModelContext());
                  }
                } catch (error) {
                  console.error('Error getting model context:', error);
                }
              }
            } catch (error) {
              console.error('Error getting state:', error);
            }
          }

          result.push(apiInfo);
        }

        return result;
      })()
      `,
      (result, error) => {
        if (error) {
          console.error("Error fetching devtools data:", error);
          return;
        }

        if (!bridgeReadyRef.current) return;
        bridge.sendToChild("devtools:data", serializeResult(result));
      },
    );
  }, [bridge]);

  useEffect(() => {
    if (!bridge) return;

    const unsubscribeReady = bridge.subscribeToChild("devtools:ready", () => {
      bridgeReadyRef.current = true;
      setBridgeReady(true);
      bridge.sendToChild("devtools:auto-refresh", autoRefresh);
      fetchData();
    });

    const unsubscribeAutoRefresh = bridge.subscribeToChild(
      "devtools:set-auto-refresh",
      (value) => {
        const boolValue = Boolean(value);
        setAutoRefresh(boolValue);
      },
    );

    const unsubscribeRefresh = bridge.subscribeToChild(
      "devtools:request-refresh",
      () => {
        fetchData();
      },
    );

    const unsubscribeClear = bridge.subscribeToChild(
      "devtools:clear-events",
      () => {
        chrome.devtools.inspectedWindow.eval(
          `
          (function() {
            const hook = window.__ASSISTANT_UI_DEVTOOLS_HOOK__;
            if (!hook || !hook.apis) return false;

            for (const [, entry] of hook.apis) {
              entry.logs = [];
            }

            return true;
          })()
          `,
          () => {
            fetchData();
          },
        );
      },
    );

    return () => {
      unsubscribeReady();
      unsubscribeAutoRefresh();
      unsubscribeRefresh();
      unsubscribeClear();
    };
  }, [bridge, fetchData, autoRefresh]);

  useEffect(() => {
    if (!bridge || !bridgeReadyRef.current) return;
    bridge.sendToChild("devtools:auto-refresh", autoRefresh);
  }, [bridge, autoRefresh, bridgeReady]);

  useEffect(() => {
    if (!bridge || !bridgeReadyRef.current || !autoRefresh) return;
    const interval = window.setInterval(fetchData, 1000);
    return () => window.clearInterval(interval);
  }, [bridge, autoRefresh, bridgeReady, fetchData]);

  useEffect(() => {
    if (!bridge || !bridgeReadyRef.current) return;
    fetchData();
  }, [bridge, bridgeReady, fetchData]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    let frameWindow: Window | null = null;
    const hostSubscribers = new Map<string, Set<(payload: unknown) => void>>();

    const sendToChild = (type: string, payload?: unknown) => {
      if (!frameWindow) return;
      frameWindow.postMessage(
        {
          namespace: MESSAGE_NAMESPACE,
          type,
          payload,
        },
        frameOrigin,
      );
    };

    const hostBridge: HostBridge = {
      sendToChild,
      subscribeToChild: (type, handler) => {
        let handlers = hostSubscribers.get(type);
        if (!handlers) {
          handlers = new Set();
          hostSubscribers.set(type, handlers);
        }
        handlers.add(handler);
        return () => {
          const existing = hostSubscribers.get(type);
          if (!existing) return;
          existing.delete(handler);
          if (existing.size === 0) {
            hostSubscribers.delete(type);
          }
        };
      },
    };

    const handleMessage = (event: MessageEvent) => {
      if (event.source !== frameWindow) return;
      if (event.origin !== frameOrigin) return;

      const data = event.data;
      if (
        !data ||
        typeof data !== "object" ||
        data.namespace !== MESSAGE_NAMESPACE
      ) {
        return;
      }

      if (data.type === "devtools:frame-ready") {
        bridgeReadyRef.current = true;
        setBridge(hostBridge);
        setBridgeReady(true);
        return;
      }

      if (data.type === "devtools:ready") {
        bridgeReadyRef.current = true;
        setBridgeReady(true);
      }

      const handlers = hostSubscribers.get(data.type);
      if (!handlers) return;
      handlers.forEach((handler) => {
        try {
          handler(data.payload);
        } catch (error) {
          console.error("Error handling message from frame", error);
        }
      });
    };

    window.addEventListener("message", handleMessage);

    const handleLoad = () => {
      frameWindow = iframe.contentWindow;
      setBridge(hostBridge);
      setBridgeReady(false);
      bridgeReadyRef.current = false;
    };

    iframe.addEventListener("load", handleLoad);

    if (iframe.contentWindow) {
      handleLoad();
    }

    return () => {
      iframe.removeEventListener("load", handleLoad);
      window.removeEventListener("message", handleMessage);
      hostSubscribers.clear();
      setBridge(null);
      setBridgeReady(false);
      bridgeReadyRef.current = false;
    };
  }, [frameOrigin, fetchData]);

  return (
    <iframe
      ref={iframeRef}
      src={frameUrl}
      style={{ width: "100%", height: "100%", border: "none" }}
      title="Assistant UI DevTools"
    />
  );
};

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<DevToolsPanel />);
} else {
  console.error("Root container not found");
}
