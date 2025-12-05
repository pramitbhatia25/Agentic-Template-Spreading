import "./index.css";

import App from "./App.jsx";
import { createRoot } from "react-dom/client";
import { HeroUIProvider } from "@heroui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 30, // 30 minutes by default
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

createRoot(document.getElementById("root")).render(
  <QueryClientProvider client={queryClient}>
    <HeroUIProvider>
      <main className="light w-[100dvw] h-[100dvh] text-foreground bg-white">
        <App />
      </main>
    </HeroUIProvider>
  </QueryClientProvider>
);
