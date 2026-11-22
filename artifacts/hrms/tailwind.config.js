/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          50:  '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
          950: '#1e1b4b',
        },
        accent: {
          400: '#34d399',
          500: '#10b981',
          600: '#059669',
        },
        danger: {
          400: '#f87171',
          500: '#ef4444',
          600: '#dc2626',
        },
        warning: {
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
        },
        surface: {
          50:  '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
          950: '#020617',
        },
      },
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
        display: ['Syne', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
        mundial: ['Mundial', 'sans-serif'],
      },
      boxShadow: {
        'glow-primary': '0 0 20px rgba(99, 102, 241, 0.35)',
        'glow-accent':  '0 0 20px rgba(16, 185, 129, 0.35)',
        'card':         '0 1px 3px rgba(0,0,0,.08), 0 8px 24px rgba(0,0,0,.06)',
        'card-hover':   '0 4px 6px rgba(0,0,0,.05), 0 16px 40px rgba(0,0,0,.10)',
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
        '4xl': '2rem',
      },
      animation: {
        'fade-in':      'fadeIn 0.3s ease-out',
        'slide-up':     'slideUp 0.4s ease-out',
        'slide-right':  'slideRight 0.3s ease-out',
        'pulse-slow':   'pulse 3s ease-in-out infinite',
        'spin-slow':    'spin 3s linear infinite',
        'float':        'float 3s ease-in-out infinite',
        'shimmer':      'shimmer 2s linear infinite',
        'bounce-soft':  'bounceSoft 1s ease-in-out infinite',
      },
      keyframes: {
        fadeIn:     { from: { opacity: 0 }, to: { opacity: 1 } },
        slideUp:    { from: { opacity: 0, transform: 'translateY(20px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
        slideRight: { from: { opacity: 0, transform: 'translateX(-20px)' }, to: { opacity: 1, transform: 'translateX(0)' } },
        float:      { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-8px)' } },
        shimmer:    { from: { backgroundPosition: '-200% 0' }, to: { backgroundPosition: '200% 0' } },
        bounceSoft: { '0%,100%': { transform: 'translateY(-5%)' }, '50%': { transform: 'translateY(0)' } },
      },
      backdropBlur: { xs: '2px' },
      screens: {
        '3xl': '1920px',
      },
    },
  },
  
  plugins: [],
};
