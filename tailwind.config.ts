import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        school: {
          pink: "#be185d",
          pinkLight: "#fce7f3",
          gold: "#d97706",
          goldLight: "#fef3c7",
          purple: "#7c3aed",
          cyan: "#0284c7",
        }
      },
      fontFamily: {
        sans: ["var(--font-sarabun)", "sans-serif"],
        display: ["var(--font-prompt)", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
