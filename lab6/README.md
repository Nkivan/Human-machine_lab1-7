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
