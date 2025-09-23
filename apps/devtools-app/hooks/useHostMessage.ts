"use client";

import { useEffect, useState } from "react";
import type { HostMessageChannel } from "../lib/hostMessage";
import { waitForHostMessage } from "../lib/hostMessage";

export const useHostMessage = () => {
  const [channel, setChannel] = useState<HostMessageChannel | null>(null);

  useEffect(() => {
    let cancelled = false;

    waitForHostMessage().then((host) => {
      if (!cancelled) {
        setChannel(host);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return channel;
};
