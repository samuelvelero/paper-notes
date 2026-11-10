/* ═══════════════ editor.js — el editor WYSIWYG sobre ProseMirror ═══════════════
   La única pieza que sabe de ProseMirror. El resto de la app habla con esta
   API pequeña (PLAN.md §5), para poder cambiar de motor sin tocar nada más:

     editorOpen(host, markdown, { onChange, onWikilink, onTag })
     editorMarkdown()      → Markdown actual (mdpm.js)
     editorSet(markdown)   → reemplaza el documento (llegó de otro dispositivo)
     editorCmd(nombre, arg)
     editorState()         → qué marcas/bloque están activos (para la barra)
     editorFocus() / editorBlur() / editorDestroy() / editorIsEmpty()

   Markdown entra y sale por mdpm.js; aquí no hay sintaxis. Las #etiquetas y
   los [[enlaces]] son texto decorado (no nodos), así que escribir uno es
   escribir texto normal. */
'use strict';

const ED = { view: null, schema: null, cbs: {} };

function edSchema() {
  if (ED.schema) return ED.schema;
  ED.schema = new PM.model.Schema(MDPM.schemaSpec);
  return ED.schema;
}

/* ─── decoraciones: #etiqueta y [[enlace]] ─── */
const ED_TAG_RE = /(^|[\s(\[])#([A-Za-z_À-ɏ][\w\-\/À-ɏ]{0,59})/g;
const ED_LINK_RE = /\[\[([^\]\n|]+?)(?:\|[^\]\n]*)?\]\]/g;
function edDecorations(doc) {
  const decos = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock || node.type.name === 'code_block') return;
    node.forEach((child, off) => {
      if (!child.isText || child.marks.some(m => m.type.name === 'code')) return;
      const base = pos + 1 + off, text = child.text;
      let m;
      ED_TAG_RE.lastIndex = 0;
      while ((m = ED_TAG_RE.exec(text))) {
        const from = base + m.index + m[1].length;
        decos.push(PM.view.Decoration.inline(from, from + 1 + m[2].length, { class: 'ed-tag', 'data-tag': m[2].replace(/[-\/]+$/, '').toLowerCase() }));
      }
      ED_LINK_RE.lastIndex = 0;
      while ((m = ED_LINK_RE.exec(text))) {
        const from = base + m.index;
        decos.push(PM.view.Decoration.inline(from, from + m[0].length, { class: 'ed-wikilink', 'data-link': m[1].trim() }));
      }
    });
  });
  return PM.view.DecorationSet.create(doc, decos);
}
const edDecoPlugin = () => new PM.state.Plugin({
  state: {
    init: (_, s) => edDecorations(s.doc),
    apply: (tr, old) => (tr.docChanged ? edDecorations(tr.doc) : old),
  },
  props: {
    decorations(s) { return this.getState(s); },
    handleClick(view, pos, ev) {
      const t = ev.target;
      if (t && t.classList) {
        if (t.classList.contains('ed-wikilink') && ED.cbs.onWikilink) { ED.cbs.onWikilink(t.getAttribute('data-link')); return true; }
        if (t.classList.contains('ed-tag') && ED.cbs.onTag && (ev.metaKey || ev.ctrlKey)) { ED.cbs.onTag(t.getAttribute('data-tag')); return true; }
      }
      return false;
    },
  },
});

