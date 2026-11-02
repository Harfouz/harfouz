import { gradientColorAt, inkOf, parseGradient, resolveColor, type GradientStop } from '../render/look';

/**
 * Gradient editor: a colour bar with one handle per colour stop.
 * - drag a handle to move its colour (arrow keys work too),
 * - click the bar to add a colour there,
 * - select a handle to change its colour or remove it (Delete key too).
 *
 * The bar reads left to right, like the gradient on the word at 0°.
 */
export function buildGradientEditor(
  id: string,
  get: () => string,
  set: (value: string) => void,
): { element: HTMLElement; refresh: () => void } {
  const root = document.createElement('div');
  root.className = 'gradient-editor';

  const bar = document.createElement('div');
  bar.className = 'gradient-editor__bar';
  bar.id = id;
  bar.title = 'Click to add a colour';
  const handles = document.createElement('div');
  handles.className = 'gradient-editor__handles';

  const details = document.createElement('div');
  details.className = 'gradient-editor__details';
  const swatch = document.createElement('input');
  swatch.type = 'color';
  swatch.className = 'swatch';
  swatch.setAttribute('aria-label', 'Colour of the selected stop');
  const position = document.createElement('output');
  position.className = 'control__value';
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'link-button';
  remove.textContent = 'Remove colour';
  details.append(swatch, position, remove);

  root.append(bar, handles, details);

  let selected = 0;
  /** While a handle is dragged, outside refreshes must not rebuild the handles. */
  let dragging = false;
  const ink = () => inkOf(root);
  const stops = () => parseGradient(get());
  const save = (next: GradientStop[]) => set(JSON.stringify(next));

  /** Keep the same stop selected after re-sorting by position. */
  function update(next: GradientStop[], keep: GradientStop) {
    next.sort((a, b) => a.pos - b.pos);
    selected = next.indexOf(keep);
    save(next);
    refresh();
  }

  const posFromEvent = (e: PointerEvent | MouseEvent) => {
    const rect = bar.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  };

  // Click on the bar: add a colour, taken from the gradient at that point.
  bar.addEventListener('click', (e) => {
    const list = stops();
    const pos = Math.round(posFromEvent(e) * 100) / 100;
    const stop = { pos, color: gradientColorAt(list, pos, ink()) };
    update([...list, stop], stop);
  });

  swatch.addEventListener('input', () => {
    const list = stops();
    if (!list[selected]) return;
    list[selected].color = swatch.value;
    update(list, list[selected]);
  });

  const removeSelected = () => {
    const list = stops();
    if (list.length <= 2) return;
    list.splice(selected, 1);
    selected = Math.max(0, selected - 1);
    save(list);
    refresh();
  };
  remove.addEventListener('click', removeSelected);

  function paintBar(list: GradientStop[]) {
    const colours = [...list]
      .sort((a, b) => a.pos - b.pos)
      .map((s) => `${resolveColor(s.color, ink())} ${(s.pos * 100).toFixed(1)}%`);
    bar.style.background = `linear-gradient(to right, ${colours.join(', ')})`;
  }

  function showDetails(stop: GradientStop, count: number) {
    swatch.value = resolveColor(stop.color, ink());
    position.value = `${Math.round(stop.pos * 100)}%`;
    remove.disabled = count <= 2;
  }

  function refresh() {
    if (dragging) return;
    const list = stops();
    selected = Math.min(selected, list.length - 1);
    paintBar(list);

    handles.replaceChildren(
      ...list.map((stop, i) => {
        const handle = document.createElement('button');
        handle.type = 'button';
        handle.className = 'gradient-editor__stop';
        handle.style.left = `${stop.pos * 100}%`;
        handle.style.setProperty('--stop', resolveColor(stop.color, ink()));
        handle.setAttribute('aria-pressed', String(i === selected));
        handle.setAttribute('aria-label', `Colour ${i + 1} at ${Math.round(stop.pos * 100)}%`);

        // Drag to move; a press without moving just selects. The handle is
        // moved in place while dragging (rebuilding it would lose the drag),
        // and the list is re-sorted when it is released.
        handle.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          handle.focus();
          selected = i;
          dragging = true;
          try {
            // Keep receiving moves even outside the handle.
            handle.setPointerCapture(e.pointerId);
          } catch {
            // Some pointers can't be captured; dragging still works over the bar.
          }
          for (const other of handles.children) other.setAttribute('aria-pressed', String(other === handle));
          const current = stops();
          const moving = current[i];
          showDetails(moving, current.length);
          const move = (ev: PointerEvent) => {
            moving.pos = Math.round(posFromEvent(ev) * 100) / 100;
            handle.style.left = `${moving.pos * 100}%`;
            paintBar(current);
            showDetails(moving, current.length);
            save(current);
          };
          const stopDrag = () => {
            handle.removeEventListener('pointermove', move);
            handle.removeEventListener('pointerup', stopDrag);
            dragging = false;
            update(current, moving);
            (handles.children[selected] as HTMLElement | undefined)?.focus();
          };
          handle.addEventListener('pointermove', move);
          handle.addEventListener('pointerup', stopDrag);
        });

        handle.addEventListener('keydown', (e) => {
          const current = stops();
          const stopNow = current[i];
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            const step = e.shiftKey ? 0.1 : 0.01;
            stopNow.pos = Math.min(1, Math.max(0, stopNow.pos + (e.key === 'ArrowRight' ? step : -step)));
            update(current, stopNow);
            (handles.children[selected] as HTMLElement | undefined)?.focus();
          } else if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            selected = i;
            removeSelected();
          }
        });
        return handle;
      }),
    );

    showDetails(list[selected], list.length);
  }

  return { element: root, refresh };
}
