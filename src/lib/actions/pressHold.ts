export type PressHoldParams = {
  onStart?: (e?: Event) => void;
  onEnd?: (e?: Event) => void;
  interval?: number;
};

export function pressHold(node: HTMLElement, params: PressHoldParams = {}) {
  let intervalId: any = null;
  let current = { ...params };

  function start(e: Event) {
    e.preventDefault();
    current.onStart?.(e);
    if (current.interval) {
      intervalId = setInterval(() => current.onStart?.(e), current.interval);
    }
  }

  function end(e: Event) {
    current.onEnd?.(e);
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  node.addEventListener('pointerdown', start);
  node.addEventListener('pointerup', end);
  node.addEventListener('pointercancel', end);
  node.addEventListener('pointerleave', end);
  node.addEventListener('touchstart', start, { passive: false });
  node.addEventListener('touchend', end);

  return {
    update(newParams: PressHoldParams) {
      current = { ...newParams };
    },
    destroy() {
      node.removeEventListener('pointerdown', start);
      node.removeEventListener('pointerup', end);
      node.removeEventListener('pointercancel', end);
      node.removeEventListener('pointerleave', end);
      node.removeEventListener('touchstart', start);
      node.removeEventListener('touchend', end);
    }
  };
}
