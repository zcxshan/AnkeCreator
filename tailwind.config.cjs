/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        vscode: {
          bg: '#1e1e1e',
          sidebar: '#252526',
          activity: '#333333',
          panel: '#1e1e1e',
          border: '#3c3c3c',
          hover: '#2a2d2e',
          active: '#094771',
          text: '#cccccc',
          textDim: '#858585',
          accent: '#007acc',
          title: '#3c3c3c',
        },
      },
    },
  },
  plugins: [],
}
