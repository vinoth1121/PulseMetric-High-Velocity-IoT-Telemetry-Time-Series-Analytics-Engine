import { AdapterFn, CanonicalReading, IngestContext } from './types.js';
import { v1Adapter } from './v1.js';
import { v2Adapter } from './v2.js';
import { v3Adapter } from './v3.js';

export class UnknownFirmwareError extends Error {
  public model: string;
  public firmware: string;

  constructor(model: string, firmware: string) {
    super(`No adapter registered for model="${model}" and firmware="${firmware}"`);
    this.name = 'UnknownFirmwareError';
    this.model = model;
    this.firmware = firmware;
  }
}

export class AdapterRegistry {
  private registry = new Map<string, AdapterFn>();

  constructor() {
    this.registerDefaults();
  }

  private makeKey(model: string, firmware: string): string {
    return `${model.trim().toLowerCase()}::${firmware.trim().toLowerCase()}`;
  }

  private registerDefaults(): void {
    // v1 variations
    this.register('model-alpha', 'v1.0', v1Adapter);
    this.register('model-alpha', '1.0', v1Adapter);
    this.register('sensornode-a', 'v1.0', v1Adapter);
    this.register('default', 'v1.0', v1Adapter);

    // v2 variations
    this.register('model-beta', 'v2.0', v2Adapter);
    this.register('model-beta', '2.0', v2Adapter);
    this.register('enviromon-b', 'v2.0', v2Adapter);
    this.register('default', 'v2.0', v2Adapter);

    // v3 variations
    this.register('model-gamma', 'v3.0', v3Adapter);
    this.register('model-gamma', '3.0', v3Adapter);
    this.register('baroguard-c', 'v3.0', v3Adapter);
    this.register('default', 'v3.0', v3Adapter);
  }

  public register(model: string, firmware: string, adapter: AdapterFn): void {
    const key = this.makeKey(model, firmware);
    this.registry.set(key, adapter);
  }

  public normalize(raw: Record<string, any>, context?: IngestContext): CanonicalReading[] {
    const model = String(raw.model || 'default');
    const firmware = String(raw.firmware || 'unknown');

    // Specific key first
    let adapter = this.registry.get(this.makeKey(model, firmware));

    // Fallback by firmware alone
    if (!adapter) {
      adapter = this.registry.get(this.makeKey('default', firmware));
    }

    if (!adapter) {
      throw new UnknownFirmwareError(model, firmware);
    }

    return adapter(raw, context);
  }
}

export const defaultRegistry = new AdapterRegistry();
