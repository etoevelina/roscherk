// Реестр режимов (§6). Оболочка знает о режимах только через этот список и контракт §5.1.
// Порядок важен: Ежедневная чередует режимы как dayNumber % MODES.length (§3.2: zip → flow → stroke).
import zip from './zip.js';
import flow from './flow.js';
import stroke from './stroke.js';

export const MODES = [zip, flow, stroke];
export const MODE_BY_ID = Object.fromEntries(MODES.map((m) => [m.id, m]));
export const MODE_IDS = MODES.map((m) => m.id);
