import { createRoot } from "react-dom/client";
import "@fontsource/alegreya-sans/400.css";
import "@fontsource/alegreya-sans/500.css";
import "@fontsource/alegreya-sans/700.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "@fontsource/inter/900.css";
import "@fontsource/cormorant-garamond/600.css";
import "@fontsource/cormorant-garamond/700.css";
import "./index.css";
import App from "./App.tsx";
import { registerConsoleHooks } from "./lib/consoleHooks";
import { initAndroidSafeArea } from "./platform/androidSafeArea";
import { initializeLocalization } from "./i18n/runtime";
import { useWorkbenchStore } from "./stores/useWorkbenchStore";

async function start(): Promise<void> {
  initAndroidSafeArea();
  registerConsoleHooks();
  if (import.meta.env.DEV) {
    window.addEventListener("error", (event) => {
      const message = event.error instanceof Error ? event.error.stack ?? event.error.message : event.message;
      useWorkbenchStore.getState().recordRuntimeError(message || "Unknown window error", "window.error");
    });
    window.addEventListener("unhandledrejection", (event) => {
      const reason = event.reason instanceof Error ? event.reason.stack ?? event.reason.message : String(event.reason);
      useWorkbenchStore.getState().recordRuntimeError(reason, "unhandledrejection");
    });
  }
  await initializeLocalization();

  createRoot(document.getElementById("root")!).render(<App />);
}

void start();
