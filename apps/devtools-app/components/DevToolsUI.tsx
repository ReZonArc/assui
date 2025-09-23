"use client";

import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useHostMessage } from "../hooks/useHostMessage";
import type { HostMessageChannel } from "../lib/hostMessage";

interface AssistantState {
  [key: string]: unknown;
}

interface EventLog {
  time: Date;
  event: string;
  data: unknown;
}

interface ModelContext {
  system?: string;
  tools?: Record<string, unknown>;
  callSettings?: Record<string, unknown>;
  config?: Record<string, unknown>;
}

interface ApiInfo {
  id: number;
  state: AssistantState;
  logs: EventLog[];
  modelContext?: ModelContext;
}

type TabType = "state" | "events" | "context" | "network";

type SerializedEventLog = Omit<EventLog, "time"> & { time: string };

type SerializedApiInfo = Omit<ApiInfo, "logs"> & {
  logs: SerializedEventLog[];
};

const formatTime = (value: Date) =>
  `${value.getHours().toString().padStart(2, "0")}:${value
    .getMinutes()
    .toString()
    .padStart(2, "0")}:${value.getSeconds().toString().padStart(2, "0")}`;

const serializeApis = (apis: unknown): ApiInfo[] => {
  if (!Array.isArray(apis)) return [];

  return apis
    .map((api): ApiInfo | null => {
      if (!api || typeof api !== "object") return null;

      const safeApi = api as SerializedApiInfo;
      const logs = Array.isArray(safeApi.logs)
        ? safeApi.logs.map((log) => ({
            ...log,
            time: new Date(log.time ?? Date.now()),
          }))
        : [];

      return {
        id: safeApi.id,
        state: safeApi.state ?? {},
        logs,
        modelContext: safeApi.modelContext,
      };
    })
    .filter((api): api is ApiInfo => Boolean(api));
};

const useHostBridge = (
  host: HostMessageChannel | null,
  {
    setApis,
  }: {
    setApis: (apis: ApiInfo[]) => void;
  },
) => {
  useEffect(() => {
    if (!host) return;

    const unsubscribeData = host.subscribe<SerializedApiInfo[]>("devtools:data", (payload) => {
      setApis(serializeApis(payload));
    });

    host.post("devtools:ready");
    host.post("devtools:set-auto-refresh", true);

    return () => {
      unsubscribeData();
    };
  }, [host, setApis]);
};

