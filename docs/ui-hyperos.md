# Referencia de UI/UX: Notas de HyperOS (Xiaomi)

Rescatado de capturas de la app Notas de HyperOS el 31 oct 2026. **La webapp
debe verse así desde el principio** (en móvil y escritorio), con el lenguaje de
la app de tareas solo como parentesco de familia (chips, píldora flotante de
acciones, FAB). Más adelante puede haber una variante Material 3 Expressive.

Tres acotaciones de Samuel que mandan sobre todo lo demás:

- **Sin pestaña de tareas.** HyperOS tiene una barra inferior Notas / Tareas;
  nosotros no. Una sola app, una sola lista.
- **Sin asistente de escritura con IA** dentro del editor (la varita de HyperOS
  no existe aquí). La integración con Claude es por MCP, fuera del editor.
- **Fondos de nota "estilizados" a futuro**: HyperOS deja cambiar el "papel"
  de cada nota (blanco, crema, verde con hojas, azul marino…). No va en v1,
  pero el modelo reserva sitio: `notes.theme` (texto) cuando toque.

## Sensación general

- Fondo de la app **gris muy claro** (≈ `#F5F5F7`), tarjetas y superficies
  **blancas** con **radio grande** (≈ 20–24 px) y **sin sombra** (o apenas).
  La profundidad la da el contraste gris/blanco, no las sombras.
- **Mucho aire**: márgenes laterales de ≈ 28–32 px en pantalla de nota y
  lista; separación generosa entre filas.
- Tipografía **sans geométrica** (MiSans en Xiaomi; en web: Inter o la del
  sistema). La jerarquía se hace **por tamaño más que por peso**: los títulos
  grandes van en peso regular/medium, nunca negrita pesada.
- Iconos **de trazo fino, negros, sin fondo**, ≈ 24 px, muy separados.
- Un solo **acento: ámbar/amarillo** (≈ `#FFB300`): FAB, check de carpeta
  seleccionada, el "+" de nueva carpeta y el **caret/asa de selección con forma
  de gota** del editor. Texto principal negro, secundario gris (≈ `#8A8A8E`),
  encabezados de sección en gris-lila (≈ `#8C8FA8`).
- Textos de la UI en español, cortos: "Sin texto", "Nueva carpeta", "Mover a".

## Pantalla: lista de notas

- Cabecera sin barra: solo dos iconos arriba a la derecha (**carpeta** y
  **ajustes**), nada a la izquierda.
- Título de página **"Notas" grande** (≈ 34 px, regular) alineado a la
  izquierda, debajo de los iconos.
- **Cuadrícula de 2 columnas** (en ajustes se puede pasar a lista). Cada
  tarjeta blanca redondeada muestra, en este orden: **imagen de portada** (si
  la nota tiene una, recortada al ancho de la tarjeta con esquinas superiores
  redondeadas), **título** (≈ 22 px, negro, una línea con elipsis),
  **fragmento** del cuerpo en gris (o "Sin texto"), **fecha** en gris claro
  ("25 de Octubre"; con hora solo si es de hoy).
- La cuadrícula es tipo *masonry*: las tarjetas con imagen son más altas y
  las columnas no se alinean entre sí.
- **FAB circular ámbar** con "+" blanco, abajo a la derecha, grande (≈ 64 px).
- En escritorio: la misma lista en 3–4 columnas, con las carpetas en una
  barra lateral fija a la izquierda en vez de una pantalla aparte.

## Pantalla: carpetas

- Cabecera con **flecha atrás** a la izquierda, título **"Carpetas"
  centrado**, icono de **papelera** a la derecha (es el acceso a la papelera).
- Lista de **tarjetas blancas** redondeadas, una por carpeta: nombre a la
  izquierda, **contador** gris a la derecha; la carpeta activa lleva un
  **check ámbar** a la izquierda. "Todo" es la primera (todas las notas).
- Última tarjeta: **"Nueva carpeta"** con un "+" circular ámbar centrado y el
  texto debajo.
- Nosotros: carpetas **anidadas** (sangría o desplegable dentro de la
  tarjeta), **Fijadas** como primera sección de la lista de notas, y las
  **#etiquetas** como chips (como en tareas) en la lista, no aquí.

## Pantalla: nota (lectura)

- Flecha atrás a la izquierda; a la derecha **compartir**, **paleta** (fondo
  de la nota, a futuro) y **⋮**.
