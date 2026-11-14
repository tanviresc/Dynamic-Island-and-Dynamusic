/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        accent: "rgb(var(--accent, 255 255 255) / <alpha-value>)",
        base: "rgb(var(--base, 0 0 0) / <alpha-value>)",
        surface: "rgb(var(--surface, 18 18 20) / <alpha-value>)",
        panel: "rgb(var(--panel, 28 28 30) / <alpha-value>)",
        elevated: "rgb(var(--elevated, 44 44 46) / <alpha-value>)",
        primary: "rgb(var(--primary, 255 255 255) / <alpha-value>)",
        "on-primary": "rgb(var(--on-primary, 0 0 0) / <alpha-value>)",
        ink: {
          hi: "rgb(var(--ink-hi, 255 255 255) / <alpha-value>)",
          DEFAULT: "rgb(var(--ink, 255 255 255) / 0.92)",
          dim: "rgb(var(--ink-dim, 142 142 147) / <alpha-value>)",
          faint: "rgb(var(--ink-faint, 255 255 255) / 0.55)",
          ghost: "rgb(var(--ink-ghost, 255 255 255) / 0.34)",
        },
      },
      fontFamily: {
        sans: ['"Segoe UI Variable Text"', '"Segoe UI"', "system-ui", "-apple-system", '"Helvetica Neue"', "Arial", "sans-serif"],
        display: ['"Segoe UI Variable Display"', '"Segoe UI Variable Text"', '"Segoe UI"', "system-ui", "sans-serif"],
      },
      boxShadow: {
        elev: "0 4px 24px rgba(0, 0, 0, 0.45)",
        float: "0 24px 64px -16px rgba(0, 0, 0, 0.75), 0 2px 8px rgba(0, 0, 0, 0.5)",
        glow: "0 8px 24px -6px rgb(var(--accent, 255 255 255) / 0.45)",
        art: "0 24px 60px -16px rgba(0, 0, 0, 0.8)",
        glass: "inset 0 0.5px 0 rgba(255, 255, 255, 0.5), 0 4px 24px rgba(0, 0, 0, 0.25)",
        pill: "inset 0 0.5px 0 rgba(255, 255, 255, 0.5), 0 4px 18px rgba(0, 0, 0, 0.18)",
      },
      keyframes: {
        "pop-in": {
          from: { opacity: "0", transform: "translateY(10px) scale(0.97)" },
          to: { opacity: "1", transform: "none" },
        },
        "menu-in": {
          from: { opacity: "0", transform: "translateY(-6px) scale(0.96)" },
          to: { opacity: "1", transform: "none" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "none" },
        },
        "slide-in-right": {
          from: { opacity: "0", transform: "translateX(16px)" },
          to: { opacity: "1", transform: "none" },
        },
      },
      animation: {
        "pop-in": "pop-in 0.22s cubic-bezier(0.2, 0.8, 0.3, 1)",
        "menu-in": "menu-in 0.18s cubic-bezier(0.16, 1, 0.3, 1)",
        "fade-in": "fade-in 0.2s ease-out",
        "slide-up": "slide-up 0.28s cubic-bezier(0.2, 0.8, 0.3, 1) backwards",
        "slide-in-right": "slide-in-right 0.24s cubic-bezier(0.2, 0.8, 0.3, 1) both",
      },
    },
  },
  plugins: [],
};

