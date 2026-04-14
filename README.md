# Live Translator

[![CI](https://github.com/intrepidcanadian/translation/actions/workflows/ci.yml/badge.svg)](https://github.com/intrepidcanadian/translation/actions/workflows/ci.yml)

React Native / Expo app for real-time voice, camera, and document translation.

## Development

```sh
npm install
npm start           # Expo dev server
npm test            # Jest (local — uses Node 25 localStorage workaround)
npm run typecheck   # tsc --noEmit
```

## CI

Every push and PR to `main` runs `typecheck` and `test:ci` on Node 20 via GitHub Actions.
