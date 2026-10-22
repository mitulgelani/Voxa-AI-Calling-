import { plivo } from './plivo.js';
import { telnyx } from './telnyx.js';
import type { Carrier, CarrierName } from './types.js';
export const carriers: Record<CarrierName, Carrier> = { plivo, telnyx };
export * from './types.js';
