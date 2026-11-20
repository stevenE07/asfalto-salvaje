# Asfalto Salvaje

Juego de carreras de eliminación con vista desde arriba para **1 a 8 jugadores**.
La pantalla grande (tele, proyector o compu) muestra la carrera y cada jugador usa
**su celular como control** desde el navegador, sin instalar nada.

## Cómo se juega

1. Abrí la página principal en la pantalla grande.
2. Cada jugador escanea el QR (o entra a `/c`) y pone el código de 4 letras.
3. El primer celular que entra es el anfitrión 👑: elige el modo y arranca.
   También se puede empezar desde la pantalla grande con el botón **¡EMPEZAR!**

**Controles en el celular:** el auto acelera solo. **◀ ▶** doblan; los dos juntos
frenan. El botón redondo usa el power-up.

**Modos**

| Modo | Cómo funciona |
| --- | --- |
| 🏁 Eliminación | La cámara sigue al que va primero. Si quedás fuera de pantalla, quedás eliminado. Con power-ups. |
| 🏎️ Carrera Pura | Igual, pero sin power-ups. |
| 💣 Batalla | Arena cerrada, 3 vidas por auto. El último en pie gana. |

**Power-ups:** ⚡ Turbo · 🚀 Misil teledirigido · 💣 Mina · 🛢️ Aceite · 🛡️ Escudo · 💥 Onda expansiva.

**Puntos por ronda:** 1.º 3, 2.º 2, 3.º 1 (con 2 o 3 jugadores se reparten menos puntos).
Gana la copa el primero que llega al objetivo (5, 10 o 15). Si una ronda se alarga,
llega la **muerte súbita**: la pantalla (o la arena) se achica.

Se pueden sumar **bots** para completar lugares y hasta **2 jugadores con teclado**
en la misma compu (`← → ↑ ↓` y `A D W S`).

## Correrlo localmente

```bash
npm install
npm start
# Pantalla grande: http://localhost:3000
# Celulares (misma red): http://IP-DE-TU-COMPU:3000/c
```

## Publicarlo en Render

El repo incluye `render.yaml`. En Render: **New → Blueprint**, elegí este repositorio
y confirmá. Render instala las dependencias, arranca `node server.js` y expone la URL.

> En el plan gratuito, el servicio se duerme tras 15 minutos sin uso: la primera visita
> puede tardar ~1 minuto en despertar.

## Estructura

- `server.js` — servidor Express + WebSocket que maneja las salas y reenvía los controles.
- `public/index.html`, `public/game.js` — pantalla principal: simulación, render y lobby.
- `public/tracks.js` — pistas y arenas.
- `public/c.html`, `public/controller.js` — control para el celular.
- `public/sfx.js` — efectos de sonido sintetizados.