/* ─── vistas de nodo: casilla de to-do e imagen ─── */
class TodoView {
  constructor(node, view, getPos) {
    this.dom = document.createElement('li');
    this.dom.className = 'todo' + (node.attrs.checked ? ' done' : '');
    this.dom.setAttribute('data-checked', node.attrs.checked ? 'true' : 'false');
    const box = document.createElement('span');
    box.className = 'todo-box'; box.contentEditable = 'false';
    box.innerHTML = I.check();
    box.addEventListener('mousedown', e => {
      e.preventDefault();
      const pos = getPos();
      view.dispatch(view.state.tr.setNodeMarkup(pos, null, { checked: !view.state.doc.nodeAt(pos).attrs.checked }));
    });
    this.contentDOM = document.createElement('div');
    this.contentDOM.className = 'todo-body';
    this.dom.append(box, this.contentDOM);
  }
  update(node) {
    if (node.type.name !== 'todo_item') return false;
    this.dom.classList.toggle('done', !!node.attrs.checked);
    this.dom.setAttribute('data-checked', node.attrs.checked ? 'true' : 'false');
    return true;
  }
  ignoreMutation(m) { return m.target === this.dom || (m.target.classList && m.target.classList.contains('todo-box')); }
}
class ImageView {
  constructor(node) {
    this.dom = document.createElement('figure');
    this.dom.className = 'ed-img';
    const img = document.createElement('img');
    img.alt = node.attrs.alt || '';
    img.src = edResolveSrc(node.attrs.src);
    img.draggable = false;
    img.onerror = () => { this.dom.classList.add('broken'); };
    this.dom.appendChild(img);
    this.img = img;
  }
  update(node) { if (node.type.name !== 'image') return false; const s = edResolveSrc(node.attrs.src); if (this.img.src !== s) this.img.src = s; return true; }
  selectNode() { this.dom.classList.add('sel'); }
  deselectNode() { this.dom.classList.remove('sel'); }
  stopEvent() { return false; }
}
function edResolveSrc(src) {
  const m = /^attachments\/([a-z0-9]{15})$/.exec(src || '');
  if (m) return (typeof attUrl === 'function' && attUrl(m[1], '800x0')) || '';
  return src;
}

