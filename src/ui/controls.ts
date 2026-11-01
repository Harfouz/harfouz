import type { ParamDef } from '../params/schema';
import { inkOf } from '../render/look';

type Value = number | string;

/** How a group of controls reads and writes its values. */
export interface ControlBinding {
  get(key: string): Value;
  set(key: string, value: Value): void;
  /** Double-click on a label. */
  reset(key: string): void;
  /** Highlighted value: differs from the default, or overridden on this letter. */
  isModified(key: string): boolean;
  /** Hidden when false (e.g. a word-only parameter while editing a letter). */
  isAvailable(def: ParamDef): boolean;
  /**
   * Optional: add extra UI to a row (e.g. the animate button). Returns a
   * function called on every refresh.
   */
  decorate?(def: ParamDef, row: HTMLElement): () => void;
}

function formatValue(def: ParamDef, value: Value): string {
  if (def.kind === 'choice') return '';
  if (def.kind === 'color') return value === 'ink' ? 'ink' : String(value);
  const n = Number(value);
  const digits = def.step < 1 ? 1 : 0;
  return `${n.toFixed(digits)}${def.unit ?? ''}`;
}

/**
 * Build one control per parameter definition inside `container`.
 * Returns a function that refreshes every control from the binding
 * (call it when the values or the edited letter change).
 */
export function buildControls(container: HTMLElement, defs: readonly ParamDef[], binding: ControlBinding) {
  const refreshers: (() => void)[] = [];

  for (const def of defs) {
    const id = `param-${def.key}`;
    const row = document.createElement('div');
    row.className = `control control--${def.kind}`;

    const label = document.createElement('label');
    label.className = 'control__label';
    label.htmlFor = id;
    label.textContent = def.label;
    label.title = [def.hint, 'Double-click to reset.'].filter(Boolean).join(' ');
    row.appendChild(label);

    let refreshInput: () => void;
    if (def.kind === 'range') {
      const output = document.createElement('output');
      output.className = 'control__value';
      output.htmlFor.add(id);

      const input = document.createElement('input');
      input.type = 'range';
      input.id = id;
      input.min = String(def.min);
      input.max = String(def.max);
      input.step = String(def.step);
      input.addEventListener('input', () => {
        binding.set(def.key, Number(input.value));
        refresh();
      });
      refreshInput = () => {
        const value = binding.get(def.key);
        input.value = String(value);
        output.value = formatValue(def, value);
        // Fill the track up to the thumb (used by the CSS).
        const t = (Number(value) - def.min) / (def.max - def.min);
        input.style.setProperty('--fill', `${t * 100}%`);
      };
      row.append(output, input);
    } else if (def.kind === 'color') {
      const output = document.createElement('output');
      output.className = 'control__value';
      const input = document.createElement('input');
      input.type = 'color';
      input.id = id;
      input.className = 'swatch';
      input.addEventListener('input', () => {
        binding.set(def.key, input.value);
        refresh();
      });
      refreshInput = () => {
        const value = String(binding.get(def.key));
        // 'ink' follows the theme; show the colour it currently is.
        input.value = value === 'ink' ? inkOf(container) : value;
        output.value = formatValue(def, value);
      };
      row.append(output, input);
    } else {
      const select = document.createElement('select');
      select.id = id;
      select.className = 'select';
      for (const o of def.options) select.add(new Option(o.label, o.value));
      select.addEventListener('change', () => {
        binding.set(def.key, select.value);
        refresh();
      });
      refreshInput = () => {
        select.value = String(binding.get(def.key));
      };
      row.appendChild(select);
    }

    const refreshExtra = binding.decorate?.(def, row);
    const refresh = () => {
      row.hidden = !binding.isAvailable(def);
      row.classList.toggle('is-modified', binding.isModified(def.key));
      refreshInput();
      refreshExtra?.();
    };
    label.addEventListener('dblclick', () => {
      binding.reset(def.key);
      refresh();
    });
    refreshers.push(refresh);
    container.appendChild(row);
  }

  const refreshAll = () => refreshers.forEach((r) => r());
  refreshAll();
  return refreshAll;
}
