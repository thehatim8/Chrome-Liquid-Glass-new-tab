import { storage } from './storage.js';

function tryEvaluateMathExpression(rawQuery) {
  const q = String(rawQuery || '').trim();
  if (!q) return null;
  const normalized = q.replace(/[xX]/g, '*');
  if (!/^[\d+\-*/().\s]+$/.test(normalized)) return null;
  if (!/[+\-*/]/.test(normalized)) return null;

  function precedence(op) {
    if (op === 'u-') return 3;
    if (op === '*' || op === '/') return 2;
    if (op === '+' || op === '-') return 1;
    return 0;
  }

  function isRightAssociative(op) {
    return op === 'u-';
  }

  function applyTop(values, ops) {
    const op = ops.pop();
    if (!op) throw new Error('Missing operator');
    if (op === 'u-') {
      const v = values.pop();
      if (!Number.isFinite(v)) throw new Error('Invalid unary operand');
      values.push(-v);
      return;
    }
    const b = values.pop();
    const a = values.pop();
    if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error('Invalid binary operands');
    if (op === '+') values.push(a + b);
    else if (op === '-') values.push(a - b);
    else if (op === '*') values.push(a * b);
    else if (op === '/') values.push(a / b);
    else throw new Error('Unknown operator');
  }

  try {
    const values = [];
    const ops = [];
    let i = 0;
    let prev = 'start'; // start | number | operator | lparen | rparen

    while (i < normalized.length) {
      const ch = normalized[i];
      if (/\s/.test(ch)) {
        i += 1;
        continue;
      }

      if (/\d|\./.test(ch)) {
        let j = i + 1;
        while (j < normalized.length && /[\d.]/.test(normalized[j])) j += 1;
        const n = Number(normalized.slice(i, j));
        if (!Number.isFinite(n)) return null;
        values.push(n);
        prev = 'number';
        i = j;
        continue;
      }

      if (ch === '(') {
        ops.push(ch);
        prev = 'lparen';
        i += 1;
        continue;
      }

      if (ch === ')') {
        while (ops.length && ops[ops.length - 1] !== '(') applyTop(values, ops);
        if (!ops.length || ops.pop() !== '(') return null;
        prev = 'rparen';
        i += 1;
        continue;
      }

      if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
        let op = ch;
        if (ch === '-' && (prev === 'start' || prev === 'operator' || prev === 'lparen')) {
          op = 'u-';
        } else if (prev !== 'number' && prev !== 'rparen') {
          return null;
        }

        while (ops.length && ops[ops.length - 1] !== '(') {
          const top = ops[ops.length - 1];
          const shouldApply = isRightAssociative(op)
            ? precedence(top) > precedence(op)
            : precedence(top) >= precedence(op);
          if (!shouldApply) break;
          applyTop(values, ops);
        }
        ops.push(op);
        prev = 'operator';
        i += 1;
        continue;
      }

      return null;
    }

    while (ops.length) {
      if (ops[ops.length - 1] === '(') return null;
      applyTop(values, ops);
    }

    if (values.length !== 1) return null;
    const result = values[0];
    if (typeof result !== 'number' || !Number.isFinite(result)) return null;
    return Number(result.toFixed(10)).toString();
  } catch (_) {
    return null;
  }
}

export async function initNotes(appState) {
  const notesInput = document.getElementById('notesInput');
  if (!notesInput) return;

  const res = await storage.get(['notesText']);
  notesInput.value = res.notesText || '';

  function isAutoMathEnabled() {
    return appState?.settings?.notesAutoMath !== false;
  }

  let saveTimer = null;
  notesInput.addEventListener('input', (e) => {
    if (isAutoMathEnabled() && e?.data === '=') {
      const caret = notesInput.selectionStart;
      const value = notesInput.value;
      const lineStart = value.lastIndexOf('\n', Math.max(0, caret - 2)) + 1;
      const expression = value.slice(lineStart, Math.max(lineStart, caret - 1));
      const result = tryEvaluateMathExpression(expression);
      if (result !== null) {
        notesInput.value = value.slice(0, caret) + result + value.slice(caret);
        const nextCaret = caret + result.length;
        notesInput.setSelectionRange(nextCaret, nextCaret);
      }
    }

    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      await storage.set({ notesText: notesInput.value });
    }, 180);
  });
}