- **Título grande** (≈ 32 px, regular) y debajo una línea de **metadatos en
  gris**: fecha con hora y conteo ("25 de octubre 6:43 PM | 0 caracteres").
- Imágenes a todo el ancho del área de contenido, **esquinas muy
  redondeadas** (≈ 24 px).
- Menú ⋮ de HyperOS: Recordatorio, Ocultar, Colocar en la pantalla de inicio,
  Mover a, Eliminar. **El nuestro**: Fijar/Desfijar, Mover a, Historial de
  versiones, Compartir, Mover a la papelera. Sin recordatorios ni ocultar.
- Con un fondo "estilizado" activo, el **lienzo entero** cambia (cabecera
  incluida) con una ilustración sutil y el texto pasa a blanco si el fondo es
  oscuro. El selector es un **carrusel inferior de miniaturas** del papel
  (blanco con líneas, crema, verde hojas, azul marino) con la elegida marcada
  por un borde ámbar. Guardar para v2.

## Pantalla: nota (edición)

- Cabecera: flecha atrás; a la derecha **deshacer / rehacer** (gris cuando no
  hay nada) y un **check** para terminar la edición. La nota se guarda sola;
  el check solo cierra el teclado/modo edición.
- Arriba a la izquierda del contenido, un **chip gris con icono de carpeta**
  ("Sin categoría") que abre "Mover a".
- **Caret ámbar con asa en forma de gota** (en web: `caret-color` ámbar y
  asa de selección nativa; no hace falta imitar la gota).
- **Barra de herramientas pegada encima del teclado**, de una sola fila, que
  se **desplaza en horizontal**, con una **X al final** para cerrarla. Los
  iconos van agrupados con separadores verticales finos:
  1. Barra base: *(varita IA: NO)* · audio *(no en v1)* · **imagen** ·
     lápiz *(dibujo: futuro)* · **casilla (to-do)** · **T (formato de texto)**.
  2. Al tocar **T**: resaltador · **H1 · H2 · H3** · **B** · *(sigue)*
     **I · U · S** · **lista de viñetas** · **lista numerada** · *(sigue)*
     bloque (¿tabla/código?) · **cita** · alineación centro · alineación
     derecha · **sangría +** · sangría − (gris si no aplica).
- Nuestra barra, con el mismo patrón (una fila, scroll, grupos, X):
  `Imagen · ☑ To-do · T` → `H1 H2 H3 · B I U S · • 1. · " · </> · ― · ⇥ ⇤`.
  Sin varita, sin audio; el lápiz aparece cuando exista.
- En escritorio la misma barra va fija arriba del editor (o flotante sobre la
  selección), pero con los mismos iconos y grupos.

## Pantalla: ajustes

- Título grande **"Notas"**, flecha atrás. Secciones con **encabezado en
  gris-lila** y cada sección en **una tarjeta blanca** con filas separadas sin
  líneas.
- Filas con el **valor a la derecha** y un **stepper ^v** (Tamaño de fuente:
  Mediana · Ordenar: Por fecha de modificación · Diseño: Ver en cuadrícula).
  Filas de navegación con **>**. Toggles tipo píldora.
- Las nuestras: *Estilo*: Tamaño de fuente, Ordenar, Diseño (cuadrícula /
  lista). *Notas*: **Título automático en notas nuevas** (on/off, como Apple),
  Fondo de nota *(v2)*. *Cuenta*: usuario, cerrar sesión. *Datos*:
  Elementos eliminados recientemente (papelera), Importar (Obsidian),
  Exportar. Sin "Servicios de la nube" ni recordatorios.

## Lo que se hereda de la app de tareas (parentesco)

De las capturas de tareas que llegaron junto a estas: los **chips** de
filtro/etiqueta (píldoras grises, texto gris oscuro), la **píldora flotante
oscura de acciones** al seleccionar ("→ Mover · 🗑 · ⋯"), la **tarjeta blanca
que se expande** al abrir un elemento en la lista, y el FAB circular. Aquí
el FAB es ámbar, no azul.

## Resumen en tokens (punto de partida para `styles.css`)

```
--bg: #F5F5F7;   --surface: #FFFFFF;   --text: #111;   --muted: #8A8A8E;
--section: #8C8FA8;   --accent: #FFB300;   --radius-card: 22px;
--radius-img: 24px;   --gutter: 28px;   --fab: 64px;
--title-page: 34px/400;   --title-note: 32px/400;   --title-card: 22px/500;
```
