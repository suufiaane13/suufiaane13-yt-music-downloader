/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        accent: {
          50: "#fff0f2",
          100: "#ffdfe3",
          200: "#ffc5cd",
          300: "#ff9aa6",
          400: "#ff6b82",
          500: "#ff3b5c",
          600: "#ef1c45",
          700: "#c90f36",
          800: "#a51230",
          900: "#84122c",
        },
        dark: {
          50: "#f2f2f4",
          100: "#d6d7da",
          200: "#afb1b8",
          300: "#7e818a",
          400: "#52565f",
          500: "#3a3e45",
          600: "#292c31",
          700: "#1e2024",
          800: "#15171a",
          900: "#0b0c0e",
        },
      },
      boxShadow: {
        panel: "0 1px 0 0 rgba(255,255,255,.03) inset, 0 10px 30px -16px rgba(0,0,0,.7)",
        "glow-accent": "0 4px 14px -6px rgba(255,59,92,.55)",
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        shimmer: "shimmer 1.6s ease-in-out infinite",
        "soft-pulse": "soft-pulse 2.6s ease-in-out infinite",
      },
      keyframes: {
        shimmer: {
          "0%": { transform: "translateX(-110%)" },
          "100%": { transform: "translateX(320%)" },
        },
        "soft-pulse": {
          "0%, 100%": { opacity: "0.55" },
          "50%": { opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};