import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(0, 0%, 90%)",
        input: "hsl(0, 0%, 90%)",
        ring: "hsl(220, 13%, 18%)",
        background: "hsl(0, 0%, 100%)",
        foreground: "hsl(220, 13%, 18%)",
        primary: {
          DEFAULT: "hsl(220, 13%, 18%)",
          foreground: "hsl(0, 0%, 100%)",
        },
        secondary: {
          DEFAULT: "hsl(0, 0%, 96%)",
          foreground: "hsl(220, 13%, 18%)",
        },
        muted: {
          DEFAULT: "hsl(0, 0%, 96%)",
          foreground: "hsl(220, 10%, 40%)",
        },
        accent: {
          DEFAULT: "hsl(0, 0%, 96%)",
          foreground: "hsl(220, 13%, 18%)",
        },
      },
      borderRadius: {
        lg: "0.5rem",
        md: "calc(0.5rem - 2px)",
        sm: "calc(0.5rem - 4px)",
      },
    },
  },
  plugins: [],
};

export default config;
