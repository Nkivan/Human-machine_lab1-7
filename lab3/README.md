# Dogfight — Lab 03: Async JavaScript

Асинхронне завантаження ассетів з екраном прогресу, обробкою помилок і повторами (`withRetry`), розв'язка через `EventTarget` та лобі по HTTP з `AbortController` і `AbortSignal.timeout`.

**Запуск:** `npm install`, потім `npm install -D vite eslint @eslint/js globals prettier`, далі `npm run dev`.
**Керування:** стрілки або `WASD`, `Space` — постріл, `H` — показати/сховати HUD.

## Структура

- `public/assets/manifest.json` — опис спрайтів, кадрів, звуків (опціональних) та конфігурації арени[cite: 15]
- `src/assets/loader.js` — `fetchJson` (перевірка `res.ok`), `loadImage`, `loadAudio`, `loadJson`, `withRetry` (експоненційний backoff + jitter, без ретраїв на `4xx`), `loadAll` (`Promise.all` + лічильник прогресу)[cite: 15]
- `src/assets/loadingScreen.js` — прогрес-бар на canvas та екран помилки з повтором по кліку[cite: 15]
- `src/audio.js`, `src/hud.js` — підписники на події світу (`fired`, `hit`, `exploded`, `score`); `src/sim/` не імпортує жоден із них[cite: 15]
- `src/lobby.js` (`EventTarget`, дані) + `src/lobbyView.js` (DOM) — періодичне оновлення, `AbortSignal.timeout`, скасування запиту при виході з лобі[cite: 15]

## Тестові режими (лише dev-сервер)

Доступні параметри: `/?test=slow`, `/?test=flaky`, `/?test=404-sound`, `/?test=404-required`, `/?test=corrupt`, `/?test=timeout`, `/?test=abort`. Додавання `&seq=1` вмикає послідовне завантаження з виводом часу в консоль (`[loader] ... ms`)[cite: 15].

## M1 — concurrent vs sequential (3 повільні ассети по ~3 с)

| mode | time |
|---|---|
| concurrent (`?test=slow`) | *впиши свій час у ms з консолі* |
| sequential (`?test=slow&seq=1`) | *впиши свій час у ms з консолі* |

**Why:** `Promise.all` запускає всі запити одночасно, тому загальний час визначається найдовшим запитом (~3 с). При послідовному завантаженні (`&seq=1`) кожен наступний запит стартує лише після завершення попереднього, тому час сумується (~9 с).

## M4a — ordering puzzles (перевірені в консолі)

1. `console.log("start"); setTimeout(() => console.log("t1"), 0); Promise.resolve().then(() => console.log("m1")); console.log("end");` → `start`, `end`, `m1`, `t1`. Спочатку виконується синхронний код на стеку, потім спустошується черга мікрозадач (`Promise.then`), і лише потім береться макрозадача з черги таймерів.
2. `async function run() { console.log("a1"); await 42; console.log("a2"); } run(); console.log("a3");` → `a1`, `a3`, `a2`. `await` призупиняє функцію й повертає керування в event loop навіть для не-промісу, а продовження ставиться в чергу мікрозадач.
3. `Promise.resolve().then(() => { console.log("step1"); setTimeout(() => console.log("innerTimer"), 0); }).then(() => console.log("step2")); setTimeout(() => console.log("outerTimer"), 0);` → `step1`, `step2`, `outerTimer`, `innerTimer`. Обидві мікрозадачі ланцюжка виконуються до макрозадач, а `outerTimer` був поставлений у чергу задач раніше за `innerTimer`.
4. `requestAnimationFrame(() => console.log("frameCb")); setTimeout(() => console.log("timerCb"), 0); Promise.resolve().then(() => console.log("microCb"));` → `microCb`, `timerCb`, `frameCb` (типовий порядок). Мікрозадачі й задачі обробляються до кроку рендерингу, де викликаються колбеки `requestAnimationFrame`.
5. `const pr = new Promise(resolve => { console.log("insideExecutor"); resolve("ok"); }); pr.then(val => console.log("onFulfilled", val)); console.log("afterCreate");` → `insideExecutor`, `afterCreate`, `onFulfilled ok`. Функція-executor запускається синхронно під час `new Promise`, тоді як обробники `.then` завжди викликаються асинхронно як мікрозадачі.

## M4b — failure gallery

| mode | what I expect | screenshot / log |
|---|---|---|
| `404-sound` | гра запускається, у консолі є попередження про відсутній необов'язковий звук | *додай скріншот або лог* |
| `404-required` | екран помилки + кнопка повтору; без ретраїв, бо `404` — це помилка клієнта (`4xx`) | *додай скріншот або лог* |
| `flaky` | дві помилки `503` повторюються з backoff + jitter, після чого завантаження успішно завершується | *додай скріншот або лог* |
| `timeout` | запит переривається по таймауту (`AbortSignal.timeout`), виконуються спроби повтору, далі екран помилки з повтором | *додай скріншот або лог* |
| `abort` | скасування завантаження («Loading cancelled»), екран помилки з можливістю натиснути для повтору | *додай скріншот або лог* |
| `corrupt` | помилка парсингу (`SyntaxError`), екран помилки з повтором без безглуздих ретраїв битого файлу | *додай скріншот або лог* |
