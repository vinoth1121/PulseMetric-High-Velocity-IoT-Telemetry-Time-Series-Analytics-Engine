export interface CanonicalReading {
  ts: Date;
  meta: {
    deviceId: string;
    metric: string;
    facilityId: string;
    model: string;
    firmware: string;
  };
  value: number;
  synthetic?: boolean;
}

export interface IngestContext {
  defaultFacilityId?: string;
}

export type AdapterFn = (raw: Record<string, any>, context?: IngestContext) => CanonicalReading[];

export interface AdapterRegistration {
  model: string;
  firmware: string;
  adapter: AdapterFn;
}
