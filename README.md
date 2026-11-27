# Bookstore Café

A cozy portrait mobile browser game: design and run a bookstore and café on a grid.

**Play:** https://lazmcspaz.github.io/Bookstoregame/

## Put it on your phone's Home Screen
- **iPhone (Safari):** open the link, tap Share, then **Add to Home Screen**.
- **Android (Chrome):** open the link, tap the ⋮ menu, then **Add to Home screen** (or **Install app**).

It opens full screen like an app. After the first visit it also works offline.

## Sound
Sound starts off, so music, a podcast or a video already playing on the phone keeps going. Switch Music or Sounds on in the ? menu; the game remembers. When on, the game asks the phone to mix its sound with whatever is playing; on an iPhone it then follows the ring/silent switch, like most games. With both off the game does not use the phone's sound at all.

## Files
- `index.html` is the whole game. It loads three.js r128 from cdnjs.
- `models.json` holds the furniture models.
- `manifest.webmanifest`, `sw.js` and `icons/` are what let it install to the Home Screen and play offline.
- `tests/` holds checks run by hand: the staff jobs (`staff-jobs.test.mjs`), a new game played from the title screen (`tutorial-from-title.test.mjs`) and the seats (`seats.test.mjs`). How to run each is at the top of the file. The game never loads them.

Saves live in the browser on each device (localStorage), so a shop saved on your phone stays on your phone.
