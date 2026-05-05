# Bomb Master Monad

A real-time multiplayer Bomberman-inspired game built with React, Vite, and Firebase.

## Deployment to GitHub Pages

If you are hosting this on GitHub Pages, follow these steps:

1. **Vite Base Path**: I have already set `base: './'` in `vite.config.ts`. This ensures that assets are loaded correctly regardless of your repository name.
2. **Firebase Configuration**: 
   - Ensure the `firebase-applet-config.json` file is present in the root directory.
   - If you want to keep your Firebase keys private, you should use environment variables instead of the JSON file in production.
3. **Build & Deploy**:
   - Run `npm install`
   - Run `npm run build`
   - Upload the contents of the `dist` folder to your GitHub Pages branch (usually `gh-pages`).

## How to play
- **Move**: W, A, S, D
- **Place Bomb**: Space
- **Goal**: Be the last one standing!

## Features
- Real-time multiplayer via Firebase Firestore.
- Procedural map generation with different styles.
- Sound effects for movement, explosions, and UI.
- Professional UI with motion animations.
