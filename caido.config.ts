import { defineConfig } from "@caido-community/dev";

export default defineConfig({
  id: "better-websockets",
  name: "Better Websockets",
  description: "Browse, search, filter and export WebSocket streams directly from the Caido sidebar.",
  version: "1.0.0",
  author: {
    name: "Jakob Pachmann",
    email: "jakob.pachmann@proton.me",
  },
  plugins: [
    {
      kind: "frontend",
      id: "better-websockets-frontend",
      root: "plugin",
    },
  ],
});
