import { describe, it, expect } from 'vitest';
import { defaultRoi, mirrorRoi, squareRoi, roiPixelSize, roiCropStyle } from './roi';

/** Pixel aspect of a region on a frame of the given aspect; 1 means square. */
const pixelAspect = (r: { w: number; h: number }, aspect: number) => (r.w * aspect) / r.h;

describe('defaultRoi', () => {
  it('is square in pixels on a landscape frame', () => {
    expect(pixelAspect(defaultRoi(4 / 3), 4 / 3)).toBeCloseTo(1);
    expect(pixelAspect(defaultRoi(16 / 9), 16 / 9)).toBeCloseTo(1);
  });

  it('is square in pixels on a portrait frame', () => {
    expect(pixelAspect(defaultRoi(3 / 4), 3 / 4)).toBeCloseTo(1);
  });

  it('fills the short side of the frame, so nothing is given away', () => {
    // Landscape: full height. Portrait: full width. Either way one axis is 1.
    expect(defaultRoi(4 / 3).h).toBeCloseTo(1);
    expect(defaultRoi(4 / 3).w).toBeCloseTo(0.75);
    expect(defaultRoi(3 / 4).w).toBeCloseTo(1);
    expect(defaultRoi(1).w).toBeCloseTo(1);
    expect(defaultRoi(1).h).toBeCloseTo(1);
  });

  it('stays centred and inside the frame', () => {
    for (const aspect of [4 / 3, 16 / 9, 1, 3 / 4]) {
      const r = defaultRoi(aspect);
      expect(r.x + r.w / 2).toBeCloseTo(0.5);
      expect(r.y + r.h / 2).toBeCloseTo(0.5);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(1);
      expect(r.y + r.h).toBeLessThanOrEqual(1);
    }
  });

  it('survives mirroring, which only moves it sideways', () => {
    const r = defaultRoi(4 / 3);
    const m = mirrorRoi(r); // centred, so its own mirror
    expect(m.x).toBeCloseTo(r.x);
    expect(m.w).toBeCloseTo(r.w);
    expect(m.h).toBeCloseTo(r.h);
  });
});

