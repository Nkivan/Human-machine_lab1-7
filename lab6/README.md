# Dogfight — Lab 06: TypeScript

Уся кодова база (`shared`, `server`, `client`) переведена на TypeScript із `strict` та `noUncheckedIndexedAccess`, з **єдиним типізованим протоколом** і валідацією на кожній межі введення-виведення. Поведінка під час виконання залишилася незмінною: хеш детермінізму з Lab 5 ідентичний (`e34f5d00`), що підтверджується тестом.

## Запуск

```bash
npm install                 # рекомендовано Node 22; працює від Node >= 20.6 (сервер запускається через tsx)
npm run dev:server          # термінал 1 -> [http://127.0.0.1:3000](http://127.0.0.1:3000)
npm run dev:client          # термінал 2 -> http://localhost:5173 (два вікна в одній кімнаті)
npm run typecheck           # tsc --noEmit у кожному воркспейсі (Vite цього не виконує)
npm run lint                # typescript-eslint: без `any`, без `!`, мінімум приведень `as`
npm test                    # усі тести (shared, client, server)
npm run build
```
Нативний запуск TypeScript у Node >= 22.18 (або 22.6+ із прапорцем) без tsx: npm run start:native -w server.   Керування та URL-прапори такі самі, як у Lab 5 (?lat=100&jitter=30&drop=0.02, ?noise=4, ?hash=1, а також ?codec=json для JSON-кодека знімків).   CI: .github/workflows/ci.yml запускає npm ci && typecheck && lint && test && build.

Що змінилося (і чому)ДеЩо реалізованоtsconfig.base.jsonstrict, noUncheckedIndexedAccess, noImplicitOverride, verbatimModuleSyntax, erasableSyntaxOnly (без enum та parameter properties, щоб Node міг нативно прибирати типи), noUnused*   shared/компілюється без DOM і без типів Node: це підтверджує незалежність симуляції від платформи. Vector2 має readonly x, y; EntityId/Tick/Seq оформлені як branded-типи; Ship | Bullet | Asteroid | Pickup утворюють discriminated union за полем kind   shared/src/protocol/messages.tsєдине джерело істини: zod-схема -> виведений TS-тип -> парсер часу виконання для всіх JSON-повідомлень в обидва боки, записів знімків і HTTP API. parseClientMessage(data: unknown): Result<ClientMessage> не кидає винятків   shared/src/codec/бінарний декодер повертає Result без винятків; перший байт містить версію протоколу (старший нібл) для відсіювання застарілих клієнтів; інтерфейс Codec має бінарну та JSON-реалізації   shared/src/bus.tsтипізована шина Bus<E>: замінює EventTarget + CustomEvent (нетипізований detail) у симуляції, аудіо, HUD та лобі   server/src/config.tsзмінні середовища валідуються zod-схемою (значення за замовчуванням, приведення типів, зупинка при некоректній конфігурації)   server/src/rooms.tsRoom extends EventEmitter<RoomEvents> (узагальнений емітер Node): типи аргументів слухачів перевіряються компілятором   client/Vite компілює .ts без перевірки типів; перевірку виконує npm run typecheck. Дані з manifest.json, /api/rooms, текстові та бінарні WebSocket-фрейми проходять валідацію перед використанням
