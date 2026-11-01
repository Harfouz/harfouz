import type { ParamDef } from '../params/schema';

type Values = Record<string, number | string>;

function formatValue(def: ParamDef, value: number | string): string {
  if (def.kind === 'choice') return '';
  const n = Number(value);
  const digits = def.step < 1 ? 1 : 0;
  return `${n.toFixed(digits)}${def.unit ?? ''}`;
}

/**
 * Build one control per parameter definition inside `container`.
 * Double-clicking a label resets that parameter to its default.
 * Returns a function that refreshes every control from `values`.
 */
export function buildControls(
  container: HTMLElement,
  defs: readonly ParamDef[],
  values: Values,
  onChange: (key: string, value: number | string) => void,
): () => void {
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

      const refresh = () => {
        input.value = String(values[def.key]);
        output.value = formatValue(def, values[def.key]);
        // Fill the track up to the thumb (used by the CSS).
        const t = (Number(values[def.key]) - def.min) / (def.max - def.min);
        input.style.setProperty('--fill', `${t * 100}%`);
        row.classList.toggle('is-default', Number(values[def.key]) === def.default);
      };
      input.addEventListener('input', () => {
        onChange(def.key, Number(input.value));
        refresh();
      });
      label.addEventListener('dblclick', () => {
        onChange(def.key, def.default);
        refresh();
      });
      row.append(output, input);
      refreshers.push(refresh);
    } else {
      const select = document.createElement('select');
      select.id = id;
      select.className = 'select';
      for (const o of def.options) select.add(new Option(o.label, o.value));
      const refresh = () => {
        select.value = String(values[def.key]);
      };
      select.addEventListener('change', () => onChange(def.key, select.value));
      label.addEventListener('dblclick', () => {
        onChange(def.key, def.default);
        refresh();
      });
      row.appendChild(select);
      refreshers.push(refresh);
    }

    container.appendChild(row);
  }

  const refreshAll = () => refreshers.forEach((r) => r());
  refreshAll();
  return refreshAll;
}