describe('squareRoi', () => {
  const A = 4 / 3;
  // Deliberately not defaultRoi(): that one already fills the frame, so every
  // grow would clamp and the anchoring assertions would test the clamp instead.
  // Not square either — squaring a rectangle is the normal case here.
  const start = { x: 0.25, y: 0.2, w: 0.3, h: 0.4 };

  it('leaves a move untouched', () => {
    const moved = { ...start, x: 0.1 };
    expect(squareRoi(moved, start, 'move', A)).toEqual(moved);
  });

  it('squares an edge drag and keeps the opposite edge fixed', () => {
    // Dragging the east edge out: right edge follows, left edge must not move.
    const dragged = { ...start, w: start.w + 0.2 };
    const r = squareRoi(dragged, start, 'e', A);
    expect(pixelAspect(r, A)).toBeCloseTo(1);
    expect(r.x).toBeCloseTo(start.x);
    expect(r.w).toBeCloseTo(dragged.w);
  });

  it('keeps the anchored corner in place on a corner drag', () => {
    // South-east corner drag: the north-west corner is the anchor.
    const dragged = { ...start, w: start.w - 0.2, h: start.h - 0.1 };
    const r = squareRoi(dragged, start, 'se', A);
    expect(pixelAspect(r, A)).toBeCloseTo(1);
    expect(r.x).toBeCloseTo(start.x);
    expect(r.y).toBeCloseTo(start.y);
  });

  it('keeps the south-east corner in place when dragging north-west', () => {
    const dragged = { x: start.x - 0.1, y: start.y - 0.1, w: start.w + 0.1, h: start.h + 0.1 };
    const r = squareRoi(dragged, start, 'nw', A);
    expect(pixelAspect(r, A)).toBeCloseTo(1);
    expect(r.x + r.w).toBeCloseTo(start.x + start.w);
    expect(r.y + r.h).toBeCloseTo(start.y + start.h);
  });

  it('grows a north/south drag around the horizontal centre', () => {
    const dragged = { ...start, h: start.h - 0.3 };
    const r = squareRoi(dragged, start, 's', A);
    expect(pixelAspect(r, A)).toBeCloseTo(1);
    expect(r.x + r.w / 2).toBeCloseTo(start.x + start.w / 2);
    expect(r.y).toBeCloseTo(start.y);
  });

  it('shrinks both axes rather than clipping when it would leave the frame', () => {
    const dragged = { x: 0, y: 0, w: 1, h: 1 };
    const r = squareRoi(dragged, { x: 0, y: 0, w: 0.5, h: 0.5 }, 'se', A);
    expect(pixelAspect(r, A)).toBeCloseTo(1);
    expect(r.x + r.w).toBeLessThanOrEqual(1 + 1e-9);
    expect(r.y + r.h).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('never leaves the frame or collapses, whatever the handle', () => {
    const handles = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;
    for (const h of handles) {
      // -0.4 overshoots start.w, so the box arrives inverted: the floor inside
      // squareRoi is what keeps that from becoming a zero-size region.
      for (const d of [-0.4, -0.1, 0.1, 0.4]) {
        const dragged = { x: start.x - d, y: start.y - d, w: start.w + d, h: start.h + d };
        const r = squareRoi(dragged, start, h, A);
        expect(r.w, `w for ${h} at ${d}`).toBeGreaterThanOrEqual(0.05 - 1e-9);
        expect(r.h, `h for ${h} at ${d}`).toBeGreaterThanOrEqual(0.05 - 1e-9);
        expect(r.x).toBeGreaterThanOrEqual(-1e-9);
        expect(r.y).toBeGreaterThanOrEqual(-1e-9);
        expect(r.x + r.w).toBeLessThanOrEqual(1 + 1e-9);
        expect(r.y + r.h).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });
});

describe('roiPixelSize', () => {
  it('measures the full frame when there is no region', () => {
    expect(roiPixelSize(null, 4 / 3, 720)).toEqual({ w: 960, h: 720 });
  });

  it('measures the default as the frame short side, squared', () => {
    const { w, h } = roiPixelSize(defaultRoi(4 / 3), 4 / 3, 720);
    expect(w).toBe(h);
    expect(h).toBe(720);
  });

  it('reports a region below the model input as such', () => {
    const small = { x: 0.4, y: 0.4, w: 0.15, h: 0.2 };
    const { w, h } = roiPixelSize(small, 4 / 3, 720);
    expect(Math.min(w, h)).toBeLessThan(224);
  });
});

describe('roiCropStyle', () => {
  it('places the region exactly over the box', () => {
    const roi = { x: 0.15, y: 0.15, w: 0.7, h: 0.7 };
    const style = roiCropStyle(roi);
    // "left:-21.429%; top:-21.429%; width:142.857%; height:142.857%;"
    const declared = new Map(
      style
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const [prop, value] = part.split(':');
          return [prop, Number(value.replace('%', ''))] as const;
        })
    );
    const get = (prop: string) => {
      const value = declared.get(prop);
      expect(value, `${prop} in "${style}"`).toBeTypeOf('number');
      return value!;
    };
    // Box is 100 units wide. The image spans width%, and the region's own offset
    // inside the image must land the region's top-left on the box's origin.
    const width = get('width');
    const height = get('height');
    expect(get('left') + roi.x * width).toBeCloseTo(0, 2);
    expect(get('top') + roi.y * height).toBeCloseTo(0, 2);
    // ...and the region must be exactly as big as the box.
    expect(roi.w * width).toBeCloseTo(100, 2);
    expect(roi.h * height).toBeCloseTo(100, 2);
  });

  it('shows the whole image when there is no region', () => {
    expect(roiCropStyle(null)).toContain('width:100%');
    expect(roiCropStyle({ x: 0, y: 0, w: 0, h: 0 })).toContain('height:100%');
  });
});
