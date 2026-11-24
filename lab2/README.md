# Dogfight — Lab 02: Objects, Prototypes, and this

Controls: arrows/WASD, Space = fire, H = toggle HUD.
Run: `npm install`, `npm install -D vite eslint @eslint/js globals prettier`, `npm run dev`.

## The `this` bug
- What I wrote: `canvas.addEventListener("click", ship.fire)`
- What happened: `this` was `<canvas>` / `undefined`, and the Event was passed as `world` -> TypeError
- Fix chosen: (arrow wrapper / bind / class-field arrow) because ...
- Alternatives and downsides: arrow wrapper (new function per registration), bind (extra object, easy to forget), class-field arrow (one function per instance = memory).
- Demo: `src/this-demo.js`

## Why composition (<= 1 page)
- Homing is ONE function (`behaviors.js`) attached to bullets and asteroids.
- Inheritance version: Entity -> Moving -> Homing -> HomingBullet / HomingAsteroid, plus a Pickup that is neither moving nor a ship.
- Why I chose behaviors-as-functions: ...
