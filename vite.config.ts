import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { devOtpPlugin } from "./vite.devOtpPlugin";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [
      react(),
      mode === "development" ? devOtpPlugin(env) : null,
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["logo-1.png", "logo-2.png"],
        manifest: {
          name: "Shree Kutchi Maheshwari Samaj Bhuj Bhagwat Saptah",
          short_name: "Bhagwat Saptah",
          description: "Guest registration, pothi, room, QR and meal tracking.",
          theme_color: "#c90f1b",
          background_color: "#fff7ef",
          display: "standalone",
          start_url: "/",
          icons: [
            {
              src: "/logo-1.png",
              sizes: "1024x1024",
              type: "image/png",
              purpose: "any"
            },
            {
              src: "/logo-2.png",
              sizes: "1024x1024",
              type: "image/png",
              purpose: "maskable"
            }
          ]
        }
      })
    ].filter(Boolean)
  };
});
