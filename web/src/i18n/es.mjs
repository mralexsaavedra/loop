/* Generic (non-personal) Spanish UI copy — ported verbatim from the hand-
 * maintained legacy `data/nutrition/plan-web.html` for the tabs/strings
 * that exist so far (astro-plan-web slice 3: Mi día; the day builder's copy went with it). Anything
 * PERSONAL (page title/kicker/h1/sub/footer/notes) lives in the user's
 * gitignored `plan-data.json` `page` block instead — see
 * web/test/leak.test.mjs. */
export default {
  strings: {
    // the product name (document title, home-screen name): the same in every locale
    brand: 'LOOP',
    nav: {
      ariaLabel: 'Secciones',
      // four top-level tabs, in nav order; the former tabs are now sections (see `sections`)
      tabs: {
        home: { label: 'Inicio' },
        entreno: { label: 'Entreno' },
        health: { label: 'Salud' },
        nutricion: { label: 'Nutrición' },
      },
      // top bar date pill (the viewer's full date is the <time> inside it, read by assistive tech)
      today: 'Hoy',
      // the pill's day stepping (client/today-date.js): Inicio shows a past day; the label returns to today
      day: { group: 'Día mostrado', prev: 'Día anterior', next: 'Día siguiente', back: 'Volver a hoy' },
      // the dock's "+" button and its popover (client/nav-actions.js lists only the available actions)
      actions: { open: 'Acciones', close: 'Cerrar acciones', label: 'Acciones rápidas', addFood: 'Añadir comida', journal: 'Completar el diario', sync: 'Sincronizar' },
      // headings of the sections that used to be tabs of their own (Mi día/Tablas keep theirs)
      sections: {
        hoy: 'Entreno de hoy',
        dash: 'Intensidad (FC)',
      },
    },
    tablas: {
      heading: 'Equivalencias',
      // fixed reference values per natural unit (lib/nutrition/reference.mjs); today's amounts are in Plan de hoy
      refNote: 'Valores de referencia por unidad natural (pieza, cucharada o 100 g); no cambian con el día. Las cantidades de hoy están en Plan de hoy.',
      cols: { food: 'Alimento', ref: 'Referencia', f: 'G', typical: 'peso típico' },
      units: { raw: 'crudo', dry: 'seco', cooked: 'cocido', serving: 'ración', unit: 'ud' },
      desayunos: {
        icon: '☕', label: 'Desayunos',
        noteHtml: 'Elige el desayuno que mejor encaje con el día. Objetivo ~35–40 g de proteína. Las opciones del anclaje proteico están en la tabla <button class="lnk" onclick="jump(\'acc-anclaje\')">🥛 Anclaje proteico</button>.',
      },
      carboComida: { icon: '🍚', label: 'Carbo de la comida', note: 'Arroz y pasta, por 100 g en seco. La forma de la pasta no importa: mismo peso seco = mismos macros.' },
      carboCena: { icon: '🥔', label: 'Carbo de la cena', note: 'Patata y similares, por 100 g cocido/listo para comer.' },
      proteina: {
        icon: '🥩', label: 'Proteína',
        note: 'Carne y pescado por 100 g en crudo. Prioriza la magra a diario; deja la grasa para el capricho.',
        lean: 'Magras — base diaria', mod: 'Intermedias — con cabeza', fat: 'Grasas — capricho',
      },
      anclaje: { icon: '🥛', label: 'Anclaje proteico (~25 g)', note: 'Opciones rápidas para el día de descanso. El yogur ligero NO cuenta como proteína.' },
      postentreno: { icon: '🍌', label: 'Post-entreno', note: 'El batido ya lleva su carbo (plátano); los fiambres van con 1 tosta. El timing no es crítico.' },
      fruta: {
        icon: '🍎', label: 'Fruta',
        note: 'De postre o con la comida. Por pieza mediana (peso típico, no de etiqueta).',
      },
      postre: { icon: '🍨', label: 'Postre', note: 'Para comida y cena. La fruta es lo más ligero; el yogur con frutos secos y miel, lo más completo. El yogur ligero NO cuenta como proteína.' },
      verduras: { icon: '🥦', label: 'Verduras', note: 'Cómelas casi libres en un déficit — sacian y suman poco. Valores estándar orientativos, por 100 g.' },
      quesos: { icon: '🧀', label: 'Quesos y salsas', note: 'Suman grasa/sal → cuéntalas, no son "gratis".' },
      supplementsHeading: 'Suplementación',
      supplementsFallbackHtml: '<div class="meal">\n    <div class="supp"><span class="when">Comida</span><div class="what">Creatina monohidrato<small>3 g, con agua</small></div></div>\n    <div class="supp"><span class="when">Cena</span><div class="what">Magnesio<small>según dosis del producto · puede ayudar al sueño</small></div></div>\n    <div class="supp"><span class="when">Entreno</span><div class="what">Electrolitos<small>días de calor / sesiones largas</small></div></div>\n  </div>',
      howToHeading: 'Cómo usarlo',
      howToHtml: '<b>Para cambiar un alimento, elígelo en Plan de hoy:</b> la proteína se ajusta a los mismos gramos de proteína y el resto del día se recalcula. Estas tablas son la referencia fija. En proteína tira del <b style="color:var(--lean)">verde</b> a diario; deja el <b style="color:var(--fat)">rojo</b> de capricho. La grasa que añaden los carbos aceitosos o el guacamole, cuéntala.',
    },
  },
};
