// Constantes compartidas entre el servidor y los clientes.
(function (root) {
  'use strict';

  const COLORS = [
    { name: 'Rojo', hex: '#ec3b40', dark: '#9b1d22' },
    { name: 'Azul', hex: '#2f7cf6', dark: '#18469c' },
    { name: 'Amarillo', hex: '#f6c512', dark: '#a07f05' },
    { name: 'Verde', hex: '#27bf57', dark: '#157434' },
    { name: 'Naranja', hex: '#ff8a1f', dark: '#ad560a' },
    { name: 'Violeta', hex: '#9a5cf6', dark: '#5b31a6' },
    { name: 'Celeste', hex: '#22d0de', dark: '#0f838c' },
    { name: 'Rosa', hex: '#ff5ca7', dark: '#b02f6d' },
  ];

  const ITEMS = {
    turbo: { icon: '⚡', name: 'Turbo' },
    missile: { icon: '🚀', name: 'Misil' },
    mine: { icon: '💣', name: 'Mina' },
    oil: { icon: '🛢️', name: 'Aceite' },
    shield: { icon: '🛡️', name: 'Escudo' },
    wave: { icon: '💥', name: 'Onda' },
  };
  // Índices usados en las instantáneas de red
  const ITEM_LIST = ['', 'roll', 'turbo', 'missile', 'mine', 'oil', 'shield', 'wave'];

  const MODES = {
    knockout: { name: 'Eliminación', icon: '🏁', desc: 'La cámara sigue al que va primero. Si te quedás fuera de la pantalla, quedás eliminado.', items: true, arena: false },
    pure: { name: 'Carrera Pura', icon: '🏎️', desc: 'Igual que Eliminación pero sin power-ups: solo manejo.', items: false, arena: false },
    arena: { name: 'Batalla', icon: '💣', desc: 'Arena cerrada con 3 vidas por auto. El último que queda en pie gana.', items: true, arena: true },
  };

  const PHASES = ['lobby', 'intro', 'race', 'roundover', 'matchover'];

  // Bits de estado de cada auto
  const F = { ALIVE: 1, SPIN: 2, SHIELD: 4, TURBO: 8, OFFROAD: 16, SKID: 32, WARN: 64, FLASH: 128, SHIELD_LOW: 256, BRAKE: 512 };

  const api = {
    COLORS, ITEMS, ITEM_LIST, MODES, PHASES, F,
    TARGETS: [5, 10, 15],
    MAX_PLAYERS: 8,
    VIEW_W: 1400, VIEW_H: 790, // zona visible (y de eliminación) de la cámara compartida
    CAR_R: 19,
    INTRO_TIME: 0.6 + 0.8 * 3,
  };
  root.Common = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
