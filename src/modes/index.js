// Реестр режимов (§6). Оболочка знает о режимах только через этот список и контракт §5.1.
// Порядок важен: Ежедневная чередует режимы как dayNumber % ROTATION_IDS.length (§3.2: zip → flow → stroke).
// «Слова» (§2.5) и «Карандаш» (§2.6) — только кампания (campaignOnly): в Ежедневную и Бесконечность не входят.
import zip from './zip.js';
import flow from './flow.js';
import stroke from './stroke.js';
import words from './words.js';
import draw from './draw.js';

export const MODES = [zip, flow, stroke, words, draw];
export const MODE_BY_ID = Object.fromEntries(MODES.map((m) => [m.id, m]));
export const MODE_IDS = MODES.map((m) => m.id);
/** Режимы Ежедневной и Бесконечности (без campaignOnly). */
export const ROTATION_MODES = MODES.filter((m) => !m.campaignOnly);
export const ROTATION_IDS = ROTATION_MODES.map((m) => m.id);
