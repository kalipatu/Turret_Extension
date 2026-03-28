import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: ["evedappsui.condor-home.org"] ,  // add here your external host if you access it over e.g. tunnel
    port: parseInt(process.env.VITE_PORT) || 5173,
    fs: {
      strict: false,
    },
  }
});