/* ─── reglas de entrada: escribir Markdown lo convierte en formato al vuelo ─── */
function edInputRules(schema) {
  const { wrappingInputRule, textblockTypeInputRule, InputRule, inputRules } = PM.inputrules;
  const rules = [
    textblockTypeInputRule(/^(#{1,3})\s$/, schema.nodes.heading, m => ({ level: m[1].length })),
    wrappingInputRule(/^\s*(?:-|\*|\+)\s\[([ xX])\]\s$/, schema.nodes.todo_list, m => ({ checked: m[1] !== ' ' })),
    wrappingInputRule(/^\s*\[([ xX]?)\]\s$/, schema.nodes.todo_list, m => ({ checked: !!m[1].trim() })),
    wrappingInputRule(/^\s*(?:-|\*|\+)\s$/, schema.nodes.bullet_list),
    wrappingInputRule(/^(\d+)[.)]\s$/, schema.nodes.ordered_list, m => ({ order: +m[1] }), (m, node) => node.childCount + node.attrs.order === +m[1]),
    wrappingInputRule(/^\s*>\s$/, schema.nodes.blockquote),
    textblockTypeInputRule(/^```(\w*)\s$/, schema.nodes.code_block, m => ({ lang: m[1] })),
    new InputRule(/^(?:---|\*\*\*|___)$/, (state, match, start, end) => state.tr.replaceWith(start - 1, end, schema.nodes.horizontal_rule.create())),
    markRule(/(?:^|[^*])(\*\*([^*\s][^*]*?[^*\s]|[^*\s])\*\*)$/, schema.marks.strong),
    markRule(/(?:^|[^~])(~~([^~\s][^~]*?[^~\s]|[^~\s])~~)$/, schema.marks.strike),
    markRule(/(?:^|[^+])(\+\+([^+\s][^+]*?[^+\s]|[^+\s])\+\+)$/, schema.marks.underline),
    markRule(/(?:^|\s)(`([^`\s][^`]*?[^`\s]|[^`\s])`)$/, schema.marks.code),
  ];
  return inputRules({ rules });
  /* `**texto**` → negrita (el grupo 1 es lo que se reemplaza, el 2 el texto). */
  function markRule(re, mark) {
    return new InputRule(re, (state, match, start, end) => {
      /* `start`..`end` es lo que casó match[0] en el documento (el texto
         recién tecleado aún no está insertado: lo aporta la regla). */
      const full = match[1], inner = match[2];
      const from = start + (match[0].length - full.length);
      /* Si llegó de golpe más texto del que casa (pegado, dictado), lo que
         precede a la marca dentro de lo tecleado se conserva tal cual. */
      const typedLen = match[0].length - (end - start);
      const typed = match[0].slice(match[0].length - typedLen);
      const prefix = from > end ? typed.slice(0, from - end) : '';
      const at = Math.min(from, end);
      const tr = state.tr.insertText(prefix + inner, at, end);
      tr.addMark(at + prefix.length, at + prefix.length + inner.length, mark.create());
      tr.removeStoredMark(mark);
      return tr;
    });
  }
}

/* ─── atajos ─── */
function edKeymap(schema) {
  const { toggleMark, setBlockType, wrapIn, lift, chainCommands, exitCode, createParagraphNear, liftEmptyBlock, splitBlock, selectParentNode } = PM.commands;
  const { splitListItem, liftListItem, sinkListItem } = PM.schemaList;
  const { undo, redo } = PM.history;
  const hard = (state, dispatch) => { dispatch && dispatch(state.tr.replaceSelectionWith(schema.nodes.hard_break.create()).scrollIntoView()); return true; };
  const splitList = chainCommands(splitTodo, splitListItem(schema.nodes.list_item), splitListItem(schema.nodes.todo_item));
  const liftList = chainCommands(liftListItem(schema.nodes.list_item), liftListItem(schema.nodes.todo_item));
  const sinkList = chainCommands(sinkListItem(schema.nodes.list_item), sinkListItem(schema.nodes.todo_item));
  const keys = {
    'Mod-z': undo, 'Shift-Mod-z': redo, 'Mod-y': redo,
    'Mod-b': toggleMark(schema.marks.strong), 'Mod-i': toggleMark(schema.marks.em), 'Mod-u': toggleMark(schema.marks.underline),
    'Shift-Mod-x': toggleMark(schema.marks.strike), 'Mod-e': toggleMark(schema.marks.code),
    'Shift-Enter': chainCommands(exitCode, hard), 'Mod-Enter': chainCommands(exitCode, hard),
    'Enter': chainCommands(splitList, exitCodeAtEnd, createParagraphNear, liftEmptyBlock, splitBlock),
    'Tab': sinkList, 'Shift-Tab': liftList,
    'Backspace': chainCommands(backspaceInList(liftList), PM.commands.deleteSelection, PM.commands.joinBackward, PM.commands.selectNodeBackward),
    'Shift-Mod-8': edToggleList('bullet_list'), 'Shift-Mod-7': edToggleList('ordered_list'), 'Shift-Mod-9': edToggleList('todo_list'),
    'Shift-Mod-0': setBlockType(schema.nodes.paragraph),
    'Mod-Alt-1': setBlockType(schema.nodes.heading, { level: 1 }), 'Mod-Alt-2': setBlockType(schema.nodes.heading, { level: 2 }), 'Mod-Alt-3': setBlockType(schema.nodes.heading, { level: 3 }),
    'Escape': selectParentNode,
  };
  void wrapIn; void lift;
  return PM.keymap.keymap(keys);
  /* Enter en un to-do hecho crea el siguiente sin hacer. */
  function splitTodo(state, dispatch) {
    const { $from } = state.selection;
    const item = $from.node(-1);
    if (!item || item.type !== schema.nodes.todo_item) return false;
    if (!item.attrs.checked) return false;
    const cmd = splitListItem(schema.nodes.todo_item, { checked: false });
    return cmd(state, dispatch);
  }
  /* Retroceso al principio de un elemento de lista vacío o no: lo saca de la lista. */
  function backspaceInList(liftCmd) {
    return (state, dispatch) => {
      const { $from, empty } = state.selection;
      if (!empty || $from.parentOffset !== 0) return false;
      const item = $from.node(-1);
      if (!item || (item.type !== schema.nodes.list_item && item.type !== schema.nodes.todo_item)) return false;
      if ($from.index(-1) !== 0) return false;   // no es el primer bloque del elemento
      return liftCmd(state, dispatch);
    };
  }
  /* Enter al final de un bloque de código con línea vacía: sale del bloque. */
  function exitCodeAtEnd(state, dispatch) {
    const { $from } = state.selection;
    if ($from.parent.type !== schema.nodes.code_block) return false;
    if (!/\n$/.test($from.parent.textContent) || $from.parentOffset !== $from.parent.content.size) return false;
    if (dispatch) {
      const tr = state.tr.delete($from.pos - 1, $from.pos);
      const after = tr.mapping.map($from.after());
      tr.insert(after, schema.nodes.paragraph.create());
      tr.setSelection(PM.state.TextSelection.create(tr.doc, after + 1)).scrollIntoView();
      dispatch(tr);
    }
    return true;
  }
}

/* Alternar lista: si ya estamos en una de ese tipo, la deshace; si es de otro
   tipo, la cambia; si no hay lista, envuelve. */
function edToggleList(type) {
  return (state, dispatch) => {
    const schema = state.schema;
    const listType = schema.nodes[type];
    const itemType = type === 'todo_list' ? schema.nodes.todo_item : schema.nodes.list_item;
    const { $from, $to } = state.selection;
    const range = $from.blockRange($to, n => n.childCount > 0 && (n.firstChild.type === schema.nodes.list_item || n.firstChild.type === schema.nodes.todo_item));
    if (range) {
      const list = range.parent;
      if (list.type === listType) {
        const lift = PM.schemaList.liftListItem(list.firstChild.type);
        return lift(state, dispatch);
      }
      /* cambiar el tipo de lista y de sus elementos */
      if (dispatch) {
        const tr = state.tr;
        const listPos = range.start - 1;   // antes del nodo lista... (range.start es dentro)
        const $list = state.doc.resolve(range.start);
        const pos = $list.before($list.depth);
        const node = state.doc.nodeAt(pos);
        if (node && node === list) {
          const items = [];
          list.forEach(it => items.push(itemType.create(itemType === schema.nodes.todo_item ? { checked: !!it.attrs.checked } : null, it.content)));
          tr.replaceWith(pos, pos + list.nodeSize, listType.create(listType === schema.nodes.ordered_list ? { order: 1 } : null, items));
          dispatch(tr.scrollIntoView());
        }
        void listPos;
      }
      return true;
    }
    return PM.schemaList.wrapInList(listType, type === 'todo_list' ? { checked: false } : null)(state, dispatch);
  };
}

/* ─── API ─── */
function editorOpen(host, markdown, cbs) {
  editorDestroy();
  ED.cbs = cbs || {};
  const schema = edSchema();
  const doc = schema.nodeFromJSON(MDPM.parse(markdown));
  const state = PM.state.EditorState.create({ doc, plugins: [
    edInputRules(schema), edKeymap(schema), PM.keymap.keymap(PM.commands.baseKeymap),
    PM.history.history(), PM.dropcursor.dropCursor({ class: 'ed-drop' }), PM.gapcursor.gapCursor(), edDecoPlugin(),
  ] });
  ED.view = new PM.view.EditorView(host, {
    state,
    nodeViews: { todo_item: (n, v, g) => new TodoView(n, v, g), image: n => new ImageView(n) },
    attributes: { class: 'ed', spellcheck: 'true', autocorrect: 'on', autocapitalize: 'sentences' },
    dispatchTransaction(tr) {
      const s = ED.view.state.apply(tr);
      ED.view.updateState(s);
      if (tr.docChanged && ED.cbs.onChange) ED.cbs.onChange();
      if (ED.cbs.onSelection && (tr.docChanged || tr.selectionSet)) ED.cbs.onSelection();
    },
    handleDOMEvents: {
      focus() { ED.cbs.onFocus && ED.cbs.onFocus(); return false; },
      blur() { ED.cbs.onBlur && ED.cbs.onBlur(); return false; },
      mousedown(view, ev) { return edClickBelow(view, ev); },
      paste(view, ev) { return edPaste(view, ev); },
      drop(view, ev) { return edDropFiles(view, ev); },
    },
  });
  return ED.view;
}
/* Clic en el hueco de debajo del último bloque: si ese bloque no es un
   párrafo (lista, to-do, cita, código, imagen, separador), no hay dónde
   poner el cursor para seguir con cuerpo de texto. Se crea el párrafo. */
function edClickBelow(view, ev) {
  if (ev.button !== 0 || ev.target !== view.dom) return false;
  const last = view.dom.lastElementChild;
  if (!last || ev.clientY <= last.getBoundingClientRect().bottom) return false;
  const doc = view.state.doc, node = doc.lastChild;
  if (!node || node.type.name === 'paragraph' || node.type.name === 'heading') return false;
  const p = view.state.schema.nodes.paragraph.create();
  const tr = view.state.tr.insert(doc.content.size, p);
  tr.setSelection(PM.state.TextSelection.create(tr.doc, tr.doc.content.size - 1)).scrollIntoView();
  view.dispatch(tr); view.focus();
  ev.preventDefault();
  return true;
}
/* Pegar imágenes del portapapeles → subirlas; texto con sintaxis Markdown →
   interpretarlo (si parece Markdown y no hay HTML). */
function edPaste(view, ev) {
  const items = ev.clipboardData && ev.clipboardData.items;
  if (items) for (const it of items) {
    if (it.kind === 'file' && /^image\//.test(it.type)) { const f = it.getAsFile(); if (f && ED.cbs.onImage) { ED.cbs.onImage(f); ev.preventDefault(); return true; } }
  }
  const html = ev.clipboardData && ev.clipboardData.getData('text/html');
  const text = ev.clipboardData && ev.clipboardData.getData('text/plain');
  if (!html && text && /(^|\n)\s*(#{1,3}\s|[-*+]\s|\d+[.)]\s|>\s|```)|\*\*|\[[^\]]+\]\(/.test(text)) {
    const doc = view.state.schema.nodeFromJSON(MDPM.parse(text));
    view.dispatch(view.state.tr.replaceSelection(new PM.model.Slice(doc.content, 0, 0)).scrollIntoView());
    ev.preventDefault();
    return true;
  }
  return false;
}
function edDropFiles(view, ev) {
  const files = ev.dataTransfer && ev.dataTransfer.files;
  if (!files || !files.length) return false;
  let any = false;
  for (const f of files) if (/^image\//.test(f.type) && ED.cbs.onImage) { ED.cbs.onImage(f); any = true; }
  if (any) ev.preventDefault();
  return any;
}
/* Pegar desde el menú contextual (la app leyó el portapapeles): por el mismo
   camino que Ctrl+V, así el Markdown pegado también se interpreta. */
function editorPaste({ text, html }) {
  if (!ED.view) return;
  const v = ED.view;
  v.focus();
  if (!html && text && /(^|\n)\s*(#{1,3}\s|[-*+]\s|\d+[.)]\s|>\s|```)|\*\*|\[[^\]]+\]\(/.test(text)) {
    const doc = v.state.schema.nodeFromJSON(MDPM.parse(text));
    v.dispatch(v.state.tr.replaceSelection(new PM.model.Slice(doc.content, 0, 0)).scrollIntoView());
  } else if (html) v.pasteHTML(html);
  else if (text) v.pasteText(text);
}
function editorMarkdown() { return ED.view ? MDPM.serialize(ED.view.state.doc.toJSON()) : ''; }
function editorSet(markdown) {
  if (!ED.view) return;
  const schema = edSchema();
  const doc = schema.nodeFromJSON(MDPM.parse(markdown));
  const tr = ED.view.state.tr.replaceWith(0, ED.view.state.doc.content.size, doc.content);
  tr.setMeta('addToHistory', false);
  ED.view.dispatch(tr);
}
function editorIsEmpty() { return ED.view ? !ED.view.state.doc.textContent.trim() && !ED.view.state.doc.content.content.some(n => n.type.name === 'image') : true; }
function editorFocus() { ED.view && ED.view.focus(); }
function editorBlur() { ED.view && ED.view.dom.blur(); }
function editorDestroy() { if (ED.view) { const v = ED.view; ED.view = null; v.destroy(); } }
function editorHasFocus() { return !!(ED.view && ED.view.hasFocus()); }

/* Comandos de la barra. Devuelve true si hizo algo. */
function editorCmd(name, arg) {
  if (!ED.view) return false;
  const v = ED.view, s = v.state, schema = s.schema;
  const { toggleMark, setBlockType, wrapIn, lift } = PM.commands;
  const run = cmd => { const ok = cmd(s, v.dispatch, v); v.focus(); return ok; };
  switch (name) {
    case 'undo': return run(PM.history.undo);
    case 'redo': return run(PM.history.redo);
    case 'bold': return run(toggleMark(schema.marks.strong));
    case 'italic': return run(toggleMark(schema.marks.em));
    case 'underline': return run(toggleMark(schema.marks.underline));
    case 'strike': return run(toggleMark(schema.marks.strike));
    case 'codeInline': return run(toggleMark(schema.marks.code));
    case 'h1': case 'h2': case 'h3': {
      const level = +name[1];
      const cur = edBlock(s);
      if (cur === 'heading' + level) return run(setBlockType(schema.nodes.paragraph));
      return run(setBlockType(schema.nodes.heading, { level }));
    }
    case 'para': return run(setBlockType(schema.nodes.paragraph));
    case 'bullet': return run(edToggleList('bullet_list'));
    case 'ordered': return run(edToggleList('ordered_list'));
    case 'todo': return run(edToggleList('todo_list'));
    case 'quote': {
      if (edInside(s, 'blockquote')) return run(lift);
      return run(wrapIn(schema.nodes.blockquote));
    }
    case 'code': {
      if (edBlock(s) === 'code_block') return run(setBlockType(schema.nodes.paragraph));
      return run(setBlockType(schema.nodes.code_block));
    }
    case 'hr': {
      const tr = s.tr.replaceSelectionWith(schema.nodes.horizontal_rule.create());
      v.dispatch(tr.scrollIntoView()); v.focus(); return true;
    }
    case 'indent': return run(PM.commands.chainCommands(PM.schemaList.sinkListItem(schema.nodes.list_item), PM.schemaList.sinkListItem(schema.nodes.todo_item)));
    case 'outdent': return run(PM.commands.chainCommands(PM.schemaList.liftListItem(schema.nodes.list_item), PM.schemaList.liftListItem(schema.nodes.todo_item), lift));
    case 'image': {
      const node = schema.nodes.image.create({ src: arg, alt: '' });
      const tr = s.tr.replaceSelectionWith(node);
      v.dispatch(tr.scrollIntoView()); v.focus(); return true;
    }
    case 'link': {
      const href = arg;
      if (!href) return run(toggleMark(schema.marks.link, {}));
      if (s.selection.empty) { const tr = s.tr.insertText(href); tr.addMark(s.selection.from, s.selection.from + href.length, schema.marks.link.create({ href })); v.dispatch(tr); v.focus(); return true; }
      return run(toggleMark(schema.marks.link, { href }));
    }
    case 'focusEnd': {
      const tr = s.tr.setSelection(PM.state.Selection.atEnd(s.doc));
      v.dispatch(tr); v.focus(); return true;
    }
    case 'selectAll': return run(PM.commands.selectAll);
    case 'focusStart': {
      const tr = s.tr.setSelection(PM.state.Selection.atStart(s.doc));
      v.dispatch(tr); v.focus(); return true;
    }
  }
  return false;
}
function edBlock(s) {
  const n = s.selection.$from.parent;
  if (n.type.name === 'heading') return 'heading' + n.attrs.level;
  return n.type.name;
}
function edInside(s, type) {
  const $from = s.selection.$from;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === type) return true;
  return false;
}
function edListType(s) {
  const $from = s.selection.$from;
  for (let d = $from.depth; d > 0; d--) { const t = $from.node(d).type.name; if (t === 'bullet_list' || t === 'ordered_list' || t === 'todo_list') return t; }
  return null;
}
/* Para pintar la barra: qué está activo donde está el cursor. */
function editorState() {
  if (!ED.view) return null;
  const s = ED.view.state;
  const marks = {};
  const { from, $from, empty } = s.selection;
  for (const name of ['strong', 'em', 'underline', 'strike', 'code']) {
    const m = s.schema.marks[name];
    marks[name] = empty ? !!m.isInSet(s.storedMarks || $from.marks()) : s.doc.rangeHasMark(from, s.selection.to, m);
  }
  const list = edListType(s);
  return { marks, block: edBlock(s), list, quote: edInside(s, 'blockquote'),
    canUndo: PM.history.undoDepth(s) > 0, canRedo: PM.history.redoDepth(s) > 0,
    canIndent: !!list && PM.commands.chainCommands(PM.schemaList.sinkListItem(s.schema.nodes.list_item), PM.schemaList.sinkListItem(s.schema.nodes.todo_item))(s),
    canOutdent: !!list || edInside(s, 'blockquote') };
}
