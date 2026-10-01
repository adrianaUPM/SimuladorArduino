// Editor Arduino/C++ basado en CodeMirror 6: resaltado, números de línea,
// indentación, autocompletado de la API soportada y errores en vivo.

import { autocompletion, type Completion, type CompletionContext } from '@codemirror/autocomplete';
import { indentWithTab } from '@codemirror/commands';
import { cpp } from '@codemirror/lang-cpp';
import { HighlightStyle, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { linter, lintGutter, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, keymap, type DecorationSet } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { basicSetup } from 'codemirror';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { CLASSES, CONSTANTS, FUNCTIONS, GLOBAL_OBJECTS, STRING_METHODS } from '../engine/library';
import { sim } from '../simulator/controller';

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.modifier], color: 'var(--syn-keyword)' },
  { tag: [t.typeName, t.standard(t.typeName)], color: 'var(--syn-type)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--syn-fn)' },
  { tag: [t.number, t.bool], color: 'var(--syn-num)' },
  { tag: [t.string, t.character], color: 'var(--syn-str)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.processingInstruction, t.macroName], color: 'var(--syn-macro)' },
  { tag: [t.operator, t.punctuation, t.bracket], color: 'var(--syn-op)' },
  { tag: [t.variableName, t.propertyName], color: 'var(--syn-var)' },
  { tag: [t.constant(t.variableName)], color: 'var(--syn-const)' },
]);

// ---------------------------------------------------------- autocompletado

const KEYWORDS = ['void', 'int', 'long', 'unsigned', 'float', 'double', 'bool', 'char', 'byte', 'String', 'const',
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'return', 'true', 'false',
  'uint8_t', 'uint16_t', 'uint32_t', 'int16_t', 'int32_t', 'volatile', 'static', 'sizeof'];

const globalCompletions: Completion[] = [
  ...Object.entries(FUNCTIONS).map(([name, f]) => ({
    label: name, type: 'function', detail: f.sig.slice(name.length), info: f.doc, apply: f.max === 0 ? `${name}()` : undefined,
  })),
  ...Object.entries(CONSTANTS).map(([name]) => ({ label: name, type: 'constant' })),
  ...Object.keys(GLOBAL_OBJECTS).map((name) => ({ label: name, type: 'variable', info: CLASSES[GLOBAL_OBJECTS[name]].doc })),
  ...Object.keys(CLASSES).filter((c) => !['HardwareSerial', 'TwoWire'].includes(c)).map((name) => ({ label: name, type: 'class', info: CLASSES[name].doc })),
  ...KEYWORDS.map((k) => ({ label: k, type: 'keyword' })),
  { label: 'setup', type: 'function', apply: 'void setup() {\n  \n}', detail: '() — plantilla' },
  { label: 'loop', type: 'function', apply: 'void loop() {\n  \n}', detail: '() — plantilla' },
];

function completions(ctx: CompletionContext) {
  // métodos tras un punto: Serial.  display.  servo.
  const member = ctx.matchBefore(/[A-Za-z_]\w*\.\w*/);
  if (member) {
    const [obj, partial] = member.text.split('.');
    const doc = ctx.state.doc.toString();
    let cls: string | undefined = GLOBAL_OBJECTS[obj];
    if (!cls) {
      const m = new RegExp(`\\b(${Object.keys(CLASSES).join('|')}|String)\\s+${obj}\\b`).exec(doc);
      cls = m?.[1];
    }
    if (cls === 'String') {
      return {
        from: member.from + obj.length + 1,
        options: Object.entries(STRING_METHODS).map(([name, m]) => ({ label: name, type: 'method', info: m.doc, apply: m.max === 0 ? `${name}()` : undefined })),
        validFor: /^\w*$/,
      };
    }
    if (cls && CLASSES[cls]) {
      return {
        from: member.from + obj.length + 1,
        options: Object.entries(CLASSES[cls].methods).map(([name, m]) => ({
          label: name, type: 'method', detail: m.sig.slice(m.sig.indexOf('(')), info: m.doc, apply: m.max === 0 ? `${name}()` : undefined,
        })),
        validFor: /^\w*$/,
      };
    }
    if (partial !== undefined) return null;
  }
  const word = ctx.matchBefore(/\w+/);
  if (!word || (word.from === word.to && !ctx.explicit)) return null;
  return { from: word.from, options: globalCompletions, validFor: /^\w*$/ };
}

// ---------------------------------------------------------- errores en vivo

const codeLinter = linter(
  (view) => {
    const diags = sim.check(view.state.doc.toString());
    const len = view.state.doc.length;
    return diags.map<CmDiagnostic>((d) => ({
      from: Math.min(d.from, len),
      to: Math.min(Math.max(d.to, d.from + 1), len),
      severity: d.severity,
      message: d.message,
    }));
  },
  { delay: 400 },
);

// ---------------------------------------------------------- línea de error en ejecución

const setErrorLine = StateEffect.define<number | null>();
const errorLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setErrorLine)) {
        if (e.value === null || e.value < 1 || e.value > tr.state.doc.lines) deco = Decoration.none;
        else {
          const line = tr.state.doc.line(e.value);
          deco = Decoration.set([Decoration.line({ class: 'cm-runtime-error-line' }).range(line.from)]);
        }
      }
    }
    if (tr.docChanged) deco = Decoration.none;
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export interface CodeEditorHandle {
  goToLine(line: number): void;
  focus(): void;
}

interface Props {
  value: string;
  resetKey: number;
  errorLine: number | null;
  onChange(code: string): void;
}

export const CodeEditor = forwardRef<CodeEditorHandle, Props>(function CodeEditor({ value, resetKey, errorLine, onChange }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        cpp(),
        keymap.of([indentWithTab]),
        indentUnit.of('  '),
        EditorState.tabSize.of(2),
        syntaxHighlighting(highlight),
        autocompletion({ override: [completions], icons: true }),
        codeLinter,
        lintGutter(),
        errorLineField,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current(u.state.doc.toString());
        }),
        EditorView.theme({ '&': { height: '100%' } }),
      ],
    });
    view.current = new EditorView({ state, parent: host.current! });
    return () => view.current?.destroy();
    // se recrea al cargar otro proyecto
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  useEffect(() => {
    view.current?.dispatch({ effects: setErrorLine.of(errorLine) });
    if (errorLine) goTo(errorLine);
  }, [errorLine]);

  const goTo = (line: number) => {
    const v = view.current;
    if (!v || line < 1 || line > v.state.doc.lines) return;
    const l = v.state.doc.line(line);
    v.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: 'center' }) });
  };

  useImperativeHandle(ref, () => ({
    goToLine: (line) => {
      goTo(line);
      view.current?.focus();
    },
    focus: () => view.current?.focus(),
  }));

  return <div className="editor-wrap" ref={host} />;
});
