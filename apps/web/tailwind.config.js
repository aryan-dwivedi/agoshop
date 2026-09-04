/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './seller.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      /** Token colours shared by the light Shop and Studio surfaces. */
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        elev: 'var(--elev)',
        menu: 'var(--menu)',
        line: 'var(--border)',
        'line-ctl': 'var(--border-ctl)',
        t1: 'var(--text-1)',
        t2: 'var(--text-2)',
        t3: 'var(--text-3)',
        accent: {
          DEFAULT: 'var(--accent)',
          /** Accessible action text/icon colour for the active theme. */
          text: 'var(--accent-text)',
          press: 'var(--accent-press)',
          ink: 'var(--accent-ink)',
          wash: 'var(--accent-wash)',
        },
        live: {
          DEFAULT: 'var(--live)',
          ink: 'var(--live-ink)',
          wash: 'var(--live-wash)',
        },
        success: {
          DEFAULT: 'var(--success)',
          wash: 'var(--success-wash)',
        },
        danger: 'var(--danger-text)',
        chip: 'var(--chip)',
      },
      fontFamily: {
        sans: 'var(--font-sans)',
        display: 'var(--font-display)',
      },
      /** 1.2 ratio. Shop reads at 16, Studio at 13; both draw from one scale. */
      fontSize: {
        11: ['11px', '16px'],
        13: ['13px', '18px'],
        14: ['14px', '20px'],
        16: ['16px', '24px'],
        19: ['19px', '28px'],
        23: ['23px', '32px'],
        28: ['28px', '36px'],
        33: ['33px', '40px'],
        40: ['40px', '48px'],
      },
      borderRadius: {
        chip: 'var(--r-chip)',
        ctl: 'var(--r-ctl)',
        panel: 'var(--r-panel)',
        sheet: 'var(--r-sheet)',
      },
      boxShadow: {
        e1: 'var(--e-1)',
        sheet: 'var(--e-sheet)',
        drag: 'var(--e-drag)',
      },
      height: {
        ctl: 'var(--ctl-h)',
        'ctl-lg': 'var(--ctl-h-lg)',
        bar: 'var(--bar-h)',
        'pin-bar': 'var(--pin-bar-h)',
      },
      minHeight: {
        ctl: 'var(--ctl-h)',
        'ctl-lg': 'var(--ctl-h-lg)',
      },
      width: {
        sidebar: 'var(--sidebar-w)',
      },
      maxWidth: {
        page: 'var(--page-max)',
      },
      transitionTimingFunction: {
        out: 'var(--ease-out)',
        emphatic: 'var(--ease-emphatic)',
      },
      transitionDuration: {
        echo: '80ms',
        ctl: '140ms',
        panel: '220ms',
        stage: '320ms',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-down': {
          from: { opacity: '0', transform: 'translateY(-6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        /** Reaction bursts drifting off the video stage. */
        float: {
          '0%': { opacity: '0', transform: 'translateY(0) scale(0.8)' },
          '15%': { opacity: '1' },
          '100%': { opacity: '0', transform: 'translateY(-72px) scale(1.25)' },
        },
        /** LIVE dot: opacity only, so it never triggers layout or a composite. */
        breathe: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.45' },
        },
        /** Indeterminate sweep under the assistant header while it is thinking. */
        sweep: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(400%)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 140ms var(--ease-out) both',
        'slide-up': 'slide-up 220ms var(--ease-out) both',
        'slide-down': 'slide-down 140ms var(--ease-out) both',
        float: 'float 1.4s ease-out forwards',
        breathe: 'breathe 1.8s var(--ease-in-out) infinite',
        sweep: 'sweep 1.2s var(--ease-in-out) infinite',
      },
    },
  },
  plugins: [],
};
