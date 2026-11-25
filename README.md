# Bookstore Café

A cozy portrait mobile browser game: design and run a bookstore and café on a grid.

**Play:** https://lazmcspaz.github.io/Bookstoregame/

## Put it on your phone's Home Screen
- **iPhone (Safari):** open the link, tap Share, then **Add to Home Screen**.
- **Android (Chrome):** open the link, tap the ⋮ menu, then **Add to Home screen** (or **Install app**).

It opens full screen like an app. After the first visit it also works offline.

## Files
- `index.html` is the whole game. It loads three.js r128 from cdnjs.
- `models.json` holds the furniture models.
- `manifest.webmanifest`, `sw.js` and `icons/` are what let it install to the Home Screen and play offline.

Saves live in the browser on each device (localStorage), so a shop saved on your phone stays on your phone.
