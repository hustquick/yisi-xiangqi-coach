"use client";

import { useEffect } from "react";

export default function PWARegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const register = () => navigator.serviceWorker.register("/service-worker.js", { scope: "/" }).catch(() => undefined);
    if (document.readyState === "complete") void register();
    else window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);
  return null;
}
