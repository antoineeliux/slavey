import { useEffect } from "react";

import { AppShell } from "./components/AppShell";
import { useAppStore } from "./store/appStore";

export default function App() {
  useEffect(() => {
    let disposed = false;
    let cleanup: Array<() => void> = [];

    void useAppStore
      .getState()
      .connectEvents()
      .then((unlisten) => {
        if (disposed) {
          unlisten.forEach((item) => item());
          return;
        }
        cleanup = unlisten;
      })
      .catch((error) => {
        useAppStore.getState().addLog({
          id: crypto.randomUUID(),
          level: "warn",
          message: `event bridge unavailable: ${String(error)}`,
          timestamp: Date.now(),
        });
      });

    void useAppStore.getState().bootstrap();

    return () => {
      disposed = true;
      cleanup.forEach((item) => item());
    };
  }, []);

  return <AppShell />;
}
