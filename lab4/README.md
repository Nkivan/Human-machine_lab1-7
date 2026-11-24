# Dogfight - Lab 04: Сервер на Node.js

## Запуск (розробка)
npm install
npm install -D vite eslint @eslint/js globals prettier
npm run dev:server        # термінал 1: http://127.0.0.1:3000 (API + WebSocket)
npm run dev:client        # термінал 2: http://localhost:5173 (Vite проксує /api та /ws на сервер)
Тестування чату: два вікна браузера на :5173, одна кімната, відправка повідомлень через Enter.

## Запуск (продакшн-режим)
npm run build && npm start      # Node віддає client/dist на :3000
npm test                        # node:test - протокол, rate limit, кімнати, інтеграція WebSocket, HTTP-захисти

## Структура проєкту
server/src/app.js - сервер на node:http: статика (MIME + захист від path traversal), GET /health, GET/POST /api/rooms, GET /api/stats, GET /api/replays[/:id], debug-маршрути
server/src/rooms.js - Room успадковує EventEmitter (події join/leave/chat/empty), RoomManager
server/src/protocol.js - протокол v1 + validate(); ws.js - життєвий цикл, heartbeat, rate limit, політика повільного клієнта
server/src/log/matchlog.js - events.on(room) → Readable → NDJSON Transform → запис у файл через pipeline; replay.js - асинхронний генератор
client/src/connection.js - перепідключення з backoff та черга відправки; chatView.js, lobby.js (інтеграція з реальним API)

Коди закриття: 4001 join timeout, 4002 bad JSON, 4003 bad message, 4004 not joined, 4005 already joined, 4006 no such room, 4007 room full, 4008 rate limit, 1009 payload too big, 1013 too slow

## M3 - доказ backpressure
cd server && node tools/gen-log.js 200 logs/big.ndjson          # синтетичний лог на 200 MB
node tools/rss-sampler.js 60 > rss.csv                           # термінал 2: замір RSS кожні 500 мс
# у DevTools браузера -> Network -> обмеження (Slow 4G), запит http://localhost:5173/api/replays/big.ndjson
Аналіз rss.csv: лінія залишається рівною під час завантаження файлу на 200 MB. Мій результат: RSS до завантаження 41.3 MB, під час завантаження 36.8–44.3 MB (рівний рівень / близько ~41 MB, чиста зміна +1.3 MB за 60 с; пік 44.3 MB на 26.4 с, спад до 36.8 MB на 26.9 с, у кінці 42.6 MB на 60.0 с). Графік: `rss.csv` (117 замірів за 60 с у режимі Slow 4G).

## M4 - короткий звіт

1. Event loop під навантаженням
Фази: timers → pending → poll (I/O) → check (setImmediate) → close; nextTick та мікрозадачі промісів обробляються між фазами. Демонстрація: з DEBUG_ROUTES=1 виконано запит curl "localhost:3000/api/slow?ms=300" та одночасно перевірено відправку повідомлень у чаті з іншого вікна. Спостереження (затримка чату під час блокування, цифри): `GET /api/slow?ms=300` повернув `{"blockedMs":300}` за `0.303772s` (~303.8 мс); синхронне виконання в одному JS-потоці затримує наступні ітерації event loop та колбеки (зокрема повідомлення чату, таймери й heartbeat), доки синхронний цикл не завершиться і керування не повернеться до фаз циклу. Чому так: один потік виконує ВСІ обробники; синхронний цикл на 300 мс пригальмовує кожного підключеного клієнта, включно з heartbeat та таймерами.

2. Backpressure
Де проявилося в M3: при стрімінговому віддаванні реплею на 200 MB (`logs/big.ndjson`) через обмежене з'єднання (`Slow 4G`) у браузері через `pipeline`. Коли `write()` повертає `false` вище `highWaterMark` → зупиняємо генерацію/читання до події `drain`; `pipeline` робить це автоматично. Без цього: ігнорування повернення `write()` або буферизація всього файлу в пам'яті накопичували б чанки швидше, ніж повільний клієнт встигає їх забирати, що призвело б до необмеженого росту пам'яті.

3. Необроблена помилка ("error") або rejection валить сервер
curl "localhost:3000/api/debug/error"      # процес падає, код виходу 1
curl "localhost:3000/api/debug/error?safe=1"   # є слухач: сервер виживає
Фрагмент логу:
`curl.exe "http://127.0.0.1:3000/api/debug/error?safe=1"` -> `{"scheduled":true,"safe":true}` (сервер продовжує працювати)
`curl.exe "http://127.0.0.1:3000/api/debug/error"` -> `{"scheduled":true,"safe":false}`, далі у логах Vite/проксі:
`[vite] ws proxy error: Error: read ECONNRESET`
`[vite] ws proxy error: Error: connect ECONNREFUSED 127.0.0.1:3000` (серверний процес на `127.0.0.1:3000` упав і перестав приймати з'єднання).
Чому це зроблено навмисно: необроблена помилка означає, що процес перебуває в невідомому стані; безпечніше впасти й перезапуститися під супервайзером, ніж працювати далі з пошкодженим станом. Виправлення: слухач `emitter.on("error", ...)` або `.catch()`.

## Інші параметри для фіксації
Rate limit (token bucket, 10 повідомлень/с, burst 20), maxPayload 2 KB, максимум 4 гравці в кімнаті, максимум 20 кімнат, поріг повільного клієнта 64 KB.
