/** Static facts about the six preset families, shared by generation, rendering and the UI. */
import type { Decoration, PresetId } from './schema.ts';

export interface PresetMeta {
  id: PresetId;
  name: string;
  summary: string;
  /** Decorations this composition can draw. The first entry is its default. */
  decorations: Decoration[];
  /** What `frame.radius` controls here, for the inspector label. */
  radiusLabel: string;
  /** Where caption text sits, which decides what the text colour must contrast with. */
  textOn: 'frame' | 'light';
}

export const PRESET_META: Record<PresetId, PresetMeta> = {
  precision: {
    id: 'precision',
    name: 'Precision',
    summary: 'Crisp geometry, restrained framing, a quiet caption line.',
    decorations: ['ticks', 'hairline', 'none'],
    radiusLabel: 'Corner radius',
    textOn: 'frame',
  },
  soft: {
    id: 'soft',
    name: 'Soft',
    summary: 'Rounded card, gentle shapes behind a light panel.',
    decorations: ['blobs', 'halo', 'none'],
    radiusLabel: 'Card roundness',
    textOn: 'frame',
  },
  editorial: {
    id: 'editorial',
    name: 'Editorial',
    summary: 'Portrait layout led by typography, with the logo set outside.',
    decorations: ['rules', 'bar', 'none'],
    radiusLabel: 'Corner radius',
    textOn: 'frame',
  },
  technical: {
    id: 'technical',
    name: 'Technical',
    summary: 'Dark chamfered plate with angular modules and measured marks.',
    decorations: ['brackets', 'ruler', 'grid', 'none'],
    radiusLabel: 'Corner cut',
    textOn: 'frame',
  },
  emblem: {
    id: 'emblem',
    name: 'Emblem',
    summary: 'Circular badge around the square symbol, lettering on the ring.',
    decorations: ['double-ring', 'beads', 'scallop', 'none'],
    radiusLabel: 'Ring detail',
    textOn: 'frame',
  },
  pattern: {
    id: 'pattern',
    name: 'Pattern',
    summary: 'A repeated motif fills the surround; the symbol sits on its own panel.',
    decorations: ['dots', 'diagonal', 'plus', 'waves', 'logo-tile', 'none'],
    radiusLabel: 'Corner radius',
    textOn: 'light',
  },
};

export const DECORATION_LABELS: Record<Decoration, string> = {
  none: 'None',
  ticks: 'Corner ticks',
  hairline: 'Hairline',
  blobs: 'Soft shapes',
  halo: 'Halo',
  rules: 'Rules',
  bar: 'Accent bar',
  brackets: 'Brackets',
  ruler: 'Ruler ticks',
  grid: 'Grid',
  'double-ring': 'Double ring',
  beads: 'Beads',
  scallop: 'Scalloped edge',
  dots: 'Dots',
  diagonal: 'Diagonal stripes',
  plus: 'Plus signs',
  waves: 'Waves',
  'logo-tile': 'Logo tiles',
};