const ControlButton = ({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    className={clsx(
      "inline-flex h-8 items-center rounded-md border border-zinc-300 px-3 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:focus-visible:ring-offset-zinc-900",
      className,
    )}
    {...props}
  />
);

const JSONPreview = ({ value }: { value: unknown }) => (
  <pre className="whitespace-pre-wrap break-words rounded-lg bg-zinc-100 p-3 text-[11px] leading-relaxed text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
    {JSON.stringify(value, null, 2)}
  </pre>
);

const CenteredMessage = ({ children }: { children: ReactNode }) => (
  <div className="flex h-full items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
    {children}
  </div>
);

const SectionTitle = ({ children }: { children: ReactNode }) => (
  <h3 className="mb-2 text-sm font-semibold text-zinc-800 dark:text-zinc-100">{children}</h3>
);

const InfoCard = ({ children }: { children: ReactNode }) => (
  <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm transition-colors dark:border-zinc-800 dark:bg-zinc-900">
    {children}
  </div>
);

export function DevToolsUI() {
  const host = useHostMessage();
  const [apis, setApis] = useState<ApiInfo[]>([]);
  const [selectedApiId, setSelectedApiId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>("state");
  const [viewMode, setViewMode] = useState<"raw" | "preview">("preview");
  const [expandedStates, setExpandedStates] = useState<Set<string>>(new Set());
  const [selectedEventTypes, setSelectedEventTypes] = useState<Set<string>>(new Set());
  const knownEventTypesRef = useRef(new Set<string>());

  useHostBridge(host, { setApis });

  const selectedApi = useMemo(
    () => apis.find((api) => api.id === selectedApiId) ?? apis[0] ?? null,
    [apis, selectedApiId],
  );

  useEffect(() => {
    if (!selectedApi && apis.length > 0) {
      setSelectedApiId(apis[0].id);
    }
  }, [apis, selectedApi]);

  const eventTypes = useMemo(() => {
    const types = new Set<string>();
    apis.forEach((api) => {
      api.logs.forEach((log) => types.add(log.event));
    });
    return Array.from(types).sort();
  }, [apis]);

  useEffect(() => {
    setSelectedEventTypes((prev) => {
      const next = new Set(prev);
      const eventTypeSet = new Set(eventTypes);
      let changed = false;

      if (
        knownEventTypesRef.current.size === 0 &&
        next.size === 0 &&
        eventTypes.length > 0
      ) {
        eventTypes.forEach((type) => {
          knownEventTypesRef.current.add(type);
          next.add(type);
        });
        return next;
      }

      Array.from(next).forEach((value) => {
        if (!eventTypeSet.has(value)) {
          next.delete(value);
          knownEventTypesRef.current.delete(value);
          changed = true;
        }
      });

      knownEventTypesRef.current.forEach((value) => {
        if (!eventTypeSet.has(value)) {
          knownEventTypesRef.current.delete(value);
        }
      });

      eventTypes.forEach((type) => {
        if (!knownEventTypesRef.current.has(type)) {
          knownEventTypesRef.current.add(type);
          if (!next.has(type)) {
            next.add(type);
            changed = true;
          }
        }
      });

      return changed ? next : prev;
    });
  }, [eventTypes]);

  const filteredLogs = useMemo(() => {
    if (!selectedApi) return [];

    return selectedApi.logs.filter((log) => selectedEventTypes.has(log.event));
  }, [selectedApi, selectedEventTypes]);

  const toggleStateSection = useCallback((key: string) => {
    setExpandedStates((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const toggleEventType = useCallback((eventType: string) => {
    setSelectedEventTypes((prev) => {
      const next = new Set(prev);
      if (next.has(eventType)) {
        next.delete(eventType);
      } else {
        next.add(eventType);
      }
      return next;
    });
  }, []);

  const clearEventTypes = useCallback(() => {
    const next = new Set(eventTypes);
    knownEventTypesRef.current.clear();
    eventTypes.forEach((type) => knownEventTypesRef.current.add(type));
    setSelectedEventTypes(next);
    host?.post("devtools:clear-events");
  }, [eventTypes, host]);

  const showApiSelector = apis.length > 1;

  const renderToolbar = () => {
    if (!showApiSelector) {
      return null;
    }

    return (
      <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500 dark:border-zinc-900 dark:bg-zinc-950">
        <span className="font-medium">API</span>
        <select
          value={selectedApiId ?? ""}
          onChange={(event) => {
            const value = Number(event.target.value);
            setSelectedApiId(Number.isNaN(value) ? null : value);
          }}
          className="rounded-md border border-zinc-300 bg-zinc-50 px-2 py-1 text-xs text-zinc-900 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
        >
          {apis.map((api) => (
            <option key={api.id} value={api.id}>
              API #{api.id}
            </option>
          ))}
        </select>
      </div>
    );
  };

  const renderTabControls = () => {
    if (activeTab === "events") {
      return (
        <div className="flex h-full items-center gap-2 px-2">
          <ControlButton onClick={clearEventTypes}>Clear Events</ControlButton>
        </div>
      );
    }

    if (activeTab === "state") {
      return (
        <div className="flex h-full items-center gap-2 px-2">
          <ControlButton
            onClick={() =>
              setViewMode((prev) => (prev === "preview" ? "raw" : "preview"))
            }
          >
            View: {viewMode === "preview" ? "Preview" : "Raw"}
          </ControlButton>
        </div>
      );
    }

    if (activeTab === "context") {
      return (
        <div className="flex h-full items-center px-4 text-xs text-zinc-500 dark:text-zinc-400">
          Model context overview
        </div>
      );
    }

    return (
      <div className="flex h-full items-center px-4 text-xs text-zinc-500 dark:text-zinc-400">
        Network activity
      </div>
    );
  };

  const renderStateContent = () => {
    if (!selectedApi) {
      return <CenteredMessage>Waiting for assistant-ui instance...</CenteredMessage>;
    }

    if (Object.keys(selectedApi.state).length === 0) {
      return (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
          No state detected for this assistant instance.
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-3">
        {Object.entries(selectedApi.state).map(([key, value]) => {
          const expanded = expandedStates.has(key);
          return (
            <div
              key={key}
              className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm transition-colors dark:border-zinc-800 dark:bg-zinc-900"
            >
              <button
                onClick={() => toggleStateSection(key)}
                className="flex w-full items-center justify-between bg-zinc-50 px-4 py-3 text-left text-sm font-semibold text-zinc-800 transition-colors hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
              >
                <span>{key}</span>
                <span className="text-lg">{expanded ? "−" : "+"}</span>
              </button>
              {expanded && (
                <div className="border-t border-zinc-200 p-4 text-[11px] transition-colors dark:border-zinc-800">
                  {viewMode === "preview" ? (
                    <JSONPreview value={value} />
                  ) : (
                    <pre className="whitespace-pre overflow-auto rounded-lg bg-zinc-100 p-3 text-[11px] text-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
                      {JSON.stringify(value, null, 2)}
                    </pre>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderEventsContent = () => {
    if (!selectedApi) {
      return <CenteredMessage>Waiting for assistant-ui instance...</CenteredMessage>;
    }

    const eventFilterChips = eventTypes.map((eventType) => (
      <label
        key={eventType}
        className={clsx(
          "flex items-center gap-2 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
          selectedEventTypes.has(eventType)
            ? "border-blue-500 bg-blue-500/10 text-blue-600 dark:border-blue-400 dark:bg-blue-500/20 dark:text-blue-200"
            : "border-zinc-200 bg-white text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
        )}
      >
        <input
          type="checkbox"
          checked={selectedEventTypes.has(eventType)}
          onChange={() => toggleEventType(eventType)}
          className="size-3 rounded border-zinc-300 text-blue-600 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <span>{eventType}</span>
      </label>
    ));

    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 transition-colors dark:border-zinc-800 dark:bg-zinc-900">
          {eventFilterChips}
        </div>
        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm transition-colors dark:border-zinc-800 dark:bg-zinc-900">
          {filteredLogs.length === 0 ? (
            <div className="p-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
              No events match the current filters.
            </div>
          ) : (
            <table className="w-full table-auto border-collapse text-left">
              <thead className="bg-zinc-100 text-[11px] uppercase tracking-wide text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">
                <tr>
                  <th className="px-4 py-2 font-semibold">Time</th>
                  <th className="px-4 py-2 font-semibold">Event</th>
                  <th className="px-4 py-2 font-semibold">Data</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log, index) => (
                  <tr
                    key={`${log.event}-${index}`}
                    className="border-t border-zinc-200 bg-white text-[11px] transition-colors dark:border-zinc-800 dark:bg-zinc-900"
                  >
                    <td className="whitespace-nowrap px-4 py-2 align-top text-zinc-600 dark:text-zinc-300">
                      {formatTime(log.time)}
                    </td>
                    <td className="px-4 py-2 align-top font-semibold text-zinc-800 dark:text-zinc-100">
                      {log.event}
                    </td>
                    <td className="px-4 py-2 align-top">
                      <JSONPreview value={log.data} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  };

  const renderContextContent = () => {
    if (!selectedApi) {
      return <CenteredMessage>Waiting for assistant-ui instance...</CenteredMessage>;
    }

    return (
      <div className="grid gap-3">
        <InfoCard>
          <SectionTitle>System Prompt</SectionTitle>
          <pre className="whitespace-pre-wrap rounded-lg bg-zinc-100 p-3 text-[11px] text-zinc-700 dark:bg-zinc-950 dark:text-zinc-200">
            {selectedApi.modelContext?.system || "<empty>"}
          </pre>
        </InfoCard>
        <InfoCard>
          <SectionTitle>Tools</SectionTitle>
          <JSONPreview value={selectedApi.modelContext?.tools ?? "<no tools registered>"} />
        </InfoCard>
        <InfoCard>
          <SectionTitle>Call Settings</SectionTitle>
          <JSONPreview value={selectedApi.modelContext?.callSettings ?? "<no call settings>"} />
        </InfoCard>
      </div>
    );
  };

  const renderNetworkContent = () => (
    <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-white p-6 text-sm text-zinc-500 transition-colors dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
      Network inspection coming soon.
    </div>
  );

  const renderTabContent = () => {
    switch (activeTab) {
      case "state":
        return renderStateContent();
      case "events":
        return renderEventsContent();
      case "context":
        return renderContextContent();
      case "network":
      default:
        return renderNetworkContent();
    }
  };

  return (
    <div className="h-full w-full dark" data-theme="dark">
      <div className="flex h-full flex-col bg-white font-mono text-xs text-zinc-900 transition-colors dark:bg-zinc-950 dark:text-zinc-100">
        {renderToolbar()}

        <nav className="flex h-10 items-center justify-between border-b border-zinc-200 bg-zinc-50 px-2 dark:border-zinc-900 dark:bg-zinc-950">
          <div className="flex h-full items-center gap-1">
            {["state", "events", "context", "network"].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab as TabType)}
                className={clsx(
                  "flex h-full items-center px-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 transition-colors",
                  activeTab === tab
                    ? "border-b-2 border-blue-500 text-zinc-900 dark:border-blue-400 dark:text-zinc-100"
                    : "border-b-2 border-transparent hover:text-zinc-700 dark:hover:text-zinc-200",
                )}
              >
                {tab}
              </button>
            ))}
          </div>
          {renderTabControls()}
        </nav>

        <section className="flex-1 overflow-auto bg-white p-4 transition-colors dark:bg-zinc-950">
          {renderTabContent()}
        </section>

        <footer className="flex items-center justify-between border-t border-zinc-200 bg-zinc-50 px-4 py-2 text-[11px] text-zinc-500 transition-colors dark:border-zinc-900 dark:bg-zinc-950 dark:text-zinc-500">
          <span>
            Status: {apis.length > 0 ? `${apis.length} assistant instance${apis.length > 1 ? "s" : ""} detected` : "Waiting for instances"}
          </span>
          {host ? (
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">Connected to host</span>
          ) : (
            <span className="font-semibold text-rose-500">Host unavailable</span>
          )}
        </footer>
      </div>
    </div>
  );
}
