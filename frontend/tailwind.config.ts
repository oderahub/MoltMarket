import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#0A0A0A",
        stacks: "#FF6B00",
        terminal: "#121212",
        "terminal-border": "#222222",
      },
      fontFamily: {
        mono: ["var(--font-fira-code)", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
