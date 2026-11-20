import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        studio: {
          bg: '#070b16',
          panel: '#0f1629',
          border: '#1e2b4a',
          accent: '#f59e0b',
        },
      },
    },
  },
  plugins: [],
};

export default config;
