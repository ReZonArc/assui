export type HostMessageHandler<T = unknown> = (payload: T) => void;

export interface HostMessageChannel {
  post: (type: string, payload?: unknown) => void;
  subscribe: <T = unknown>(type: string, handler: HostMessageHandler<T>) => () => void;
}

declare global {
  interface Window {
    hostMessage?: HostMessageChannel;
  }
}

const MESSAGE_NAMESPACE = "assistant-ui-devtools";

const ensureHostMessage = (): HostMessageChannel => {
  if (window.hostMessage) {
    return window.hostMessage;
  }

  const subscribers = new Map<string, Set<HostMessageHandler>>();

  const handleMessage = (event: MessageEvent) => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.namespace !== MESSAGE_NAMESPACE) return;

    const handlers = subscribers.get(data.type);
    if (!handlers || handlers.size === 0) return;
    handlers.forEach((handler) => {
      try {
        handler(data.payload);
      } catch (error) {
        console.error("Error in host message handler", error);
      }
    });
  };

  window.addEventListener("message", handleMessage);

  const channel: HostMessageChannel = {
    post: (type, payload) => {
      window.parent?.postMessage?.(
        {
          namespace: MESSAGE_NAMESPACE,
          type,
          payload,
        },
        "*",
      );
    },
    subscribe: (type, handler) => {
      let handlers = subscribers.get(type);
      if (!handlers) {
        handlers = new Set();
        subscribers.set(type, handlers);
      }
      handlers.add(handler as HostMessageHandler);
      return () => {
        const existing = subscribers.get(type);
        if (!existing) return;
        existing.delete(handler as HostMessageHandler);
        if (existing.size === 0) {
          subscribers.delete(type);
        }
      };
    },
  };

  window.hostMessage = channel;
  window.dispatchEvent(new CustomEvent("hostMessageAvailable"));
  window.parent?.postMessage?.(
    {
      namespace: MESSAGE_NAMESPACE,
      type: "devtools:frame-ready",
    },
    "*",
  );

  return channel;
};

export const waitForHostMessage = (): Promise<HostMessageChannel> => {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Host message channel is only available in the browser"));
  }

  try {
    const channel = ensureHostMessage();
    return Promise.resolve(channel);
  } catch (error) {
    return Promise.reject(error);
  }
};
