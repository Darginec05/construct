import editorPreset from "@construct/editor/tailwind-preset";

/** @type {import('tailwindcss').Config} */
export default {
  presets: [editorPreset],
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    "../../packages/editor/src/**/*.{ts,tsx}",
  ],
};
