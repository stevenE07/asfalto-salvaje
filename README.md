# Asfalto Salvaje

Juego de carreras de eliminación online **en 3D** (cámara aérea en perspectiva, con Three.js),
para **1 a 8 jugadores**.
**Cada jugador ve la carrera en su propia pantalla** (celular o compu) y juega desde ahí,
así que se puede jugar cada uno desde su casa. No hay que instalar nada: es una página web.

## Cómo se juega

1. Uno entra a la página, pone su nombre y toca **CREAR SALA**.
2. Comparte el link (botón **Invitar**) o el código de 4 letras. Los demás entran y tocan **UNIRME**.
3. El que creó la sala es el anfitrión 👑: elige el modo, suma bots si quiere y toca **¡EMPEZAR!**

Opcional: en una tele o proyector se puede abrir la página y elegir
**"Usar esta pantalla como TV"** para que todos miren la carrera en grande.

**Controles**

Como cada uno juega desde su propia pantalla, **cada jugador usa su propio teclado**
(o la pantalla táctil de su celular).

- Celular: botones **◀ ▶** para doblar (los dos juntos frenan) y botón redondo para el power-up.
  Conviene ponerlo **horizontal**.
- Compu: **← →** o **A D** para doblar, **↓ / S** frenar, **↑ / W / espacio** power-up.
- Cada uno puede cambiar sus teclas en **⌨️ Mis teclas** (en el inicio o en el lobby). La elección
  queda guardada en esa compu, así que no afecta a los demás jugadores.

**Modos**

| Modo | Cómo funciona |
| --- | --- |
| 🏁 Eliminación | La cámara sigue al que va primero. Si quedás fuera de pantalla, quedás eliminado. Con power-ups. |
| 🏎️ Carrera Pura | Igual, pero sin power-ups. |
| 💣 Batalla | Arena cerrada, 3 vidas por auto. El último en pie gana. |

**Trompo:** si le pegás fuerte a la **cola** de otro auto, un poco corrido hacia un costado,
lo mandás al trompo y queda girando y mirando para el otro lado. De frente, justo al medio,
sólo lo empujás. El escudo lo salva (se rompe y aguanta el golpe).

**Power-ups:** ⚡ Turbo · 🚀 Misil teledirigido · 💣 Mina · 🛢️ Aceite · 🛡️ Escudo · 💥 Onda expansiva.

**Puntos por ronda:** 1.º 3, 2.º 2, 3.º 1 (con 2 o 3 jugadores se reparten menos puntos).
Gana la copa el primero que llega al objetivo (5, 10 o 15). Si una ronda se alarga,
llega la **muerte súbita**: la pantalla (o la arena) se achica.

Se pueden sumar **bots** para completar lugares. En Batalla cada uno ve su propio auto
con un minimapa; en los modos de pista todos ven la misma cámara (la del que va primero).

## Correrlo localmente

```bash
npm install
npm start
# Abrí http://localhost:3000 (o http://IP-DE-TU-COMPU:3000 desde otros dispositivos de tu red)
```

## Publicarlo en Render

El repo incluye `render.yaml`. En Render: **New → Blueprint**, elegí este repositorio
y confirmá. Render instala las dependencias, arranca `node server.js` y expone la URL.

> En el plan gratuito, el servicio se duerme tras 15 minutos sin uso: la primera visita
> puede tardar ~1 minuto en despertar.

## Estructura

- `server.js` — servidor Express + WebSocket: salas, bucle de simulación a 60 Hz e instantáneas a ~30 Hz.
- `game/sim.js` — simulación autoritativa: física, power-ups, bots, reglas y rondas.
  La física es un modelo de bicicleta con fuerzas de neumático: ángulos de deriva por eje,
  transferencia de peso, círculo de fricción e inercia de giro propia, así que el auto
  sobrevira, subvira, se cruza si entrás pasado y se endereza con contravolante.
- `shared/` — pistas y constantes usadas por servidor y clientes.
- `public/index.html`, `public/app.js` — cliente: inicio, lobby, interpolación, HUD 2D y controles.
- `public/render3d.js` — render 3D con Three.js: pistas, arenas, autos, power-ups y efectos.
  El servidor sirve Three.js desde `node_modules` en `/vendor/three`, así que hace falta `npm install`.
- `public/sfx.js` — efectos de sonido sintetizados.
